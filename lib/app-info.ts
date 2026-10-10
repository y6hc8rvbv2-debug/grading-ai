// アプリの公開情報（ストア・プライバシーポリシー・利用規約・お問い合わせで同じ値を使う）。
// 提供者名・問い合わせ先・本番の URL は、下の値を使う（2026-10-10 決定）。環境変数を設定すると、そちらが優先される
// （手元の検証で別の値を使うときなど）：
//   NEXT_PUBLIC_APP_PROVIDER       提供者名
//   NEXT_PUBLIC_SUPPORT_EMAIL      問い合わせ用メールアドレス（ストアの「サポート」欄と同じもの）
//   NEXT_PUBLIC_APP_URL            本番の URL。ネイティブアプリはこの URL を開く（capacitor.config.ts も同じ値）
export const APP_NAME = "テスト採点ver5";
export const DEFAULT_PROVIDER = "School-app1";
export const DEFAULT_SUPPORT_EMAIL = "daikan12321@gmail.com";
export const DEFAULT_APP_URL = "https://saiten.school-app1.com";
/** 規約・ポリシーの版（内容を変えたら日付を更新する） */
export const POLICY_VERSION = "2026-10-10";

export const APP_INFO = {
  name: APP_NAME,
  provider: (process.env.NEXT_PUBLIC_APP_PROVIDER || DEFAULT_PROVIDER).trim(),
  supportEmail: (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL).trim(),
  url: (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL).trim().replace(/\/$/, ""),
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
