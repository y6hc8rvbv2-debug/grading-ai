// E2E テスト用の Anthropic API の代役（本物の API は呼ばない）。
//
// アプリのサーバーは ANTHROPIC_BASE_URL をこのサーバーに向けて起動する。
// POST /v1/messages を受け取ると、リクエストの形（モデル・フォールバック・出力形式・画像・設問）を検査し、
// 「答案に正答が書かれていた」とみなした採点結果を structured outputs と同じ形で返す。
//
// GET /v1/models は Models API の代役（比較試験がモデルID を確かめる）。
// 比較試験のリクエスト（fallbacks なし・比較用のモデルID）は別の規則で検査し、
// 期待結果どおりの採点（Haiku だけ ⑤ を読み違える）を返す。
//
//   GET  /__requests            受け取ったリクエスト（検査用）
//   POST /__mode {"mode":"..."} 次の1回だけ "ratelimit"（429）/ "refusal" を返す
import http from "node:http";
import { readFileSync } from "node:fs";

// 模範解答からの自動入力の代役：今回のテスト（20問・100点、5・5・1・3・1・3・2）を読み取った結果を返す
const IMPORT_RAW = readFileSync(new URL("../fixtures/import-raw.json", import.meta.url), "utf8");
const isImport = (body) => /テストを登録する教員の補助/.test(String(body.system));
function importProblems(req, body) {
  const p = [];
  if (req.headers["x-api-key"] !== process.env.EXPECTED_API_KEY) p.push("x-api-key が違う");
  if (body.model !== "claude-opus-5") p.push(`model が claude-opus-5 でない（${body.model}）`);
  if (body.stream !== true) p.push("stream で受け取っていない");
  if (body.thinking?.type !== "adaptive") p.push("thinking が adaptive でない");
  if (body.output_config?.format?.type !== "json_schema") p.push("output_config.format が json_schema でない");
  const content = body.messages?.[0]?.content ?? [];
  if (!content.some((c) => c.type === "text" && /資料1：模範解答/.test(c.text))) p.push("資料の種類（模範解答）を示していない");
  if (!content.some((c) => (c.type === "image" || c.type === "document") && c.source?.data)) p.push("資料の画像が無い");
  return p;
}
function sse(res, model, text) {
  res.writeHead(200, { "content-type": "text/event-stream", "request-id": "req_mock_import" });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev("message_start", { message: { id: "msg_mock_import", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5200, output_tokens: 1 } } });
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
  ev("content_block_stop", { index: 0 });
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2600 } });
  ev("message_stop", {});
  res.end();
}

const PORT = Number(process.env.MOCK_ANTHROPIC_PORT || 4010);
const requests = [];
let nextMode = "";
// モデルごとの台本：POST /__script {"claude-haiku-4-5": ["missing"], ...} で、次の呼び出しの結果を決める
// clean（既定）/ missing（最後の設問を返さない）/ contradict（正答と同じ解答を ×）/ unreadable（判読不能）/
// disagree（1問目を別の解答として ×）/ error500 / ratelimit / refusal / slow（2.5秒待ってから clean）
const scripts = {};

const MODELS = [
  { type: "model", id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5", created_at: "2025-10-01T00:00:00Z" },
  { type: "model", id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", created_at: "2026-08-01T00:00:00Z" },
  { type: "model", id: "claude-sonnet-5", display_name: "Claude Sonnet 5", created_at: "2026-05-01T00:00:00Z" },
  { type: "model", id: "claude-opus-5", display_name: "Claude Opus 5", created_at: "2026-05-01T00:00:00Z" },
];
const COMPARE_IDS = ["claude-haiku-4-5-20251001", "claude-sonnet-5-5", "claude-opus-5"];
const isCompare = (body) => !("fallbacks" in body) && /比較試験/.test(JSON.stringify(body.messages?.[0]?.content ?? ""));

function compareProblems(req, body) {
  const p = [];
  if (req.headers["x-api-key"] !== process.env.EXPECTED_API_KEY) p.push("x-api-key が違う");
  if (String(req.headers["anthropic-beta"] || "").includes("server-side-fallback")) p.push("比較試験に fallback の beta ヘッダーが付いている");
  if (!COMPARE_IDS.includes(body.model)) p.push(`Models API に無いモデルID（${body.model}）`);
  if ("thinking" in body) p.push("比較試験で thinking を指定している");
  if (body.output_config?.format?.type !== "json_schema") p.push("output_config.format が json_schema でない");
  const content = body.messages?.[0]?.content ?? [];
  const img = content.find((c) => c.type === "image");
  if (!img || img.source?.type !== "base64" || !img.source?.data) p.push("答案画像（base64）が無い");
  const qs = questionsFrom(body);
  if (qs.map((q) => q.correct).join(",") !== "6,18,36,72,144") p.push("模範解答（6,18,36,72,144）を送っていない");
  if (qs.some((q) => q.points !== 20)) p.push("配点が20点でない");
  const all = JSON.stringify(body);
  if (/145|期待|studentAnswer|60点/.test(all.replace(img?.source?.data ?? "", ""))) p.push("期待結果が入力に入っている");
  return p;
}

function compareResult(model) {
  const read = { 1: ["3+3=9", "×", 0], 2: ["9+9=18", "○", 20], 3: ["18+18=36", "○", 20], 4: ["36+36=72", "○", 20], 5: ["72+72=145", "×", 0] };
  // Haiku だけ ⑤ を 144 と読み違えて正解にする（照合で不一致になることを確かめる）
  if (model.startsWith("claude-haiku")) read[5] = ["72+72=144", "○", 20];
  return {
    quality: { tilt: 95, brightness: 92, blur: 94, shadow: 90, coverage: 97, contrast: 93, issues: [] },
    items: [1, 2, 3, 4, 5].map((qno) => ({
      qno, detected: read[qno][0], is_blank: false, mark: read[qno][1], earned: read[qno][2], confidence: 0.93,
      reason: read[qno][1] === "×" ? "計算ミス" : "", comment: "", bbox: { page: 1, x: 0.1, y: 0.1 * qno, w: 0.4, h: 0.08 },
    })),
  };
}

// 採点のリクエストの形を、モデルごとの決まりで検査する
//   claude-opus-5     … adaptive thinking・effort high・fallbacks（Opus単独とこれまでの採点）
//   claude-sonnet-5-5 … adaptive thinking・effort high、fallbacks なし（3モデル併用の2段目）
//   claude-haiku-4-5  … thinking・effort なし（Haiku 4.5 は非対応）、fallbacks なし（3モデル併用の1段目）
function problems(req, body) {
  const p = [];
  if (req.headers["x-api-key"] !== process.env.EXPECTED_API_KEY) p.push("x-api-key が違う");
  const beta = String(req.headers["anthropic-beta"] || "");
  if (body.model === "claude-opus-5") {
    if (!beta.includes("server-side-fallback-2026-07-01")) p.push("fallback の beta ヘッダーが無い");
    if (body.fallbacks !== "default") p.push("fallbacks が default でない");
    if (body.thinking?.type !== "adaptive") p.push("thinking が adaptive でない");
    if (body.output_config?.effort !== "high") p.push("effort が high でない");
  } else if (body.model === "claude-sonnet-5-5") {
    if (body.thinking?.type !== "adaptive") p.push("Sonnet の thinking が adaptive でない");
    if (body.output_config?.effort !== "high") p.push("Sonnet の effort が high でない");
    if ("fallbacks" in body || beta.includes("server-side-fallback")) p.push("3モデル併用の Sonnet に fallbacks を付けている");
  } else if (body.model === "claude-haiku-4-5") {
    if ("thinking" in body) p.push("Haiku に thinking を付けている（非対応）");
    if (body.output_config?.effort) p.push("Haiku に effort を付けている（非対応）");
    if ("fallbacks" in body || beta.includes("server-side-fallback")) p.push("3モデル併用の Haiku に fallbacks を付けている");
  } else {
    p.push(`想定外のモデル（${body.model}）`);
  }
  if (body.output_config?.format?.type !== "json_schema") p.push("output_config.format が json_schema でない");
  if ("budget_tokens" in (body.thinking || {})) p.push("budget_tokens を送っている");
  const content = body.messages?.[0]?.content ?? [];
  const img = content.find((c) => c.type === "image" || c.type === "document");
  if (!img || img.source?.type !== "base64" || !img.source?.data) p.push("答案画像（base64）が無い");
  if (img?.type === "image" && !/^image\/(jpeg|png|webp|gif)$/.test(img.source.media_type)) p.push("画像の media_type が不正");
  if (!/氏名/.test(String(body.system))) p.push("system に氏名を書かない指示が無い");
  return p;
}

function questionsFrom(body) {
  const text = body.messages[0].content.find((c) => c.type === "text")?.text ?? "";
  const m = text.match(/設問（qno・配点・正答・模範解答）:\n([\s\S]*?)\n\n採点基準:/);
  return m ? JSON.parse(m[1]) : [];
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const send = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json", "request-id": "req_mock" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "GET" && req.url === "/__requests") return send(200, requests);
    if (req.method === "POST" && req.url === "/__mode") { nextMode = JSON.parse(raw || "{}").mode || ""; return send(200, { ok: true }); }
    if (req.method === "POST" && req.url === "/__script") {
      for (const [m, list] of Object.entries(JSON.parse(raw || "{}"))) scripts[m] = [...(scripts[m] ?? []), ...list];
      return send(200, { ok: true });
    }
    if (req.method === "GET" && req.url.startsWith("/v1/models")) {
      requests.push({ url: req.url, kind: "models", problems: req.headers["x-api-key"] === process.env.EXPECTED_API_KEY ? [] : ["x-api-key が違う"] });
      return send(200, { data: MODELS, has_more: false, first_id: MODELS[0].id, last_id: MODELS.at(-1).id });
    }
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) return send(404, { type: "error", error: { type: "not_found_error", message: "not found" } });

    const body = JSON.parse(raw);
    if (isImport(body)) {
      const bad = importProblems(req, body);
      const content = body.messages[0].content;
      const mode = scripts.import?.shift() ?? "clean";
      requests.push({ url: req.url, kind: "import", model: body.model, mode, problems: bad,
        sources: content.filter((c) => c.type === "text" && /^資料\d+：/.test(c.text)).map((c) => c.text),
        images: content.filter((c) => c.type === "image" || c.type === "document").length });
      if (bad.length) return send(400, { type: "error", error: { type: "invalid_request_error", message: bad.join(" / ") } });
      const reply = () => sse(res, body.model, IMPORT_RAW);
      if (mode === "slow") setTimeout(reply, 2500); else reply();
      return;
    }
    if (isCompare(body)) {
      const bad = compareProblems(req, body);
      requests.push({ url: req.url, kind: "compare", model: body.model, problems: bad });
      if (bad.length) return send(400, { type: "error", error: { type: "invalid_request_error", message: bad.join(" / ") } });
      return send(200, {
        id: "msg_mock_compare", type: "message", role: "assistant", model: body.model,
        content: [{ type: "text", text: JSON.stringify(compareResult(body.model)) }],
        stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 2000, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      });
    }
    const bad = problems(req, body);
    const qs = questionsFrom(body);
    // 台本は文字列（モード）か、{ mode, bboxes }（設問ごとの位置を指定する。赤ペンの位置の確認用）
    const scripted = scripts[body.model]?.shift();
    const customBoxes = typeof scripted === "object" && scripted ? scripted.bboxes : null;
    const mode = nextMode || (typeof scripted === "object" && scripted ? scripted.mode : scripted) || "clean"; nextMode = "";
    requests.push({ url: req.url, kind: "grade", beta: req.headers["anthropic-beta"], model: body.model, mode, problems: bad, questions: qs,
      rubric: body.messages[0].content.find((c) => c.type === "text")?.text.split("採点基準:\n")[1] ?? "",
      imageType: body.messages[0].content[0]?.source?.media_type ?? body.messages[0].content[0]?.type,
      images: body.messages[0].content.filter((c) => c.type === "image" || c.type === "document").length });

    if (mode === "ratelimit") {
      res.writeHead(429, { "content-type": "application/json", "retry-after": "0", "x-should-retry": "false" });
      return res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "rate limited (mock)" } }));
    }
    if (mode === "error500") {
      res.writeHead(500, { "content-type": "application/json", "x-should-retry": "false" });
      return res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "internal error (mock)" } }));
    }
    if (bad.length) return send(400, { type: "error", error: { type: "invalid_request_error", message: bad.join(" / ") } });

    const pageCount = body.messages[0].content.filter((c) => c.type === "image" || c.type === "document").length;
    const items = qs.map((q, i) => ({
      qno: q.qno,
      detected: q.correct || "（記述：要点を満たす解答）",
      is_blank: false,
      mark: "○",
      earned: q.points,
      confidence: 0.95,
      reason: "",
      comment: "よくできました",
      // 2ページの答案では、2問目を2ページ目に置く（ページ別の赤ペン表示の確認用）
      bbox: customBoxes?.[i] ?? { page: i === 1 && pageCount > 1 ? 2 : 1, x: 0.12, y: 0.18 + i * 0.12, w: 0.45, h: 0.08 },
    }));
    const keyed = items.findIndex((_, i) => qs[i].correct);
    if (mode === "missing") items.pop();
    // 採点基準との矛盾：正答のある設問は「正答と同じ解答なのに ×」、無ければ「満点なのに △」（判定と得点の食い違い）
    if (mode === "contradict" && keyed >= 0) Object.assign(items[keyed], { mark: "×", earned: 0, reason: "計算ミス" });
    if (mode === "contradict" && keyed < 0) Object.assign(items[0], { mark: "△" });
    if (mode === "unreadable") Object.assign(items[0], { detected: "？？（判読不能）", confidence: 0.9 });
    if (mode === "disagree") Object.assign(items[keyed >= 0 ? keyed : 0], { detected: "別の解答", mark: "×", earned: 0, reason: "誤答" });
    const result = { quality: { tilt: 92, brightness: 90, blur: 94, shadow: 88, coverage: 96, contrast: 91, issues: [] }, items };
    const reply = () => send(200, {
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model: body.model,
      content: mode === "refusal" ? [] : [{ type: "text", text: JSON.stringify(result) }],
      stop_reason: mode === "refusal" ? "refusal" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 300 },
    });
    if (mode === "slow") setTimeout(reply, 2500); else reply();
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock anthropic listening on ${PORT}`));
