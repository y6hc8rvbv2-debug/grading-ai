// E2E 用の OpenAI の代役（本物の OpenAI は呼ばない）。チャッピー先生の「本人のキーだけを使う」を検査する。
//   GET  /v1/models                     本人のキーならモデル一覧。失効させたキー・知らないキーは 401
//   POST /v1/realtime/client_secrets    短期の資格情報
//   GET  /__requests                    受けた要求（キーは末尾4文字と「本人か」だけを記録）
//   POST /__revoke {key}                そのキーを失効させる（以後 401）
//   POST /__quota {key}                 そのキーを残高不足にする（以後 429 insufficient_quota）
import http from "node:http";

const PORT = Number(process.env.MOCK_OPENAI_PORT || 4011);
const VALID = new Set((process.env.MOCK_OPENAI_KEYS || "").split(",").filter(Boolean));
const revoked = new Set(), noQuota = new Set();
const requests = [];

const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.url === "/__requests") return send(200, requests);
  if (req.method === "POST" && (req.url === "/__revoke" || req.url === "/__quota")) {
    const { key } = JSON.parse(raw || "{}");
    (req.url === "/__revoke" ? revoked : noQuota).add(key);
    return send(200, { ok: true });
  }
  // ブラウザから直接来る SDP の交換（短期の資格情報だけで呼ばれる）。別オリジンなので CORS を許す
  if (req.url === "/v1/realtime/calls") {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const eph = String(req.headers.authorization || "").replace(/^Bearer\s+/, "");
    requests.push({ method: req.method, url: req.url, ephemeral: eph.startsWith("ek_e2e_"), keyTail: eph.slice(-4), known: false, body: "" });
    if (!eph.startsWith("ek_e2e_")) { res.writeHead(401, cors); return res.end(); }
    res.writeHead(201, { ...cors, "content-type": "application/sdp" });
    return res.end("v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\n");
  }
  const key = String(req.headers.authorization || "").replace(/^Bearer\s+/, "");
  const entry = { method: req.method, url: req.url, keyTail: key.slice(-4), known: VALID.has(key), body: raw.slice(0, 20000) };
  requests.push(entry);
  if (!VALID.has(key) || revoked.has(key)) return send(401, { error: { code: "invalid_api_key", message: "Incorrect API key provided" } });
  if (noQuota.has(key)) return send(429, { error: { code: "insufficient_quota", message: "You exceeded your current quota" } });
  if (req.method === "GET" && req.url === "/v1/models") {
    return send(200, { object: "list", data: [{ id: "gpt-realtime-e2e" }, { id: "gpt-4o-mini-transcribe" }, { id: "gpt-5-e2e" }] });
  }
  if (req.method === "POST" && req.url === "/v1/realtime/client_secrets") {
    return send(200, { value: "ek_e2e_short_lived_" + Date.now(), expires_at: Math.floor(Date.now() / 1000) + 60, session: { type: "realtime" } });
  }
  return send(404, { error: { message: "not found" } });
});
server.listen(PORT, "127.0.0.1", () => console.log(`mock openai listening on ${PORT}`));
