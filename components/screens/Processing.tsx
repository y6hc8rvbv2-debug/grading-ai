"use client";
// 採点中。docs/prototype-v3.jsx の Processing を移植。
// 「AI採点待ち（uploaded）」と「採点中（processing）」の答案を一覧し、ここから AI 採点を実行できる。
// 採点中のまま止まった答案（画面を閉じた・時間切れ）も、ここから採点し直せる。
import React, { useState } from "react";
import { FONT_MONO } from "@/lib/ui/theme";
import { fmtDateTime } from "@/lib/util";
import { PIPELINE, SOURCES } from "@/lib/grading/engine";
import { useUI } from "@/components/ui-context";
import { Badge, Bar, Btn, Card, Empty } from "@/components/ui";
import { GradingModeSelect } from "@/components/GradingModePicker";

export default function Processing() {
  const { T, go, subs, testById, who, refresh, ds, ai, aiGradeSub, toast } = useUI();
  const list = subs.filter((s) => s.status === "processing" || s.status === "uploaded");
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  const gradeOne = async (id: string, silent = false) => {
    setRunning((p) => new Set(p).add(id));
    const r = await aiGradeSub(id, { silent });
    setRunning((p) => { const n = new Set(p); n.delete(id); return n; });
    return r.ok;
  };

  const gradeAll = async () => {
    const targets = list.filter((s) => s.imagePaths.length && !running.has(s.id)).map((s) => s.id);
    if (!targets.length) return;
    let ng = 0;
    setBulk({ done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      if (!(await gradeOne(targets[i], true))) ng++;
      setBulk({ done: i + 1, total: targets.length });
    }
    setBulk(null);
    if (ng) toast(`${targets.length - ng} 枚を採点し、${ng} 枚は採点できませんでした。1枚ずつ「AIで採点する」を押すと理由が表示されます`, "ng");
    else toast(`${targets.length} 枚のAI採点が終わりました。返却前に結果を確認してください`);
  };

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
              : ai.enabled
                ? "「AIで採点する」を押すと、答案画像・正答・配点・採点基準をもとに AI が採点します（1枚あたり数十秒）。"
                : "採点AIが設定されていません。サーバーに ANTHROPIC_API_KEY を設定すると、ここから採点できます。"}
            {bulk && <div style={{ marginTop: 6 }}><Bar value={bulk.done} max={bulk.total} tone="accent" height={6} label={`まとめて採点中 ${bulk.done} / ${bulk.total} 枚`} /></div>}
          </div>
          {ai.enabled && <GradingModeSelect />}
          {ai.enabled && (
            <Btn size="sm" variant="primary" disabled={!!bulk} onClick={gradeAll}>
              {bulk ? "採点しています…" : `まとめてAI採点（${list.filter((s) => s.imagePaths.length).length}枚）`}
            </Btn>
          )}
          <Btn size="sm" onClick={refresh}>最新の状態にする</Btn>
        </div>
      </Card>
      {list.map((s) => {
        const test = testById(s.testId);
        const busy = running.has(s.id);
        const waiting = s.status === "uploaded" && !busy;
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
              {busy
                ? <Badge tone="accent">AIが採点しています…</Badge>
                : waiting
                  ? <Badge tone="info">AI採点待ち</Badge>
                  : <Badge tone="info">ステップ{PIPELINE[stageIdx].n}：{PIPELINE[stageIdx].title}</Badge>}
              <span style={{ font: `700 14px ${FONT_MONO}`, color: T.accent }}>{Math.round(s.progress)}%</span>
            </div>
            <Bar value={s.progress} tone="accent" />
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {ai.enabled && (
                <Btn size="sm" variant="primary" disabled={busy || !!bulk || !s.imagePaths.length} onClick={() => gradeOne(s.id)}>
                  {busy ? "採点しています…" : s.status === "processing" ? "AIで採点し直す" : "AIで採点する"}
                </Btn>
              )}
              <Btn size="sm" variant="ghost" onClick={() => go("detail", s.id)}>答案を見る</Btn>
              {!s.imagePaths.length && <span style={{ fontSize: 11.5, color: T.textFaint }}>原本画像がないため、AI採点できません</span>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
