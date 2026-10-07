// 返却とチャッピー先生（生徒本人の OpenAI 契約での復習）の通しテスト。tests/e2e/run.sh から呼ぶ。
// 学校C（tests/e2e/seed.mjs）のデータだけを使い、既存のシナリオ（学校A・B）とは混ざらない。
// OpenAI は代役（tests/e2e/mock-openai.mjs）。本物の OpenAI・採点AIは呼ばない。
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3200";
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
});
const errors = [];
const ok = (cond, msg) => { if (!cond) { console.log("✗ FAIL:", msg); throw new Error(msg); } console.log("✓", msg); };
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const rpTok = (await (await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: process.env.ANON, "content-type": "application/json" }, body: JSON.stringify({ email: "admin@c.example", password: "pass-C-123" }),
})).json()).access_token;
const rp = async (path) => (await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: process.env.ANON, authorization: `Bearer ${rpTok}` } })).json();
const [rpSub] = await rp("submissions?select=id");
const [mockTest] = await rp("tests?select=id");
// 管理者（先生）の画面
const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await adminCtx.newPage();
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`[admin ${m.type()}] ${m.text()}`); });
await page.goto(BASE + "/login");
await page.getByLabel("メールアドレス").fill("admin@c.example");
await page.getByLabel("パスワード").fill("pass-C-123");
await page.getByRole("button", { name: "ログイン" }).click();
await page.waitForURL(BASE + "/");

// 11i. 返却とチャッピー先生（生徒本人の OpenAI 契約で復習）。OpenAI は代役（tests/e2e/mock-openai.mjs）。
//      料金の支払者は本人：OpenAI への要求はすべて本人のキー。管理者のキー（ANTHROPIC_API_KEY・OPENAI_API_KEY）は一度も使わない。
//      WebRTC の接続そのものは代役（ブラウザの RTCPeerConnection を差し替え）。実際の音声のやり取りは未検証。
const OAI = process.env.MOCK_OPENAI_URL;
const SK = process.env.STUDENT_KEY, SK2 = process.env.STUDENT_KEY2;
const oaiReqs = async () => (await (await fetch(OAI + "/__requests")).json());
const rpcA = async (name, args) => {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: process.env.ANON, authorization: `Bearer ${rpTok}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const patchA = (path, body) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { method: "PATCH", headers: { apikey: process.env.ANON, authorization: `Bearer ${rpTok}`, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify(body) });
const [clsA] = await rp("classes?select=id");
// 先生：大問1-(2) を × にしてコメントを付け、問題文を入れる（教師の修正 → 確認 → 返却）
await patchA(`submission_items?submission_id=eq.${rpSub.id}&qno=eq.2`, { mark: "×", earned: 0, comment: "符号に注意", need_review: false });
await patchA(`questions?test_id=eq.${mockTest.id}&no=eq.2`, { prompt_text: "-4a+6b-12 を計算しなさい（問題文の例）" });

// 生徒（スマホ）。RTCPeerConnection とマイクを代役にする（マイクは最初は拒否）
const stuCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ["clipboard-read", "clipboard-write"] });
await stuCtx.addInitScript(() => {
  window.__rtc = { created: 0, open: 0, sent: [] };
  class FakeDC {
    constructor() { this.readyState = "connecting"; setTimeout(() => { this.readyState = "open"; this.onopen?.(); }, 30); }
    send(raw) {
      const e = JSON.parse(raw); window.__rtc.sent.push(e.type);
      if (e.type !== "response.create") return;
      const emit = (o) => this.onmessage?.({ data: JSON.stringify(o) });
      setTimeout(() => {
        emit({ type: "response.created" });
        emit({ type: "response.output_text.delta", delta: "ヒント：符号を" });
        emit({ type: "response.output_text.delta", delta: "確かめよう" });
        emit({ type: "response.output_text.done", text: "ヒント：符号を確かめよう" });
        emit({ type: "response.done", response: { usage: { input_tokens: 120, output_tokens: 30 } } });
      }, 30);
    }
    close() { this.readyState = "closed"; }
  }
  class FakePC {
    constructor() { this.connectionState = "new"; this.senders = []; window.__rtc.created++; window.__rtc.open++; }
    addTrack(t) { this.senders.push({ track: t }); } addTransceiver() {} getSenders() { return this.senders; }
    createDataChannel() { return (this.dc = new FakeDC()); }
    async createOffer() { return { type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n" }; }
    async setLocalDescription() {}
    async setRemoteDescription() { this.connectionState = "connected"; }
    close() { if (this.connectionState !== "closed") { this.connectionState = "closed"; window.__rtc.open--; } }
  }
  window.RTCPeerConnection = FakePC;
  navigator.mediaDevices.getUserMedia = async () => {
    if (window.__mic !== "ok") throw new DOMException("denied", "NotAllowedError");
    const ac = new AudioContext(); const d = ac.createMediaStreamDestination(); window.__micStream = d.stream; return d.stream;
  };
});
const stuPage = await stuCtx.newPage();
stuPage.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`[student ${m.type()}] ${m.text()}`); });
stuPage.on("pageerror", (e) => errors.push(`[student pageerror] ${e.message}`));
const stuText = () => stuPage.locator("body").innerText();
await stuPage.goto(BASE + "/student");
await stuPage.getByLabel("メール").fill("student1@c.example");
await stuPage.getByLabel("パスワード").fill("pass-S-111x");
await stuPage.getByRole("button", { name: "ログイン" }).click();
await stuPage.getByText("student1@c.example").waitFor({ timeout: 15000 });
await stuPage.waitForTimeout(800);
ok((await stuText()).includes("返却された答案はまだありません"), "返却前の答案は生徒に見えない（確認・返却の前）");

const tutorItems0 = JSON.stringify(await rp(`submission_items?select=qno,mark,earned,comment,need_review&submission_id=eq.${rpSub.id}&order=qno`));
let pubRes = await rpcA("publish_submission_result", { p_submission: rpSub.id });
ok(pubRes.status >= 400, `先生が確認する前は返却できない（HTTP ${pubRes.status}）`);
await rpcA("mark_submission_reviewed", { p_submission_id: rpSub.id });
pubRes = await rpcA("publish_submission_result", { p_submission: rpSub.id });
const pubRes2 = await rpcA("publish_submission_result", { p_submission: rpSub.id });
ok(pubRes.body === 1 && pubRes2.body === 0, "確認後に返却。もう一度押しても二重に返却しない");
const tutorItems1 = JSON.stringify(await rp(`submission_items?select=qno,mark,earned,comment,need_review&submission_id=eq.${rpSub.id}&order=qno`));

await stuPage.getByRole("button", { name: "更新" }).click(); await stuPage.waitForTimeout(1200);
ok((await stuText()).includes("新着") && (await stuText()).includes("チャッピー確認テスト"), "返却すると生徒の受信箱に「新着」で届く（通知に点数は出さない）");
const inboxText = await stuPage.locator('[data-testid="inbox"] li').first().innerText();
ok(!/\d+\s*／\s*100|点数/.test(inboxText.split("間違えた問題")[0]), "受信箱の一覧（通知）に点数を出さない");
await stuPage.locator('[data-testid="inbox"] li button').first().click();
await stuPage.locator('[data-testid="wrong-question"]').first().waitFor({ timeout: 15000 });
ok((await stuPage.locator('[data-testid="wrong-question"]').count()) === 1 && (await stuText()).includes("符号に注意"), "返却されたテスト → 間違えた問題（1問）と先生のコメント");
ok(!(await stuText()).includes("新着"), "開くと既読になる");
await stuPage.getByRole("button", { name: "チャッピー先生に聞く" }).click();
await stuPage.locator('[data-testid="tutor-panel"]').waitFor();
ok((await stuPage.locator('[data-testid="tutor-panel"]').innerText()).includes("-4a+6b-12 を計算しなさい"), "問題カードに問題文・本人の解答・判定・先生のコメント");
await stuPage.getByRole("button", { name: "⌨ 文字で質問する" }).click(); await stuPage.waitForTimeout(600);
ok((await stuText()).includes("学校またはクラスで有効になっていません"), "学校・クラスで有効にする前は使えない（理由を表示）");

// 管理者が学校とクラスで有効にする
const enabled12 = await rpcA("set_tutor_settings", { p_enabled: true, p_session_minutes: 10, p_daily_minutes: 30, p_class_ids: [clsA.id] });
ok(enabled12.status < 300, "管理者が学校・クラスでチャッピー先生を有効にする");
await stuPage.getByRole("button", { name: "更新" }).click(); await stuPage.waitForTimeout(1000);
await stuPage.getByRole("button", { name: "チャッピー先生の設定" }).click();
await stuPage.locator('[data-testid="tutor-settings"]').waitFor();
await stuPage.screenshot({ path: new URL("./.out/tutor-mobile-settings.png", import.meta.url).pathname, fullPage: true });
ok(await stuPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "スマホの幅（390px）で横にはみ出さない（設定）");
ok((await stuText()).includes("あなた本人、または保護者が OpenAI と直接契約して支払います") && (await stuText()).includes("ほかの費用まで無料という意味ではありません"),
  "料金の支払者（本人・保護者が OpenAI と直接契約）と、管理者負担なしの範囲を説明");
// 同意してからキーを登録する（誤ったキーは断る）
await stuPage.getByLabel(/私は OpenAI の利用条件/).check();
await stuPage.getByRole("button", { name: "同意する" }).click();
await stuPage.getByText("同意を保存しました").waitFor();
await stuPage.getByLabel("OpenAI API キー").fill("sk-proj-wrongWRONGwrongWRONGwrong0000");
await stuPage.getByRole("button", { name: "キーを確かめて登録" }).click();
await stuPage.getByText(/API キーが無効です/).waitFor({ timeout: 15000 });
ok(true, "無効なキーは登録せず、本人向けに直し方を表示");
ok((await stuPage.getByLabel("OpenAI API キー").inputValue()) === "", "送信後、キーの入力欄はすぐ空にする");
await stuPage.getByLabel("OpenAI API キー").fill(SK);
await stuPage.getByLabel(/暗号化して保存する/).check();
await stuPage.getByRole("button", { name: "キーを確かめて登録" }).click();
await stuPage.locator('[data-testid="key-registered"]').waitFor({ timeout: 15000 }).catch(async (e) => {
  console.log("✗ キーを登録できなかった画面:", (await stuPage.locator('[data-testid="tutor-settings"]').innerText()).slice(-800));
  throw e;
});
const stuHtml = await stuPage.content();
const stuStored = await stuPage.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
ok((await stuPage.locator('[data-testid="key-registered"]').innerText()).includes("…1111") && !stuHtml.includes(SK) && !stuStored.includes(SK.slice(10)),
  "キーは暗号化して保存し、画面・HTML・ブラウザの保存領域には末尾4文字しか出さない");

const modelOptions = await stuPage.locator('[data-testid="tutor-settings"] select option').evaluateAll((os) => os.map((o) => o.value));
ok(modelOptions.join(",") === "gpt-realtime-2,gpt-audio-mini", `モデルの選択肢は、音声の会話に対応したものだけ（翻訳・文字起こし用などは出さない：${modelOptions.join(",")}）`);

// 文字で会話する（通話はサーバーが本人のキーで作り、ブラウザには SDP の応答だけを返す。WebRTC は代役）
await stuPage.getByRole("button", { name: /受信箱/ }).click();
await stuPage.locator('[data-testid="inbox"] li button').first().click();
await stuPage.getByRole("button", { name: "チャッピー先生に聞く" }).click();
const oaiStart = (await oaiReqs()).length;
await stuPage.getByRole("button", { name: "⌨ 文字で質問する" }).click();
await stuPage.getByRole("button", { name: "会話を終える" }).waitFor({ timeout: 15000 }).catch(async (e) => {
  console.log("✗ 会話を始められなかった画面:", (await stuPage.locator('[data-testid="tutor-panel"]').innerText()).slice(-1200));
  console.log("  OpenAI 代役への要求:", JSON.stringify((await oaiReqs()).slice(oaiStart).map((r) => [r.method, r.path, r.status])));
  throw e;
});
await stuPage.getByRole("button", { name: "ヒント", exact: true }).click();
await stuPage.getByText("ヒント：符号を確かめよう").waitFor({ timeout: 10000 });
ok((await stuPage.locator('[data-testid="tutor-state"]').innerText()).includes("状態："), "会話の状態（接続中・考え中など）を表示し、応答を字幕で出す");
await stuPage.screenshot({ path: new URL("./.out/tutor-mobile-chat.png", import.meta.url).pathname, fullPage: true });
ok(await stuPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "スマホの幅（390px）で横にはみ出さない（会話中）");
ok((await stuText()).includes("入力 120・出力 30 トークン") && (await stuText()).includes("請求額は OpenAI が決めます"), "使用量を表示し、請求額は提供元が決めると明記");
// 同時に2つは始められない
const busyRes12 = await stuPage.request.post(BASE + "/api/tutor/session", { data: { releaseId: (await rp(`result_releases?select=id&submission_id=eq.${rpSub.id}`))[0].id, qno: 2, mode: "text", sdp: "v=0\r\nfake" }, headers: { origin: BASE } });
ok(busyRes12.status() === 409, `同じ生徒の会話は同時に1つだけ（HTTP ${busyRes12.status()}）`);
await stuPage.getByRole("button", { name: "会話を終える" }).click(); await stuPage.waitForTimeout(800);
const rtcAfterEnd = await stuPage.evaluate(() => window.__rtc);
const sessAfterEnd = await rp(`tutor_sessions?select=status,end_reason,mode&order=started_at`);
ok(rtcAfterEnd.open === 0 && sessAfterEnd.length === 1 && sessAfterEnd[0].status === "ended" && sessAfterEnd[0].end_reason === "user", "「会話を終える」で接続を閉じ、サーバーの記録も終える");
const oaiDuring = (await oaiReqs()).slice(oaiStart);
const callReq = oaiDuring.find((r) => r.url === "/v1/realtime/calls");
ok(oaiDuring.every((r) => r.known && r.keyTail === "1111" && !r.origin) && callReq && oaiDuring.some((r) => r.hangup === callReq.callId),
  "OpenAI への要求はすべてサーバーから本人のキーで（ブラウザは OpenAI に直接つながず、短期の資格情報も受け取らない）。終了でサーバーが通話を切る");
const sessionJson = JSON.parse(callReq.body.split('name="session"\r\nContent-Type: application/json\r\n\r\n')[1].split("\r\n--")[0]);
ok(sessionJson.type === "realtime" && sessionJson.model === "gpt-realtime-2" && sessionJson.instructions.includes("チャッピー先生") && sessionJson.instructions.includes("符号に注意")
  && !sessionJson.instructions.includes("student1@") && !sessionJson.instructions.includes("2C01") && !/生徒C01/.test(sessionJson.instructions),
  "AI に渡すのは1問分の資料と指導方針だけ（メール・出席番号・匿名ID を含めない）");
const hangups = async () => (await oaiReqs()).filter((r) => r.hangup).map((r) => r.hangup);
const lastCall = async () => (await oaiReqs()).filter((r) => r.callId).at(-1)?.callId;
const startText = async () => {
  await stuPage.getByRole("button", { name: "⌨ 文字で質問する" }).click();
  await stuPage.getByRole("button", { name: "会話を終える" }).waitFor({ timeout: 15000 });
  return lastCall();
};
const waitHangup = async (id, ms = 50000) => { const t = Date.now(); while (Date.now() - t < ms) { if ((await hangups()).includes(id)) return true; await settle(500); } return false; };
const waitText = async (t, ms = 5000) => { const s0 = Date.now(); while (Date.now() - s0 < ms) { if ((await stuText()).includes(t)) return true; await settle(300); } return false; };
const waitUiStopped = async (ms = 50000) => { const t = Date.now(); while (Date.now() - t < ms) { if (!(await stuPage.getByRole("button", { name: "会話を終える" }).count())) return true; await settle(500); } return false; };

// 音声：マイクを拒否したら文字へ切り替えを案内し、会話を始めない
await stuPage.getByRole("button", { name: "🎤 音声で質問する" }).click(); await stuPage.waitForTimeout(600);
ok((await stuText()).includes("マイクを使えませんでした") && (await rp("tutor_sessions?select=id")).length === 1, "マイクを拒否したら会話を始めず、文字で質問するよう案内");
// 音声：マイクを許可 → 画面を離れる（バックグラウンド）と会話・マイクを止める
await stuPage.evaluate(() => { window.__mic = "ok"; });
await stuPage.getByRole("button", { name: "🎤 音声で質問する" }).click();
await stuPage.getByRole("button", { name: "マイクを止める" }).waitFor({ timeout: 15000 });
await stuPage.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
await stuPage.waitForTimeout(1500);
const rtcAfterHide = await stuPage.evaluate(() => ({ open: window.__rtc.open, mic: window.__micStream?.getTracks().every((t) => t.readyState === "ended") }));
const sessAfterHide = await rp(`tutor_sessions?select=status,end_reason,mode&order=started_at`);
ok(rtcAfterHide.open === 0 && rtcAfterHide.mic && sessAfterHide.at(-1).mode === "voice" && sessAfterHide.at(-1).status === "ended" && sessAfterHide.at(-1).end_reason === "background"
  && await waitHangup(await lastCall(), 5000), "画面を離れると、マイク・接続・サーバーの会話をすべて止め、サーバーが通話を切る");

// 1回の上限：接続から上限時間を過ぎたら、次の生存確認（20秒ごと）でサーバーが通話を切り、画面も止まる
// （短期の資格情報の期限ではなく、会話の時間で止める。テストでは開始時刻を11分前にずらす）
const callT = await startText();
const [actT] = await rp("tutor_sessions?select=id&status=eq.active");
await fetch(`${process.env.SUPABASE_URL}/rest/v1/tutor_sessions?id=eq.${actT.id}`, { method: "PATCH", headers: { apikey: process.env.SERVICE, authorization: `Bearer ${process.env.SERVICE}`, "content-type": "application/json" }, body: JSON.stringify({ started_at: new Date(Date.now() - 11 * 60000).toISOString() }) });
const hT = await waitHangup(callT), uT = await waitUiStopped(), tT = await waitText("上限になったので"), rT = (await rp(`tutor_sessions?select=end_reason&id=eq.${actT.id}`))[0].end_reason;
if (!(hT && uT && tT && rT === "time_limit")) console.log("  診断:", JSON.stringify({ callT, hT, uT, tT, rT, hang: await hangups(), sess: await rp("tutor_sessions?select=id,status,end_reason,call_id,started_at,last_seen_at&order=started_at") }));
ok(hT && uT && tT && rT === "time_limit",
  "1回の利用時間の上限を過ぎると、サーバーが通話を切り、画面も会話を止める");
// 機能の停止：管理者がクラスで無効にすると、次の生存確認でサーバーが通話を切る
const callD = await startText();
const disRes = await rpcA("set_tutor_settings", { p_enabled: true, p_session_minutes: 10, p_daily_minutes: 30, p_class_ids: [] });
const hD = await waitHangup(callD), uD = await waitUiStopped(), tD = await waitText("停止されたので");
if (!(hD && uD && tD)) console.log("  診断:", JSON.stringify({ disRes, callD, hD, uD, tD, sess: await rp("tutor_sessions?select=status,end_reason,call_id&order=started_at") }));
ok(hD && uD && tD, "管理者が無効にすると、進行中の会話もサーバーが通話を切って止める");
await rpcA("set_tutor_settings", { p_enabled: true, p_session_minutes: 10, p_daily_minutes: 30, p_class_ids: [clsA.id] });
// 同意の撤回：その場でサーバーが通話を切る
const callC = await startText();
const rev = await stuPage.request.delete(BASE + "/api/tutor/consent", { data: {}, headers: { origin: BASE } });
ok(rev.ok() && await waitHangup(callC, 5000) && await waitUiStopped(), "同意を撤回すると、その場でサーバーが通話を切り、画面も止まる");
await stuPage.request.post(BASE + "/api/tutor/consent", { data: { payer: "self", termsConfirmed: true }, headers: { origin: BASE } });
await stuPage.reload(); await stuPage.waitForTimeout(800);
await stuPage.locator('[data-testid="inbox"] li button').first().click();
await stuPage.getByRole("button", { name: "チャッピー先生に聞く" }).click();
// キーの削除：削除する前のキーで、サーバーが通話を切る
const callK = await startText();
const delKey = await stuPage.request.delete(BASE + "/api/tutor/key", { headers: { origin: BASE } });
ok(delKey.ok() && await waitHangup(callK, 5000) && await waitUiStopped(), "キーを削除すると、削除する前に本人のキーで通話を切る");
// 以降の確認のために、キーを登録し直す
const reg = await stuPage.request.post(BASE + "/api/tutor/key", { data: { apiKey: SK, payer: "self", store: true }, headers: { origin: BASE } });
await stuPage.request.patch(BASE + "/api/tutor/key", { data: { model: "gpt-realtime-2" }, headers: { origin: BASE } });
ok(reg.ok(), "（準備）キーを登録し直す");
await stuPage.reload(); await stuPage.waitForTimeout(800);
await stuPage.locator('[data-testid="inbox"] li button').first().click();
await stuPage.getByRole("button", { name: "チャッピー先生に聞く" }).click();

// キーの失効・残高不足：別のキー（管理者のキーなど）へ切り替えず、理由を表示する
await fetch(OAI + "/__quota", { method: "POST", body: JSON.stringify({ key: SK }) });
const oaiN0 = (await oaiReqs()).length;
await stuPage.getByRole("button", { name: "⌨ 文字で質問する" }).click();
await stuPage.getByText(/残高・利用上限に達しています/).waitFor({ timeout: 15000 });
await fetch(OAI + "/__revoke", { method: "POST", body: JSON.stringify({ key: SK }) });
await stuPage.getByRole("button", { name: "⌨ 文字で質問する" }).click();
await stuPage.getByText(/API キーが無効です/).waitFor({ timeout: 15000 });
const oaiAfter = (await oaiReqs()).slice(oaiN0);
ok(oaiAfter.length >= 2 && oaiAfter.every((r) => r.keyTail === "1111" && !r.origin) && (await rp("tutor_sessions?select=id&status=eq.active")).length === 0,
  "残高不足・失効では会話を始めず、ほかのキーへ切り替えない（OpenAI への要求はすべて本人のキー）");

// 別の生徒は、他人の返却・資料・会話を使えない
const stu2Ctx = await browser.newContext();
const stu2Page = await stu2Ctx.newPage();
await stu2Page.goto(BASE + "/student");
await stu2Page.getByLabel("メール").fill("student2@c.example");
await stu2Page.getByLabel("パスワード").fill("pass-S-222x");
await stu2Page.getByRole("button", { name: "ログイン" }).click();
await stu2Page.getByText("student2@c.example").waitFor({ timeout: 15000 });
await stu2Page.waitForTimeout(800);
const stuRelId = (await rp(`result_releases?select=id&submission_id=eq.${rpSub.id}`))[0].id;
const stu2Ctx2 = await stu2Page.request.post(BASE + "/api/tutor/context", { data: { releaseId: stuRelId, qno: 2 }, headers: { origin: BASE } });
const stu2Start = await stu2Page.request.post(BASE + "/api/tutor/session", { data: { releaseId: stuRelId, qno: 2, mode: "text", apiKey: SK2, model: "gpt-realtime-2", sdp: "v=0\r\nfake" }, headers: { origin: BASE } });
ok((await stu2Page.locator("body").innerText()).includes("返却された答案はまだありません") && stu2Ctx2.status() === 404 && [403, 404].includes(stu2Start.status()),
  `別の生徒は、他人の返却を見られず、その資料で会話も始められない（HTTP ${stu2Ctx2.status()} / ${stu2Start.status()}）`);
const csrfRes = await stu2Page.request.post(BASE + "/api/tutor/key", { data: { apiKey: SK2, payer: "self" }, headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } });
ok(csrfRes.status() === 403, `他のサイトからのキー登録は断る（CSRF・HTTP ${csrfRes.status()}）`);
await stu2Ctx.close();

// キーを削除すると、新しい会話は始められない（他人や管理者のキーへ切り替えない）
await stuPage.getByRole("button", { name: "チャッピー先生の設定" }).click();
stuPage.once("dialog", (d) => d.accept());
await stuPage.getByRole("button", { name: "保存したキーを削除" }).click();
await stuPage.getByText("保存したキーを削除しました").waitFor();
await stuPage.getByRole("button", { name: /受信箱/ }).click();
await stuPage.locator('[data-testid="inbox"] li button').first().click();
await stuPage.getByRole("button", { name: "チャッピー先生に聞く" }).click();
const oaiN1 = (await oaiReqs()).length;
await stuPage.getByRole("button", { name: "⌨ 文字で質問する" }).click(); await stuPage.waitForTimeout(800);
ok((await stuText()).includes("API キーが登録されていません") && (await oaiReqs()).length === oaiN1, "キーを削除したら会話を始めない（OpenAI も呼ばない）");

// 外部の ChatGPT：復習内容をコピーし、本人のアカウントで開く。自動同期はしない（振り返りは自己申告）
await stuPage.getByRole("button", { name: "📋 復習内容をコピー" }).click();
await stuPage.getByText("復習内容をコピーしました").waitFor();
const clipText = await stuPage.evaluate(() => navigator.clipboard.readText());
const chatHref = await stuPage.getByRole("link", { name: /ChatGPT を開く/ }).getAttribute("href");
ok(clipText.includes("チャッピー先生") && clipText.includes("符号に注意") && !clipText.includes("student1@") && chatHref === "https://chatgpt.com/"
  && (await stuText()).includes("会話の内容も自動では戻りません"), "外部の ChatGPT：復習内容をコピーして本人が開く（ログイン・音声開始・同期を装わない）");
await stuPage.getByLabel("振り返り").fill("移項するときは符号を変える");
await stuPage.getByRole("button", { name: "理解できた（自己申告）として記録" }).click();
await stuPage.getByText("振り返りを記録しました").waitFor();
ok((await stuPage.locator('[data-testid="progress-state"]').innerText()).includes("自己申告"), "外部での復習の結果は「自己申告」として記録（AI の確認と区別）");

// 復習しても、正式な採点・コメント・赤ペンの位置は変わらない
const tutorItems2 = JSON.stringify(await rp(`submission_items?select=qno,mark,earned,comment,need_review&submission_id=eq.${rpSub.id}&order=qno`));
ok(tutorItems1 === tutorItems2 && tutorItems0 !== "", "チャッピー先生で復習しても、正式な採点・コメントは変わらない");

// 先生：答案詳細で復習の様子を見て、理解確認済みにする → 生徒に反映
await page.goto(BASE + "/history/" + rpSub.id); await settle(1500);
await page.getByRole("button", { name: /^設問別採点/ }).click(); await settle(800);
const tutorCard = page.locator("section", { hasText: "生徒への返却と復習" }).first();
ok(/アプリ内の会話 \d+ 回/.test(await tutorCard.innerText()), "先生は返却の版・復習の回数・時間を見られる（会話の中身は共有の同意が無いと見えない）");
await tutorCard.getByRole("button", { name: "理解確認済みにする" }).first().click(); await settle(800);
await stuPage.reload(); await stuPage.waitForTimeout(800);
await stuPage.locator('[data-testid="inbox"] li button').first().click();
await stuPage.getByRole("button", { name: "チャッピー先生に聞く" }).click();
await stuPage.waitForTimeout(800);
ok((await stuPage.locator('[data-testid="progress-state"]').innerText()).includes("理解確認済み"), "「理解確認済み」は先生が付け、生徒の画面に出る");

// 先生が確認後に直して返し直すと、生徒には「更新」（第2版）で届く
await patchA(`submission_items?submission_id=eq.${rpSub.id}&qno=eq.2`, { comment: "符号に注意（移項）" });
const republish = await rpcA("publish_submission_result", { p_submission: rpSub.id });
ok(republish.status >= 400, "確認後に直したら、再確認するまで返し直せない（未確認の修正は生徒に出ない）");
await rpcA("mark_submission_reviewed", { p_submission_id: rpSub.id });
ok((await rpcA("publish_submission_result", { p_submission: rpSub.id })).body === 1, "再確認して返し直す");
await stuPage.getByRole("button", { name: "← 受信箱に戻る" }).click();
await stuPage.getByRole("button", { name: "更新" }).click(); await stuPage.waitForTimeout(1200);
ok((await stuText()).includes("更新") && (await stuText()).includes("第2版"), "返し直しは「更新」として受信箱に1件だけ届く");
// ログアウトで、会話・入力したキー・画面の内容を消す
await stuPage.getByRole("button", { name: "ログアウト" }).click(); await stuPage.waitForTimeout(600);
ok(!(await stuText()).includes("チャッピー確認テスト"), "ログアウトすると、答案の内容を画面に残さない");
const oaiAll = await oaiReqs();
// 生徒がわざと誤って入れたキー（末尾 0000）以外は、すべて生徒本人のキー（登録済み、または保存しない方式で今回だけ渡したもの）。管理者のキー（末尾 real）は1件も無い
ok(oaiAll.length > 0 && oaiAll.every((r) => (r.known || r.keyTail === "0000") && !r.origin) && !oaiAll.some((r) => r.keyTail === "real") && !oaiAll.some((r) => r.url.includes("client_secrets")),
  `OpenAI への要求に管理者のキーは1件も無い（${oaiAll.length} 件すべて生徒本人のキー）`);
await stuCtx.close();


await browser.close();
// わざと起こした失敗（誤ったキー 400・残高不足 402・失効 400）の記録だけを外す
const unexpected = errors.filter((e) => !/Failed to load resource: the server responded with a status of (400|402)/.test(e));
if (unexpected.length) {
  console.log("\n✗ コンソールにエラー・警告があります:");
  unexpected.forEach((e) => console.log("  ", e));
  process.exit(1);
}
console.log("\nOK: 返却とチャッピー先生のシナリオがすべて通りました（コンソールエラーなし）");
