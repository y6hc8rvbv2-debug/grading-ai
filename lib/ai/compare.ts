// ============================================================================
// 採点モデルの比較試験（サーバー専用）
//
// 管理者の「モデル比較試験」画面（app/api/compare）と、手元で動かすスクリプト
// （scripts/model-compare/run.ts）の両方がこのファイルを使う。
//
// - 採点の指示と出力形式はアプリの採点と同じ（lib/ai/grade.ts の buildGradingPrompt）
// - 3モデルに同じ画像・同じ指示・同じ採点基準を1回ずつ独立して送る（他モデルの回答は渡さない）
// - 自動再試行なし（maxRetries: 0）・別モデルへの自動切り替えなし（fallbacks を付けない）
// - モデルID は Models API で表示名から確認し、見つからないモデルは代わりを使わない
// - 期待結果（compare-expected.json）は judgeCompare() だけが読む。モデルへの入力には入れない
// ============================================================================
import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildGradingPrompt, readGradingResponse, normalizeResult, toGradingError, OUTPUT_SCHEMA,
  type AnswerPage, type GradeTest, type NormalizedItem,
} from "@/lib/ai/grade";
import { DEFAULT_RUBRIC } from "@/lib/grading/engine";
import type { Rubric } from "@/lib/types";
import EXPECTED from "@/lib/ai/compare-expected.json";

/* ---------------------------------------------------------------- 条件 */

/** 候補（表示名）。Models API の display_name と完全一致したものだけを使う */
export const COMPARE_CANDIDATES = ["Claude Haiku 4.5", "Claude Sonnet 5.5", "Claude Opus 5"] as const;

/** 公式単価（USD / 100万トークン）。標準（バッチ・データ所在地指定なし）の料金 */
export const PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing（2026-09-29 取得）";
export const PRICES: Record<string, { input: number; cacheWrite5m: number; cacheRead: number; output: number }> = {
  "Claude Haiku 4.5": { input: 1, cacheWrite5m: 1.25, cacheRead: 0.10, output: 5 },
  "Claude Sonnet 5.5": { input: 2, cacheWrite5m: 2.50, cacheRead: 0.20, output: 10 },
  "Claude Opus 5": { input: 5, cacheWrite5m: 6.25, cacheRead: 0.50, output: 25 },
};

/** 採点基準：各問20点、正答のみ加点、部分点なし */
export const COMPARE_RUBRIC: Rubric = {
  ...DEFAULT_RUBRIC, partialStep: 1, workPartial: false, unitPartial: false, praiseFull: true,
};

/** 全モデル共通の正答（模範解答）。依頼元の指定: ①6 ②18 ③36 ④72 ⑤144 */
export const COMPARE_ANSWER_KEY = ["6", "18", "36", "72", "144"];

export function buildCompareTest(opts: { withAnswerKey: boolean } = { withAnswerKey: true }): GradeTest {
  return {
    subject: "算数",
    name: "算数テスト（比較試験）",
    grade: 1,
    answerLang: "ja",
    questions: [1, 2, 3, 4, 5].map((no) => ({
      no,
      label: "①②③④⑤"[no - 1],
      type: "calc" as const,
      typeLabel: "計算",
      unit: "たし算",
      points: 20,
      correct: opts.withAnswerKey ? COMPARE_ANSWER_KEY[no - 1] : "",
      model: opts.withAnswerKey ? "" : `答案に印刷された ${"①②③④⑤"[no - 1]} の計算問題の正しい答え（問題文から求める）`,
      keywords: [],
    })),
  };
}

/** 3モデル共通の入力を1回だけ作る。fingerprint が同じなら、送った内容（画像を含む）は同じ */
export function buildCompareInput(page: AnswerPage, opts?: { withAnswerKey: boolean }) {
  const test = buildCompareTest(opts);
  const { system, content } = buildGradingPrompt({ pages: [page], test, rubric: COMPARE_RUBRIC });
  const fingerprint = createHash("sha256").update(JSON.stringify({ system, content, schema: OUTPUT_SCHEMA })).digest("hex");
  return { test, system, content, fingerprint };
}

/* ---------------------------------------------------------------- 使えるか */

/** 比較試験を使えるか。本番（Vercel の Production）では既定で無効 */
export function compareAvailability(env: Record<string, string | undefined> = process.env) {
  if (!env.ANTHROPIC_API_KEY) {
    return { enabled: false, reason: "サーバーに ANTHROPIC_API_KEY が設定されていません。Vercel の環境変数（Preview）に設定して、再デプロイしてください。" };
  }
  if (env.VERCEL_ENV === "production" && env.MODEL_COMPARE_IN_PRODUCTION !== "1") {
    return { enabled: false, reason: "本番環境（Production）では比較試験を無効にしています。Vercel の Preview（プレビュー）で実行してください。" };
  }
  return { enabled: true, reason: "" };
}

export function compareClient() {
  // 自動再試行なし。Vercel の関数の上限（300秒）より前に打ち切って、結果を記録できるようにする
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 240_000 });
}

/** エラーを記録用の文字列にする（APIキーは含めない） */
export function describeCompareError(e: unknown): string {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  let s: string;
  if (e instanceof Anthropic.APIError) s = `${toGradingError(e).message}（HTTP ${e.status ?? "-"}）`;
  else if (e instanceof Error) s = e.message;
  else s = String(e);
  return key ? s.split(key).join("[REDACTED]") : s;
}

/* ---------------------------------------------------------------- モデルの確認 */

export type ResolvedModel = { displayName: string; modelId: string | null };

/** Models API で候補の正式なモデルID を確かめる。見つからない候補は modelId: null（代替しない） */
export async function resolveCompareModels(client: Anthropic) {
  const found = new Map<string, string>();
  let listed = 0;
  for await (const m of client.models.list()) {
    listed++;
    if ((COMPARE_CANDIDATES as readonly string[]).includes(m.display_name) && !found.has(m.display_name)) {
      found.set(m.display_name, m.id);
    }
  }
  const models: ResolvedModel[] = COMPARE_CANDIDATES.map((displayName) => ({ displayName, modelId: found.get(displayName) ?? null }));
  return { models, listed };
}

/* ---------------------------------------------------------------- 1モデル分の採点 */

export type CompareUsage = { input: number; output: number; cacheWrite: number; cacheRead: number };

export function costOf(displayName: string, u: CompareUsage): number | null {
  const p = PRICES[displayName];
  if (!p) return null;
  return (u.input * p.input + u.output * p.output + u.cacheWrite * p.cacheWrite5m + u.cacheRead * p.cacheRead) / 1_000_000;
}

export type CompareCallResult = {
  ok: boolean;
  elapsedMs: number;
  servedModel?: string;
  stopReason?: string | null;
  usage?: CompareUsage;
  costUsd?: number | null;
  items?: NormalizedItem[];
  raw?: unknown;
  total?: number;
  error?: string;
};

/** 1モデルに1回だけ送る。失敗しても再試行しない */
export async function callCompareModel(
  client: Anthropic,
  displayName: string,
  modelId: string,
  input: ReturnType<typeof buildCompareInput>,
): Promise<CompareCallResult> {
  const t0 = performance.now();
  try {
    // 全モデル同じ本文。thinking・effort は指定せず各モデルの既定のまま（Haiku 4.5 は adaptive/effort 非対応のため）
    const res = await client.beta.messages.create({
      model: modelId,
      max_tokens: 16000,
      system: input.system,
      messages: [{ role: "user", content: input.content }],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
    });
    const elapsedMs = Math.round(performance.now() - t0);
    const u = res.usage;
    const usage: CompareUsage = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    };
    const base = { elapsedMs, servedModel: res.model, stopReason: res.stop_reason, usage, costUsd: costOf(displayName, usage) };
    try {
      const { parsed } = readGradingResponse(res);
      const { items } = normalizeResult(parsed, input.test, COMPARE_RUBRIC);
      return { ...base, ok: true, items, raw: parsed, total: items.reduce((a, i) => a + i.earned, 0) };
    } catch (e) {
      return { ...base, ok: false, error: `応答を読み取れません: ${describeCompareError(e)}` };
    }
  } catch (e) {
    return { ok: false, elapsedMs: Math.round(performance.now() - t0), error: describeCompareError(e) };
  }
}

/* ---------------------------------------------------------------- 照合（期待結果はここだけで使う） */

export type CompareExpected = typeof EXPECTED;
export type CompareJudge = {
  perQ: { qno: number; detected: string; mark: string; earned: number; readOk: boolean; verdictOk: boolean; scoreOk: boolean; all: boolean }[];
  total: number;
  totalOk: boolean;
  allOk: boolean;
};

/** モデルの応答が返った後に、期待結果と照合する */
export function judgeCompare(items: NormalizedItem[], expected: CompareExpected = EXPECTED): CompareJudge {
  const digits = (s: string): string[] => s.match(/-?\d+/g) ?? [];
  const perQ = expected.questions.map((e) => {
    const it = items.find((i) => i.qno === e.qno);
    const readOk = !!it && digits(it.detected).includes(e.studentAnswer);
    const verdictOk = !!it && (e.correct ? it.mark === "○" : it.mark === "×");
    const scoreOk = !!it && it.earned === e.earned;
    return {
      qno: e.qno, detected: it?.detected ?? "", mark: it?.mark ?? "-", earned: it?.earned ?? 0,
      readOk, verdictOk, scoreOk, all: readOk && verdictOk && scoreOk,
    };
  });
  const total = items.reduce((a, i) => a + i.earned, 0);
  return { perQ, total, totalOk: total === expected.total, allOk: perQ.every((q) => q.all) && total === expected.total };
}

/** 画面に表示する期待結果（照合専用。モデルには送らない） */
export const COMPARE_EXPECTED = EXPECTED;
