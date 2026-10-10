// 「本人の ChatGPT で復習」（B方式）の画面テスト。tests/e2e-lite/run.sh から呼ぶ。
//   - 既定は無効（生徒に出ない）→ 先生が設定画面で学校・クラスを有効にする
//   - 生徒（スマホ幅）：返却された答案 → 間違えた問題 → 送る内容を確認 → コピー → ChatGPT を開く
//   - コピー内容：問題文・本人の解答・判定・先生のコメント・家庭教師の指示。未公開の正答・解説、氏名・学校名・出席番号・画像は入らない
//   - 他の生徒の答案は読めない（PostgREST の RLS）
//   - AI は呼ばれない（採点AI・OpenAI の宛先の罠に要求が来ない。アプリ内の会話の API はサーバーでも断る）
import { chromium } from "playwright";

const BASE = process.env.BASE_URL, GW = process.env.GATEWAY_URL, TRAP = process.env.TRAP_URL;
const ok = (cond, msg) => { if (!cond) { console.log("✗ FAIL:", msg); throw new Error(msg); } console.log("✓", msg); };
const errors = [];
// SHOT_DIR を指定すると、スマホ幅の画面写真を保存する（確認用。テストの判定には使わない）
const shot = async (pg, name, loc) => { if (process.env.SHOT_DIR) await (loc ?? pg).screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, ...(loc ? {} : { fullPage: false }) }); };
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
});
const token = async (email) => (await (await fetch(`${GW}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "pass-lite-123" }),
})).json()).access_token;
const rest = async (tok, path) => (await fetch(`${GW}/rest/v1/${path}`, { headers: { authorization: `Bearer ${tok}` } })).json();
const ID = (n) => `eeeeeeee-0000-0000-0000-0000000000${n}`;
const adminTok = await token("admin@lite.example");

// ---------------------------------------------------------------- 生徒A（スマホ）
const stuCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ["clipboard-read", "clipboard-write"] });
const requests = [];
stuCtx.on("request", (r) => requests.push(`${r.method()} ${r.url()}`));
// ChatGPT は開くだけ（外部には出ない）：開いた URL だけを確かめる
await stuCtx.route("https://chatgpt.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>ChatGPT（テストの代役）</title>" }));
const stu = await stuCtx.newPage();
stu.on("console", (m) => { if (m.type() === "error") errors.push(`[生徒A] ${m.text()}`); });
stu.on("pageerror", (e) => errors.push(`[生徒A] ${e.message}`));
const text = () => stu.evaluate(() => document.body.innerText);
await stu.goto(BASE + "/student");
await stu.getByLabel("メール").fill("stu-a@lite.example");
await stu.getByLabel("パスワード").fill("pass-lite-123");
await stu.getByRole("button", { name: "ログイン", exact: true }).click();
await stu.getByTestId("inbox").getByText("一学期ライトテスト").waitFor();
ok((await stu.getByTestId("inbox").locator("li").count()) === 2, "生徒A：自分に返却された答案だけが受信箱に出る（2件）");
await stu.getByTestId("inbox").getByText("一学期ライトテスト").click();
await stu.getByTestId("wrong-question").first().waitFor();
ok((await stu.getByTestId("wrong-question").count()) === 1 && (await stu.getByTestId("wrong-question").innerText()).includes("大問1-(2)"), "間違えた問題だけが選べる（大問1-(2)）");
await stu.getByTestId("review-copy-off").waitFor();
ok((await stu.getByRole("button", { name: "ChatGPT で復習" }).count()) === 0, "既定は無効：「ChatGPT で復習」は出ない");
await stu.getByTestId("review-copy-off").scrollIntoViewIfNeeded(); await shot(stu, "1-default-off");
ok((await stu.getByRole("button", { name: "チャッピー先生に聞く" }).count()) === 0 && (await stu.getByRole("button", { name: "チャッピー先生の設定" }).count()) === 0,
  "アプリ内の会話・キーの設定は出ない（キー登録・モデル選択・料金表示なし）");
ok(!/API キー|モデル|トークン|\$/.test(await text()), "API キー・モデル・料金の表示が無い");

// ---------------------------------------------------------------- 先生：設定画面で B方式を有効にする
const admCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const adm = await admCtx.newPage();
adm.on("console", (m) => { if (m.type() === "error") errors.push(`[先生] ${m.text()}`); });
await adm.goto(BASE + "/login");
await adm.getByLabel("メールアドレス").fill("admin@lite.example");
await adm.getByLabel("パスワード").fill("pass-lite-123");
await adm.getByRole("button", { name: "ログイン" }).click();
await adm.waitForURL(BASE + "/");
await adm.goto(BASE + "/settings");
const card = adm.getByTestId("review-copy-settings");
await card.waitFor();
ok(!(await adm.evaluate(() => document.body.innerText)).includes("チャッピー先生（生徒の音声復習）"), "先生の設定画面：アプリ内の会話（キー・時間）の設定は出ない");
ok(!(await card.getByRole("checkbox").first().isChecked()), "先生の設定画面：既定は無効");
for (const c of await card.getByRole("checkbox").all()) await c.check();
ok(await card.getByRole("button", { name: "設定を保存" }).isDisabled(), "有効にするクラスの生徒が13歳以上かを確かめるまで保存できない");
await card.getByRole("checkbox", { name: /全員13歳以上/ }).check();
await shot(adm, "0-teacher-settings", adm.locator("section", { hasText: "生徒の復習：本人の ChatGPT で復習" }).first());
await card.getByRole("button", { name: "設定を保存" }).click();
await adm.getByText("ChatGPT での復習の設定を保存しました").waitFor();
const [school] = await rest(adminTok, "schools?select=review_copy_enabled,tutor_enabled");
const [cls] = await rest(adminTok, "classes?select=review_copy_enabled,tutor_enabled");
ok(school.review_copy_enabled === true && cls.review_copy_enabled === true, "先生が学校・クラスで有効にした（DB に保存）");
ok(school.tutor_enabled === false && cls.tutor_enabled === false, "アプリ内の会話の設定は有効にならない");

// ---------------------------------------------------------------- 生徒A：確認してコピー → ChatGPT を開く
await stu.getByRole("button", { name: "更新" }).click();
await stu.getByRole("button", { name: "ChatGPT で復習" }).click();
const panel = stu.getByTestId("review-copy");
await panel.waitFor();
const copyBtn = panel.getByRole("button", { name: "📋 復習内容をコピー" });
ok(await copyBtn.isDisabled(), "確認のチェックを付けるまでコピーできない");
const prompt1 = await panel.getByTestId("review-copy-text").inputValue();
for (const s of ["-4a+6b-12 を計算しなさい", "私の解答：-4a-6b+12", "判定：不正解（0／5点）", "先生のコメント：かっこの前のマイナスに注意", "家庭教師", "ヒントを1つずつ", "最初は答えを言わずに"]) {
  ok(prompt1.includes(s), `コピー内容に「${s}」が入る`);
}
for (const s of ["HIDDEN-ANSWER", "HIDDEN-EXPLANATION", "正答（先生が公開）", "ライト検証中学校", "LT07", "生徒A07", "ライト組", "一学期ライトテスト", ".jpg", "stu-a@", "eeeeeeee"]) {
  ok(!prompt1.includes(s), `コピー内容に「${s}」が入らない（未公開の正答・氏名などの代わりの値・学校名・番号・テスト名・画像）`);
}
await panel.scrollIntoViewIfNeeded(); await shot(stu, "2-panel-before-check", panel);
await panel.getByRole("checkbox", { name: "送る内容を確認しました" }).check();
ok(await copyBtn.isDisabled() && (await panel.getByRole("link", { name: /ChatGPT を開く/ }).count()) === 0, "13歳以上の確認が無いと、コピーも ChatGPT を開くこともできない");
await panel.getByRole("checkbox", { name: /13歳以上です/ }).check();
await copyBtn.click();
await panel.getByText("復習内容をコピーしました").waitFor();
await shot(stu, "3-copied", panel);
const clip = await stu.evaluate(() => navigator.clipboard.readText());
ok(clip === prompt1, "クリップボードの内容は、画面で確認した内容と同じ");
const link = panel.getByRole("link", { name: /ChatGPT を開く/ });
ok((await link.getAttribute("href")) === "https://chatgpt.com/" && (await link.getAttribute("target")) === "_blank" && /noopener/.test(await link.getAttribute("rel")),
  "「ChatGPT を開く」は公式の URL を新しいタブで開く（noopener）");
const [popup] = await Promise.all([stuCtx.waitForEvent("page"), link.click()]);
await popup.waitForLoadState();
ok(popup.url().startsWith("https://chatgpt.com/"), "タップすると ChatGPT が開く");
await popup.close();
ok((await stu.evaluate(() => document.documentElement.scrollWidth)) <= 390, "スマホ幅（390px）で横にはみ出さない");
const t = await text();
ok(t.includes("会話の内容や理解度を受け取ったりしません") && !/会話を始めました|会話中|理解度：/.test(t), "会話の開始・内容・理解度を受け取ったように表示しない");
ok((await panel.getByTestId("review-progress").innerText()) === "未記録", "コピーしただけでは復習の状態は変わらない");
await panel.getByRole("button", { name: "理解できた（自己申告）" }).click();
await panel.getByText("自己申告として記録しました").waitFor();
const [prog] = await rest(adminTok, `tutor_progress?select=state,source&release_id=eq.${(await rest(adminTok, `result_releases?select=id&submission_id=eq.${ID(51)}`))[0].id}`);
ok(prog.state === "self_understood" && prog.source === "external_self", "復習の状態は生徒の自己申告として記録（先生の確認とは別）");

// 正答・解説を公開したテストでは入る
await stu.getByRole("button", { name: "← 受信箱に戻る" }).click();
await stu.getByTestId("inbox").getByText("二学期ライトテスト").click();
await stu.getByRole("button", { name: "ChatGPT で復習" }).click();
const prompt2 = await stu.getByTestId("review-copy-text").inputValue();
ok(prompt2.includes("正答（先生が公開）：x=2") && prompt2.includes("解説（先生が公開）：両辺を2でわる"), "先生が公開したテストでは、正答と解説が入る");
ok(!t.includes("B-ONLY-COMMENT") && !(await text()).includes("B-ONLY-COMMENT"), "生徒Aの画面に、生徒Bの答案の内容は出ない");

// ---------------------------------------------------------------- 先生：答案詳細で自己申告と確認を区別して見る
await adm.goto(`${BASE}/history/${ID(51)}`);
await adm.getByText("設問別採点").first().click();
await adm.getByText("理解できた（自己申告）").waitFor();
ok(!(await adm.evaluate(() => document.body.innerText)).includes("アプリ内の会話"), "答案詳細：アプリ内の会話の回数・時間は出ない");
await adm.getByRole("button", { name: "理解確認済みにする" }).click();
await adm.getByText("理解確認済み（先生）").waitFor();
const [prog2] = await rest(adminTok, `tutor_progress?select=state,source&qno=eq.2`);
ok(prog2.state === "verified" && prog2.source === "teacher", "「理解確認済み」は先生の確認として記録");

// ---------------------------------------------------------------- 他の生徒の答案へのアクセスは拒否
const bTok = await token("stu-b@lite.example");
const aTok = await token("stu-a@lite.example");
const relA = await rest(adminTok, `result_releases?select=id&student_id=eq.${ID(21)}`);
ok(relA.length === 2, "（前提）生徒Aの返却は2件");
ok((await rest(bTok, `result_releases?select=id,payload&student_id=eq.${ID(21)}`)).length === 0, "生徒Bは、生徒Aの返却内容を読めない（学籍で指定しても）");
ok((await rest(bTok, `result_releases?select=id&id=eq.${relA[0].id}`)).length === 0, "生徒Bは、生徒Aの返却内容を読めない（返却の ID で指定しても）");
ok((await rest(bTok, `tutor_progress?select=state&student_id=eq.${ID(21)}`)).length === 0, "生徒Bは、生徒Aの復習の状態を読めない");
ok((await rest(bTok, "submissions?select=id")).length === 0 && (await rest(bTok, "submission_items?select=id")).length === 0, "生徒は答案・採点結果の表を直接読めない");
ok((await rest(aTok, `result_releases?select=id&student_id=eq.${ID(22)}`)).length === 0, "生徒Aも、生徒Bの返却内容を読めない");
const stuB = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
await stuB.goto(BASE + "/student");
await stuB.getByLabel("メール").fill("stu-b@lite.example");
await stuB.getByLabel("パスワード").fill("pass-lite-123");
await stuB.getByRole("button", { name: "ログイン", exact: true }).click();
await stuB.getByTestId("inbox").getByText("一学期ライトテスト").waitFor();
ok((await stuB.getByTestId("inbox").locator("li").count()) === 1 && !(await stuB.evaluate(() => document.body.innerText)).includes("二学期ライトテスト"), "生徒Bの受信箱には自分の答案だけ");

// ---------------------------------------------------------------- AI は呼ばれない
// 画面の操作で出た要求（下でテストが直接 API を試す前に控える）
const uiRequests = [...requests];
ok(!uiRequests.some((r) => /\/api\/(grade|tutor\/(session|context|consent|key))/.test(r)), "B方式の画面操作で、アプリ内の会話・採点AIの API を呼ばない");
const app = new URL(BASE).host, gw = new URL(GW).host;
const outside = uiRequests.filter((r) => { const u = new URL(r.slice(r.indexOf(" ") + 1)); return u.host !== app && u.host !== gw && !(u.host === "chatgpt.com" && r.startsWith("GET ")); });
ok(outside.length === 0, `生徒のブラウザは、アプリと DB 以外へ要求しない（ChatGPT を開いた1回を除く）${outside.length ? "：" + outside.join(", ") : ""}`);
const tutorApi = await stu.request.post(BASE + "/api/tutor/session", { headers: { origin: BASE, "content-type": "application/json" }, data: { releaseId: relA[0].id, qno: 2, mode: "text", sdp: "v=0\r\n" } });
ok(tutorApi.status() === 403 && (await tutorApi.json()).code === "inapp_off", "アプリ内の会話を始める API はサーバーで断る（inapp_off）");
const keyApi = await stu.request.post(BASE + "/api/tutor/key", { headers: { origin: BASE, "content-type": "application/json" }, data: { apiKey: "sk-proj-notarealkeyAAAAAAAAAAAAAAAAAAAA", payer: "self", store: false } });
ok(keyApi.status() === 403, "API キーの登録はサーバーで断る");
ok((await (await stu.request.get(BASE + "/api/tutor/mode")).json()).inapp === false, "アプリ内の会話は既定で無効（暗号鍵・CRON_SECRET・API キーなしで起動）");
const hits = await (await fetch(TRAP + "/__hits")).json();
ok(hits.length === 0, `採点AI・OpenAI の宛先に要求が1回も来ない（${hits.length}件）`);
const gwLog = await (await fetch(GW + "/__requests")).json();
ok(gwLog.every((l) => /^(GET|POST|PATCH|DELETE|HEAD) \/(rest|auth|storage)\/v1\//.test(l)), "DB への要求は REST・ログイン・画像だけ");

// ストアに載せる生徒の画面の写真（STORE_SHOT_DIR を指定したときだけ。scripts/mobile/screenshots.mjs と同じ端末の大きさ）
if (process.env.STORE_SHOT_DIR) {
  const devices = {
    "iphone-6.9": { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 },
    "ipad-13": { viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2 },
    "android-phone": { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 },
  };
  for (const [name, opts] of Object.entries(devices)) {
    const ctx = await browser.newContext({ ...opts, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(BASE + "/student");
    await p.getByLabel("メール").fill("stu-a@lite.example");
    await p.getByLabel("パスワード").fill("pass-lite-123");
    await p.getByRole("button", { name: "ログイン", exact: true }).click();
    await p.getByTestId("inbox").getByText("一学期ライトテスト").waitFor();
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${process.env.STORE_SHOT_DIR}/${name}/06-student-inbox.png` });
    await p.getByTestId("inbox").getByText("一学期ライトテスト").click();
    await p.getByRole("button", { name: "ChatGPT で復習" }).click();
    const panel = p.getByTestId("review-copy");
    await panel.getByRole("checkbox", { name: "送る内容を確認しました" }).check();
    await panel.getByRole("checkbox", { name: /13歳以上です/ }).check();
    await panel.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${process.env.STORE_SHOT_DIR}/${name}/07-student-review.png` });
    await ctx.close();
  }
  console.log("✓ ストア用の生徒の画面の写真を保存しました");
}

ok(errors.length === 0, `コンソールのエラーが無い${errors.length ? "：\n" + errors.join("\n") : ""}`);
await browser.close();
console.log("OK: B方式（本人の ChatGPT で復習）の画面テストがすべて通りました");
