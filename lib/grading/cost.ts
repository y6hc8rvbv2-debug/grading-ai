// 採点方式と API 料金の目安（ブラウザ・サーバーの両方で使う。秘密は含まない）
//
// 単価は公式の料金表（USD / 100万トークン、標準料金）。
// 出典: https://platform.claude.com/docs/en/about-claude/pricing（2026-09-29 取得）

export type GradingMode = "opus" | "cascade";
export type GradingStage = "haiku" | "sonnet" | "opus";

export const MODE_LABEL: Record<GradingMode, string> = {
  opus: "Opus単独",
  cascade: "3モデル併用",
};
export const STAGE_LABEL: Record<GradingStage, string> = {
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
};

export const PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing（2026-09-29 取得）";
export const STAGE_PRICES: Record<GradingStage, { input: number; cacheWrite5m: number; cacheRead: number; output: number }> = {
  haiku: { input: 1, cacheWrite5m: 1.25, cacheRead: 0.10, output: 5 },     // Claude Haiku 4.5
  sonnet: { input: 2, cacheWrite5m: 2.50, cacheRead: 0.20, output: 10 },   // Claude Sonnet 5.5
  opus: { input: 5, cacheWrite5m: 6.25, cacheRead: 0.50, output: 25 },     // Claude Opus 5
};

export type TokenUsage = { input: number; output: number; cacheWrite?: number; cacheRead?: number };

/** 実際のトークン数から概算費用（USD）を出す */
export function costOfStage(stage: GradingStage, u: TokenUsage) {
  const p = STAGE_PRICES[stage];
  return (u.input * p.input + u.output * p.output + (u.cacheWrite ?? 0) * p.cacheWrite5m + (u.cacheRead ?? 0) * p.cacheRead) / 1_000_000;
}

/** 費用試算の目安：Sonnet に回る答案は全体の20％、Opus まで回る答案は5％と仮定する（上限ではない） */
export const CASCADE_SHARE = { sonnet: 0.2, opus: 0.05 };

/** 1人分（pages ページ・questions 問）の概算トークン数。実測ではなく、料金を比べるための仮定 */
export function assumedTokens(stage: GradingStage, pages: number, questions: number): TokenUsage {
  const input = 2000 + 1600 * Math.max(1, pages);              // 指示・設問・採点基準 + 画像1ページあたり
  const answer = 300 + 90 * Math.max(1, questions);            // 設問ごとの採点結果（JSON）
  const thinking = stage === "haiku" ? 0 : stage === "sonnet" ? 1500 : 3000;  // 考える分の出力
  return { input, output: answer + thinking };
}

/** 方式ごとの1人あたりの概算費用（USD） */
export function estimatePerAnswer(mode: GradingMode, pages: number, questions: number) {
  const one = (s: GradingStage) => costOfStage(s, assumedTokens(s, pages, questions));
  if (mode === "opus") return one("opus");
  return one("haiku") + CASCADE_SHARE.sonnet * one("sonnet") + CASCADE_SHARE.opus * one("opus");
}

export const usd = (v: number) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);
