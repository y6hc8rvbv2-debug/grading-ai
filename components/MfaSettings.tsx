"use client";
// 二段階認証（認証アプリの6桁のコード）の設定。教職員の設定画面の「アカウント」に出す（2026-10-22。docs/SECURITY-REVIEW.md）
//   設定すると、ログインのたびにパスワードのあとで6桁のコードを聞かれる。DB も、2段階目まで済んだログインでないと学校のデータを返さない（0022）
//   管理者には設定をすすめる（パスワードが漏れても、なりすまされない）
import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

// ボタン（画面の共通設定に頼らない。ログイン画面（共通の外枠の外）でも使うため。2026-11-10）
function Btn({ children, onClick, disabled, variant }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; size?: string; variant?: "ghost" }) {
  return <button type="button" onClick={onClick} disabled={disabled} style={{
    padding: "6px 12px", borderRadius: 8, fontSize: 13, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1,
    border: `1px solid ${variant === "ghost" ? "transparent" : "#9aa3ad"}`, background: variant === "ghost" ? "transparent" : "#fff", color: "#1d2433",
  }}>{children}</button>;
}

type Factor = { id: string; status: string; factor_type?: string; friendly_name?: string };

/** onDone：設定が終わったとき（ログインの直後に設定を求める画面で、続きへ進む）。required：管理者で設定が必須（2026-11-10。0027） */
export function MfaSettings({ isAdmin, onDone, required }: { isAdmin: boolean; onDone?: () => void; required?: boolean }) {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    // 読み込みに失敗しても（例外を含む）、設定のボタンは出す（何も出ないと、必須の管理者が先へ進めない）
    try {
      const { data, error } = await createClient().auth.mfa.listFactors();
      if (error) { setFactors([]); return; }
      setFactors(((data?.all ?? []) as Factor[]).filter((f) => (f.factor_type ?? "totp") === "totp"));
    } catch { setFactors([]); }
  };
  useEffect(() => { load(); }, []);
  const verified = (factors ?? []).filter((f) => f.status === "verified");

  const start = async () => {
    setBusy(true); setMessage("");
    try {
      const sb = createClient();
      // 途中でやめた設定（未確認の要素）が残っていると新しく作れないので、先に消す
      for (const f of (factors ?? []).filter((x) => x.status !== "verified")) await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `テスト採点 ${new Date().toISOString().slice(0, 10)}` });
      if (error) throw error;
      setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (e) { setMessage(friendlyError(e, "二段階認証の設定")); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!enroll || !/^\d{6}$/.test(code)) { setMessage("認証アプリに表示された6桁の数字を入力してください。"); return; }
    setBusy(true); setMessage("");
    try {
      const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: enroll.id, code });
      if (error) throw error;
      setEnroll(null); setCode(""); setMessage("二段階認証を設定しました。次のログインから、6桁のコードを聞かれます。");
      await load();
      onDone?.();
    } catch (e) { setMessage(friendlyError(e, "コードの確認")); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!window.confirm(isAdmin
      ? "二段階認証を解除しますか？ 管理者は二段階認証が必須のため、解除すると次のログインで設定し直すまで学校のデータを使えません。"
      : "二段階認証を解除しますか？ パスワードだけでログインできるようになります。")) return;
    setBusy(true); setMessage("");
    try {
      const { error } = await createClient().auth.mfa.unenroll({ factorId: id });
      if (error) throw error;
      setMessage("二段階認証を解除しました。");
      await load();
    } catch (e) { setMessage(friendlyError(e, "二段階認証の解除")); } finally { setBusy(false); }
  };

  if (factors === null) return null;
  return (
    <section aria-label="二段階認証" style={{ borderTop: "1px solid #e5e1d8", marginTop: 14, paddingTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>二段階認証（認証アプリ）</div>
      {verified.length ? (
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <span data-testid="mfa-state">✓ 設定済み</span>：ログインのたびに、認証アプリの6桁のコードを聞かれます。
          <div style={{ marginTop: 6 }}><Btn size="sm" variant="ghost" disabled={busy} onClick={() => remove(verified[0].id)}>二段階認証を解除する</Btn></div>
        </div>
      ) : enroll ? (
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <ol style={{ paddingInlineStart: 20, margin: "0 0 8px" }}>
            <li>スマホの認証アプリ（Google Authenticator・Microsoft Authenticator など）で、下の QR コードを読み取る</li>
            <li>アプリに出た6桁の数字を入力して「確認」</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="二段階認証の QR コード" width={180} height={180} style={{ background: "#fff", borderRadius: 8 }} />
          <div style={{ fontSize: 12, color: "#666", wordBreak: "break-all" }}>読み取れないときは、このキーをアプリに入力：<code>{enroll.secret}</code></div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              aria-label="6桁のコード" placeholder="123456" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ccc", width: 120, fontSize: 16 }} />
            <Btn size="sm" disabled={busy} onClick={confirm}>確認</Btn>
            <Btn size="sm" variant="ghost" disabled={busy} onClick={() => { setEnroll(null); setCode(""); }}>やめる</Btn>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          {isAdmin
            ? <div role="note" style={{ color: "#b5620e", fontWeight: 700 }}>{required
                ? "管理者は二段階認証の設定が必須です。設定するまで、学校のデータは使えません（パスワードが漏れても、なりすましを防ぐため）。"
                : "管理者は二段階認証が必須です。パスワードが漏れても、なりすましを防げます。"}</div>
            : <div>パスワードに加えて、スマホの認証アプリのコードでログインします。</div>}
          <div style={{ marginTop: 6 }}><Btn size="sm" disabled={busy} onClick={start}>二段階認証を設定する</Btn></div>
        </div>
      )}
      {message && <div role="status" style={{ fontSize: 12.5, marginTop: 6 }}>{message}</div>}
    </section>
  );
}
