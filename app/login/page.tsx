"use client";
// 教職員のログイン画面。生徒は /student から自分のアカウントでログインする。
// 教職員のアカウントは学校の管理者が作成・招待する（一般の新規登録は受け付けない）。
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { THEME, FONT_UI, FONT_HAND } from "@/lib/ui/theme";
import { friendlyError } from "@/lib/errors";
import { isSupabaseConfigured } from "@/lib/data/source";
import { createClient } from "@/lib/supabase/client";

const T = THEME.light;

export default function LoginPage() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleted, setDeleted] = useState(false);
  // アカウントを削除した直後（/login?deleted=1）
  useEffect(() => { setDeleted(new URLSearchParams(window.location.search).get("deleted") === "1"); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError("メールアドレスとパスワードを入力してください。"); return; }
    setBusy(true); setError("");
    try {
      const { error: err } = await createClient().auth.signInWithPassword({ email, password });
      if (err) throw err;
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(friendlyError(err, "ログイン"));
      setBusy(false);
    }
  };

  const input: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 9,
    border: `1px solid ${T.lineStrong}`, background: T.panel, color: T.text, font: `500 14px ${FONT_UI}`,
  };

  return (
    <main style={{
      minHeight: "100vh", background: T.bg, color: T.text, font: `14px/1.6 ${FONT_UI}`,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        width: "100%", maxWidth: 400, background: T.panel, border: `1px solid ${T.line}`,
        borderRadius: 16, boxShadow: T.shadow, padding: 26,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, background: T.shu, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center", font: `700 21px ${FONT_HAND}`,
          }}>朱</div>
          <div>
            <h1 style={{ margin: 0, font: `700 18px ${FONT_UI}` }}>テスト採点</h1>
            <div style={{ fontSize: 11.5, color: T.textSub }}>教職員ログイン</div>
          </div>
        </div>

        {deleted && (
          <div role="status" style={{ background: T.okSoft, color: T.ok, borderRadius: 9, padding: "9px 11px", fontSize: 12.5, marginBottom: 12 }}>
            アカウントを削除しました。
          </div>
        )}
        {!configured ? (
          <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.85 }}>
            <p style={{ marginTop: 0 }}>
              Supabase の接続情報が設定されていないため、デモモードで動いています。ログインは不要です。
            </p>
            <p>本番で使うには、<code>.env.local</code> に <code>NEXT_PUBLIC_SUPABASE_URL</code> と <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> を設定してください（docs/SUPABASE-SETUP.md のステップ5）。</p>
            <button onClick={() => router.replace("/")} style={{
              width: "100%", marginTop: 6, padding: "11px 0", borderRadius: 9, border: "none",
              background: T.accent, color: "#fff", font: `700 14px ${FONT_UI}`, cursor: "pointer",
            }}>デモを開く</button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <label style={{ display: "block", marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.textSub, marginBottom: 5 }}>メールアドレス</div>
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="teacher@example.ed.jp" style={input} />
            </label>
            <label style={{ display: "block", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.textSub, marginBottom: 5 }}>パスワード</div>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                style={input} />
            </label>
            {error && (
              <div role="alert" style={{
                background: T.ngSoft, color: T.ng, border: `1px solid ${T.ng}`, borderRadius: 9,
                padding: "9px 11px", fontSize: 12.5, lineHeight: 1.7, marginBottom: 12,
              }}>{error}</div>
            )}
            <button type="submit" disabled={busy} style={{
              width: "100%", padding: "11px 0", borderRadius: 9, border: "none",
              background: T.accent, color: "#fff", font: `700 14px ${FONT_UI}`,
              cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1,
            }}>{busy ? "ログインしています…" : "ログイン"}</button>
            <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 14, lineHeight: 1.75 }}>
              アカウントは学校の管理者が発行します。パスワードを忘れた場合は管理者に再設定を依頼してください。
            </div>
          </form>
        )}
        <div style={{ fontSize: 12, marginTop: 14, lineHeight: 2, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a href="/student" style={{ color: T.accent }}>生徒の方はこちら</a>
          <a href="/privacy" style={{ color: T.textSub }}>プライバシーポリシー</a>
          <a href="/terms" style={{ color: T.textSub }}>利用規約</a>
          <a href="/support" style={{ color: T.textSub }}>お問い合わせ</a>
        </div>
      </div>
    </main>
  );
}
