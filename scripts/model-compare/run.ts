// ============================================================================
// 採点モデルの比較試験（Haiku / Sonnet / Opus）
//
//   npm run compare:models -- --image <答案画像のパス> [--dry-run] [--with-answer-key]
//
// - アプリの採点と同じ指示文・出力形式（lib/ai/grade.ts の buildGradingPrompt）を使う
// - 同じ画像・同じ指示・同じ採点基準を、各モデルに1回ずつ独立して送る（他モデルの回答は渡さない）
// - 自動再試行なし（maxRetries: 0）・別モデルへの自動切り替えなし（fallbacks を付けない）
// - モデルID は Models API で表示名から確認する。見つからないモデルは代わりを使わず「利用不可」と記録する
// - 期待結果（lib/ai/compare-expected.json）は全モデルの採点が終わってから照合にだけ使う
// - 条件・料金・照合は画面版（app/api/compare）と共通（lib/ai/compare.ts）
// - 結果は scripts/model-compare/results/ に保存する（DB の答案・成績には書き込まない）
// - ANTHROPIC_API_KEY は環境変数から読むだけで、画面・ログ・結果ファイルに出さない
// ============================================================================
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPARE_CANDIDATES as CANDIDATES, COMPARE_EXPECTED, PRICING_SOURCE,
  buildCompareInput, callCompareModel, compareClient, describeCompareError, judgeCompare, resolveCompareModels,
} from "../../lib/ai/compare";
import type { AnswerPage, NormalizedItem } from "../../lib/ai/grade";

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

const describeError = describeCompareError;

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
  const input = buildCompareInput(page, { withAnswerKey });
  const { system, content } = input;
  const promptText = content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n");
  const requestFingerprint = input.fingerprint;

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

  const client = compareClient();

  /* -------- Models API でモデルID を確認（代わりのモデルは選ばない） */
  log("");
  log("== Models API でモデルを確認");
  let resolved: Awaited<ReturnType<typeof resolveCompareModels>>;
  try {
    resolved = await resolveCompareModels(client);
  } catch (e) {
    log(`✗ Models API を呼べませんでした: ${describeError(e)}`);
    log("  採点は実行していません。");
    process.exit(4);
  }
  const available = new Map(resolved.models.filter((m) => m.modelId).map((m) => [m.displayName, m.modelId as string]));
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
    const r = await callCompareModel(client, name, id, input);
    const base = { displayName: name, modelId: id, servedModel: r.servedModel, stopReason: r.stopReason, elapsedMs: r.elapsedMs, usage: r.usage, costUsd: r.costUsd };
    if (r.ok) {
      results.push({ ...base, status: "ok", items: r.items, raw: r.raw, total: r.total });
      log(`  完了（${(r.elapsedMs / 1000).toFixed(1)}秒、入力 ${r.usage?.input} / 出力 ${r.usage?.output} トークン）`);
    } else {
      results.push({ ...base, status: "failed", reason: r.error });
      log(`  ✗ 失敗（再試行しません）: ${r.error}`);
    }
  }

  /* -------- 期待結果と照合（モデルの応答が返った後にだけ使う） */
  const expected = COMPARE_EXPECTED;
  const judged = results.map((r) => {
    if (r.status !== "ok" || !r.items) return { ...r, match: null };
    const j = judgeCompare(r.items);
    return { ...r, match: { perQ: j.perQ, totalOk: j.totalOk, allOk: j.allOk } };
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
      rubric: "各問20点・正答のみ加点・部分点なし", partialStep: 1,
      answerKeySent: withAnswerKey, maxRetries: 0, fallbacks: "なし",
      thinking: "未指定（各モデルの既定）", maxTokens: 16000, requestFingerprint,
    },
    pricingSource: PRICING_SOURCE,
    modelsApi: { candidates: CANDIDATES, resolved: Object.fromEntries(available), listed: resolved.listed },
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
