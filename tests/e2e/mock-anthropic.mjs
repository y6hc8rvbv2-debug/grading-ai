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
const sysText = (body) => (Array.isArray(body.system) ? body.system.map((b) => b.text ?? "").join("\n") : String(body.system ?? ""));
const isImport = (body) => /テストを登録する教員の補助/.test(sysText(body));
// ver6：模範解答の自動作成の検算・判定
const isVerify = (body) => /模範解答を検算する教員/.test(sysText(body));
const isAdjudicate = (body) => /模範解答を最終確認する教員/.test(sysText(body));
// ver6：答案の自動振り分け（受験番号・テスト名の読み取り）。画像に埋め込んだ印（PNG の tEXt「EXAM:受験番号|TITLEHEX:テスト名のUTF-8の16進」）を読む
const isIntake = (body) => /答案の印刷情報だけ読み取る/.test(sysText(body));
function intakeResult(body) {
  const img = (body.messages?.[0]?.content ?? []).find((c) => c.type === "image");
  const bytes = img?.source?.data ? Buffer.from(img.source.data, "base64").toString("latin1") : "";
  const m = /EXAM:([A-Za-z0-9]*)\|TITLEHEX:([0-9a-f]*)/.exec(bytes);
  // 氏名欄の位置（ver6：氏名欄の塗りつぶし）：印「NAMEBOX:x,y,w,h」（割合）。無ければ 0
  const nb = /NAMEBOX:([0-9.]+),([0-9.]+),([0-9.]+),([0-9.]+)/.exec(bytes);
  const nameBox = nb ? { x: +nb[1], y: +nb[2], w: +nb[3], h: +nb[4] } : { x: 0, y: 0, w: 0, h: 0 };
  return { examNo: m ? m[1] : "", number: 0, page: 1, first: 1, last: 2, totalPages: 1, issues: [], title: m ? Buffer.from(m[2], "hex").toString("utf8") : "", nameBox };
}
// 同時に処理している採点の数（並列採点の確認用。GRADE_DELAY_MS で1件の応答を遅らせる）
let inFlight = 0, maxInFlight = 0;
// ver6：既定のモデル（lib/grading/models.ts の DEFAULT_MODELS）
const TOP = "claude-opus-5-5", STANDARD = "claude-sonnet-5-5", FAST = "claude-haiku-5-5";
function importProblems(req, body) {
  const p = [];
  if (req.headers["x-api-key"] !== process.env.EXPECTED_API_KEY) p.push("x-api-key が違う");
  if (![TOP, STANDARD].includes(body.model)) p.push(`model が ${TOP} / ${STANDARD} でない（${body.model}）`);
  if (body.stream !== true) p.push("stream で受け取っていない");
  if (body.thinking?.type !== "adaptive") p.push("thinking が adaptive でない");
  if (body.output_config?.format?.type !== "json_schema") p.push("output_config.format が json_schema でない");
  const content = body.messages?.[0]?.content ?? [];
  if (!content.some((c) => c.type === "text" && /資料1：/.test(c.text))) p.push("資料の種類を示していない");
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
  { type: "model", id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5", created_at: "2026-09-01T00:00:00Z" },
  { type: "model", id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-09-01T00:00:00Z" },
  // 将来のモデルの代役（設定画面の「新しいモデルがあります」の確認用）
  { type: "model", id: "claude-sonnet-6", display_name: "Claude Sonnet 6", created_at: "2026-12-01T00:00:00Z" },
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

// 採点のリクエストの形を、段階ごとの決まりで検査する（ver6 の既定のモデル）
//   claude-opus-5-5   … adaptive thinking・effort high・fallbacks（Opus単独・3モデル併用の最上位）
//   claude-sonnet-5-5 … adaptive thinking・effort medium、fallbacks なし（3モデル併用の2段目）
//   claude-haiku-5-5  … adaptive thinking・effort low、fallbacks なし（3モデル併用の1段目）
//   claude-haiku-4-5  … thinking・effort なし（学校が Haiku 4.5 を選んだとき）
function problems(req, body) {
  const p = [];
  if (req.headers["x-api-key"] !== process.env.EXPECTED_API_KEY) p.push("x-api-key が違う");
  const beta = String(req.headers["anthropic-beta"] || "");
  const noFallback = (who) => { if ("fallbacks" in body || beta.includes("server-side-fallback")) p.push(`3モデル併用の ${who} に fallbacks を付けている`); };
  if (body.model === TOP) {
    if (!beta.includes("server-side-fallback-2026-07-01")) p.push("fallback の beta ヘッダーが無い");
    if (body.fallbacks !== "default") p.push("fallbacks が default でない");
    if (body.thinking?.type !== "adaptive") p.push("thinking が adaptive でない");
    if (body.output_config?.effort !== "high") p.push("effort が high でない");
  } else if (body.model === STANDARD) {
    if (body.thinking?.type !== "adaptive") p.push("Sonnet の thinking が adaptive でない");
    if (body.output_config?.effort !== "medium") p.push("Sonnet の effort が medium でない");
    noFallback("Sonnet");
  } else if (body.model === FAST) {
    if (body.thinking?.type !== "adaptive") p.push("Haiku 5.5 の thinking が adaptive でない");
    if (body.output_config?.effort !== "low") p.push("Haiku 5.5 の effort が low でない");
    noFallback("Haiku");
  } else if (body.model === "claude-haiku-4-5") {
    if ("thinking" in body) p.push("Haiku 4.5 に thinking を付けている（非対応）");
    if (body.output_config?.effort) p.push("Haiku 4.5 に effort を付けている（非対応）");
    noFallback("Haiku");
  } else {
    p.push(`想定外のモデル（${body.model}）`);
  }
  if (body.output_config?.format?.type !== "json_schema") p.push("output_config.format が json_schema でない");
  if ("budget_tokens" in (body.thinking || {})) p.push("budget_tokens を送っている");
  const content = body.messages?.[0]?.content ?? [];
  const img = content.find((c) => c.type === "image" || c.type === "document");
  if (!img || img.source?.type !== "base64" || !img.source?.data) p.push("答案画像（base64）が無い");
  if (img?.type === "image" && !/^image\/(jpeg|png|webp|gif)$/.test(img.source.media_type)) p.push("画像の media_type が不正");
  if (!/氏名/.test(sysText(body))) p.push("system に氏名を書かない指示が無い");
  // ver6：設問・正答・採点基準は system の2つ目のブロックに置き、プロンプトキャッシュに載せる
  if (!Array.isArray(body.system) || body.system[1]?.cache_control?.type !== "ephemeral") p.push("設問・採点基準をキャッシュに載せていない");
  return p;
}

function questionsFrom(body) {
  const text = sysText(body);
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
    if (req.method === "GET" && req.url === "/__stats") return send(200, { maxInFlight, inFlight });
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
    if (isIntake(body)) {
      const result = intakeResult(body);
      requests.push({ url: req.url, kind: "intake", model: body.model, problems: req.headers["x-api-key"] === process.env.EXPECTED_API_KEY ? [] : ["x-api-key が違う"], result });
      return send(200, { id: "msg_mock_intake", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify(result) }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 900, output_tokens: 60 } });
    }
    if (isImport(body)) {
      const bad = importProblems(req, body);
      const content = body.messages[0].content;
      const mode = scripts.import?.shift() ?? "clean";
      requests.push({ url: req.url, kind: "import", model: body.model, mode, problems: bad,
        sources: content.filter((c) => c.type === "text" && /^資料\d+：/.test(c.text)).map((c) => c.text),
        images: content.filter((c) => c.type === "image" || c.type === "document").length });
      if (bad.length) return send(400, { type: "error", error: { type: "invalid_request_error", message: bad.join(" / ") } });
      // 模範解答なしモード（ver6 の下書き）：問題用紙から解いた答えとして返す
      const generated = /模範解答なしモード/.test(sysText(body))
        ? JSON.stringify({ ...JSON.parse(IMPORT_RAW), questions: JSON.parse(IMPORT_RAW).questions.map((q) => (q.correct ? { ...q, correct_status: "generated", correct_file: 1 } : q)) })
        : IMPORT_RAW;
      const reply = () => sse(res, body.model, generated);
      if (mode === "slow") setTimeout(reply, 2500); else reply();
      return;
    }
    if (isVerify(body) || isAdjudicate(body)) {
      // 検算は取り込み用の結果（IMPORT_RAW）の正答をそのまま答える＝下書きと一致。台本 "verify": ["differ"] で1問目だけ違う答え
      const mode = scripts[isVerify(body) ? "verify" : "adjudicate"]?.shift() ?? "clean";
      requests.push({ url: req.url, kind: isVerify(body) ? "verify" : "adjudicate", model: body.model, mode, problems: [] });
      const qs = JSON.parse(IMPORT_RAW).questions ?? [];
      const text = isVerify(body)
        ? JSON.stringify({ answers: qs.map((q, i) => ({ big: q.big, sub: q.sub, answer: mode === "differ" && i === 0 ? "999" : q.correct, solvable: !!q.correct })) })
        : JSON.stringify({ decisions: [] });
      return sse(res, body.model, text);
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
      rubric: sysText(body).split("採点基準:\n")[1] ?? "",
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
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    const done = () => { inFlight--; reply(); };
    const delay = mode === "slow" ? 2500 : Number(process.env.GRADE_DELAY_MS || 0);
    if (delay) setTimeout(done, delay); else done();
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock anthropic listening on ${PORT}`));
