"use client";
// 本人の ChatGPT で復習（B方式。生徒の画面）。
//   1. 返却された答案の問題1問の「送る内容」を読んで確かめる
//   2. 年齢に合わせた使い方で復習する
//      - 12歳以下：ChatGPT とのやり取りは保護者や先生（大人）に行ってもらう（大人が自分のアカウントで操作し、いっしょにヒントを読む）
//      - 13〜17歳：保護者の許可を得たうえで、本人のアカウントで使う
//      - 18歳以上：本人のアカウントで使う
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
const note: React.CSSProperties = { fontSize: 12.5, color: "#555", margin: "6px 0", lineHeight: 1.7 };

/** 年齢区分。既定は未選択（不明を自動で13歳以上として扱わない） */
type Band = "" | "under13" | "teen" | "adult";

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
  // 年齢区分（既定は未選択）と、区分ごとの確認。学年からは決めない・不明を13歳以上にしない
  const [band, setBand] = useState<Band>("");
  const [guardian, setGuardian] = useState(false); // 13〜17歳：保護者の許可
  const [adultWith, setAdultWith] = useState(false); // 12歳以下：大人といっしょに行う
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<{ state: string; source: string } | null>(null);

  useEffect(() => {
    createClient().from("tutor_progress").select("state, source").eq("release_id", releaseId).eq("qno", item.qno).maybeSingle()
      .then(({ data }) => setProgress(data ?? null));
  }, [releaseId, item.qno]);

  // 年齢に合わせて使える状態か（既定の未選択や不明では使えない）
  const ageOk = band === "adult" || (band === "teen" && guardian) || (band === "under13" && adultWith);
  const canUse = checked && ageOk;
  const child = band === "under13"; // 大人が操作する案内にする

  const copy = async () => {
    if (!canUse) { setMessage("先に送る内容を読み、年齢と必要なチェックを選んでください。"); return; }
    const ok = await copyText(text, area.current);
    if (!ok) { setMessage("自動でコピーできませんでした。上の文章を長押しして「すべて選択」→「コピー」してください。"); return; }
    setMessage(child
      ? "コピーしました。保護者や先生（大人）が、自分の ChatGPT に貼り付けて、いっしょにヒントを読みましょう。"
      : "復習内容をコピーしました。「ChatGPT を開く」から、自分のアカウントで貼り付けて送ってください。");
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

      {/* 年齢区分（既定は未選択。学年からは決めない。不明を自動で13歳以上にしない） */}
      <fieldset data-testid="review-age" style={{ border: "1px solid #c9ced6", borderRadius: 10, padding: "8px 10px", margin: "0 0 8px" }}>
        <legend style={{ fontWeight: 700, fontSize: 13.5, padding: "0 4px" }}>使う人の年齢を選んでください</legend>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="radio" name={`band-${item.qno}`} checked={band === "under13"} onChange={() => setBand("under13")} style={{ width: 20, height: 20, flex: "none" }} />
            <span>12歳以下（13歳未満）</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="radio" name={`band-${item.qno}`} checked={band === "teen"} onChange={() => setBand("teen")} style={{ width: 20, height: 20, flex: "none" }} />
            <span>13〜17歳</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="radio" name={`band-${item.qno}`} checked={band === "adult"} onChange={() => setBand("adult")} style={{ width: 20, height: 20, flex: "none" }} />
            <span>18歳以上</span>
          </label>
        </div>
      </fieldset>

      {/* 区分ごとの案内 */}
      {band === "" && (
        <p data-testid="review-band-hint" style={note}>まず「使う人の年齢」を選んでください。わからないときは、先生や保護者に聞きましょう。</p>
      )}
      {child && (
        <div data-testid="review-under13" style={{ background: "#eef4fb", border: "1px solid #cfe0f2", borderRadius: 10, padding: "8px 10px", margin: "0 0 8px", fontSize: 13.5, lineHeight: 1.8 }}>
          <b>13歳未満の方は、ChatGPT とのやり取りを保護者や先生に行ってもらってください。</b>
          自分の考えを大人に伝え、返ってきたヒントをいっしょに読みながら復習できます。
          <ul style={{ margin: "6px 0 0", paddingInlineStart: 20 }}>
            <li>大人は、<b>自分（大人）のアカウント</b>で ChatGPT を使ってください。大人のアカウントやパスワードを子どもに貸さないでください。</li>
            <li>13歳未満は、自分の ChatGPT アカウントを作れません（ChatGPT の利用条件）。</li>
          </ul>
        </div>
      )}
      {band === "teen" && (
        <div data-testid="review-teen" style={{ background: "#fff7e6", border: "1px solid #f0d9a8", borderRadius: 10, padding: "8px 10px", margin: "0 0 8px", fontSize: 13.5, lineHeight: 1.8 }}>
          18歳未満の方は、ChatGPT を使うことに<b>保護者の許可が必要</b>です。下のチェックを付けてください。
        </div>
      )}

      {/* 操作手順（年齢に合わせて説明） */}
      <ol style={{ fontSize: 14, lineHeight: 1.7, margin: "0 0 8px", paddingInlineStart: 20 }}>
        <li>下の「送る内容」を読んで確かめ、チェックを付ける</li>
        <li>「復習内容をコピー」を押す</li>
        {child ? (
          <>
            <li>保護者や先生（大人）が、<b>大人のアカウント</b>で ChatGPT を開いて貼り付ける</li>
            <li>返ってきたヒントを、大人といっしょに読みながら考える（声で話すときも大人が操作）</li>
          </>
        ) : (
          <>
            <li>「ChatGPT を開く」→ 自分のアカウントでログインして、貼り付けて送る</li>
            <li>声で話したいときは、ChatGPT の音声モードを自分で始める</li>
          </>
        )}
      </ol>

      <label htmlFor={`review-text-${item.qno}`} style={{ fontWeight: 700, fontSize: 14 }}>送る内容（ChatGPT に貼り付ける文章）</label>
      <textarea id={`review-text-${item.qno}`} ref={area} readOnly value={text} rows={10} data-testid="review-copy-text"
        style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 4, padding: 8, fontSize: 13, lineHeight: 1.6, borderRadius: 8, border: "1px solid #9aa3ad", background: "#fff", resize: "vertical" }} />
      <p style={note}>
        名前・学校名・出席番号・答案の写真は入りません。正答と解説は、先生が公開した場合だけ入ります。
        先生のコメントなどに名前が書かれていたら、ChatGPT に貼り付けたあと、送る前に消してください。
      </p>

      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, margin: "6px 0" }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ width: 20, height: 20, flex: "none" }} />
        <span>送る内容を確認しました</span>
      </label>
      {band === "teen" && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, margin: "6px 0" }}>
          <input type="checkbox" data-testid="review-guardian" checked={guardian} onChange={(e) => setGuardian(e.target.checked)} style={{ width: 20, height: 20, flex: "none" }} />
          <span>ChatGPT を使うことについて、保護者の許可を得ています</span>
        </label>
      )}
      {child && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, margin: "6px 0" }}>
          <input type="checkbox" data-testid="review-adultwith" checked={adultWith} onChange={(e) => setAdultWith(e.target.checked)} style={{ width: 20, height: 20, flex: "none" }} />
          <span>保護者または先生（大人）といっしょに、大人のアカウントで復習します</span>
        </label>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={{ ...primary, opacity: canUse ? 1 : 0.5 }} disabled={!canUse} onClick={copy}>📋 復習内容をコピー</button>
        {canUse
          ? <a style={btn} href={CHATGPT_URL} target="_blank" rel="noopener noreferrer">{child ? "ChatGPT を開く（大人のアカウントで）↗" : "ChatGPT を開く ↗"}</a>
          : <span style={{ ...btn, opacity: 0.5, cursor: "not-allowed" }} aria-disabled="true">ChatGPT を開く ↗</span>}
      </div>
      {message && <p role="status" style={{ color: "#8a4b00", fontSize: 14, margin: "6px 0" }}>{message}</p>}

      <p style={note}>
        ChatGPT での会話は、このアプリの外で行います。このアプリは、会話を始めたり、会話の内容や理解度を受け取ったりしません。
        年齢やチェックはこの画面で確かめるだけで、だれが実際に操作したかをアプリが確認することはできません。
        ChatGPT の利用条件（年齢・保護者の同意など）と、アカウントの利用枠に従って使ってください。復習しても、テストの点数・赤ペン・先生のコメントは変わりません。
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
