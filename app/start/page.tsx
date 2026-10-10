// 起動画面（ストアのアプリはここを開く）。先生か生徒かを選ぶ
import type { Metadata } from "next";
import { APP_INFO } from "@/lib/app-info";

export const metadata: Metadata = { title: APP_INFO.name };

const card: React.CSSProperties = {
  display: "block", textDecoration: "none", color: "#1f2328", border: "1px solid #c9ced6", borderRadius: 16,
  padding: "18px 16px", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.06)",
};

export default function StartPage() {
  return (
    <main style={{ minHeight: "100vh", boxSizing: "border-box", background: "#F6F4EF", padding: "28px 16px", font: "15px/1.8 system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif" }}>
      <div style={{ maxWidth: 440, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div aria-hidden style={{ width: 48, height: 48, borderRadius: 12, background: "#C0392B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700 }}>朱</div>
          <h1 style={{ fontSize: 24, margin: 0 }}>{APP_INFO.name}</h1>
        </div>
        <p style={{ margin: "0 0 20px", color: "#57606a", fontSize: 14 }}>答案の写真から AI が採点の下書きと赤ペン添削を作り、先生が確認して生徒に返却します。</p>
        <div style={{ display: "grid", gap: 12 }}>
          <a href="/login" style={card} data-testid="start-teacher">
            <div style={{ fontSize: 18, fontWeight: 700 }}>👩‍🏫 先生・職員</div>
            <div style={{ fontSize: 13.5, color: "#57606a" }}>答案の撮影・採点・確認・返却。学校の管理者が作ったアカウントでログインします</div>
          </a>
          <a href="/student" style={card} data-testid="start-student">
            <div style={{ fontSize: 18, fontWeight: 700 }}>🧑‍🎓 生徒</div>
            <div style={{ fontSize: 13.5, color: "#57606a" }}>返却された答案を見て、間違えた問題を復習します</div>
          </a>
        </div>
        <p style={{ marginTop: 24, fontSize: 12.5, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <a href="/privacy">プライバシーポリシー</a>
          <a href="/terms">利用規約</a>
          <a href="/support">サポート</a>
        </p>
      </div>
    </main>
  );
}
