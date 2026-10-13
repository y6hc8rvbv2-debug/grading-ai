// E2E 用の OpenAI の代役（本物の OpenAI は呼ばない）。チャッピー先生の「本人のキーだけを使う」と「サーバーが通話を切る」を検査する。
//   GET  /v1/models                          本人のキーならモデル一覧（音声の会話に使えないモデルも混ぜる）。失効させたキー・知らないキーは 401
//   POST /v1/realtime/calls                  multipart（sdp・session）。SDP の応答と Location（通話ID）を返す
//   POST /v1/realtime/calls/{id}/hangup      通話を切る（記録する）
//   GET  /__requests                         受けた要求（キーは末尾4文字と「登録済みか」だけを記録）
//   POST /__revoke {key} / __quota {key}     そのキーを失効・残高不足にする
//   POST /__unrevoke                         失効・残高不足を元に戻す（後のテストのため）
//   POST /__hangup_fail {count}              次の count 回の hangup を 500 で失敗させる（再試行の確認）
import http from "node:http";

const PORT = Number(process.env.MOCK_OPENAI_PORT || 4011);
const VALID = new Set((process.env.MOCK_OPENAI_KEYS || "").split(",").filter(Boolean));
const revoked = new Set(), noQuota = new Set();
const requests = [];
let seq = 0, hangupFail = 0;

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
  if (req.method === "POST" && req.url === "/__unrevoke") { revoked.clear(); noQuota.clear(); return send(200, { ok: true }); }
  if (req.method === "POST" && req.url === "/__hangup_fail") { hangupFail = Number(JSON.parse(raw || "{}").count) || 0; return send(200, { ok: true }); }
  const key = String(req.headers.authorization || "").replace(/^Bearer\s+/, "");
  const entry = { method: req.method, url: req.url, keyTail: key.slice(-4), known: VALID.has(key), contentType: req.headers["content-type"] || "", origin: req.headers.origin || "", body: raw.slice(0, 20000) };
  requests.push(entry);
  if (!VALID.has(key) || revoked.has(key)) return send(401, { error: { code: "invalid_api_key", message: "Incorrect API key provided" } });
  if (noQuota.has(key)) return send(429, { error: { code: "insufficient_quota", message: "You exceeded your current quota" } });
  if (req.method === "GET" && req.url === "/v1/models") {
    return send(200, { object: "list", data: ["gpt-realtime-2", "gpt-audio-mini", "gpt-realtime-translate", "gpt-realtime-whisper", "gpt-4o-mini-transcribe", "gpt-5"].map((id) => ({ id })) });
  }
  if (req.method === "POST" && req.url === "/v1/realtime/calls") {
    if (!/multipart\/form-data/.test(entry.contentType) || !/name="sdp"/.test(raw) || !/name="session"/.test(raw)) return send(400, { error: { message: "multipart required" } });
    const id = `rtc_e2e_${++seq}`;
    entry.callId = id;
    res.writeHead(201, { "content-type": "application/sdp", location: `/v1/realtime/calls/${id}` });
    return res.end("v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\n");
  }
  const hang = req.url.match(/^\/v1\/realtime\/calls\/([A-Za-z0-9_-]+)\/hangup$/);
  if (req.method === "POST" && hang) {
    if (hangupFail > 0) { hangupFail--; entry.hangupFailed = hang[1]; return send(500, { error: { message: "server error" } }); }
    entry.hangup = hang[1]; return send(200, {});
  }
  return send(404, { error: { message: "not found" } });
});
server.listen(PORT, "127.0.0.1", () => console.log(`mock openai listening on ${PORT}`));
