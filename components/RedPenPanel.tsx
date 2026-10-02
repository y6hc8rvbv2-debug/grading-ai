"use client";
// 原本の赤ペンの横に出す「設問ごとのコメント・赤ペンの位置」。
// コメントは原本の画像には書かず、ここに設問ごとに並べる（答案の文字・罫線と重ならないように）。
// 位置の要確認（解答欄を確かめられなかった設問）は、先生が位置を確かめて「この位置でよい」を押すか、ドラッグで直す。
import React, { useState } from "react";
import { FONT_HAND, FONT_MONO, FONT_UI } from "@/lib/ui/theme";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, inputStyle } from "@/components/ui";
import { SOURCE_LABEL, type PageLayout, type Placed } from "@/lib/redpen/layout";
import type { Submission } from "@/lib/types";

export function RedPenPanel({ sub, layouts, selected, onSelect, onConfirm, onReset, onMoveTo, currentPage, analyzed, onEditComment }: {
  sub: Submission;
  onEditComment: (qno: number, comment: string) => Promise<boolean>;
  layouts: PageLayout[];
  selected: number | null;
  onSelect: (qno: number, page: number) => void;
  /** 今の位置で確定する（位置の要確認を外す） */
  onConfirm: (p: Placed) => void;
  /** 位置を元に戻す（先生が動かした位置を消す） */
  onReset: (qno: number) => void;
  /** 別のページへ移す（ページをまたいでドラッグできないため） */
  onMoveTo: (qno: number, page: number) => void;
  /** 表示中の原本のページ（このページの設問だけを並べる） */
  currentPage: number;
  /** 原本の罫線を調べられたか（調べられなければ AI の位置をそのまま使っている） */
  analyzed: boolean;
}) {
  const { T } = useUI();
  const byQno = new Map<number, Placed>();
  layouts.forEach((l) => l.placed.forEach((p) => byQno.set(p.qno, p)));
  const pageCount = layouts.length;
  // 表示中のページの設問と、位置が分からない設問（どのページにも置けていない）だけを並べる
  const shown = sub.result.items.filter((it) => {
    const p = byQno.get(it.qno);
    return !p || p.page === currentPage || p.source === "none";
  });
  const needPos = shown.filter((it) => (byQno.get(it.qno)?.issues.length ?? 0) > 0).length;
  const needOther = [...byQno.values()].filter((p) => p.issues.length > 0 && p.page !== currentPage && p.source !== "none").length;

  return (
    <div data-testid="redpen-panel" style={{ display: "grid", gap: 8, alignContent: "start" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ font: `700 13px ${FONT_UI}`, color: T.text }}>
          {pageCount > 1 ? `${currentPage} ページ目の設問` : "設問ごとのコメント・赤ペンの位置"}
        </span>
        {needPos > 0 && <Badge tone="warn">位置の要確認 {needPos} 問</Badge>}
      </div>
      {needOther > 0 && (
        <div data-testid="other-page-review" style={{ fontSize: 11.5, color: T.warn }}>ほかのページに、位置の要確認が {needOther} 問あります（◀ ▶ でページを切り替えてください）。</div>
      )}
      {shown.length === 0 && <div style={{ fontSize: 12, color: T.textFaint }}>このページに置いた赤ペンはありません。</div>}
      <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.7 }}>
        ○×△ はドラッグ（または選んで矢印キー）で動かせます。動かしても判定・得点・コメント・要確認は変わりません。
        {!analyzed && " 原本の罫線を調べられなかったため、AI が返した位置を基準にしています。"}
      </div>
      {shown.map((it) => {
        const p = byQno.get(it.qno);
        const sel = selected === it.qno;
        return (
          <div key={it.qno} data-testid="panel-row" data-qno={it.qno} data-pos-review={p && p.issues.length ? "1" : "0"}
            onClick={() => p && onSelect(it.qno, p.page)}
            style={{
              border: `1px solid ${sel ? T.accent : p?.issues.length ? T.warn : T.line}`, borderRadius: 10, padding: "8px 10px",
              background: sel ? T.accentSoft : p?.issues.length ? T.warnSoft : T.panel, cursor: p ? "pointer" : "default",
            }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ font: `700 12.5px ${FONT_UI}`, color: T.text }}>{it.label}</span>
              <span style={{ font: `700 14px ${FONT_HAND}`, color: T.shu }}>{it.blank ? "—" : it.mark}</span>
              <span style={{ font: `700 12px ${FONT_MONO}`, color: T.text }}>{it.earned}/{it.points}</span>
              {p && <span style={{ fontSize: 11, color: T.textFaint }}>{p.page}ページ目</span>}
              {it.needReview && <Badge tone="warn">採点の要確認</Badge>}
              {p?.source === "saved" && <Badge tone="accent">位置を調整済み</Badge>}
            </div>
            <CommentEditor key={`${sub.id}:${it.qno}`} label={it.label} comment={it.comment}
              onSave={comment => onEditComment(it.qno, comment)} />
            {p && p.issues.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: T.warn, lineHeight: 1.6 }}>
                <b>位置の要確認：</b>{p.issues.join("／")}。原本で位置を確かめ、ずれていればドラッグで直してください。
              </div>
            )}
            {p && sel && (
              <div style={{ marginTop: 4, fontSize: 11, color: T.textFaint }}>位置の基準：{SOURCE_LABEL[p.source]}</div>
            )}
            {p && (p.issues.length > 0 || p.source === "saved" || (sel && pageCount > 1)) && (
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                {p.issues.length > 0 && <Btn size="sm" onClick={() => onConfirm(p)}>この位置でよい</Btn>}
                {Array.from({ length: pageCount }, (_, i) => i + 1).filter((n) => n !== p.page || p.source === "none").map((n) => (
                  <Btn key={n} size="sm" variant="ghost" onClick={() => onMoveTo(it.qno, n)}>{n} ページ目へ移す</Btn>
                ))}
                {p.source === "saved" && <Btn size="sm" variant="ghost" onClick={() => onReset(it.qno)}>位置を元に戻す</Btn>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CommentEditor({label, comment, onSave}: {
  label: string; comment: string; onSave: (value: string) => Promise<boolean>;
}) {
  const {T, toast} = useUI();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div style={{marginTop:6}} onClick={e => e.stopPropagation()}>
    {editing ? <>
      <textarea aria-label={`${label} のコメント`} value={draft} rows={4}
        disabled={busy} onChange={e => setDraft(e.target.value)}
        style={{...inputStyle(T),width:"100%",boxSizing:"border-box",resize:"vertical"}} />
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
        <Btn size="sm" variant="primary" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try {
            if (await onSave(draft)) { setEditing(false); toast("コメントを保存しました"); }
            else setError("保存できませんでした。入力は残しています。もう一度保存してください。");
          } catch { setError("保存できませんでした。入力は残しています。"); }
          finally { setBusy(false); }
        }}>{busy ? "保存中…" : "保存"}</Btn>
        <Btn size="sm" variant="ghost" disabled={busy} onClick={() => {setDraft(comment);setEditing(false);setError("");}}>取消</Btn>
        <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setDraft("")}>文章を空にする</Btn>
      </div>
      <div style={{fontSize:11,color:T.textSub,marginTop:4}}>取消は編集前に戻します。削除する場合は「文章を空にする」→「保存」。</div>
      {error && <div role="alert" style={{color:T.ng,fontSize:12}}>{error}</div>}
    </> : <>
      <div style={{font:`13px ${FONT_HAND}`,color:comment ? T.shu : T.textFaint,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{comment || "（コメントなし）"}</div>
      <Btn size="sm" variant="ghost" onClick={() => {setDraft(comment);setError("");setEditing(true);}}>コメントを編集</Btn>
    </>}
  </div>;
}
