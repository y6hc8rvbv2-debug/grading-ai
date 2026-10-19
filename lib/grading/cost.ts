// 採点方式と API 料金の目安（ブラウザ・サーバーの両方で使う。秘密は含まない）
//
// 単価は lib/grading/models.ts の登録表（公式の料金表）から読む。

export type GradingMode = "opus" | "cascade";
export type GradingStage = "haiku" | "sonnet" | "opus";

import { DEFAULT_MODELS, PRICING_SOURCE as SRC, STAGE_TIER, costOfModel, priceOf, type TokenUsage } from "@/lib/grading/models";
export type { TokenUsage } from "@/lib/grading/models";

export const MODE_LABEL: Record<GradingMode, string> = {
  opus: "Opus単独",
  cascade: "3モデル併用",
};
/** 段階の表示名（実際に使ったモデルID は AI採点の記録に残る。段階の中身は設定画面の「AIエンジン」で変えられる） */
export const STAGE_LABEL: Record<GradingStage, string> = {
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
};

export const PRICING_SOURCE = SRC;
/** 既定のモデルの単価（費用の目安の表示用） */
export const STAGE_PRICES: Record<GradingStage, { input: number; cacheWrite5m: number; cacheRead: number; output: number }> = {
  haiku: priceOf(DEFAULT_MODELS.fast).price,
  sonnet: priceOf(DEFAULT_MODELS.standard).price,
  opus: priceOf(DEFAULT_MODELS.top).price,
};

/** 実際のトークン数から概算費用（USD）。modelId があればそのモデルの単価、無ければ段階の既定モデルの単価 */
export function costOfStage(stage: GradingStage, u: TokenUsage, modelId?: string) {
  return costOfModel(modelId ?? DEFAULT_MODELS[STAGE_TIER[stage]], u);
}

/** 費用試算の目安：Sonnet に回る答案は全体の20％、Opus まで回る答案は5％と仮定する（上限ではない） */
export const CASCADE_SHARE = { sonnet: 0.2, opus: 0.05 };

/** 1人分（pages ページ・questions 問）の概算トークン数。実測ではなく、料金を比べるための仮定 */
export function assumedTokens(stage: GradingStage, pages: number, questions: number): TokenUsage {
  const input = 2000 + 1600 * Math.max(1, pages);              // 指示・設問・採点基準 + 画像1ページあたり
  const answer = 300 + 90 * Math.max(1, questions);            // 設問ごとの採点結果（JSON）
  const thinking = stage === "haiku" ? 300 : stage === "sonnet" ? 1500 : 3000;  // 考える分の出力
  return { input, output: answer + thinking };
}

/** 方式ごとの1人あたりの概算費用（USD） */
export function estimatePerAnswer(mode: GradingMode, pages: number, questions: number) {
  const one = (s: GradingStage) => costOfStage(s, assumedTokens(s, pages, questions));
  if (mode === "opus") return one("opus");
  return one("haiku") + CASCADE_SHARE.sonnet * one("sonnet") + CASCADE_SHARE.opus * one("opus");
}

export const usd = (v: number) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);
