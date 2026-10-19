"use client";
// 本人によるアカウントの削除（生徒・教職員で共通）。確認の文字を入れてから削除する。
// 削除はサーバー（/api/account/delete）が行う。消えるもの・残るものを先に示す。
import React, { useState } from "react";

export function AccountDeletion({ kind, onDeleted }: { kind: "student" | "staff"; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const btn: React.CSSProperties = { padding: "8px 14px", minHeight: 40, borderRadius: 10, border: "1px solid #B3261E", background: "#fff", color: "#B3261E", fontSize: 14, cursor: "pointer" };

  const remove = async () => {
    setBusy(true); setMessage("");
    try {
      const res = await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: text.trim() }), cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(j.error ?? "削除できませんでした。時間をおいてお試しください。"); return; }
      try { localStorage.clear(); sessionStorage.clear(); } catch { /* 使えない環境 */ }
      onDeleted();
    } catch {
      setMessage("通信できませんでした。電波の良いところでもう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="account-deletion" style={{ fontSize: 13.5, lineHeight: 1.8 }}>
      {!open ? (
        <button style={btn} onClick={() => setOpen(true)}>アカウントを削除する</button>
      ) : (
        <div style={{ border: "1px solid #e3b4b0", borderRadius: 12, padding: 12, background: "#fff8f7" }}>
          <p style={{ margin: "0 0 6px", fontWeight: 700 }}>アカウントを削除すると、元に戻せません。</p>
          <ul style={{ margin: "0 0 8px", paddingInlineStart: 20 }}>
            <li>消えるもの：ログインのアカウント（メールアドレス・パスワード）{kind === "student" ? "、返却された答案を見るための登録、復習の自己申告" : "、教職員のプロフィール"}</li>
            <li>残るもの：学校が管理する記録（名簿の番号・答案・採点結果・返却した内容）。氏名はもともと保存していません</li>
            {kind === "staff" && <li>学校の最後の管理者は削除できません。先にほかの教職員を管理者にしてください</li>}
            {kind === "student" && <li>また返却を受けたいときは、新しく登録して先生に伝えてください</li>}
          </ul>
          <label style={{ display: "block", marginBottom: 6 }}>
            確認のため「削除」と入力してください
            <input aria-label="確認の文字" value={text} onChange={(e) => setText(e.target.value)}
              style={{ display: "block", marginTop: 4, padding: 8, fontSize: 15, borderRadius: 8, border: "1px solid #9aa3ad", width: 160 }} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={{ ...btn, background: "#B3261E", color: "#fff", opacity: text.trim() === "削除" && !busy ? 1 : 0.5 }}
              disabled={text.trim() !== "削除" || busy} onClick={remove}>{busy ? "削除しています…" : "削除する"}</button>
            <button style={{ ...btn, borderColor: "#9aa3ad", color: "#333" }} onClick={() => { setOpen(false); setText(""); setMessage(""); }}>やめる</button>
          </div>
          {message && <p role="alert" style={{ color: "#B3261E", margin: "6px 0 0" }}>{message}</p>}
        </div>
      )}
    </section>
  );
}
