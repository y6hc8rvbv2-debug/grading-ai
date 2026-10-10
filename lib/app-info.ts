// アプリの公開情報（ストア・プライバシーポリシー・利用規約・お問い合わせで同じ値を使う）。
// 提供者名・問い合わせ先・本番の URL は、ここではなく環境変数で設定する（Vercel の Production と、ストア用のビルド）：
//   NEXT_PUBLIC_APP_PROVIDER       提供者名（個人で公開する場合は、開発者アカウントの名義と同じ氏名）
//   NEXT_PUBLIC_SUPPORT_EMAIL      問い合わせ用メールアドレス（ストアの「サポート」欄と同じもの）
//   NEXT_PUBLIC_APP_URL            本番の URL（例 https://saiten.example.jp）。ネイティブアプリはこの URL を開く
// 未設定のまま公開しないよう、npm run store:check と設定画面の「準備状況」が未設定を知らせる。
export const APP_NAME = "テスト採点";
/** 規約・ポリシーの版（内容を変えたら日付を更新する） */
export const POLICY_VERSION = "2026-10-10";

export const APP_INFO = {
  name: APP_NAME,
  provider: (process.env.NEXT_PUBLIC_APP_PROVIDER ?? "").trim(),
  supportEmail: (process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "").trim(),
  url: (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, ""),
};

/** 公開に必要な値で、未設定のもの（空なら公開の準備ができている） */
export function missingAppInfo() {
  const miss: string[] = [];
  if (!APP_INFO.provider) miss.push("NEXT_PUBLIC_APP_PROVIDER（提供者名）");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(APP_INFO.supportEmail)) miss.push("NEXT_PUBLIC_SUPPORT_EMAIL（問い合わせ用メールアドレス）");
  if (!/^https:\/\/[^/\s]+/.test(APP_INFO.url)) miss.push("NEXT_PUBLIC_APP_URL（本番の URL。https:// から）");
  return miss;
}

/** 問い合わせのメールを開くリンク（問い合わせ先が未設定なら null） */
export function mailtoLink(subject: string, body = "") {
  if (!APP_INFO.supportEmail) return null;
  return `mailto:${APP_INFO.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
