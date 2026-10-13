"use client";
// 要確認一覧。docs/prototype-v3.jsx の ReviewView を移植。
// 一覧は needsReview()（DB 側で need_review の設問だけを信頼度の低い順に取得）から作る。
import React, { useCallback, useEffect, useState } from "react";
import { FONT_HAND } from "@/lib/ui/theme";
import { friendlyError } from "@/lib/errors";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Card, Empty, Stat } from "@/components/ui";
import type { Mark, ReviewEntry } from "@/lib/types";

const PAGE = 40;

export default function ReviewView() {
  const { T, go, subs, toast, who, ds, testById, refreshSub, editItem } = useUI();
  const [list, setList] = useState<ReviewEntry[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await ds.needsReview());
      setError("");
    } catch (e) {
      setError(friendlyError(e, "要確認一覧の読み込み"));
    }
  }, [ds]);

  useEffect(() => { load(); }, [load]);

  const fix = async (entry: ReviewEntry, mark: Mark) => {
    setBusy(entry.item.id);
    // 直近200件に入っていない答案は、先に読み込んでおく（修正後の合計点を画面に出すため）
    if (!subs.some((s) => s.id === entry.submissionId)) await refreshSub(entry.submissionId);
    const ok = await editItem(entry.submissionId, entry.item, { mark });
    if (ok) {
      setList((prev) => (prev ?? []).filter((e) => e.item.id !== entry.item.id));
      toast("確認しました");
    }
    setBusy(null);
  };

  if (error) {
    return <Card><Empty icon="⚠️" title="要確認一覧を読み込めませんでした" hint={error}
      action={<Btn variant="primary" onClick={load}>もう一度読み込む</Btn>} /></Card>;
  }
  if (!list) return <Card><Empty icon="⏳" title="読み込んでいます…" /></Card>;

  return (
    <div>
      <p><a href="/batch-review">全員を問題別に確認・一斉配信へ</a></p>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text, marginBottom: 4 }}>認識信頼度が低い設問だけを集めています</div>
            <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.75 }}>
              手書きの判読が難しい、記述の要点判定が割れた、といった設問です。○△×を選ぶとその場で確定し、合計点と赤ペン画像に反映されます。
            </div>
          </div>
          <Stat label="残り" value={list.length} unit="件" tone="warn" />
        </div>
      </Card>

      {list.length === 0 ? (
        <Card><Empty icon="🎉" title="要確認はゼロです" hint="すべての設問が確定しています。答案を返却できます。"
          action={<Btn variant="primary" onClick={() => go("history")}>採点履歴を見る</Btn>} /></Card>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {list.slice(0, PAGE).map((entry) => {
            const { item: it } = entry;
            const sub = subs.find((s) => s.id === entry.submissionId);
            const test = sub ? testById(sub.testId) : undefined;
            return (
              <Card key={it.id} pad={13}>
                <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", marginBottom: 9 }}>
                  <Badge tone="warn">信頼度 {Math.round(it.confidence * 100)}%</Badge>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{test ? `${test.subject}／` : ""}{it.label}</span>
                  <Badge tone="mute">{it.unit}</Badge>
                  <Badge tone="mute">{it.typeLabel}・{it.points}点</Badge>
                  {sub && <span style={{ fontSize: 12, color: T.textSub }}>{who(sub.studentId)}</span>}
                  <span style={{ flex: 1 }} />
                  <Btn size="sm" variant="ghost" onClick={() => go("detail", entry.submissionId)}>答案を開く</Btn>
                </div>
                <div style={{
                  background: T.panelAlt, border: `1px solid ${T.line}`, borderRadius: 9, padding: "10px 12px",
                  font: `15px ${FONT_HAND}`, color: T.text, marginBottom: 10,
                }}>{it.blank ? "（無記入）" : it.detected}</div>
                <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11.5, color: T.textSub, fontWeight: 700 }}>AIの判定：</span>
                  <Badge tone={it.mark === "○" ? "ok" : it.mark === "△" ? "warn" : "ng"}>{it.mark} {it.earned}点</Badge>
                  <span style={{ flex: 1 }} />
                  {(["○", "△", "×"] as Mark[]).map((m) => (
                    <Btn key={m} size="sm" variant={m === it.mark ? "shu" : "default"} disabled={busy === it.id}
                      onClick={() => fix(entry, m)}>
                      {m} で確定
                    </Btn>
                  ))}
                </div>
              </Card>
            );
          })}
          {list.length > PAGE && (
            <div style={{ textAlign: "center", fontSize: 12, color: T.textFaint, padding: 10 }}>
              ほか {list.length - PAGE} 件（{PAGE}件ずつ表示しています。確定すると次が表示されます）
            </div>
          )}
        </div>
      )}
    </div>
  );
}
