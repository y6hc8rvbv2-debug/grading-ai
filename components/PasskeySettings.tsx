"use client";
// パスキー（指紋・顔認証・端末の画面ロック）でのログイン（2026-10-27。docs/SECURITY-REVIEW.md）
//   サーバー（Supabase）に残るのは「公開鍵」だけで、秘密の鍵は本人の端末から出ない。漏れても、なりすましに使えない。
//   Supabase の設定でパスキーを有効にし、環境変数 NEXT_PUBLIC_PASSKEY_ENABLED=1 のときだけ表示する（docs/V6-SETUP.md）
import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

export const passkeyEnabled = () =>
  process.env.NEXT_PUBLIC_PASSKEY_ENABLED === "1" && typeof window !== "undefined" && "PublicKeyCredential" in window;

type Item = { id: string; friendly_name?: string; created_at: string; last_used_at?: string };

/** 設定画面：パスキーの登録・一覧・削除（教職員・生徒で共通） */
export function PasskeySettings() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [on, setOn] = useState(false);
  const load = async () => {
    const { data, error } = await createClient().auth.passkey.list();
    setItems(error ? [] : ((data ?? []) as Item[]));
  };
  useEffect(() => { const e = passkeyEnabled(); setOn(e); if (e) load(); }, []);
  if (!on) return null;

  const add = async () => {
    setBusy(true); setMessage("");
    try {
      const { error } = await createClient().auth.registerPasskey();
      if (error) throw error;
      setMessage("パスキーを登録しました。次から「パスキーでログイン」を使えます。");
      await load();
    } catch (e) { setMessage(friendlyError(e, "パスキーの登録")); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!window.confirm("このパスキーを削除しますか？ その端末ではパスキーでログインできなくなります。")) return;
    setBusy(true); setMessage("");
    try {
      const { error } = await createClient().auth.passkey.delete({ passkeyId: id });
      if (error) throw error;
      await load();
    } catch (e) { setMessage(friendlyError(e, "パスキーの削除")); } finally { setBusy(false); }
  };
  const btn: React.CSSProperties = { padding: "6px 12px", borderRadius: 8, border: "1px solid #9aa3ad", background: "#fff", cursor: "pointer", fontSize: 13 };
  return (
    <section aria-label="パスキー" style={{ borderTop: "1px solid #e5e1d8", marginTop: 14, paddingTop: 12, fontSize: 13, lineHeight: 1.8 }}>
      <div style={{ fontWeight: 700 }}>パスキー（指紋・顔認証でログイン）</div>
      <div style={{ color: "#555" }}>パスワードの代わりに、この端末の指紋・顔認証・画面ロックでログインします。サーバーには公開鍵しか残らないため、漏れても悪用できません。</div>
      {(items ?? []).length > 0 && (
        <ul data-testid="passkeys" style={{ margin: "6px 0", paddingInlineStart: 18 }}>
          {(items ?? []).map((p) => (
            <li key={p.id}>
              {p.friendly_name || "パスキー"}（登録 {p.created_at.slice(0, 10)}{p.last_used_at ? `・最後に使用 ${p.last_used_at.slice(0, 10)}` : ""}）
              <button style={{ ...btn, marginInlineStart: 8, padding: "2px 8px" }} disabled={busy} onClick={() => remove(p.id)}>削除</button>
            </li>
          ))}
        </ul>
      )}
      <button style={btn} disabled={busy} onClick={add}>この端末をパスキーとして登録する</button>
      {message && <div role="status" style={{ marginTop: 6 }}>{message}</div>}
    </section>
  );
}

/** ログイン画面：パスキーでログインするボタン（成功したら onSignedIn） */
export function PasskeySignIn({ onSignedIn, onError }: { onSignedIn: () => void | Promise<void>; onError: (msg: string) => void }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(passkeyEnabled()), []);
  if (!on) return null;
  return (
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const { data, error } = await createClient().auth.signInWithPasskey();
        if (error) throw error;
        if (data?.session) await onSignedIn();
      } catch (e) { onError(friendlyError(e, "パスキーでのログイン")); } finally { setBusy(false); }
    }} style={{ width: "100%", padding: "10px 0", borderRadius: 9, border: "1px solid #1E3A5F", background: "#fff", color: "#1E3A5F", fontWeight: 700, fontSize: 14, cursor: "pointer", marginTop: 10 }}>
      🔑 パスキーでログイン（指紋・顔認証）
    </button>
  );
}
