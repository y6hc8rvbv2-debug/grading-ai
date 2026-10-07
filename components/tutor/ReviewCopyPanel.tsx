"use client";
// 本人の ChatGPT で復習（B方式。生徒の画面）。
//   1. 返却された答案の、間違えた問題1問の「送る内容」を生徒が読んで確かめる
//   2. 確かめたら「復習内容をコピー」→「ChatGPT を開く」→ 本人のアカウントで貼り付け、本人が音声会話を始める
// このアプリは AI を呼ばない（API キー・暗号鍵・見回りは不要）。ChatGPT での会話の開始・内容・理解度は受け取らない。
// 復習の状態は生徒の自己申告として残す（「理解確認済み」は先生だけ）。点数・赤ペン・先生のコメントは変わらない。
import React, { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CHATGPT_URL, buildReviewPrompt, type ReviewItem, type ReviewMeta } from "@/lib/tutor/review-copy";

const STATES: Record<string, string> = {
  untouched: "未記録", reviewing: "復習中（自己申告）", self_understood: "理解できた（自己申告）",
  verified: "理解確認済み（先生が確認）", ask_teacher: "先生に質問したい（自己申告）",
};
const btn: React.CSSProperties = { padding: "10px 14px", borderRadius: 10, border: "1px solid #9aa3ad", background: "#fff", color: "#1E3A5F", fontSize: 15, minHeight: 44, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" };
const primary: React.CSSProperties = { ...btn, background: "#1E3A5F", color: "#fff", border: "1px solid #1E3A5F" };

/** クリップボードへ書く。使えない環境（HTTP・古いブラウザ）では、文章を選んでブラウザのコピーを使う */
async function copyText(text: string, area: HTMLTextAreaElement | null) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 下の方法を試す */ }
  if (!area) return false;
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);
  try { return document.execCommand("copy"); } catch { return false; }
}

export function ReviewCopyPanel({ releaseId, item, meta }: { releaseId: string; item: ReviewItem; meta: ReviewMeta }) {
  const text = buildReviewPrompt(item, meta);
  const area = useRef<HTMLTextAreaElement>(null);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<{ state: string; source: string } | null>(null);

  useEffect(() => {
    createClient().from("tutor_progress").select("state, source").eq("release_id", releaseId).eq("qno", item.qno).maybeSingle()
      .then(({ data }) => setProgress(data ?? null));
  }, [releaseId, item.qno]);

  const copy = async () => {
    if (!checked) { setMessage("先に送る内容を読んで、「送る内容を確認しました」にチェックしてください。"); return; }
    setMessage(await copyText(text, area.current)
      ? "復習内容をコピーしました。「ChatGPT を開く」から、自分のアカウントで貼り付けて送ってください。"
      : "自動でコピーできませんでした。上の文章を長押しして「すべて選択」→「コピー」してください。");
  };
  const save = async (state: "reviewing" | "self_understood" | "ask_teacher") => {
    const db = createClient();
    const [{ data: student }, { data: school }] = await Promise.all([db.rpc("current_student_id"), db.rpc("current_student_school")]);
    const { error } = await db.from("tutor_progress").upsert(
      { school_id: school, student_id: student, release_id: releaseId, qno: item.qno, state, source: "external_self", updated_at: new Date().toISOString() },
      { onConflict: "release_id,qno" });
    if (error) setMessage("復習の状態を記録できませんでした。先生が「理解確認済み」にした問題は変えられません。");
    else { setProgress({ state, source: "external_self" }); setMessage("自己申告として記録しました。"); }
  };

  return (
    <section data-testid="review-copy" style={{ border: "1px solid #c9ced6", borderRadius: 14, padding: 12, marginTop: 10, background: "#fbfaf7", maxWidth: "100%", boxSizing: "border-box" }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 17 }}>{item.label}：ChatGPT で復習</h3>
      <ol style={{ fontSize: 14, lineHeight: 1.7, margin: "0 0 8px", paddingInlineStart: 20 }}>
        <li>下の「送る内容」を読んで確かめ、チェックを付ける</li>
        <li>「復習内容をコピー」を押す</li>
        <li>「ChatGPT を開く」→ 自分のアカウントでログインして、貼り付けて送る</li>
        <li>声で話したいときは、ChatGPT の音声モードを自分で始める</li>
      </ol>
      <label htmlFor={`review-text-${item.qno}`} style={{ fontWeight: 700, fontSize: 14 }}>送る内容（ChatGPT に貼り付ける文章）</label>
      <textarea id={`review-text-${item.qno}`} ref={area} readOnly value={text} rows={10} data-testid="review-copy-text"
        style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 4, padding: 8, fontSize: 13, lineHeight: 1.6, borderRadius: 8, border: "1px solid #9aa3ad", background: "#fff", resize: "vertical" }} />
      <p style={{ fontSize: 12.5, color: "#555", margin: "6px 0" }}>
        名前・学校名・出席番号・答案の写真は入りません。正答と解説は、先生が公開した場合だけ入ります。
        先生のコメントなどに名前が書かれていたら、ChatGPT に貼り付けたあと、送る前に消してください。
      </p>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, margin: "6px 0" }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ width: 20, height: 20, flex: "none" }} />
        <span>送る内容を確認しました</span>
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={{ ...primary, opacity: checked ? 1 : 0.5 }} disabled={!checked} onClick={copy}>📋 復習内容をコピー</button>
        <a style={btn} href={CHATGPT_URL} target="_blank" rel="noopener noreferrer">ChatGPT を開く ↗</a>
      </div>
      {message && <p role="status" style={{ color: "#8a4b00", fontSize: 14, margin: "6px 0" }}>{message}</p>}
      <p style={{ fontSize: 12.5, color: "#555", margin: "8px 0" }}>
        ChatGPT での会話は、このアプリの外で行います。このアプリは、会話を始めたり、会話の内容や理解度を受け取ったりしません。
        ChatGPT の利用条件（年齢・保護者の同意など）と、あなたのアカウントの利用枠に従って使ってください。復習しても、テストの点数・赤ペン・先生のコメントは変わりません。
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }} aria-label="復習の状態">
        <span style={{ fontSize: 13 }}>復習の状態：<b data-testid="review-progress">{STATES[progress?.state ?? "untouched"]}</b></span>
        {progress?.state !== "verified" && (["reviewing", "self_understood", "ask_teacher"] as const).map((s) => (
          <button key={s} style={{ ...btn, padding: "6px 10px", minHeight: 36, fontSize: 13 }} onClick={() => save(s)}>{STATES[s]}</button>
        ))}
      </div>
    </section>
  );
}
