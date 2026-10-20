// WebAuthn の共通設定
export const rpName = "小学生テスト採点AI";

// RP_ID はドメイン名（例: example.com）、ORIGIN は https://example.com のような完全なURL
export const rpID = process.env.RP_ID || "localhost";
export const origin = process.env.ORIGIN || "http://localhost:3000";

export function isValidUsername(username) {
  return typeof username === "string" && /^[a-zA-Z0-9_-]{3,32}$/.test(username);
}
