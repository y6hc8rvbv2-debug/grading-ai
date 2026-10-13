"use client";
// 採点方式の選択（Opus単独 / 3モデル併用）と、使用料金の目安の比較。
// 新規採点では大きな選択欄、採点中・答案詳細では小さな切り替えとして使う。
import React from "react";
import { FONT_MONO } from "@/lib/ui/theme";
import { useUI } from "@/components/ui-context";
import {
  CASCADE_SHARE, MODE_LABEL, PRICING_SOURCE, estimatePerAnswer, usd, type GradingMode,
} from "@/lib/grading/cost";

const DESCRIPTION: Record<GradingMode, string> = {
  opus: "すべての答案を最も精度の高い Opus で採点します。",
  cascade: "まず全答案を Haiku で採点し、読み取りが不確実・回答の欠落・採点基準との矛盾などがある答案だけを Sonnet へ、さらに解決しない答案を Opus へ回します。最後まで解決しない設問は「要確認」にし、理由を記録します。",
};

export function GradingModePicker({ pages = 1, questions = 10, answers = 1 }: { pages?: number; questions?: number; answers?: number }) {
  const { T, gradingMode, setGradingMode, ai } = useUI();
  const per = { opus: estimatePerAnswer("opus", pages, questions), cascade: estimatePerAnswer("cascade", pages, questions) };
  const ratio = per.cascade / per.opus;

  return (
    <div role="radiogroup" aria-label="採点方式" style={{ display: "grid", gap: 8 }}>
      {(["opus", "cascade"] as GradingMode[]).map((m) => {
        const on = gradingMode === m;
        return (
          <label key={m} style={{
            display: "flex", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: 10, cursor: "pointer",
            border: `1px solid ${on ? T.accent : T.line}`, background: on ? T.accentSoft : T.panel,
          }}>
            <input type="radio" name="grading-mode" value={m} checked={on} onChange={() => setGradingMode(m)} style={{ marginTop: 4 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <b style={{ fontSize: 13, color: T.text }}>{MODE_LABEL[m]}</b>
                <span style={{ fontSize: 11.5, color: T.textSub }}>
                  {m === "opus" ? "Opus" : "Haiku → 必要に応じて Sonnet → Opus"}
                </span>
                <span style={{ marginInlineStart: "auto", font: `700 12px ${FONT_MONO}`, color: T.text }}>
                  1人あたり 約{usd(per[m])}{answers > 1 ? `（${answers}人で 約${usd(per[m] * answers)}）` : ""}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.7, marginTop: 3 }}>{DESCRIPTION[m]}</div>
              {m === "cascade" && ai.models && (
                <div style={{ fontSize: 11, color: T.textFaint, marginTop: 3, fontFamily: FONT_MONO }}>
                  {ai.models.haiku} → {ai.models.sonnet} → {ai.models.opus}
                </div>
              )}
            </div>
          </label>
        );
      })}
      <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.7 }}>
        料金の比較（目安）：3モデル併用は Opus単独の約 {Math.round(ratio * 100)}%。
        Sonnet に回る答案を全体の{Math.round(CASCADE_SHARE.sonnet * 100)}％、Opus まで回る答案を{Math.round(CASCADE_SHARE.opus * 100)}％と仮定した試算です（上限ではなく、必要な答案はすべて上のモデルに回します）。
        1人分 {pages} ページ・{questions} 問として、公式単価から計算しています（{PRICING_SOURCE}）。実際の費用は採点後に「AI採点の記録」で確認できます。
      </div>
    </div>
  );
}

/** 採点中・答案詳細で使う小さな切り替え */
export function GradingModeSelect() {
  const { T, gradingMode, setGradingMode } = useUI();
  return (
    <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, color: T.textSub }}>
      採点方式
      <select aria-label="採点方式" value={gradingMode} onChange={(e) => setGradingMode(e.target.value as GradingMode)}
        style={{ padding: "4px 6px", borderRadius: 7, border: `1px solid ${T.line}`, background: T.panel, color: T.text, font: "inherit", fontSize: 12 }}>
        <option value="opus">{MODE_LABEL.opus}</option>
        <option value="cascade">{MODE_LABEL.cascade}</option>
      </select>
    </label>
  );
}
