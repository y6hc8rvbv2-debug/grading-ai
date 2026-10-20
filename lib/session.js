// 署名付きCookieでセッションとWebAuthnのチャレンジを管理する（DB不要）
import crypto from "node:crypto";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET（32文字以上）を環境変数に設定してください");
  }
  return s;
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

// payload を「データ.署名」の形にし、有効期限を埋め込む
export function createToken(payload, maxAgeSec) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + maxAgeSec * 1000 })
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

// 署名が正しく期限内なら payload を返す。改ざん・期限切れは null
export function readToken(token) {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  return payload.exp > Date.now() ? payload : null;
}

export function getCookie(req, name) {
  const cookies = Object.fromEntries(
    (req.headers.cookie || "").split(";").map((c) => {
      const i = c.indexOf("=");
      return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
    })
  );
  return cookies[name];
}

export function setCookie(res, name, value, maxAgeSec) {
  const secure = process.env.NODE_ENV === "development" ? "" : "; Secure";
  const prev = res.getHeader("Set-Cookie") || [];
  res.setHeader("Set-Cookie", [
    ...[].concat(prev),
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`,
  ]);
}

// ログイン済みユーザー名を返す。未ログインなら null
export function getSessionUser(req) {
  return readToken(getCookie(req, "session"))?.username ?? null;
}
