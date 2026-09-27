"use client";
// 採点中。docs/prototype-v3.jsx の Processing を移植。
// プロトタイプは進捗を擬似的に進めていたが、実際の進み具合は採点AI（次の段階）が書き込む。
// いまは「AI採点待ち（uploaded）」と「採点中（processing）」の答案をそのまま一覧する。
import React from "react";
import { FONT_MONO } from "@/lib/ui/theme";
import { fmtDateTime } from "@/lib/util";
import { PIPELINE, SOURCES } from "@/lib/grading/engine";
import { useUI } from "@/components/ui-context";
import { Badge, Bar, Btn, Card, Empty } from "@/components/ui";

export default function Processing() {
  const { T, go, subs, testById, who, refresh, ds } = useUI();
  const list = subs.filter((s) => s.status === "processing" || s.status === "uploaded");

  if (!list.length) {
    return <Card><Empty icon="✅" title="処理中の答案はありません" hint="取り込んだ答案はすべて採点が終わっています。"
      action={<Btn variant="primary" onClick={() => go("new")}>新しく採点する</Btn>} /></Card>;
  }
  return (
    <div style={{ display: "grid", gap: 11 }}>
      <Card>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220, fontSize: 12.5, color: T.textSub, lineHeight: 1.8 }}>
            {ds.mode === "demo"
              ? "デモでは採点中の答案をそのまま表示しています。"
              : "採点AIの接続後は、ここに並んだ答案が順番に自動採点されます。"}
            「最新の状態にする」で進み具合を読み直します。
          </div>
          <Btn size="sm" onClick={refresh}>最新の状態にする</Btn>
        </div>
      </Card>
      {list.map((s) => {
        const test = testById(s.testId);
        const waiting = s.status === "uploaded";
        const stageIdx = Math.min(PIPELINE.length - 1, Math.floor((s.progress / 100) * PIPELINE.length));
        return (
          <Card key={s.id}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 9 }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{test ? `${test.subject}／${test.name}` : "（削除されたテスト）"}</div>
                <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 3 }}>
                  {who(s.studentId)}・{SOURCES[s.source]?.label ?? s.source}・{fmtDateTime(s.uploadedAt)} 取り込み
                </div>
              </div>
              {waiting
                ? <Badge tone="info">AI採点待ち</Badge>
                : <Badge tone="info">ステップ{PIPELINE[stageIdx].n}：{PIPELINE[stageIdx].title}</Badge>}
              <span style={{ font: `700 14px ${FONT_MONO}`, color: T.accent }}>{Math.round(s.progress)}%</span>
            </div>
            <Bar value={s.progress} tone="accent" />
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <Btn size="sm" variant="ghost" onClick={() => go("detail", s.id)}>答案を見る</Btn>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
