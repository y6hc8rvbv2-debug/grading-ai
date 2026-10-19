"use client";
// AI採点の記録（答案詳細の「AI採点の記録」タブ）。
// 採点方式・各段階のモデルID・確認に回した理由・トークン数・概算費用を表示する。
import React, { useEffect, useState } from "react";
import { FONT_MONO } from "@/lib/ui/theme";
import { fmtDateTime } from "@/lib/util";
import { MODE_LABEL, STAGE_LABEL, usd } from "@/lib/grading/cost";
import { useUI } from "@/components/ui-context";
import { Badge, Card, Empty } from "@/components/ui";
import type { GradingLog } from "@/lib/types";

const JOB_STATUS = { running: ["採点中", "info"], done: ["完了", "ok"], failed: ["失敗（成績は変更なし）", "ng"] } as const;
const STAGE_STATUS = { calling: ["呼び出し中", "info"], done: ["完了", "ok"], error: ["失敗", "ng"] } as const;

export function GradingLogCard({ submissionId, refreshKey }: { submissionId: string; refreshKey: string }) {
  const { T, ds } = useUI();
  const [log, setLog] = useState<GradingLog[] | null>(null);
  useEffect(() => {
    let alive = true;
    ds.gradingLog(submissionId).then((l) => { if (alive) setLog(l); }).catch(() => { if (alive) setLog([]); });
    return () => { alive = false; };
  }, [ds, submissionId, refreshKey]);

  if (!log) return <Card><div style={{ fontSize: 12.5, color: T.textSub }}>読み込んでいます…</div></Card>;
  if (!log.length) {
    return <Card><Empty icon="🧾" title="AI採点の記録はまだありません"
      hint="AIで採点すると、使ったモデル・確認に回した理由・トークン数・概算費用がここに残ります。" /></Card>;
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {log.map((j) => (
        <Card key={j.id}
          title={`${fmtDateTime(j.createdAt)}　${MODE_LABEL[j.mode]}${j.finalStage ? `（${STAGE_LABEL[j.finalStage]}で確定）` : ""}`}
          sub={`${j.by ? `実行: ${j.by}・` : ""}概算費用 ${usd(j.costUsd)}`}
          right={<Badge tone={JOB_STATUS[j.status][1]}>{JOB_STATUS[j.status][0]}</Badge>}>
          {j.error && <div style={{ fontSize: 12, color: T.ng, marginBottom: 8 }}>{j.error}</div>}
          <div style={{ display: "grid", gap: 8 }}>
            {j.stages.map((s) => (
              <div key={s.stage} style={{ border: `1px solid ${T.line}`, borderRadius: 9, padding: "8px 10px", background: T.panelAlt }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
                  <b style={{ color: T.text }}>{STAGE_LABEL[s.stage]}</b>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: T.textSub }}>{s.modelId}</span>
                  <Badge tone={STAGE_STATUS[s.status][1]}>{STAGE_STATUS[s.status][0]}</Badge>
                  {s.escalate && <Badge tone="warn">上のモデルへ</Badge>}
                  <span style={{ marginInlineStart: "auto", fontFamily: FONT_MONO, fontSize: 11.5, color: T.textSub }}>
                    入力 {s.inputTokens ?? "—"}・出力 {s.outputTokens ?? "—"} トークン・{s.costUsd == null ? "—" : usd(s.costUsd)}
                    {s.elapsedMs != null ? `・${(s.elapsedMs / 1000).toFixed(1)}秒` : ""}
                  </span>
                </div>
                {s.reasons.length > 0 && (
                  <ul style={{ margin: "6px 0 0", paddingInlineStart: 18, fontSize: 11.5, color: T.textSub, lineHeight: 1.7 }}>
                    {s.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
                {s.error && <div style={{ fontSize: 11.5, color: T.ng, marginTop: 4 }}>{s.error}</div>}
              </div>
            ))}
          </div>
          {j.status === "done" && j.reviewReasons.length > 0 && (
            <div style={{ fontSize: 12, color: T.warn, marginTop: 8, lineHeight: 1.7 }}>
              最後のモデルでも解決しなかったため「要確認」にした理由：{j.reviewReasons.join("／")}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
