// 答案登録 → AI 採点 → 教師の確認 → 返却 → 生徒の復習（チャッピー先生）を、画面の操作で1本につなげて確かめる。
// tests/e2e/run.sh から呼ぶ（学校C を使う。tests/e2e/tutor.mjs の後に実行してよい）。
//   - テストの登録・新規採点・確認・返却は、先生（学校Cの管理者）がブラウザで操作する
//   - 採点AI は代役（tests/e2e/mock-anthropic.mjs）。1問目を × にする台本で採点させる
//   - 生徒の会話は OpenAI の代役（tests/e2e/mock-openai.mjs）と、ブラウザの RTCPeerConnection の代役。本物の音声は使わない
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3200";
const MOCK = process.env.MOCK_URL;          // 採点AIの代役
const OAI = process.env.MOCK_OPENAI_URL;    // OpenAI の代役
const SK2 = process.env.STUDENT_KEY2;
const OUT = new URL("./.out/", import.meta.url).pathname;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const ok = (cond, msg) => { if (!cond) { console.log("✗ FAIL:", msg); throw new Error(msg); } console.log("✓", msg); };
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const rest = async (path) => (await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
  headers: { apikey: process.env.SERVICE, authorization: `Bearer ${process.env.SERVICE}` },
})).json();

// ---------------------------------------------------------------- 先生（PC）
const tCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await tCtx.newPage();
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`[teacher ${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[teacher pageerror] ${e.message}`));
page.on("dialog", (d) => d.accept());
const text = () => page.locator("body").innerText();
process.on("uncaughtException", async (e) => {
  console.log("✗ 失敗:", e?.message?.split("\n")[0]);
  await page.screenshot({ path: OUT + "fullflow-failure.png", fullPage: true }).catch(() => {});
  process.exit(1);
});

await page.goto(BASE + "/login");
await page.getByLabel("メールアドレス").fill("admin@c.example");
await page.getByLabel("パスワード").fill("pass-C-123");
await page.getByRole("button", { name: "ログイン" }).click();
await page.waitForURL(BASE + "/");
await page.locator("header h1").waitFor();

// 1. テストを登録（3問・正答あり・全問確認）
const NAME = "通し確認テスト";
await page.goto(BASE + "/tests"); await settle();
await page.getByRole("button", { name: "＋ テストを追加" }).click();
await page.getByPlaceholder("例：1学期期末テスト").fill(NAME);
await page.locator('input[aria-label="まとめて追加する問題数"]').fill("2");
await page.getByRole("button", { name: "問まとめて追加" }).click();
const answers = ["3x-2", "ア", "等しい"];
for (let i = 0; i < 3; i++) await page.locator('table tbody input[aria-label$="の正答"]').nth(i).fill(answers[i]);
await page.getByLabel(/すべて確認した/).check();
await page.getByRole("button", { name: "登録する" }).click();
await page.getByText(new RegExp(`「${NAME}」を登録しました`)).first().waitFor({ timeout: 15000 });
ok(true, "1. 答案登録の準備：テスト（3問・正答・配点）を画面から登録");

// 2. 答案を取り込み、AI で採点（代役は1問目を × にする）
const img = `${OUT}fullflow-answer.png`;
{
  const p = await browser.newPage({ viewport: { width: 600, height: 840 } });
  await p.setContent(`<body style="margin:0;background:#fff;font:28px serif;padding:40px">通し確認<br><br>(1) 3x+2<br>(2) ア<br>(3) 等しい</body>`);
  await p.screenshot({ path: img });
  await p.close();
}
await fetch(MOCK + "/__script", { method: "POST", body: JSON.stringify({ "claude-opus-5": ["disagree"] }) });
const gradeBefore = (await (await fetch(MOCK + "/__requests")).json()).length;
await page.goto(BASE + "/new"); await settle(1200);
await page.locator('input[type=file]:not([capture])').setInputFiles([img]);
await page.getByText("1 / 80 枚").waitFor({ timeout: 30000 });
await page.locator("select").filter({ has: page.locator('option:text("生徒を選ぶ")') }).first().selectOption({ label: "2年C組 2番" });
await page.getByLabel("生徒・ページ順・不足や見切れがないことを確認しました").check();
const sel = page.locator("select").filter({ has: page.locator('option:text("今回のテストを選択（自動選択しません）")') });
await sel.selectOption(await sel.locator("option", { hasText: NAME }).first().getAttribute("value"));
await page.getByLabel("今回の答案と、テスト名・設問・正答・配点が一致しています").check();
await page.getByRole("button", { name: /保存してAI採点する/ }).click();
await page.getByText(/1 枚のAI採点が終わりました/).first().waitFor({ timeout: 60000 });
const gradeCalls = (await (await fetch(MOCK + "/__requests")).json()).slice(gradeBefore).filter((r) => r.kind === "grade");
const [test] = await rest(`tests?select=id&name=eq.${encodeURIComponent(NAME)}`);
const [sub] = await rest(`submissions?select=id,status,total_score,reviewed_by&test_id=eq.${test.id}`);
const items0 = await rest(`submission_items?select=qno,mark,earned,detected&submission_id=eq.${sub.id}&order=qno`);
ok(gradeCalls.length === 1 && gradeCalls[0].problems.length === 0 && items0.length === 3 && items0[0].mark === "×" && items0[1].mark === "○",
  `2. 採点：答案を取り込み、採点AI（代役）で採点（1問目 ×・${sub.total_score}点）`);

// 3. 先生が確認：コメントを直して「確認済みにする」
await page.goto(BASE + "/history/" + sub.id); await settle(1200);
await page.getByRole("button", { name: /^設問別採点/ }).click();
await page.getByRole("button", { name: "確認済みにする" }).click();
await page.getByText(/確認済みにしました/).first().waitFor({ timeout: 15000 });
const [subR] = await rest(`submissions?select=reviewed_by&id=eq.${sub.id}`);
ok(!!subR.reviewed_by, "3. 教師確認：答案詳細で「確認済みにする」（確認者を記録）");

// 4. 返却：全員確認・返却の画面から、この生徒に返却
await page.goto(BASE + "/batch-review"); await settle(1200);
await page.getByLabel("テスト", { exact: true }).selectOption(test.id); await settle(1200);
const card = page.locator("h3", { hasText: "2年C組 2番" }).locator("xpath=..");
await card.getByRole("button", { name: "この生徒に返却" }).click();
await page.getByText(/この生徒に返却しました/).first().waitFor({ timeout: 15000 });
const rel = await rest(`result_releases?select=id,version&submission_id=eq.${sub.id}`);
ok(rel.length === 1, "4. 返却：「この生徒に返却」で本人の受信箱へ（返却の版 1）");

// 5. 生徒の復習：受信箱 → 間違えた問題 → チャッピー先生（文字）
const sCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await sCtx.addInitScript(() => {
  class FakeDC {
    constructor() { this.readyState = "connecting"; setTimeout(() => { this.readyState = "open"; this.onopen?.(); }, 30); }
    send(raw) {
      const e = JSON.parse(raw);
      if (e.type !== "response.create") return;
      const emit = (o) => this.onmessage?.({ data: JSON.stringify(o) });
      setTimeout(() => {
        emit({ type: "response.created" });
        emit({ type: "response.output_text.delta", delta: "まず (1) の符号を" });
        emit({ type: "response.output_text.done", text: "まず (1) の符号を確かめよう" });
        emit({ type: "response.done", response: { usage: { input_tokens: 100, output_tokens: 20 } } });
      }, 30);
    }
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
});
const stu = await sCtx.newPage();
stu.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`[student ${m.type()}] ${m.text()}`); });
stu.on("pageerror", (e) => errors.push(`[student pageerror] ${e.message}`));
const stuText = () => stu.locator("body").innerText();
await stu.goto(BASE + "/student");
await stu.getByLabel("メール").fill("student2@c.example");
await stu.getByLabel("パスワード").fill("pass-S-222x");
await stu.getByRole("button", { name: "ログイン" }).click();
await stu.getByText("student2@c.example").waitFor({ timeout: 15000 });
await settle(800);
ok((await stuText()).includes(NAME) && (await stuText()).includes("新着"), "5a. 生徒の受信箱に、返却したテストが「新着」で届く");
// 学校・クラスで有効にし、同意とキー（本人のキー・代役）を用意する（画面の操作は tests/e2e/tutor.mjs で確認済み）
const adminTok = (await (await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: process.env.ANON, "content-type": "application/json" }, body: JSON.stringify({ email: "admin@c.example", password: "pass-C-123" }),
})).json()).access_token;
const [cls] = await rest("classes?select=id&name=eq.C");
await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/set_tutor_settings`, {
  method: "POST", headers: { apikey: process.env.ANON, authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
  body: JSON.stringify({ p_enabled: true, p_session_minutes: 10, p_daily_minutes: 30, p_class_ids: [cls.id] }),
});
const h = { origin: BASE };
ok((await stu.request.post(BASE + "/api/tutor/consent", { data: { payer: "self", termsConfirmed: true }, headers: h })).ok()
  && (await stu.request.post(BASE + "/api/tutor/key", { data: { apiKey: SK2, payer: "self", store: true }, headers: h })).ok()
  && (await stu.request.patch(BASE + "/api/tutor/key", { data: { model: "gpt-realtime-2" }, headers: h })).ok(),
  "（準備）学校・クラスで有効にし、生徒本人が同意して自分のキーを登録");
await stu.reload(); await settle(800);
await stu.locator('[data-testid="inbox"] li button').first().click();
await stu.locator('[data-testid="wrong-question"]').first().waitFor({ timeout: 15000 });
ok((await stu.locator('[data-testid="wrong-question"]').count()) === 1, "5b. 間違えた問題（1問）が出る");
await stu.getByRole("button", { name: "チャッピー先生に聞く" }).click();
await stu.locator('[data-testid="tutor-panel"]').waitFor();
await stu.getByRole("button", { name: "⌨ 文字で質問する" }).click();
await stu.getByRole("button", { name: "会話を終える" }).waitFor({ timeout: 15000 });
await stu.getByLabel("質問を書く").fill("どこが違いますか");
await stu.getByRole("button", { name: "送る", exact: true }).click();
await stu.getByText("まず (1) の符号を確かめよう").waitFor({ timeout: 10000 });
await stu.getByRole("button", { name: "会話を終える" }).click(); await settle(1000);
const sess = await rest(`tutor_sessions?select=status,end_reason,call_id&release_id=eq.${rel[0].id}`);
const hung = (await (await fetch(OAI + "/__requests")).json()).filter((r) => r.hangup).map((r) => r.hangup);
ok(sess.length === 1 && sess[0].status === "ended" && hung.includes(sess[0].call_id), "5c. 復習：チャッピー先生と文字で会話し、終えるとサーバーが通話を切る");
const items1 = await rest(`submission_items?select=qno,mark,earned,detected&submission_id=eq.${sub.id}&order=qno`);
ok(JSON.stringify(items0) === JSON.stringify(items1), "復習しても、正式な採点は変わらない");

ok(errors.length === 0, `コンソールエラーなし ${errors.join(" / ")}`);
await browser.close();
console.log("\nOK: 答案登録 → 採点 → 教師確認 → 返却 → 復習 の通しテストが通りました");
