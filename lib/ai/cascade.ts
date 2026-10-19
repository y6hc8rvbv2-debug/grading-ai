// ============================================================================
// 採点方式（サーバー専用）：Opus単独 / 3モデル併用（Haiku → 必要なら Sonnet → さらに必要なら Opus）
//
// 3モデル併用では、まず全答案を Haiku で採点し、結果を次の観点で点検する。
// 問題が残る答案だけを上のモデルに回す（自己申告の confidence だけでは振り分けない）。
//   - 回答の欠落：AI が返さなかった設問がある
//   - 読み取りの不確実さ：無記入でないのに読めていない／判読不能の印／無記入なのに文字がある／画質が悪い
//   - 採点基準との矛盾：判定と得点が食い違う／部分点なしなのに △／正答と一致するのに × ・一致しないのに ○
//   - 自信が低い（confidence がしきい値未満）… 上と並ぶ理由の1つ
// 全モデルに同じ指示・模範解答・配点・採点基準を渡す（lib/ai/grade.ts の buildGradingPrompt）。
// 最後の段階（Opus）でも残った問題と、前の段階と判定が分かれた設問は「要確認」にし、理由を記録する。
// Sonnet 20％・Opus 5％は費用試算の目安で、上限ではない（必要な答案はすべて上のモデルに回す）。
// ============================================================================
import "server-only";
import { aiConfig, type CallOptions, type GradeTest, type NormalizedItem, type ReviewFlag } from "@/lib/ai/grade";
import type { GradingMode, GradingStage } from "@/lib/grading/cost";

export const PLAN: Record<GradingMode, GradingStage[]> = {
  opus: ["opus"],
  cascade: ["haiku", "sonnet", "opus"],
};

/** 各段階のモデルID（環境変数で変更できる） */
export function stageModel(stage: GradingStage) {
  if (stage === "haiku") return process.env.ANTHROPIC_MODEL_HAIKU || "claude-haiku-4-5";
  if (stage === "sonnet") return process.env.ANTHROPIC_MODEL_SONNET || "claude-sonnet-5-5";
  return aiConfig().model;
}

/** 各段階の呼び出し方。Haiku 4.5 は adaptive thinking・effort に対応していない。
 *  3モデル併用の Haiku・Sonnet は、拒否されたら別モデルに切り替えず、上の段階に回す（記録が残る） */
export function stageOptions(stage: GradingStage, mode: GradingMode): CallOptions {
  const model = stageModel(stage);
  if (stage === "haiku") return { model, thinking: false, fallbacks: false };
  if (stage === "sonnet") return { model, thinking: true, effort: "high", fallbacks: false };
  // Opus は方式によらず、これまでの Opus単独の採点と同じ呼び出し方（fallbacks は ANTHROPIC_FALLBACKS に従う）
  void mode;
  return { model, thinking: true, effort: "high" };
}

/* ---------------------------------------------------------------- 点検 */

export type Reason = { code: ReviewFlag | "unusable"; qno?: number; msg: string };

export const FLAG_MESSAGE: Record<ReviewFlag | "unusable", string> = {
  missing: "回答の欠落（AIがこの設問を返さなかった）",
  inconsistent: "判定と得点が食い違う",
  low_confidence: "読み取り・判定の自信が低い",
  teacher_required: "記述問題のため教員の確認が必要（採点基準）",
  partial_not_allowed: "部分点なしの基準なのに△",
  quality: "画質が悪く、読み取りが不確実",
  unreadable: "解答を読み取れていない（判読不能）",
  blank_mismatch: "無記入と判定したのに文字を読み取っている",
  key_contradiction: "正答との照合と判定が矛盾",
  model_disagreement: "前のモデルと判定が分かれた",
  unusable: "AIの応答を採点結果として使えない",
};

// 正答と照合する設問形式（記述・グラフは照合しない）
const KEYED: GradeTest["questions"][number]["type"][] = ["calc", "choice", "fill"];

/** 解答の表記をそろえる（全角・半角、空白、マイナス記号、x= の前置き、末尾の単位など） */
export function normAnswer(s: string) {
  return s.normalize("NFKC").toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[−－ー‐–—]/g, "-")
    .replace(/[、，・]/g, ",")
    .replace(/[\^*]/g, "")
    .replace(/÷/g, "/")
    .replace(/^(答え?|ans)[:：]?/, "")
    .replace(/^[a-z]=/, "")
    .replace(/(円|cm3|cm2|cm|mm|km|kg|mg|ml|分|秒|時間|個|人|度|°|本|枚|点|回|倍|%|m|g|l)+$/, "");
}

/** 読み取った解答が正答と一致するか（式ごと書いた「3+3=6」も最後の値で比べる） */
export function answerMatches(detected: string, correct: string) {
  const d = normAnswer(detected);
  const c = normAnswer(correct);
  if (!d || !c) return false;
  return d === c || normAnswer(detected.split(/[=＝]/).pop() ?? "") === c;
}

const NOT_WRITTEN = new Set(["", "-", "無記入", "(無記入)", "なし", "空欄"]);

/** normalizeResult の結果に、読み取り・採点基準との矛盾の点検を加える（items の flags に追記する） */
export function addChecks(items: NormalizedItem[], test: GradeTest) {
  for (const it of items) {
    if (it.flags.includes("missing")) continue;
    const q = test.questions.find((x) => x.no === it.qno);
    const text = it.detected.trim();
    if (it.is_blank) {
      if (!NOT_WRITTEN.has(normAnswer(text)) && !NOT_WRITTEN.has(text)) it.flags.push("blank_mismatch");
      continue;
    }
    if (!text || /[?？]|判読|不明|読めない|読み取れ/.test(text)) it.flags.push("unreadable");
    if (q && KEYED.includes(q.type) && q.correct.trim() && text) {
      const same = answerMatches(text, q.correct);
      if ((same && it.mark !== "○") || (!same && it.mark === "○")) it.flags.push("key_contradiction");
    }
  }
  return items;
}

/** 上のモデルに回す理由（教員確認が必須の記述問題は、上のモデルでも解決しないので理由にしない） */
export function escalationReasons(items: NormalizedItem[]): Reason[] {
  const out: Reason[] = [];
  for (const it of items) {
    for (const f of it.flags) {
      if (f === "teacher_required") continue;
      out.push({ code: f, qno: it.qno, msg: `${it.qno}番：${FLAG_MESSAGE[f]}` });
    }
  }
  return out;
}

/** 前の段階と判定（記号・得点）が分かれた設問に印を付ける */
export function markDisagreement(items: NormalizedItem[], previous: NormalizedItem[] | null) {
  if (!previous) return items;
  for (const it of items) {
    const p = previous.find((x) => x.qno === it.qno);
    if (p && !p.flags.includes("missing") && (p.mark !== it.mark || p.earned !== it.earned)) {
      it.flags.push("model_disagreement");
      (it as NormalizedItem & { previous?: unknown }).previous = { mark: p.mark, earned: p.earned };
    }
  }
  return items;
}

/** 確定する採点結果：理由のある設問は要確認にし、理由と採点した段階を ai_raw に残す */
export function finalizeItems(items: NormalizedItem[], info: { mode: GradingMode; stage: GradingStage; model: string }) {
  return items.map((it) => {
    const reasons = it.flags.map((f) => FLAG_MESSAGE[f]);
    const prev = (it as NormalizedItem & { previous?: { mark: string; earned: number } }).previous;
    if (prev) reasons.push(`前のモデルの判定：${prev.mark}・${prev.earned}点`);
    return {
      ...it,
      need_review: it.need_review || it.flags.length > 0,
      ai_raw: { ...(it.ai_raw as object ?? {}), grading: { ...info, review_reasons: reasons } },
    };
  });
}
