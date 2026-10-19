"use client";
// 要確認一覧。docs/prototype-v3.jsx の ReviewView を移植。
// 一覧は needsReview()（DB 側で need_review の設問だけを信頼度の低い順に取得）から作る。
// ver6：同じ解答のまとめ判定（同じ設問・同じ読み取り結果を1回で確定）と、キーボードでの確定（1=○ 2=△ 3=×、J/K で移動）
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { groupSameAnswers } from "@/lib/workflow/review-groups";
import { runPool } from "@/lib/workflow/pool";
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
  const [focus, setFocus] = useState(0);
  const cards = useRef<Record<string, HTMLDivElement | null>>({});

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

  // 同じ解答のまとめ（2件以上のものだけ。多い順）
  const groups = useMemo(() => groupSameAnswers(list ?? [], (id) => subs.find((x) => x.id === id)?.testId ?? null), [list, subs]);
  const fixGroup = async (entries: ReviewEntry[], mark: Mark) => {
    setBusy("group");
    const done = new Set<string>();
    await runPool(entries, 3, async (entry) => {
      if (await editItem(entry.submissionId, entry.item, { mark })) done.add(entry.item.id);
    });
    setList((prev) => (prev ?? []).filter((e) => !done.has(e.item.id)));
    toast(`${done.size} 件をまとめて ${mark} で確定しました`);
    setBusy(null);
  };

  // キーボードでの確定：1=○ 2=△ 3=×、J・↓=次、K・↑=前、Enter=答案を開く（入力欄にいるときは使わない）
  useEffect(() => {
    if (!list?.length) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const shown = list.slice(0, PAGE);
      const cur = shown[Math.min(focus, shown.length - 1)];
      if (!cur) return;
      const mark = ({ "1": "○", "2": "△", "3": "×" } as Record<string, Mark>)[e.key];
      if (mark && busy === null) { e.preventDefault(); fix(cur, mark); return; }
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setFocus((f) => Math.min(shown.length - 1, f + 1)); }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
      if (e.key === "Enter") { e.preventDefault(); go("detail", cur.submissionId); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // fix は毎回作り直されるので、一覧・位置・状態が変わったときに張り直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, focus, busy]);
  useEffect(() => {
    const id = list?.[focus]?.item.id;
    if (id) cards.current[id]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus, list]);

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
        {list.length > 0 && <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 8 }}>キー操作：1＝○　2＝△　3＝×　／　J・↓＝次　K・↑＝前　／　Enter＝答案を開く</div>}
      </Card>

      {groups.length > 0 && (
        <Card title="同じ解答をまとめて確定" sub="同じ設問に同じ解答を書いた答案を、1回の判定で全員分確定できます" style={{ marginBottom: 14 }}>
          <div style={{ display: "grid", gap: 8 }}>
            {groups.slice(0, 10).map((g) => {
              const first = g.entries[0].item;
              const test = testById(g.testId);
              return (
                <div key={g.key} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", border: `1px solid ${T.line}`, borderRadius: 10, padding: "8px 10px" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{test ? `${test.subject}／` : ""}{first.label}</span>
                  <span style={{ font: `15px ${FONT_HAND}`, background: T.panelAlt, borderRadius: 6, padding: "2px 8px" }}>{g.detected}</span>
                  <Badge tone="info">{g.entries.length} 人</Badge>
                  {test?.questions.find((q) => q.no === g.qno)?.correct && <span style={{ fontSize: 11.5, color: T.textSub }}>正答：{test.questions.find((q) => q.no === g.qno)!.correct}</span>}
                  <span style={{ flex: 1 }} />
                  {(["○", "△", "×"] as Mark[]).map((m) => (
                    <Btn key={m} size="sm" disabled={busy !== null} onClick={() => fixGroup(g.entries, m)}>{g.entries.length}件を {m} で確定</Btn>
                  ))}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {list.length === 0 ? (
        <Card><Empty icon="🎉" title="要確認はゼロです" hint="すべての設問が確定しています。答案を返却できます。"
          action={<Btn variant="primary" onClick={() => go("history")}>採点履歴を見る</Btn>} /></Card>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {list.slice(0, PAGE).map((entry, idx) => {
            const { item: it } = entry;
            const sub = subs.find((s) => s.id === entry.submissionId);
            const test = sub ? testById(sub.testId) : undefined;
            return (
              <div key={it.id} ref={(el) => { cards.current[it.id] = el; }} onClick={() => setFocus(idx)}
                style={{ borderRadius: 16, outline: idx === focus ? `2px solid ${T.accent}` : "none", outlineOffset: 1 }}>
              <Card pad={13}>
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
              </div>
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
