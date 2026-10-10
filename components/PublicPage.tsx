// ログインなしで読める公開ページの枠（起動画面・プライバシーポリシー・利用規約・サポート・アカウントの削除）。
// ストアの審査担当・保護者も読む。サーバーで描画する（ボタンの動き無し）。
import React from "react";
import { APP_INFO, POLICY_VERSION } from "@/lib/app-info";

export function PublicPage({ title, children, updated = true }: { title: string; children: React.ReactNode; updated?: boolean }) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "20px 16px 40px", font: "15px/1.85 system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif", color: "#1f2328", background: "#fff" }}>
      <p style={{ margin: "0 0 4px", fontSize: 13 }}><a href="/start" style={{ color: "#1E3A5F" }}>← {APP_INFO.name}</a></p>
      <h1 style={{ fontSize: 22, margin: "4px 0 6px" }}>{title}</h1>
      {updated && <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "#57606a" }}>制定・最終改定：{POLICY_VERSION}</p>}
      {children}
      <footer style={{ marginTop: 32, paddingTop: 12, borderTop: "1px solid #d0d7de", fontSize: 12.5, color: "#57606a", display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span>提供者：{APP_INFO.provider || <Missing what="提供者名" />}</span>
        <span>お問い合わせ：{APP_INFO.supportEmail ? <a href={`mailto:${APP_INFO.supportEmail}`}>{APP_INFO.supportEmail}</a> : <Missing what="問い合わせ先" />}</span>
        <a href="/privacy">プライバシーポリシー</a>
        <a href="/terms">利用規約</a>
        <a href="/support">サポート</a>
        <a href="/account-deletion">アカウントの削除</a>
      </footer>
    </main>
  );
}

/** 公開前に設定が必要な値（環境変数）が未設定のときの表示 */
export function Missing({ what }: { what: string }) {
  return <span style={{ color: "#B3261E" }}>（{what}が未設定です）</span>;
}

export const H2 = ({ children }: { children: React.ReactNode }) => <h2 style={{ fontSize: 17, margin: "24px 0 6px" }}>{children}</h2>;
