// チャッピー先生：ブラウザが来なくても、サーバー（見回り）が通話を切ることを確かめる。tests/e2e/run.sh の最後に実行する（アプリを再起動するため）。
//
//   見回りの経路は本番・検証環境と同じ：DB の pg_cron（ここでは5秒ごと）→ pg_net → アプリの /api/tutor/sweep → 本人のキーで hangup。
//   生存確認が途絶えたとみなす秒数はテスト用に 45 秒（TUTOR_STALE_SECONDS。本番の既定は 90 秒）。
//   OpenAI は代役（tests/e2e/mock-openai.mjs）、ブラウザの WebRTC も代役。本物の OpenAI で通話が実際に切れるかは未検証。
//
//   1. 生存確認の停止（画面は開いたまま、生存確認の要求だけ届かない）
//   2. 通信断（ブラウザをオフラインにする）
//   4. 1回の上限時間（生存確認は止めたまま。開始時刻を11分前にずらして確かめる）
//   5. アプリ（サーバー）の再起動（強制終了 → 停止中は切れない → 起動後の見回りで切る）
//   6. 通話を切るのに失敗したときの再試行と記録
//   3. ブラウザの強制終了（画面のプロセスを落とす）。キーは「保存しない」で登録（保存したキーを消すので、5・6 の後）
//   7. 見回りが止まっていれば、新しい会話を始めない
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { openSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3200";
const OAI = process.env.MOCK_OPENAI_URL;
const SK = process.env.STUDENT_KEY;
const SB = process.env.SUPABASE_URL, SERVICE = process.env.SERVICE, DB_URL = process.env.DB_URL;
const OUT = new URL("./.out/", import.meta.url).pathname;
const STALE = Number(process.env.TUTOR_STALE_SECONDS || 45);
// 終了までの猶予：生存確認の間隔（20秒）＋見回りの間隔（5秒）＋処理の余裕（10秒）
const GRACE = 35;

const ok = (cond, msg) => { if (!cond) { console.log("✗ FAIL:", msg); throw new Error(msg); } console.log("✓", msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const svc = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };
const rest = async (path) => (await fetch(`${SB}/rest/v1/${path}`, { headers: svc })).json();
const patch = (path, body) => fetch(`${SB}/rest/v1/${path}`, { method: "PATCH", headers: { ...svc, prefer: "return=minimal" }, body: JSON.stringify(body) });
const sql = (q) => execFileSync("psql", [DB_URL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const oaiReqs = async () => (await fetch(OAI + "/__requests")).json();
const hangupAt = async (callId) => (await oaiReqs()).some((r) => r.hangup === callId);
const session = async (id) => (await rest(`tutor_sessions?select=id,status,end_reason,started_at,last_seen_at,ended_at,call_id,hangup_status,hangup_attempts,hangup_error&id=eq.${id}`))[0];
const secretCount = async (id) => (await rest(`tutor_call_secrets?select=session_id&session_id=eq.${id}`)).length;
/** 通話が切られるまで待つ（切られた時刻を返す。来なければ null） */
async function waitHangup(callId, maxSec) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxSec * 1000) { if (await hangupAt(callId)) return new Date(); await sleep(1000); }
  return null;
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const fakeRtc = () => {
  class FakeDC {
    constructor() { this.readyState = "connecting"; setTimeout(() => { this.readyState = "open"; this.onopen?.(); }, 30); }
    send() {}
    close() { this.readyState = "closed"; }
  }
  class FakePC {
    constructor() { this.connectionState = "new"; this.senders = []; }
    addTrack(t) { this.senders.push({ track: t }); } addTransceiver() {} getSenders() { return this.senders; }
    createDataChannel() { return new FakeDC(); }
    async createOffer() { return { type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n" }; }
    async setLocalDescription() {}
    async setRemoteDescription() { this.connectionState = "connected"; }
    close() { this.connectionState = "closed"; }
  }
  window.RTCPeerConnection = FakePC;
};

// 準備：学校・クラスで有効（1日の上限は長めに）、同意、保存したキー
const adminTok = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: process.env.ANON, "content-type": "application/json" }, body: JSON.stringify({ email: "admin@c.example", password: "pass-C-123" }),
})).json()).access_token;
const [cls] = await rest("classes?select=id&name=eq.C");
await fetch(`${SB}/rest/v1/rpc/set_tutor_settings`, {
  method: "POST", headers: { apikey: process.env.ANON, authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
  body: JSON.stringify({ p_enabled: true, p_session_minutes: 10, p_daily_minutes: 240, p_class_ids: [cls.id] }),
});

// 学校Cの生徒1の答案を確認・返却しておく（tutor.mjs の後なら返却済み。同じ内容の返し直しは何もしない）
const rpcA = (name, args) => fetch(`${SB}/rest/v1/rpc/${name}`, {
  method: "POST", headers: { apikey: process.env.ANON, authorization: `Bearer ${adminTok}`, "content-type": "application/json" }, body: JSON.stringify(args),
});
const [tc] = await rest(`tests?select=id&name=eq.${encodeURIComponent("チャッピー確認テスト")}`);
const [sub1] = await rest(`submissions?select=id&test_id=eq.${tc.id}`);
await rpcA("mark_submission_reviewed", { p_submission_id: sub1.id });
await rpcA("publish_submission_result", { p_submission: sub1.id });

async function studentPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(fakeRtc);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(BASE + "/student");
  await page.getByLabel("メール").fill("student1@c.example");
  await page.getByLabel("パスワード").fill("pass-S-111x");
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.getByText("student1@c.example").waitFor({ timeout: 15000 });
  return { ctx, page };
}
const h = { origin: BASE };
async function openQuestion(page) {
  await page.getByRole("button", { name: "チャッピー先生の設定" }).waitFor({ timeout: 15000 });   // 状態を読み込んでから
  await page.getByRole("button", { name: /受信箱/ }).click();
  await page.locator('[data-testid="inbox"] li button').first().click();
  await page.locator('[data-testid="wrong-question"]').first().waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "チャッピー先生に聞く" }).first().click();
  await page.locator('[data-testid="tutor-panel"]').waitFor();
}
/** 1時間あたりの回数の制限に当たらないよう、終わった会話の開始時刻を2時間前にずらす（テストだけの操作） */
const freeQuota = () => patch("tutor_sessions?status=eq.ended", { started_at: new Date(Date.now() - 2 * 3600e3).toISOString() });
async function startText(page) {
  await freeQuota();
  await page.getByRole("button", { name: "⌨ 文字で質問する" }).click();
  await page.getByRole("button", { name: "会話を終える" }).waitFor({ timeout: 20000 }).catch(async (e) => {
    console.log("  会話を始められなかった画面:", (await page.locator('[data-testid="tutor-panel"]').innerText()).slice(-600)); throw e;
  });
  const [s] = await rest("tutor_sessions?select=id,call_id&status=eq.active");
  return s;
}
/** 生存確認が途絶えた会話：最後の生存確認から STALE 秒＋猶予のうちに、理由 no_heartbeat で終わり、通話が切られ、資格情報が消える */
async function expectStaleHangup(s, label) {
  const at = await waitHangup(s.call_id, STALE + GRACE + 30);
  const row = await session(s.id);
  const lag = at ? (at - new Date(row.last_seen_at)) / 1000 : Infinity;
  ok(at && row.end_reason === "no_heartbeat" && row.hangup_status === "done" && lag <= STALE + GRACE && (await secretCount(s.id)) === 0,
    `${label}：最後の生存確認から ${Math.round(lag)} 秒で、サーバーが通話を切った（上限 ${STALE}＋猶予 ${GRACE} 秒）。資格情報も消した`);
}

// 見回りが動いてから始める（動いていないと会話を始められない）
for (let i = 0; i < 60; i++) {
  const [w] = await rest("tutor_sweeper?select=last_run_at");
  if (w?.last_run_at && Date.now() - new Date(w.last_run_at) < 30e3) break;
  await sleep(1000);
}
// 0. 保存したキーで準備（tutor.mjs で失効させたキーを、代役の OpenAI で有効に戻す）
await fetch(OAI + "/__unrevoke", { method: "POST" });
const { ctx: c1, page: p1 } = await studentPage();
const prep = [
  await p1.request.post(BASE + "/api/tutor/consent", { data: { payer: "self", termsConfirmed: true }, headers: h }),
  await p1.request.post(BASE + "/api/tutor/key", { data: { apiKey: SK, payer: "self", store: true }, headers: h }),
  await p1.request.patch(BASE + "/api/tutor/key", { data: { model: "gpt-realtime-2" }, headers: h }),
];
ok(prep.every((r) => r.ok()), `（準備）同意して、自分のキーを保存 ${(await Promise.all(prep.filter((r) => !r.ok()).map(async (r) => `${r.status()} ${await r.text()}`))).join(" / ")}`);
await p1.reload(); await openQuestion(p1);

// 1. 生存確認の停止：画面は開いたまま、生存確認の要求だけが届かない
let s = await startText(p1);
await p1.route("**/api/tutor/session/heartbeat", (r) => r.abort());
await expectStaleHangup(s, "1. 生存確認の停止");
await p1.unroute("**/api/tutor/session/heartbeat");
await p1.getByText("通信が途切れたため、会話を終えました").waitFor({ timeout: 30000 });
ok(true, "1. 生存確認が戻ると、画面も「通信が途切れたため、会話を終えました」と止まる");

// 2. 通信断：ブラウザをオフラインにする
s = await startText(p1);
await c1.setOffline(true);
await expectStaleHangup(s, "2. 通信断");
const hb = [];
p1.on("response", async (r) => { if (r.url().includes("/heartbeat")) hb.push(`${r.status()} ${await r.text().catch(() => "")}`); });
p1.on("requestfailed", (r) => { if (r.url().includes("/heartbeat")) hb.push(`failed ${r.failure()?.errorText}`); });
await c1.setOffline(false);
await p1.getByText("通信が途切れたため、会話を終えました").waitFor({ timeout: 30000 }).catch(async (e) => {
  console.log("  診断:", hb, (await p1.locator("body").innerText()).slice(0, 1500)); await p1.screenshot({ path: OUT + "sweep-offline.png" }); throw e;
});

// 4. 1回の上限時間：生存確認は止めたまま、開始時刻を11分前にずらす → 見回りが time_limit で切る
s = await startText(p1);
await p1.route("**/api/tutor/session/heartbeat", (r) => r.abort());
await patch(`tutor_sessions?id=eq.${s.id}`, { started_at: new Date(Date.now() - 11 * 60e3).toISOString() });
const tLimit = Date.now();
const atLimit = await waitHangup(s.call_id, 30);
ok(atLimit && (await session(s.id)).end_reason === "time_limit" && (atLimit - tLimit) / 1000 <= 15,
  `4. 1回の上限を過ぎた会話は、生存確認が来なくても見回りが切る（${Math.round((atLimit - tLimit) / 1000)} 秒。開始時刻をずらして確認）`);
await p1.unroute("**/api/tutor/session/heartbeat");
await c1.close();

// 5. アプリの再起動：会話中にアプリを強制終了 → 止まっているあいだは切れない → 起動した後の見回りで切る
const { ctx: c5, page: p5 } = await studentPage();
await openQuestion(p5);   // 0. で保存したキーのまま（キーの登録は10分に5回までなので、登録し直さない）
s = await startText(p5);
const pid = readFileSync(OUT + "app.pid", "utf8").trim();
try { execFileSync("pkill", ["-9", "-P", pid]); } catch { /* 子が無い */ }
try { process.kill(Number(pid), "SIGKILL"); } catch { /* 終了済み */ }
const killedAt = new Date();
await sleep((STALE + 10) * 1000);
const failedPings = Number(sql(`select count(*) from net._http_response where created > '${killedAt.toISOString()}' and (status_code is null or status_code >= 500)`));
ok(!(await hangupAt(s.call_id)) && failedPings > 0, `5. アプリが止まっているあいだは切れない（見回りの呼び出しの失敗 ${failedPings} 回は DB に記録される）`);
const app = spawn("node_modules/.bin/next", ["start", "-p", String(process.env.E2E_PORT || 3200)], {
  env: process.env, detached: true, stdio: ["ignore", openSync(OUT + "app.log", "a"), openSync(OUT + "app.log", "a")],
});
app.unref();
writeFileSync(OUT + "app.pid", String(app.pid));
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/login")).ok) break; } catch { /* 起動中 */ } await sleep(500); }
const restartedAt = new Date();
const at5 = await waitHangup(s.call_id, 30);
ok(at5 && (await session(s.id)).hangup_status === "done" && (at5 - restartedAt) / 1000 <= 15,
  `5. アプリを起動すると、次の見回りで通話を切る（起動から ${Math.round((at5 - restartedAt) / 1000)} 秒・理由 ${(await session(s.id)).end_reason}）`);
await c5.close();

// 6. 通話を切るのに失敗したら、間隔をあけて再試行し、記録する
const { ctx: c6, page: p6 } = await studentPage();
await openQuestion(p6);
s = await startText(p6);
await fetch(OAI + "/__hangup_fail", { method: "POST", body: JSON.stringify({ count: 2 }) });
await p6.getByRole("button", { name: "会話を終える" }).click();
await sleep(1500);
const afterFirst = await session(s.id);
ok(afterFirst.hangup_status === "failed" && afterFirst.hangup_attempts === 1 && afterFirst.hangup_error === "HTTP 500" && (await secretCount(s.id)) === 1,
  "6. 終了の操作で通話を切れなかったら、失敗（HTTP 500・1回目）を記録し、資格情報は再試行のために残す");
const at6 = await waitHangup(s.call_id, 60);
const row6 = await session(s.id);
const logs6 = await rest(`audit_logs?select=action&target_id=eq.${s.id}&action=like.tutor.hangup*`);
ok(at6 && row6.hangup_status === "done" && row6.hangup_attempts === 3 && (await secretCount(s.id)) === 0
  && logs6.filter((l) => l.action === "tutor.hangup_failed").length === 2 && logs6.some((l) => l.action === "tutor.hangup_done"),
  "6. 見回りが間隔をあけて再試行し（失敗2回 → 3回目で成功）、各回を監査ログに残し、成功したら資格情報を消す");
await c6.close();

// 3. ブラウザの強制終了：キーは「保存しない」。会話の開始のあと、ブラウザからキーは送らない
const { ctx: c3, page: p3 } = await studentPage();
await p3.request.delete(BASE + "/api/tutor/key", { headers: h });
await p3.reload();
await p3.getByRole("button", { name: "チャッピー先生の設定" }).click();
await p3.getByLabel("OpenAI API キー").fill(SK);
await p3.getByRole("radio", { name: /保存しない/ }).check();
const handling = await p3.locator('[data-testid="key-handling"]').innerText();
ok(handling.includes("通話を確実に切るためだけ") && handling.includes("1回の上限時間＋30分"), "「保存しない」の説明に、通話を切るための一時保管と消す時期を書いている");
await p3.getByRole("button", { name: "キーを確かめて登録" }).click();
await p3.getByText(/保存はしていません/).waitFor({ timeout: 15000 });
const bodies = [];
p3.on("request", (r) => { if (r.url().includes("/api/tutor/")) bodies.push({ url: r.url(), body: r.postData() ?? "" }); });
await openQuestion(p3);
s = await startText(p3);
ok((await rest("tutor_credentials?select=student_id&key_hint=eq.1111")).length === 0, "3. 「保存しない」：アカウントにはキーを保存していない");
await sleep(21000);   // 生存確認が1回は送られるのを待つ
const cdp = await c3.newCDPSession(p3);
// 画面のプロセスを落とす（応答は返らないので待たない）
cdp.send("Page.crash").catch(() => {});
await sleep(1000);
await expectStaleHangup(s, "3. ブラウザの強制終了（キーは保存しない）");
const sent = bodies.filter((b) => b.body.includes(SK.slice(10)));
ok(sent.length === 1 && sent[0].url.endsWith("/api/tutor/session"), `3. ブラウザからキーを送るのは会話の開始の1回だけ（生存確認・終了には付けない）：${sent.map((b) => new URL(b.url).pathname).join(",")}`);
await c3.close().catch(() => {});

// 7. 見回りが止まっていれば、新しい会話を始めない
sql("select cron.alter_job(jobid, active := false) from cron.job where jobname = 'tutor-sweep'");
await patch("tutor_sweeper?id=eq.1", { last_run_at: new Date(Date.now() - 4 * 60e3).toISOString() });
const { ctx: c7, page: p7 } = await studentPage();
await openQuestion(p7);
await freeQuota();
await p7.getByRole("button", { name: "⌨ 文字で質問する" }).click();
await p7.getByText(/会話を確実に終わらせる仕組み/).first().waitFor({ timeout: 15000 });
ok((await rest("tutor_sessions?select=id&status=eq.active")).length === 0, "7. 見回りが3分以上止まっていれば、会話を始めない（理由を表示）");
sql("select cron.alter_job(jobid, active := true) from cron.job where jobname = 'tutor-sweep'");
await c7.close();

const realErrors = errors.filter((e) => !/Target crashed|crash/i.test(e));
ok(realErrors.length === 0, `画面のエラーなし ${realErrors.join(" / ")}`);
await browser.close();
console.log("\nOK: ブラウザが来なくても、見回りが通話を切ることを確かめました（OpenAI と WebRTC は代役）");
