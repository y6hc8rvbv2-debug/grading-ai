// Docker を使わない画面テスト用の、Supabase の入り口の代役（tests/e2e-lite/run.sh から起動する）。
//   /rest/v1/*     → 本物の PostgREST（素の PostgreSQL＋全マイグレーション。RLS は本物）へ中継
//   /auth/v1/*     → ログイン（パスワード）・利用者の取得・ログアウトだけを再現（JWT は PostgREST と同じ秘密で署名）
//   /storage/v1/*  → 署名付きURLの発行と、答案画像の代わりの白い PNG
// 受けた要求はすべて記録し、GET /__requests で返す（AI への要求が無いことの確認に使う）。
// 本番・検証環境では使わない。
import http from "node:http";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const PORT = Number(process.env.GATEWAY_PORT || 54399);
const REST = process.env.POSTGREST_URL || "http://127.0.0.1:54398";
const SECRET = process.env.JWT_SECRET;
const USERS = JSON.parse(process.env.LITE_USERS || "{}");   // { email: { id, password } }
if (!SECRET || SECRET.length < 32) throw new Error("JWT_SECRET が必要です");

const b64 = (b) => Buffer.from(b).toString("base64url");
export function sign(claims) {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify(claims));
  return `${head}.${body}.${crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}
function verify(token) {
  const [h, b, s] = String(token || "").split(".");
  if (!h || !b || !s) return null;
  const want = crypto.createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url");
  if (want.length !== s.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null;
  const c = JSON.parse(Buffer.from(b, "base64url").toString());
  return c.exp && c.exp * 1000 < Date.now() ? null : c;
}
const userJson = (id, email) => ({ id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: new Date(0).toISOString(),
  app_metadata: { provider: "email" }, user_metadata: {}, identities: [], created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() });

// 白い PNG（答案の写真の代わり。縦長 800x1100）
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 0xff); for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  // 薄い罫線を数本（真っ白だと「写真が単色」とみなす処理があるため）
  for (const y of [200, 400, 600, 800]) for (let x = 40; x < w - 40; x++) raw[y * (w + 1) + 1 + x] = 0x60;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PAGE = png(800, 1100);

const log = [];
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD", "access-control-expose-headers": "*" };
const send = (res, status, body, headers = {}) => {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { ...cors, ...(isBuf ? {} : { "content-type": "application/json" }), ...headers });
  res.end(isBuf ? body : body === undefined ? "" : JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => { const parts = []; req.on("data", (c) => parts.push(c)); req.on("end", () => r(Buffer.concat(parts))); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") return send(res, 204);
  if (url.pathname === "/__requests") return send(res, 200, log);
  log.push(`${req.method} ${url.pathname}`);
  const body = await readBody(req);
  const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");

  if (url.pathname === "/auth/v1/token") {
    const b = JSON.parse(body.toString() || "{}");
    const u = USERS[b.email];
    if (!u || u.password !== b.password) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials", code: "invalid_credentials" });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = sign({ sub: u.id, role: "authenticated", aud: "authenticated", email: b.email, exp });
    return send(res, 200, { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: crypto.randomUUID(), user: userJson(u.id, b.email) });
  }
  if (url.pathname === "/auth/v1/user") {
    const c = verify(bearer);
    if (!c || c.role !== "authenticated") return send(res, 401, { code: 401, error_code: "no_authorization", msg: "invalid JWT" });
    return send(res, 200, userJson(c.sub, c.email));
  }
  if (url.pathname === "/auth/v1/logout") return send(res, 204);
  // 管理 API：利用者の削除（アカウントの削除。service_role のトークンだけ）。本物と同じく auth.users を消す（関連は on delete で消える）
  const del = url.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
  if (del && req.method === "DELETE") {
    if (verify(bearer)?.role !== "service_role") return send(res, 403, { msg: "service_role が必要です" });
    try {
      execFileSync("psql", [process.env.PG_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", `delete from auth.users where id = '${del[1]}'`]);
    } catch (e) { return send(res, 500, { msg: String(e.stderr ?? e.message).slice(0, 300) }); }
    for (const [email, u] of Object.entries(USERS)) if (u.id === del[1]) delete USERS[email];
    return send(res, 200, {});
  }
  if (url.pathname.startsWith("/storage/v1/object/sign/")) {
    if (req.method === "POST") {
      if (!verify(bearer)) return send(res, 400, { statusCode: "403", error: "Unauthorized", message: "invalid token" });
      return send(res, 200, { signedURL: `${url.pathname.replace("/storage/v1", "")}?token=lite` });
    }
    return send(res, 200, PAGE, { "content-type": "image/png" });
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    const target = new URL(REST + url.pathname.replace("/rest/v1", "") + url.search);
    const headers = { ...req.headers };
    delete headers.host; delete headers.apikey; delete headers["content-length"];
    // apikey だけで来た要求（未ログイン）は anon として扱う。署名の無い・不正なトークンは PostgREST が断る
    if (!bearer || verify(bearer)?.role === "anon") headers.authorization = `Bearer ${sign({ role: "anon", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    const r = await fetch(target, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    const out = Buffer.from(await r.arrayBuffer());
    const h = {};
    for (const [k, v] of r.headers) if (!["content-encoding", "transfer-encoding", "connection", "content-length"].includes(k)) h[k] = v;
    return send(res, r.status, out, h);
  }
  return send(res, 404, { error: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`gateway :${PORT}`));
