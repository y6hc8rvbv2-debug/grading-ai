// ============================================================================
// 採点モデルの比較試験（Haiku / Sonnet / Opus）
//
//   npm run compare:models -- --image <答案画像のパス> [--dry-run] [--with-answer-key]
//
// - アプリの採点と同じ指示文・出力形式（lib/ai/grade.ts の buildGradingPrompt）を使う
// - 同じ画像・同じ指示・同じ採点基準を、各モデルに1回ずつ独立して送る（他モデルの回答は渡さない）
// - 自動再試行なし（maxRetries: 0）・別モデルへの自動切り替えなし（fallbacks を付けない）
// - モデルID は Models API で表示名から確認する。見つからないモデルは代わりを使わず「利用不可」と記録する
// - 期待結果（expected.json）は全モデルの採点が終わってから読み込み、照合にだけ使う
// - 結果は scripts/model-compare/results/ に保存する（DB の答案・成績には書き込まない）
// - ANTHROPIC_API_KEY は環境変数から読むだけで、画面・ログ・結果ファイルに出さない
// ============================================================================
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildGradingPrompt, readGradingResponse, normalizeResult, OUTPUT_SCHEMA,
  type AnswerPage, type GradeTest, type NormalizedItem,
} from "../../lib/ai/grade";
import { DEFAULT_RUBRIC } from "../../lib/grading/engine";
import type { Rubric } from "../../lib/types";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ 設定 */

// 候補（表示名）。Models API の display_name と完全一致したものだけを使う
const CANDIDATES = ["Claude Haiku 4.5", "Claude Sonnet 5.5", "Claude Opus 5"];

// 公式単価（USD / 100万トークン）。出典: https://platform.claude.com/docs/en/about-claude/pricing
// 2026-09-29 取得。標準（バッチ・データ所在地指定なし）の料金。
const PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing（2026-09-29 取得）";
const PRICES: Record<string, { input: number; cacheWrite5m: number; cacheRead: number; output: number }> = {
  "Claude Haiku 4.5": { input: 1, cacheWrite5m: 1.25, cacheRead: 0.10, output: 5 },
  "Claude Sonnet 5.5": { input: 2, cacheWrite5m: 2.50, cacheRead: 0.20, output: 10 },
  "Claude Opus 5": { input: 5, cacheWrite5m: 6.25, cacheRead: 0.50, output: 25 },
};

// 採点基準：各問20点、正答のみ加点、部分点なし
const RUBRIC: Rubric = { ...DEFAULT_RUBRIC, partialStep: 1, workPartial: false, unitPartial: false, praiseFull: true };

function buildTest(withAnswerKey: boolean): GradeTest {
  // 正答（6, 18, 36, 72, 144）は既定では渡さない。期待結果の「正解」と重なるため。
  // 問題文は答案に印刷されているので、モデルは画像から問題を読み、正しい答えを求めて判定する。
  const key = ["6", "18", "36", "72", "144"];
  return {
    subject: "算数",
    name: "算数テスト（比較試験）",
    grade: 1,
    answerLang: "ja",
    questions: [1, 2, 3, 4, 5].map((no) => ({
      no,
      label: `(${no})`,
      type: "calc" as const,
      typeLabel: "計算",
      unit: "たし算",
      points: 20,
      correct: withAnswerKey ? key[no - 1] : "",
      model: withAnswerKey ? "" : `答案に印刷された ${"①②③④⑤"[no - 1]} の計算問題の正しい答え（問題文から求める）`,
      keywords: [],
    })),
  };
}

/* ------------------------------------------------------------------ 補助 */

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const log = (...a: unknown[]) => console.log(...a);
const yen = (usd: number) => `$${usd.toFixed(6)}`;

function mediaTypeOf(file: string): AnswerPage | null {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return { kind: "image", mediaType: "image/jpeg", data: "" };
  if (ext === ".png") return { kind: "image", mediaType: "image/png", data: "" };
  if (ext === ".webp") return { kind: "image", mediaType: "image/webp", data: "" };
  if (ext === ".gif") return { kind: "image", mediaType: "image/gif", data: "" };
  return null;
}

/** エラーを記録用の文字列にする（APIキーは含めない） */
function describeError(e: unknown): string {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  let s: string;
  if (e instanceof Anthropic.APIError) s = `${e.constructor.name}（HTTP ${e.status ?? "-"}）: ${e.message}`;
  else if (e instanceof Error) s = `${e.name}: ${e.message}`;
  else s = String(e);
  return key ? s.split(key).join("[REDACTED]") : s;
}

type RunResult = {
  displayName: string;
  modelId: string | null;
  status: "ok" | "unavailable" | "failed" | "not-run";
  reason?: string;
  servedModel?: string;
  stopReason?: string | null;
  elapsedMs?: number;
  usage?: { input: number; output: number; cacheWrite: number; cacheRead: number };
  costUsd?: number | null;
  items?: NormalizedItem[];
  raw?: unknown;
  total?: number;
};

/* ------------------------------------------------------------------ 本体 */

async function main() {
  const dryRun = flag("--dry-run");
  const withAnswerKey = flag("--with-answer-key");
  const imagePath = opt("--image");
  const startedAt = new Date().toISOString();

  if (!imagePath) {
    log("✗ 答案画像を指定してください: npm run compare:models -- --image <パス>");
    process.exit(2);
  }

  /* -------- 答案画像 */
  const page = mediaTypeOf(imagePath);
  if (!page || page.kind !== "image") {
    log("✗ JPEG / PNG / WebP / GIF の画像を指定してください（HEIC・PDF はこの試験では使いません）");
    process.exit(2);
  }
  const buf = await readFile(imagePath);
  if (buf.length > 5 * 1024 * 1024) {
    log(`✗ 画像が5MBを超えています（${(buf.length / 1024 / 1024).toFixed(1)}MB）。長辺2400px程度に縮小してから指定してください`);
    process.exit(2);
  }
  page.data = buf.toString("base64");
  const imageSha256 = createHash("sha256").update(buf).digest("hex");

  /* -------- 3モデル共通の入力（ここで1回だけ作り、全モデルに同じものを渡す） */
  const test = buildTest(withAnswerKey);
  const { system, content } = buildGradingPrompt({ pages: [page], test, rubric: RUBRIC });
  const promptText = content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n");
  const requestFingerprint = createHash("sha256")
    .update(JSON.stringify({ system, content, schema: OUTPUT_SCHEMA })).digest("hex");

  log("== 比較試験の入力");
  log(`  画像: ${path.basename(imagePath)}（${(buf.length / 1024).toFixed(0)}KB、sha256 ${imageSha256.slice(0, 16)}…）`);
  log(`  採点基準: 各問20点・正答のみ加点・部分点なし（partialStep=1）`);
  log(`  正答（答案キー）: ${withAnswerKey ? "渡す" : "渡さない（問題文から求めさせる）"}`);
  log(`  入力の指紋: ${requestFingerprint.slice(0, 16)}…（3モデルとも同一）`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (dryRun || !apiKey) {
    if (!apiKey) {
      log("");
      log("✗ ANTHROPIC_API_KEY が設定されていないため、Models API の確認と採点は実行していません。");
      log("  キーはチャットに貼らず、実行する環境の環境変数に設定してください（scripts/model-compare/README.md）。");
    }
    log("");
    log("== 採点モデルに送る指示（画像以外）");
    log(system);
    log("---");
    log(promptText);
    process.exit(apiKey ? 0 : 3);
  }

  const client = new Anthropic({ apiKey, maxRetries: 0 });

  /* -------- Models API でモデルID を確認（代わりのモデルは選ばない） */
  log("");
  log("== Models API でモデルを確認");
  const available = new Map<string, string>();   // display_name → id
  const allModels: { id: string; display_name: string }[] = [];
  try {
    for await (const m of client.models.list()) {
      allModels.push({ id: m.id, display_name: m.display_name });
      if (CANDIDATES.includes(m.display_name) && !available.has(m.display_name)) available.set(m.display_name, m.id);
    }
  } catch (e) {
    log(`✗ Models API を呼べませんでした: ${describeError(e)}`);
    log("  採点は実行していません。");
    process.exit(4);
  }
  for (const name of CANDIDATES) {
    log(`  ${name}: ${available.has(name) ? `利用可（${available.get(name)}）` : "利用不可（Models API に見つからない。代わりのモデルは使いません）"}`);
  }

  /* -------- 各モデルで1回ずつ採点（順番に・独立して） */
  const results: RunResult[] = [];
  for (const name of CANDIDATES) {
    const id = available.get(name) ?? null;
    if (!id) {
      results.push({ displayName: name, modelId: null, status: "unavailable", reason: "Models API に見つからないため未実行" });
      continue;
    }
    log("");
    log(`== ${name}（${id}）で採点しています…`);
    const t0 = performance.now();
    try {
      // 全モデル同じ本文。thinking・effort は指定せず各モデルの既定のまま（Haiku 4.5 は adaptive/effort 非対応のため）
      const res = await client.beta.messages.create({
        model: id,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content }],
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
      });
      const elapsedMs = Math.round(performance.now() - t0);
      const u = res.usage;
      const usage = {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
      };
      const p = PRICES[name];
      const costUsd = p
        ? (usage.input * p.input + usage.output * p.output + usage.cacheWrite * p.cacheWrite5m + usage.cacheRead * p.cacheRead) / 1_000_000
        : null;
      const base = { displayName: name, modelId: id, servedModel: res.model, stopReason: res.stop_reason, elapsedMs, usage, costUsd };
      try {
        const { parsed } = readGradingResponse(res);
        const { items } = normalizeResult(parsed, test, RUBRIC);
        results.push({ ...base, status: "ok", items, raw: parsed, total: items.reduce((a, i) => a + i.earned, 0) });
        log(`  完了（${(elapsedMs / 1000).toFixed(1)}秒、入力 ${usage.input} / 出力 ${usage.output} トークン）`);
      } catch (e) {
        results.push({ ...base, status: "failed", reason: `応答を読み取れません: ${describeError(e)}` });
        log(`  ✗ 応答を読み取れません: ${describeError(e)}`);
      }
    } catch (e) {
      const elapsedMs = Math.round(performance.now() - t0);
      results.push({ displayName: name, modelId: id, status: "failed", elapsedMs, reason: describeError(e) });
      log(`  ✗ 失敗（再試行しません）: ${describeError(e)}`);
    }
  }

  /* -------- 期待結果と照合（ここで初めて期待結果を読む） */
  const expected = JSON.parse(await readFile(path.join(HERE, "expected.json"), "utf8")) as {
    questions: { qno: number; studentAnswer: string; correctAnswer: string; correct: boolean; earned: number }[];
    total: number; maxScore: number;
  };
  const digits = (s: string) => (s.match(/-?\d+/g) ?? []).join(" ");
  const judged = results.map((r) => {
    if (r.status !== "ok" || !r.items) return { ...r, match: null };
    const perQ = expected.questions.map((e) => {
      const it = r.items!.find((i) => i.qno === e.qno);
      const readOk = !!it && digits(it.detected).split(" ").includes(e.studentAnswer);
      const verdictOk = !!it && (e.correct ? it.mark === "○" : it.mark === "×");
      const scoreOk = !!it && it.earned === e.earned;
      return { qno: e.qno, readOk, verdictOk, scoreOk, all: readOk && verdictOk && scoreOk };
    });
    return { ...r, match: { perQ, totalOk: r.total === expected.total, allOk: perQ.every((q) => q.all) && r.total === expected.total } };
  });

  /* -------- 保存（DB には書き込まない） */
  const stamp = startedAt.replace(/[:.]/g, "-");
  const outDir = path.join(HERE, "results", stamp);
  await mkdir(outDir, { recursive: true });
  const record = {
    startedAt,
    finishedAt: new Date().toISOString(),
    image: { file: path.basename(imagePath), bytes: buf.length, sha256: imageSha256 },
    settings: {
      rubric: "各問20点・正答のみ加点・部分点なし", partialStep: RUBRIC.partialStep,
      answerKeySent: withAnswerKey, maxRetries: 0, fallbacks: "なし",
      thinking: "未指定（各モデルの既定）", maxTokens: 16000, requestFingerprint,
    },
    pricingSource: PRICING_SOURCE,
    modelsApi: { candidates: CANDIDATES, resolved: Object.fromEntries(available), listed: allModels.length },
    results: judged,
  };
  await writeFile(path.join(outDir, "result.json"), JSON.stringify(record, null, 2));
  const md = renderReport(record, expected);
  await writeFile(path.join(outDir, "report.md"), md);

  log("");
  log(md);
  log(`保存先: ${path.relative(process.cwd(), outDir)}/（result.json・report.md）`);
}

/* ------------------------------------------------------------------ 表 */

function renderReport(record: {
  startedAt: string; image: { file: string; sha256: string };
  settings: { answerKeySent: boolean; requestFingerprint: string };
  pricingSource: string;
  results: Array<RunResult & { match: null | { perQ: { qno: number; readOk: boolean; verdictOk: boolean; scoreOk: boolean; all: boolean }[]; totalOk: boolean; allOk: boolean } }>;
}, expected: { questions: { qno: number; studentAnswer: string; correctAnswer: string; correct: boolean; earned: number }[]; total: number; maxScore: number }) {
  const L: string[] = [];
  const mark = (b: boolean) => (b ? "✓" : "✗");
  L.push(`# 採点モデル比較試験（${record.startedAt}）`);
  L.push("");
  L.push(`- 画像: ${record.image.file}（sha256 ${record.image.sha256.slice(0, 16)}…）`);
  L.push(`- 採点基準: 各問20点・正答のみ加点・部分点なし／正答（答案キー）: ${record.settings.answerKeySent ? "渡した" : "渡していない"}`);
  L.push(`- 3モデル共通の入力（指紋 ${record.settings.requestFingerprint.slice(0, 16)}…）、各1回、自動再試行なし、別モデルへの切り替えなし`);
  L.push(`- 料金の出典: ${record.pricingSource}`);
  L.push("");
  L.push("## 概要");
  L.push("");
  L.push("| モデル | 正式なモデルID | 状態 | 合計点 | 期待結果（60点）と一致 | 処理時間 | 入力トークン | 出力トークン | 概算API費用 |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of record.results) {
    const status = r.status === "ok" ? "完了" : r.status === "unavailable" ? "利用不可（未実行）" : r.status === "failed" ? "失敗" : "未実行";
    L.push(`| ${r.displayName} | ${r.modelId ?? "—"} | ${status} | ${r.total ?? "—"}${r.total != null ? `/${expected.maxScore}` : ""} | ${r.match ? (r.match.allOk ? "✓ 全問一致" : `✗（${r.match.perQ.filter((q) => q.all).length}/5問一致${r.match.totalOk ? "・合計は一致" : ""}）`) : "—"} | ${r.elapsedMs != null ? `${(r.elapsedMs / 1000).toFixed(1)}秒` : "—"} | ${r.usage?.input ?? "—"} | ${r.usage?.output ?? "—"} | ${r.costUsd != null ? yen(r.costUsd) : "—"} |`);
  }
  L.push("");
  L.push("## 設問ごと");
  for (const r of record.results) {
    L.push("");
    L.push(`### ${r.displayName}${r.modelId ? `（${r.modelId}）` : ""}`);
    if (r.status !== "ok" || !r.items || !r.match) { L.push(""); L.push(`未実行または失敗: ${r.reason ?? "—"}`); continue; }
    L.push("");
    L.push("| 問 | 読み取り | 正誤 | 得点 | 期待（生徒の答え／正誤／得点） | 読み取り | 正誤 | 得点 |");
    L.push("|---|---|---|---|---|---|---|---|");
    for (const e of expected.questions) {
      const it = r.items.find((i) => i.qno === e.qno)!;
      const m = r.match.perQ.find((q) => q.qno === e.qno)!;
      L.push(`| ${"①②③④⑤"[e.qno - 1]} | ${it.detected || "（空）"} | ${it.mark} | ${it.earned} | ${e.studentAnswer}／${e.correct ? "正答" : `誤答（正解${e.correctAnswer}）`}／${e.earned} | ${mark(m.readOk)} | ${mark(m.verdictOk)} | ${mark(m.scoreOk)} |`);
    }
    L.push(`| 合計 | | | ${r.total} | ${expected.total} | | | ${mark(r.match.totalOk)} |`);
    if (r.usage) {
      L.push("");
      L.push(`トークン: 入力 ${r.usage.input}・出力 ${r.usage.output}（思考を含む）・キャッシュ書込 ${r.usage.cacheWrite}・キャッシュ読込 ${r.usage.cacheRead}／応答したモデル: ${r.servedModel}／stop_reason: ${r.stopReason}`);
    }
  }
  L.push("");
  L.push("※ 読み取り・正誤・得点はアプリの後処理（normalizeResult）を通した値。後処理前の出力は result.json の raw にある。");
  return L.join("\n");
}

main().catch((e) => {
  console.error(`✗ 予期しないエラー: ${describeError(e)}`);
  process.exit(1);
});
