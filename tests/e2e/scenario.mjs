// 教員の実際の作業の流れを、ローカル Supabase に対してブラウザで通すシナリオテスト。
// tests/e2e/run.sh から呼ぶ（Supabase 起動・初期データ投入・アプリのビルドを行ってから実行する）。
import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import { promises as fs } from "fs";
import { createHash, randomUUID } from "crypto";

const BASE = process.env.BASE_URL || "http://localhost:3200";
const MOCK = process.env.MOCK_URL || "http://127.0.0.1:4010";
const OUT = new URL("./.out/", import.meta.url).pathname;
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);

// 答案画像の代わりに使う PNG を作る
await mkdir(OUT, { recursive: true });
{
  const p = await browser.newPage({ viewport: { width: 600, height: 840 } });
  for (let i = 1; i <= 9; i++) {
    await p.setContent(`<body style="margin:0;background:#fff;font:28px serif;padding:40px">答案 ${i}<br><br>(1) 3x-2<br>(2) ア<br>(3) 等しい</body>`);
    await p.screenshot({ path: `${OUT}answer${i}.png` });
  }
  await p.close();
}
const img = (i) => `${OUT}answer${i}.png`;
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`[${m.type()}] ${new URL(page.url()).pathname} ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
const ok = (cond, msg) => { if (!cond) { console.log("✗ FAIL:", msg); throw new Error(msg); } console.log("✓", msg); };
const text = async () => page.locator("body").innerText();
const settle = (ms = 700) => page.waitForTimeout(ms);
const toastSeen = async (re) => { await page.getByText(re).first().waitFor({ timeout: 15000 }); };

async function login(email, pass) {
  await page.goto(BASE + "/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(pass);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL(BASE + "/");
  await page.locator("header h1").waitFor().catch(async (e) => {
    // 失敗したときは画面の文字を出して原因を分かるようにする
    console.log("✗ ログイン後の画面:", (await page.locator("body").innerText()).slice(0, 500));
    throw e;
  });
  await settle();
}

// 0. 誤ったパスワード
await page.goto(BASE + "/history");
ok(page.url().endsWith("/login"), "未ログインで /history → /login にリダイレクト");
await page.getByLabel("メールアドレス").fill("admin@a.example");
await page.getByLabel("パスワード").fill("wrong");
await page.getByRole("button", { name: "ログイン" }).click();
const alert = page.locator("form [role=alert]");
await alert.waitFor();
ok((await alert.innerText()).includes("パスワードが違います"), "誤ったパスワードは日本語で案内");

// 1. 管理者でログイン
await login("admin@a.example", "pass-A-123");
ok((await text()).includes("テスト中学校"), "ログイン後、所属校名がサイドバーに出る");
ok(!(await text()).includes("デモモード"), "Supabase 接続時はデモモード表示が出ない");

// 2. テストを登録
await page.goto(BASE + "/tests"); await settle();
ok((await text()).includes("テストがまだありません"), "テスト未登録の空状態");
await page.getByRole("button", { name: "＋ テストを追加" }).click();
await page.getByRole("button", { name: "登録する" }).click();
ok((await text()).includes("テスト名を入力してください"), "必須項目の検証メッセージ");
await page.getByPlaceholder("例：1学期期末テスト").fill("E2E 小テスト");
await page.getByPlaceholder("式の計算、連立方程式、一次関数").fill("一次関数、連立方程式");
await page.locator('input[aria-label="まとめて追加する問題数"]').fill("2");
await page.getByRole("button", { name: "問まとめて追加" }).click();
const rows = page.locator("table tbody tr");
ok((await rows.count()) === 3, "設問を3問にした");
await page.getByRole("button", { name: "登録する" }).click();
await toastSeen(/「E2E 小テスト」を登録しました/);
ok((await text()).includes("E2E 小テスト"), "登録したテストが一覧に出る");

// 3. 画像だけ保存（AI採点待ち）。1人分を2枚で取り込む（1枚目は iPhone の写真＝HEIC）
const heic = new URL("../fixtures/sample.heic", import.meta.url).pathname;
await page.goto(BASE + "/new"); await settle(1200);
ok((await text()).includes("AI（Claude）が答案を読み取って採点します"), "採点AIが使えることを表示");
ok(!(await text()).includes("動作確認用の仮採点"), "採点AIがあるときは乱数の仮採点を選べない");
await page.locator("#pages-per").selectOption("2");
await page.locator('input[type=file]:not([capture])').setInputFiles([heic, img(1), img(2), img(1)]);
await page.getByText("4 / 80 枚").waitFor({ timeout: 30000 });
ok(true, "4枚取り込み（HEIC を含む）");
ok((await text()).includes("sample.jpg") && !(await text()).includes("sample.heic"), "HEIC は取り込み時に JPEG に変換される");
ok((await text()).includes("2 名分（4 枚）") && (await page.getByText("1 / 2 ページ").count()) === 2, "2枚ずつ1人分の答案（2ページ）にまとめる");
await page.getByLabel(/画像の保存だけ行い/).check();
await page.getByRole("button", { name: "答案を保存する" }).click();
await toastSeen(/2 枚の答案を保存しました/);
ok((await text()).includes("AI採点待ち"), "保存だけを選ぶと AI採点待ち になる");

// 4. 保存してAI採点（3〜9番）
await page.getByRole("button", { name: "続けて取り込む" }).click(); await settle();
await page.locator("#pages-per").selectOption("1");   // 「1人分の枚数」は続けて取り込むときも残る
await page.locator('input[type=file]:not([capture])').setInputFiles([3, 4, 5, 6, 7, 8, 9].map(img));
await settle(600);
// 1,2番は保存済みなので、3〜9番へ割り当て直す
const selects = page.locator("section select, div select").filter({ has: page.locator('option:text("生徒を選ぶ")') });
const n = await selects.count();
for (let i = 0; i < n; i++) await selects.nth(i).selectOption({ label: `2年A組 ${i + 3}番` });
// 「保存だけ」の選択は続けて取り込むときも残る。今回は外して AI 採点する
await page.getByLabel(/画像の保存だけ行い/).uncheck();
await page.getByRole("button", { name: "保存してAI採点する" }).click();
await toastSeen(/7 枚のAI採点が終わりました/);
ok(!(await text()).includes("[エラー]"), "保存・AI採点のエラーなし");
ok((await text()).match(/2年A組 3番：\d+点/) !== null, "処理ログに生徒ごとの得点が出る");

// 5. 再読み込みしても残っている（永続化）
await page.goto(BASE + "/history"); await settle(1200);
const histRows = await page.locator("tbody tr").count();
ok(histRows === 7, `採点履歴に7件（再読み込み後も残る） 実際:${histRows}`);
await page.goto(BASE + "/processing"); await settle();
ok((await page.getByText("AI採点待ち").count()) === 2, "採点中の画面に AI採点待ち 2件");

// 6. 原本画像（署名付きURL）
await page.getByRole("button", { name: "答案を見る" }).first().click();
await page.waitForURL(/\/history\/.+/);
await page.locator('img[alt*="答案（原本）"]').waitFor({ timeout: 15000 });
const src = await page.locator('img[alt*="答案（原本）"]').getAttribute("src");
ok(src.includes("/storage/v1/object/sign/answer-sheets/"), "原本画像は署名付きURLで表示");
const loaded = await page.locator('img[alt*="答案（原本）"]').evaluate((img) => img.complete && img.naturalWidth > 0);
ok(loaded, "原本画像が実際に読み込める");
ok((await text()).includes("原本 1 / 2 ページ"), "2ページの答案は原本のページを切り替えられる");
await page.getByRole("button", { name: "▶" }).first().click(); await settle(800);
ok((await text()).includes("原本 2 / 2 ページ"), "2ページ目の原本を表示");
await page.getByRole("button", { name: "◀" }).first().click(); await settle(500);
const direct = await page.request.get(src.replace("/object/sign/", "/object/public/").split("?")[0]);
ok(direct.status() >= 400, `署名なしの直リンクは開けない（HTTP ${direct.status()}）`);

// 6b. 保存済みの答案を AI で採点する（失敗 → 元に戻る → もう一度で成功）
await fetch(MOCK + "/__mode", { method: "POST", body: JSON.stringify({ mode: "ratelimit" }) });
await page.getByRole("button", { name: "AIで採点する" }).click();
await toastSeen(/採点AIが混み合っています/);
await settle(800);
ok((await text()).includes("この答案はまだ採点されていません"), "AI採点に失敗したら、答案は採点待ちのまま（元の状態に戻る）");
await page.getByRole("button", { name: "AIで採点する" }).click();
await toastSeen(/AI採点が終わりました（\d+点・Opus単独）/);
await page.locator('svg[aria-label="原本に赤ペンを重ねた採点画像"]').waitFor({ timeout: 15000 });
ok(true, "採点後は原本の上に赤ペンが重なる");
ok(await page.locator('svg[aria-label="原本に赤ペンを重ねた採点画像"] image').count() === 1, "赤ペン画像の下地は原本画像");
await page.getByRole("button", { name: "清書版" }).click();
await page.locator('svg[aria-label="赤ペン採点画像"]').waitFor();
ok(true, "清書版に切り替えられる");

// 6c. 残りの1枚を「まとめてAI採点」
await page.goto(BASE + "/processing"); await settle();
await page.getByRole("button", { name: /まとめてAI採点（1枚）/ }).click();
await toastSeen(/1 枚のAI採点が終わりました/);
await settle(600);
ok((await text()).includes("処理中の答案はありません"), "まとめてAI採点で、採点待ちがなくなる");

// 6d. 採点AIに送った内容（代役のサーバーで検査）
const sent = await (await fetch(MOCK + "/__requests")).json();
ok(sent.length === 10, `採点AIへのリクエストは10回（7 + 失敗1 + 再試行1 + まとめて1） 実際:${sent.length}`);
ok(sent.every((r) => r.problems.length === 0), `リクエストの形が正しい ${JSON.stringify(sent.flatMap((r) => r.problems))}`);
ok(sent.every((r) => r.questions.length === 3 && r.questions.every((q) => typeof q.points === "number")), "3問の設問と配点を送っている");
ok(sent.every((r) => r.rubric.includes("要点を 70% 以上")), "採点基準を送っている");
const graded = sent.filter((r) => r.kind === "grade");
ok(graded.every((r) => ["image/png", "image/jpeg"].includes(r.imageType)), `答案画像を PNG / JPEG として送っている ${JSON.stringify(graded.map((r) => r.imageType))}`);
ok(graded.filter((r) => r.images === 2).length >= 2 && graded.some((r) => r.imageType === "image/jpeg"), "2ページの答案は2枚の画像を送る（HEIC は JPEG に変換済み）");

// 7. 採点結果を修正 → 合計点は DB のトリガーの値
await page.goto(BASE + "/history"); await settle(1000);
await page.locator("tbody tr").first().click();
await page.waitForURL(/\/history\/.+/); await settle(800);
const subUrl = page.url();
await page.getByRole("button", { name: /^設問別採点/ }).click();
const totalBefore = Number((await page.getByText(/^合計 \d+ \/ \d+ 点$/).innerText()).match(/合計 (\d+)/)[1]);
// 1問目を × にして、2問目を ○ にする
await page.locator('button[aria-label$="を × にする"]').first().click(); await settle(1200);
await page.locator('button[aria-label$="を ○ にする"]').nth(1).click(); await settle(1200);
const totalAfter = Number((await page.getByText(/^合計 \d+ \/ \d+ 点$/).innerText()).match(/合計 (\d+)/)[1]);
await page.reload(); await page.locator("header h1").waitFor(); await settle(1000);
await page.getByRole("button", { name: /^設問別採点/ }).click();
const totalReload = Number((await page.getByText(/^合計 \d+ \/ \d+ 点$/).innerText()).match(/合計 (\d+)/)[1]);
ok(totalAfter === totalReload, `修正後の合計点 ${totalAfter} は再読み込み後も同じ（修正前 ${totalBefore}）`);
ok((await text()).includes("教師修正あり"), "教師修正ありのバッジ");
// 得点を直接入力（確定時に保存）
const earned = page.locator('input[aria-label$="の得点"]').nth(2);
await earned.fill("1"); await earned.press("Enter"); await settle(1200);
await page.getByRole("button", { name: "確認済みにする" }).click();
await toastSeen(/確認済みにしました/);
await page.reload(); await page.locator("header h1").waitFor(); await settle(1000);
ok((await text()).includes("確認済 T.K"), "確認済み（確認者 T.K）が保存されている");

// 8. 要確認一覧
await page.goto(BASE + "/review"); await settle(1200);
const reviewCount = await page.getByRole("button", { name: "○ で確定" }).count();
if (reviewCount > 0) {
  await page.getByRole("button", { name: "○ で確定" }).first().click();
  await toastSeen(/確認しました/);
  await settle(800);
  ok((await page.getByRole("button", { name: "○ で確定" }).count()) === reviewCount - 1, `要確認を1件確定（${reviewCount} → ${reviewCount - 1}）`);
} else console.log("- 要確認は0件（採点結果による）");

// 9. 弱点分析（Postgres のビュー）
await page.goto(BASE + "/weakness"); await settle(1500);
const wtext = await text();
ok(wtext.includes("単元別の定着度") && wtext.includes("一次関数"), "弱点分析：単元別の定着度が出る");
ok(wtext.includes("設問別の正答率"), "弱点分析：設問別の正答率が出る");

// 10. 採点基準の保存 → 再読み込み後も残る
await page.goto(BASE + "/rubric"); await settle();
await page.getByLabel(/大文字・小文字を区別する/).check();
await page.getByRole("button", { name: "基準を保存" }).click();
await toastSeen(/採点基準を保存しました/);
await page.reload(); await page.locator("header h1").waitFor(); await settle(800);
ok(await page.getByLabel(/大文字・小文字を区別する/).isChecked(), "採点基準が保存されている");

// 11. 設定：AI採点の準備状況・保存期間（管理者）・監査ログ
await page.goto(BASE + "/settings"); await settle();
await page.getByText("AI採点できます").waitFor({ timeout: 15000 });
const stext = await text();
ok(stext.includes("AI採点の保存（0004_ai_grading.sql）：OK") && stext.includes("採点AI（ANTHROPIC_API_KEY）：OK"), "設定：AI採点の準備状況（キー・0004・0005）を確認できる");
ok(!stext.includes(process.env.DUMMY_KEY || "sk-ant-e2e-dummy-key-not-real"), "準備状況にキーの値は出ない");
await page.locator("select").filter({ has: page.locator('option:text("30日で自動削除")') }).selectOption("180");
await toastSeen(/保存期間を変更しました/);
await page.getByRole("button", { name: "改ざんがないか確認する" }).click();
await toastSeen(/連鎖を確認しました。改ざんはありません/);
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "監査ログを書き出す" }).click()]);
const csv = await fs.readFile(await dl.path(), "utf8");
ok(csv.includes("grading.edit") && csv.includes("submission.review") && csv.includes("test.create") && csv.includes("grading.ai"), "監査ログCSVにAI採点・採点修正・確認・テスト登録が記録");

// 11b. モデル比較試験（管理者専用。採点AIは代役なので API キーも本物の API も使わない）
{
  const p = await browser.newPage({ viewport: { width: 600, height: 840 } });
  await p.setContent(`<body style="margin:0;background:#fff;font:30px serif;padding:40px">算数テスト<br>1年1組 2番<br>各20点／100点満点<br><br>
    ① 3＋3＝9<br>② 9＋9＝18<br>③ 18＋18＝36<br>④ 36＋36＝72<br>⑤ 72＋72＝145</body>`);
  await p.screenshot({ path: `${OUT}compare.png` });
  await p.close();
}
const compareBodies = [];
const onCompareResponse = async (r) => {
  if (r.url().includes("/api/compare")) { try { compareBodies.push(await r.text()); } catch { /* 画面遷移で読めないものは無視 */ } }
};
page.on("response", onCompareResponse);
const compareReqs = async () => (await (await fetch(MOCK + "/__requests")).json()).filter((r) => r.kind === "compare");
await page.goto(BASE + "/history"); await settle(1000);
const histBeforeCompare = await page.locator("tbody tr").count();

await page.goto(BASE + "/compare"); await settle(1200);
ok((await text()).includes("①6、②18、③36、④72、⑤144"), "比較試験：模範解答（全モデル共通）を表示");
ok((await text()).includes("照合専用・モデルには送りません"), "比較試験：期待結果は照合専用と表示");
await page.locator("#compare-file").setInputFiles(`${OUT}compare.png`); await settle(800);
await page.getByRole("button", { name: /3モデルで比較する/ }).click();
await toastSeen(/比較が終わりました/);
await settle(1200);
const ctext = await text();
ok(ctext.includes("claude-haiku-4-5-20251001") && ctext.includes("claude-sonnet-5-5") && ctext.includes("claude-opus-5"), "Models API で確かめた正式なモデルIDを表示");
ok((ctext.match(/全問一致/g) || []).length === 2 && ctext.includes("4/5問一致"), "期待結果との照合（Sonnet・Opus は一致、Haiku の読み違いは不一致）");
ok(ctext.includes("3モデルとも同じ入力"), "3モデルに同じ入力（画像・指示・採点基準）を送った");
ok(ctext.includes("$0.0040") && ctext.includes("$0.0200"), "概算費用（公式単価 × トークン数）を表示");
let creqs = await compareReqs();
ok(creqs.length === 3 && new Set(creqs.map((r) => r.model)).size === 3, `各モデル1回ずつ呼んだ（${creqs.map((r) => r.model).join(", ")}）`);
ok(creqs.every((r) => r.problems.length === 0), `比較試験のリクエストの形（模範解答あり・期待結果なし・再試行や切り替えなし） ${JSON.stringify(creqs.flatMap((r) => r.problems))}`);

// 二重実行の防止
await page.getByRole("button", { name: /3モデルで比較する/ }).click();
await page.getByText(/この画像はすでに比較しました/).waitFor({ timeout: 15000 });
ok((await compareReqs()).length === 3, "同じ画像をもう一度実行しようとしても、チェックを入れない限り API を呼ばない");
const png = await fs.readFile(`${OUT}compare.png`);
const { runs } = await (await page.request.get(BASE + "/api/compare")).json();
const again = await page.request.post(BASE + "/api/compare/call", {
  multipart: { runId: runs[0].id, displayName: "Claude Opus 5", image: { name: "compare.png", mimeType: "image/png", buffer: png } },
});
ok(again.status() === 409, `同じ試験で同じモデルをもう一度呼ぶと断る（HTTP ${again.status()}）`);
const start = (rid) => page.request.post(BASE + "/api/compare", { data: {
  action: "start", requestId: rid, imageSha256: createHash("sha256").update(png).digest("hex"),
  imageName: "compare.png", imageBytes: png.length, rerun: true,
} });
const rid = randomUUID();
const s1 = await (await start(rid)).json();
const s2 = await (await start(rid)).json();
ok(s1.run?.id && s1.run.id === s2.run?.id && s2.reused === true, "同じ操作の再送は同じ試験として扱う");
const s3 = await start(randomUUID());
ok(s3.status() === 409, `実行中の試験があるあいだは、2つ目を始められない（HTTP ${s3.status()}）`);
await page.request.post(BASE + "/api/compare", { data: { action: "abort", runId: s1.run.id } });
const afterAbort = await page.request.post(BASE + "/api/compare/call", {
  multipart: { runId: s1.run.id, displayName: "Claude Haiku 4.5", image: { name: "compare.png", mimeType: "image/png", buffer: png } },
});
ok(afterAbort.status() === 409, "中止した試験のモデルは呼び出さない");
ok((await compareReqs()).length === 3, "二重実行の確認では採点モデルを1回も呼んでいない");

// 成績には保存しない・APIキーを返さない
await page.goto(BASE + "/history"); await settle(1000);
ok((await page.locator("tbody tr").count()) === histBeforeCompare, "比較試験は採点履歴（成績）に何も追加しない");
page.off("response", onCompareResponse);
ok(compareBodies.length > 0 && compareBodies.every((b) => !b.includes(process.env.DUMMY_KEY || "sk-ant-e2e-dummy-key-not-real")), "比較試験の API の応答に APIキーが含まれない");

// 11c. 採点方式「3モデル併用」（Haiku → 必要なら Sonnet → Opus）。採点AIは代役で、モデルごとに台本どおりの結果を返す
const allReqs = async () => (await (await fetch(MOCK + "/__requests")).json()).filter((r) => r.kind === "grade");
const script = (o) => fetch(MOCK + "/__script", { method: "POST", body: JSON.stringify(o) });
const idOf = async (label) => {
  await page.goto(BASE + "/history"); await settle(1000);
  await page.locator("tbody tr", { hasText: label }).first().click();
  await page.waitForURL(/\/history\/.+/);
  return page.url().split("/").pop();
};
const rowText = async (label) => {
  await page.goto(BASE + "/history"); await settle(1000);
  return page.locator("tbody tr", { hasText: label }).first().innerText();
};
// 画面と同じ手順で /api/grade を呼ぶ（同じ requestId で、終わるまで続きを要求する）
const gradeApi = async (submissionId, mode, requestId = randomUUID()) => {
  for (let i = 0; i < 12; i++) {
    const r = await page.request.post(BASE + "/api/grade", { data: { submissionId, mode, requestId } });
    const j = await r.json();
    if (r.status() === 202) { await settle(800); continue; }
    if (!r.ok() || j.done) return { status: r.status(), ...j, requestId };
  }
  throw new Error("採点が終わらない");
};
const ids = {
  s1: await idOf("A組 1番"), s3: await idOf("A組 3番"), s4: await idOf("A組 4番"),
  s5: await idOf("A組 5番"), s6: await idOf("A組 6番"), s7: await idOf("A組 7番"),
};

// (1) 画面：採点方式を選ぶと、実行前のボタンと料金の比較に表示される
await page.goto(BASE + "/new"); await settle(1000);
ok((await text()).includes("料金の比較（目安）") && (await text()).includes("Opus単独の約"), "新規採点：採点方式と料金の比較（目安）を表示");
await page.getByRole("radio", { name: /3モデル併用/ }).check();
await page.locator('input[type=file]:not([capture])').setInputFiles([img(3)]); await settle(600);
ok(await page.getByRole("button", { name: "保存してAI採点する（3モデル併用）" }).isVisible(), "実行前に、選んだ採点方式をボタンに表示");
await page.getByRole("button", { name: "すべて外す" }).click();

// (2) Haiku で問題がなければ Haiku で確定（画面から採点し直す）
let mark = (await allReqs()).length;
await page.goto(BASE + "/history/" + ids.s3); await settle(1200);
ok((await page.getByLabel("採点方式").inputValue()) === "cascade", "選んだ採点方式は答案詳細でも使われる");
page.once("dialog", (d) => d.accept());
await page.getByRole("button", { name: "AIで採点し直す" }).click();
await toastSeen(/AI採点が終わりました（\d+点・3モデル併用・Haikuで確定）/);
let calls = (await allReqs()).slice(mark);
ok(calls.length === 1 && calls[0].model === "claude-haiku-4-5" && calls[0].problems.length === 0,
  `問題の無い答案は Haiku だけで確定（${calls.map((c) => c.model).join(",")} ${JSON.stringify(calls.flatMap((c) => c.problems))}）`);
await settle(800);
ok((await text()).includes("採点方式：3モデル併用（Haikuで確定）"), "答案詳細に採点方式を表示");
await page.getByRole("button", { name: /^AI採点の記録/ }).click(); await settle(1000);
ok((await text()).includes("claude-haiku-4-5") && /入力 1200・出力 300 トークン/.test(await text()), "AI採点の記録：モデルID・トークン数");
ok(/\$0\.00\d+/.test(await text()), "AI採点の記録：概算費用");
ok((await rowText("A組 3番")).includes("3モデル併用（Haiku）"), "採点履歴に採点方式を保存・表示");

// (3) Haiku で回答の欠落 → Sonnet で解決
mark = (await allReqs()).length;
await script({ "claude-haiku-4-5": ["missing"] });
let r = await gradeApi(ids.s4, "cascade");
calls = (await allReqs()).slice(mark);
ok(r.done && r.finalStage === "sonnet" && calls.map((c) => c.model).join(",") === "claude-haiku-4-5,claude-sonnet-5-5"
  && calls.every((c) => c.problems.length === 0), `回答の欠落 → Sonnet で確定（${calls.map((c) => c.model).join(",")}）`);
ok(calls.every((c) => JSON.stringify(c.questions) === JSON.stringify(calls[0].questions) && c.rubric === calls[0].rubric),
  "Haiku と Sonnet に同じ模範解答・配点・採点基準を渡す");
await page.goto(BASE + "/history/" + ids.s4); await settle(1000);
await page.getByRole("button", { name: /^AI採点の記録/ }).click(); await settle(1000);
ok((await text()).includes("回答の欠落") && (await text()).includes("上のモデルへ") && (await text()).includes("claude-sonnet-5-5"),
  "確認に回した理由と各段階のモデルIDを記録");

// (4) Haiku で採点基準と矛盾 → Sonnet で判読不能 → Opus でも Sonnet と判定が分かれた → 要確認（理由を記録）
mark = (await allReqs()).length;
await script({ "claude-haiku-4-5": ["contradict"], "claude-sonnet-5-5": ["unreadable"], "claude-opus-5": ["disagree"] });
r = await gradeApi(ids.s5, "cascade");
calls = (await allReqs()).slice(mark);
ok(r.done && r.finalStage === "opus" && r.needReview >= 1 && calls.length === 3 && calls.every((c) => c.problems.length === 0),
  `解決しない答案は Opus まで回し、要確認にする（${calls.map((c) => c.model).join(",")}・要確認 ${r.needReview}）`);
await page.goto(BASE + "/history/" + ids.s5); await settle(1000);
await page.getByRole("button", { name: /^AI採点の記録/ }).click(); await settle(1000);
const log5 = await text();
ok((log5.includes("正答との照合と判定が矛盾") || log5.includes("判定と得点が食い違う")) && log5.includes("判読不能") && log5.includes("最後のモデルでも解決しなかった") && log5.includes("前のモデルと判定が分かれた"),
  "要確認にした判断理由（各段階の理由と、最後に残った理由）を記録");

// (5) 複数ページの答案：各段階に全ページを送り、ページ別に赤ペンを重ねる
mark = (await allReqs()).length;
await script({ "claude-haiku-4-5": ["missing"] });
r = await gradeApi(ids.s1, "cascade");
calls = (await allReqs()).slice(mark);
ok(r.done && calls.length === 2 && calls.every((c) => c.images === 2), `2ページの答案は Haiku・Sonnet とも2枚の画像を送る（${calls.map((c) => c.images).join(",")}）`);
await page.goto(BASE + "/history/" + ids.s1); await settle(1500);
await page.locator('svg[aria-label="原本に赤ペンを重ねた採点画像"]').waitFor({ timeout: 15000 });
await page.getByRole("button", { name: "▶" }).first().click(); await settle(1000);
ok((await text()).includes("原本 2 / 2 ページ") && await page.locator('svg[aria-label="原本に赤ペンを重ねた採点画像"] path').count() > 0,
  "2ページ目の原本にも赤ペンを重ねる");

// (6) 二重実行の防止：連打（同じ requestId の同時送信）と再送では、同じモデルを二重に呼ばない
mark = (await allReqs()).length;
await script({ "claude-haiku-4-5": ["slow"] });
const ridDup = randomUUID();
const [a1, a2] = await Promise.all([
  page.request.post(BASE + "/api/grade", { data: { submissionId: ids.s7, mode: "cascade", requestId: ridDup } }),
  (async () => { await settle(400); return page.request.post(BASE + "/api/grade", { data: { submissionId: ids.s7, mode: "cascade", requestId: ridDup } }); })(),
]);
ok([a1.status(), a2.status()].sort().join(",") === "200,202", `連打：2つ目は「採点中」で待たせる（${a1.status()},${a2.status()}）`);
const resent = await gradeApi(ids.s7, "cascade", ridDup);
ok(resent.done && resent.finalStage === "haiku", "再送：同じ requestId は確定済みの結果を返す");
ok((await allReqs()).length - mark === 1, `連打・再送でもモデルの呼び出しは1回（${(await allReqs()).length - mark}回）`);
// 採点中の答案に、別の操作で採点を始めようとしても断る
await script({ "claude-haiku-4-5": ["missing"] });
const rA = randomUUID();
const first = await (await page.request.post(BASE + "/api/grade", { data: { submissionId: ids.s7, mode: "cascade", requestId: rA } })).json();
ok(first.done === false && first.next === "sonnet", "Haiku の結果に問題があれば、次は Sonnet と返す");
const other = await page.request.post(BASE + "/api/grade", { data: { submissionId: ids.s7, mode: "opus", requestId: randomUUID() } });
ok(other.status() === 409, `採点中の答案は、別の操作では採点できない（HTTP ${other.status()}）`);
const rest = await gradeApi(ids.s7, "cascade", rA);
ok(rest.done && rest.finalStage === "sonnet", "続きは同じ requestId で Sonnet から再開する");

// (7) 途中失敗：Sonnet が失敗しても、既存の成績（得点・状態）を壊さない
const before6 = await rowText("A組 6番");
mark = (await allReqs()).length;
await script({ "claude-haiku-4-5": ["missing"], "claude-sonnet-5-5": ["error500"] });
r = await gradeApi(ids.s6, "cascade");
calls = (await allReqs()).slice(mark);
ok(!r.ok && r.status >= 500 && calls.length === 2, `Sonnet が失敗したら採点を止める（HTTP ${r.status}・${calls.map((c) => c.model).join(",")}）`);
const after6 = await rowText("A組 6番");
ok(after6.replace(/\s+/g, " ") === before6.replace(/\s+/g, " "), "途中で失敗しても、採点履歴の得点・状態・採点方式は変わらない");
await page.goto(BASE + "/history/" + ids.s6); await settle(1000);
await page.getByRole("button", { name: /^AI採点の記録/ }).click(); await settle(1000);
ok((await text()).includes("失敗（成績は変更なし）"), "失敗した採点も記録に残る");
await page.getByLabel("採点方式").selectOption("opus");

// 11d. 模範解答・配点表からテストを自動作成（AI は代役。今回のテスト 20問・100点・5・5・1・3・1・3・2 を返す）
{
  const p = await browser.newPage({ viewport: { width: 700, height: 990 } });
  await p.setContent(`<body style="margin:0;background:#fff;font:22px serif;padding:30px">第1回 高校入試模擬テスト 解答（100点満点）<br>1.(1) -1 4点 (2) -4a+6b-12 4点 …<br>3. 右図</body>`);
  await p.screenshot({ path: `${OUT}key1.png` });
  await p.close();
}
const importReqs = async () => (await (await fetch(MOCK + "/__requests")).json()).filter((r) => r.kind === "import");
await page.goto(BASE + "/tests"); await settle();
const testsBefore = await page.locator("text=設問と配点を見る").count();
await page.getByRole("button", { name: "＋ テストを追加" }).click();
await page.getByRole("button", { name: "模範解答・配点表から自動入力" }).click();
await page.locator("#import-key").setInputFiles([`${OUT}key1.png`, heic]);
await page.getByText("資料2").first().waitFor({ timeout: 30000 });
await page.locator("#import-extra").setInputFiles([img(1)]);
await page.getByLabel("資料3の種類").selectOption("student");
ok((await text()).includes("手書きの答えは使いません"), "自動入力：生徒の答案は印刷された配点だけを読むと案内");

// 下書き：画面を移動しても、選んだ資料と入力が残る
await settle(1200);
await page.getByRole("button", { name: "閉じる（下書きは残ります）" }).click();
await page.goto(BASE + "/"); await settle();
await page.goto(BASE + "/tests"); await settle();
await page.getByRole("button", { name: "＋ テストを追加" }).click();
await page.getByText(/下書きを復元しました/).waitFor({ timeout: 10000 });
ok((await page.getByLabel("資料3の種類").inputValue()) === "student", "下書きから資料（3件・種類つき）を復元");

// 連打しても AI の読み取りは1回だけ
let iMark = (await importReqs()).length;
await script({ import: ["slow"] });
const readBtn = page.getByRole("button", { name: "AIで読み取って入力する" });
await readBtn.click();
await page.getByRole("button", { name: /資料を保存しています|AIが読み取っています/ }).click({ force: true, timeout: 5000 }).catch(() => {});
await toastSeen(/20 問を読み取りました/);
let ireqs = (await importReqs()).slice(iMark);
ok(ireqs.length === 1, `連打しても読み取りは1回（${ireqs.length}回）`);
ok(ireqs[0].problems.length === 0 && ireqs[0].images === 3 && ireqs[0].sources.join("|").includes("資料3：生徒の答案"),
  `読み取りの要求：資料3件と種類を送る ${JSON.stringify(ireqs[0].problems)}`);

const itext = await text();
ok(itext.includes("大問1=5・大問2=5・大問3=1・大問4=3・大問5=1・大問6=3・大問7=2"), "大問と小問を原本どおり（5・5・1・3・1・3・2）に入力");
ok(itext.includes("設問 20 問") && itext.includes("合計 95 点") && itext.includes("原本の満点 100 点"), "設問数・合計点・原本の満点を表示");
ok(itext.includes("原本の満点 100 点と一致しません"), "合計点と原本の満点の不一致を知らせる");
ok(itext.includes("要確認 4 問（未確認 4）"), "読めない配点・正答、生徒の答案からの正答、作図を要確認にする");
ok((await page.getByLabel("大問2-(5) の配点").inputValue()) === "", "読めない配点は空欄のまま（推測で確定しない）");
ok((await page.getByLabel("大問4-(1) の正答").inputValue()) === "", "生徒の答案の手書きは正答に取り込まない");
ok((await page.getByLabel("大問3 の解説").inputValue()).includes("採点条件"), "作図は採点条件として登録する（「右図」だけにしない）");
await page.getByRole("button", { name: "資料1 の 1 ページ目を表示" }).click(); await settle(400);
ok(await page.locator('[aria-label="該当箇所"]').count() === 1 && await page.locator('img[alt^="元の資料"]').count() === 1, "元画像と入力結果を見比べられる（模範図の位置を枠で表示）");

// 同じ資料をもう一度読み取っても、AI は呼ばずに前の結果を使う（上書きは確認する）
iMark = (await importReqs()).length;
page.once("dialog", (d) => d.accept());
await readBtn.click();
await toastSeen(/同じ資料の読み取り結果を使いました/);
ok((await importReqs()).length === iMark, "同じ資料の再読み取りは AI を呼ばない（上書き前に確認）");

// 確認・修正して登録
await page.getByRole("button", { name: "登録する" }).click();
ok((await text()).includes("大問2-(5) の配点を入力してください"), "配点が空欄のままでは登録できない");
await page.getByLabel("大問2-(5) の配点").fill("5");
await page.getByLabel("大問4-(1) の正答").fill("240円");
await page.getByLabel("大問6-(3) の正答").fill("3√5");
await page.getByRole("button", { name: "登録する" }).click();
ok((await text()).includes("要確認の設問が 4 問あります"), "要確認を確認しないと登録できない");
for (const l of ["大問2-(5)", "大問3", "大問4-(1)", "大問6-(3)"]) await page.getByLabel(`${l} を確認した`).check();
ok((await text()).includes("合計 100 点") && !(await text()).includes("一致しません"), "配点を入力すると合計 100 点で原本と一致");
await page.getByRole("button", { name: "登録する" }).click();
await toastSeen(/（20 問・100 点）/);
await settle(800);
ok((await page.locator("text=設問と配点を見る").count()) === testsBefore + 1, "テストを1件追加（既存のテストはそのまま）");
// 登録したテストのカード（そのテスト名と「設問と配点を見る」を1つだけ含む枠）のボタン
await page.locator(`xpath=//*[contains(., '数学／第1回 高校入試模擬テスト') and count(.//button[normalize-space()='設問と配点を見る'])=1]//button[normalize-space()='設問と配点を見る']`)
  .first().click(); await settle(600);
const dtext = await text();
ok(["大問1-(5)", "大問2-(5)", "大問3", "大問4-(3)", "大問5", "大問6-(3)", "大問7-(2)"].every((l) => dtext.includes(l)) && dtext.includes("満点"),
  "登録した設問名が原本どおり（大問1-(5)・大問3・大問7-(2) など）");
ok(await page.getByRole("button", { name: "資料1" }).count() >= 1 && await page.getByRole("button", { name: "資料3" }).count() === 0,
  "模範解答（2件）は保存し、生徒の答案は残さない");
await page.getByRole("button", { name: "模範図を見る" }).click();
await page.locator('img[alt$="模範図"]').waitFor({ timeout: 15000 });
ok(await page.locator('[aria-label="模範図の位置"]').count() === 1, "作図の模範図を、登録後も参照できる");
await page.goto(BASE + "/tests"); await settle();
ok((await text()).includes("E2E 小テスト"), "既存のテストは変わらない");
await page.getByRole("button", { name: "＋ テストを追加" }).click(); await settle(800);
ok(!(await text()).includes("下書きを復元しました"), "登録したら下書きを消す");
await page.getByRole("button", { name: "閉じる（下書きは残ります）" }).click();

// 11e. 「テストを追加」の画面：画像と設問欄が重ならない・画像の表示切替・資料の削除・下書きの復元
//      （以前の形式の下書き＝資料4件・20問・100点・要確認3問を入れておき、AI を呼ばずに再開できること）
const fixture = JSON.parse(await fs.readFile(new URL("../fixtures/import-raw.json", import.meta.url), "utf8"));
const legacyDraft = {
  v: 1, savedAt: new Date().toISOString(),
  name: "第1回 高校入試模擬テスト（下書き）", subject: "数学", grade: "3", term: "2学期", date: "", testNo: "", unitsText: "",
  rows: fixture.questions.map((q, i) => {
    const flagged = ["3|", "4|(1)", "6|(3)"].includes(`${q.big}|${q.sub}`);
    return {
      key: i + 1, big: q.big, sub: q.sub, type: q.type, unit: "", difficulty: "標準",
      points: q.points, correct: q.type === "graph" ? "" : q.correct, model: q.type === "graph" ? `採点条件：${q.criteria}` : q.explanation,
      flags: flagged ? ["確認してください（下書きのテスト）"] : [], confirmed: !flagged,
      answerBox: q.answer_box.w ? q.answer_box : null, figure: q.figure_box.w ? q.figure_box : null,
    };
  }),
  imported: { importId: "00000000-0000-0000-0000-000000000000", maxScore: 100, warnings: [], requestId: "00000000-0000-0000-0000-000000000001" },
};
const draftFiles = [
  { name: "模範解答1.png", kind: "key", file: `${OUT}key1.png` },
  { name: "模範解答2.png", kind: "key", file: img(2) },
  { name: "配点表.png", kind: "paper", file: img(3) },
  { name: "生徒答案.png", kind: "student", file: img(1) },
];
const seedDraft = async (p) => {
  const files = await Promise.all(draftFiles.map(async (f) => ({ ...f, b64: (await fs.readFile(f.file)).toString("base64") })));
  await p.evaluate(async ({ draft, files }) => {
    draft.sources = files.map((f, i) => ({
      id: `src${i + 1}`, name: f.name, kind: f.kind, type: "image/png",
      blob: new Blob([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], { type: "image/png" }),
    }));
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("saiten-drafts", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("drafts");
      req.onsuccess = () => {
        const tx = req.result.transaction("drafts", "readwrite");
        tx.objectStore("drafts").put(draft, "new-test");
        tx.oncomplete = () => { req.result.close(); resolve(null); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, { draft: legacyDraft, files });
};
const boxesApart = async (p) => {
  const v = await p.locator("[data-testid=source-viewer]").boundingBox();
  const e = await p.locator("[data-testid=question-editor]").boundingBox();
  if (!v || !e) return false;
  return v.x + v.width <= e.x + 1 || e.x + e.width <= v.x + 1 || v.y + v.height <= e.y + 1 || e.y + e.height <= v.y + 1;
};
// その場所に見えているのが目的の要素か（ほかの要素に覆われていないか）
const visibleOnTop = async (loc) => {
  await loc.scrollIntoViewIfNeeded();
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  });
};
const viewports = [
  { label: "PC（通常表示）", opts: { viewport: { width: 1280, height: 800 } } },
  { label: "PC（縮小表示）", opts: { viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 0.67 } },
  { label: "スマホ", opts: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
];
const importBefore = (await importReqs()).length;
for (const vp of viewports) {
  const c = await browser.newContext(vp.opts);
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE + "/login");
  await p.getByLabel("メールアドレス").fill("admin@a.example");
  await p.getByLabel("パスワード").fill("pass-A-123");
  await p.getByRole("button", { name: "ログイン" }).click();
  await p.waitForURL(BASE + "/");
  await p.goto(BASE + "/tests"); await p.waitForTimeout(800);
  await seedDraft(p);
  await p.getByRole("button", { name: "＋ テストを追加" }).click();
  await p.getByText(/下書きを復元しました/).waitFor({ timeout: 10000 });
  await p.waitForTimeout(600);
  const t0 = await p.locator("body").innerText();
  ok(t0.includes("設問 20 問") && t0.includes("合計 100 点") && t0.includes("未確認 3") && (await p.getByRole("button", { name: /\.png」を削除$/ }).count()) === 4,
    `${vp.label}：以前の下書き（資料4件・20問・100点・要確認3問）を復元`);
  ok(await p.locator("[data-testid=source-viewer]").isVisible() && await boxesApart(p), `${vp.label}：資料画像と設問欄が重ならない`);
  await p.getByRole("button", { name: "資料1 の 1 ページ目を表示" }).click(); await p.waitForTimeout(300);
  ok(await boxesApart(p) && await visibleOnTop(p.getByLabel("大問2-(5) の配点")) && await visibleOnTop(p.getByLabel("大問6-(3) を確認した")),
    `${vp.label}：画像を表示したまま、配点と確認欄が隠れずに見える`);
  // 一番下までスクロールしても重ならない
  await p.getByLabel("大問7-(2) の配点").scrollIntoViewIfNeeded();
  ok(await boxesApart(p) && await visibleOnTop(p.getByLabel("大問7-(2) の配点")), `${vp.label}：下までスクロールしても重ならない`);
  // 画像を隠す → 設問欄が横幅いっぱい／もう一度表示 → 入力・確認状態はそのまま
  await p.getByLabel("大問6-(3) を確認した").check();
  const before = await p.getByLabel("大問4-(2) の正答").inputValue();
  await p.getByRole("button", { name: /画像を隠す/ }).click(); await p.waitForTimeout(300);
  const body = await p.locator("[data-testid=question-editor]").evaluate((el) => [el.getBoundingClientRect().width, el.parentElement.getBoundingClientRect().width]);
  ok(await p.locator("[data-testid=source-viewer]").count() === 0 && body[0] >= body[1] - 2, `${vp.label}：画像を隠すと設問欄が横幅いっぱい`);
  await p.getByRole("button", { name: /画像を表示/ }).click(); await p.waitForTimeout(300);
  ok(await p.locator("[data-testid=source-viewer]").isVisible() && await p.getByLabel("大問6-(3) を確認した").isChecked()
    && (await p.getByLabel("大問4-(2) の正答").inputValue()) === before && (await p.locator("body").innerText()).includes("設問 20 問"),
    `${vp.label}：表示を切り替えても資料・入力・確認状態が残る`);
  ok(errs.length === 0, `${vp.label}：画面のエラーなし ${errs.join(" / ")}`);
  if (vp.label !== "PC（通常表示）") { await c.close(); continue; }

  // 資料の削除：ファイル名を示して確認。やめれば消えない
  let msg = "";
  p.once("dialog", (d) => { msg = d.message(); d.dismiss(); });
  await p.getByRole("button", { name: "「生徒答案.png」を削除" }).click(); await p.waitForTimeout(300);
  ok(msg.includes("「生徒答案.png」") && (await p.getByRole("button", { name: /\.png」を削除$/ }).count()) === 4, "資料の削除：ファイル名を示して確認し、やめれば消えない");
  p.once("dialog", (d) => d.accept());
  await p.getByRole("button", { name: "「生徒答案.png」を削除" }).click(); await p.waitForTimeout(400);
  ok((await p.getByRole("button", { name: /\.png」を削除$/ }).count()) === 3 && (await p.locator("body").innerText()).includes("設問 20 問"),
    "資料を削除しても、入力済みの設問は消えない");
  // 作図の模範図の参照元を削除するときは影響を示し、参照切れの設問を要確認に戻す
  p.once("dialog", (d) => { msg = d.message(); d.accept(); });
  await p.getByRole("button", { name: "「模範解答1.png」を削除" }).click(); await p.waitForTimeout(400);
  const t1 = await p.locator("body").innerText();
  ok(msg.includes("大問3 の模範図の参照元") && msg.includes("入力済みの設問は削除しません"), "使用中の資料の削除は、影響（模範図の参照元）を示して確認");
  ok(t1.includes("設問 20 問") && t1.includes("模範図の参照元の資料「模範解答1.png」を削除しました") && t1.includes("未設定（元画像で模範図の場所を確認")
    && !(await p.getByLabel("大問3 を確認した").isChecked()), "参照元を削除した作図の設問は、参照を外して要確認に戻す");
  // 再読み込みしても、削除後の下書きが残る
  await p.waitForTimeout(900);
  await p.reload(); await p.waitForTimeout(800);
  await p.getByRole("button", { name: "＋ テストを追加" }).click();
  await p.getByText(/下書きを復元しました/).waitFor({ timeout: 10000 });
  ok((await p.getByRole("button", { name: /\.png」を削除$/ }).count()) === 2 && (await p.locator("body").innerText()).includes("設問 20 問"), "削除後の内容も下書きに残る");
  await c.close();
}
ok((await importReqs()).length === importBefore, "下書きの再開・表示切替・資料の削除では AI を呼ばない");
// この確認用の下書きを片付ける
await page.goto(BASE + "/tests"); await settle();
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("saiten-drafts"); q.onsuccess = q.onerror = () => r(null); }));

// 11g. 下書きを別の URL へ移す（URL ごとに下書きが分かれるため）。どの方法でも AI は呼ばない
const moveBefore = (await importReqs()).length;
const freshPage = async () => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const p = await c.newPage();
  await p.goto(BASE + "/login");
  await p.getByLabel("メールアドレス").fill("admin@a.example");
  await p.getByLabel("パスワード").fill("pass-A-123");
  await p.getByRole("button", { name: "ログイン" }).click();
  await p.waitForURL(BASE + "/");
  await p.goto(BASE + "/tests"); await p.waitForTimeout(800);
  return { c, p };
};
const summaryOk = async (p) => {
  const t = await p.locator("body").innerText();
  return t.includes("設問 20 問") && t.includes("合計 100 点") && t.includes("未確認 3") && (await p.getByRole("button", { name: /\.png」を削除$/ }).count()) === 4;
};
// (1) 書き出しボタンが無い以前の版：開発者ツールに docs/draft-export-snippet.js を貼って書き出す（旧形式 v1 の下書き）
const oldSite = await freshPage();
await seedDraft(oldSite.p);
const snippet = await fs.readFile(new URL("../../docs/draft-export-snippet.js", import.meta.url), "utf8");
let alertMsg = "";
oldSite.p.once("dialog", (d) => { alertMsg = d.message(); d.accept(); });
const [dlOld] = await Promise.all([oldSite.p.waitForEvent("download"), oldSite.p.evaluate(snippet)]);
const oldFile = `${OUT}draft-old.json`;
await dlOld.saveAs(oldFile);   // 画面を閉じるとダウンロードが消えるので保存しておく
ok(alertMsg.includes("資料 4 件・設問 20 問") && JSON.parse(await fs.readFile(oldFile, "utf8")).files.length === 4,
  "以前の版の画面から、コンソールのコードで下書き（資料4件・20問）を書き出せる");
await oldSite.c.close();
// (2) 新しい URL（下書きが空のブラウザ）で読み込む
const newSite = await freshPage();
await newSite.p.getByRole("button", { name: "＋ テストを追加" }).click(); await newSite.p.waitForTimeout(500);
ok(!(await newSite.p.locator("body").innerText()).includes("下書きを復元しました"), "新しい URL では、もとの下書きは見えない（URL ごとに別）");
await newSite.p.getByLabel("下書きを読み込む").setInputFiles(oldFile);
await newSite.p.getByText(/ファイルから下書きを読み込みました（資料 4 件・設問 20 問/).waitFor({ timeout: 10000 });
ok(await summaryOk(newSite.p), "読み込んだ下書き：資料4件・20問・合計100点・要確認3問（未確認3）");
await newSite.p.getByRole("button", { name: "資料1 の 1 ページ目を表示" }).click(); await newSite.p.waitForTimeout(300);
ok(await newSite.p.locator('[aria-label="該当箇所"]').count() === 1 && await newSite.p.locator('img[alt^="元の資料"]').count() === 1,
  "読み込んだ下書きでも、元画像と模範図の位置を表示できる");
await newSite.p.waitForTimeout(900);
await newSite.p.reload(); await newSite.p.waitForTimeout(800);
await newSite.p.getByRole("button", { name: "＋ テストを追加" }).click();
await newSite.p.getByText(/下書きを復元しました/).waitFor({ timeout: 10000 });
ok(await summaryOk(newSite.p), "読み込んだ下書きは、新しい URL の端末にも保存される");
// (3) 新しい版どうし：「下書きを書き出す」→ 別の端末で「下書きを読み込む」
const [dlNew] = await Promise.all([newSite.p.waitForEvent("download"), newSite.p.getByRole("button", { name: "下書きを書き出す（ファイル）" }).click()]);
const newFile = `${OUT}draft-new.json`;
await dlNew.saveAs(newFile);
await newSite.c.close();
const third = await freshPage();
await third.p.getByRole("button", { name: "＋ テストを追加" }).click(); await third.p.waitForTimeout(500);
await third.p.getByLabel("下書きを読み込む").setInputFiles(newFile);
await third.p.getByText(/ファイルから下書きを読み込みました/).waitFor({ timeout: 10000 });
ok(await summaryOk(third.p), "「下書きを書き出す／読み込む」で別の端末へ移せる（資料・設問・確認状態）");
// (4) 予備：サーバーに残っている未登録の読み取り結果から再開（読み取り後に手で直した内容は含まない）
third.p.once("dialog", (d) => d.accept());
await third.p.getByRole("button", { name: "下書きを破棄" }).click(); await third.p.waitForTimeout(400);
await third.p.getByRole("button", { name: "模範解答・配点表から自動入力" }).click();
await third.p.locator("#import-key").setInputFiles([img(5)]);
await third.p.getByText("資料1").first().waitFor();
await third.p.getByRole("button", { name: "AIで読み取って入力する" }).click();
await third.p.getByText(/20 問を読み取りました/).waitFor({ timeout: 30000 });
await third.c.close();
const resume = await freshPage();
await resume.p.getByRole("button", { name: "＋ テストを追加" }).click(); await resume.p.waitForTimeout(500);
await resume.p.getByRole("button", { name: "以前のAI読み取り結果から再開" }).click();
await resume.p.getByText(/資料 1 件・設問 20 問/).waitFor({ timeout: 10000 });
await resume.p.getByRole("button", { name: "この結果で再開" }).first().click();
await resume.p.getByText(/以前のAI読み取り結果から再開しました/).waitFor({ timeout: 15000 });
const rt = await resume.p.locator("body").innerText();
ok(rt.includes("設問 20 問") && rt.includes("大問1=5・大問2=5・大問3=1・大問4=3・大問5=1・大問6=3・大問7=2") && (await resume.p.getByRole("button", { name: /」を削除$/ }).count()) >= 1,
  "予備：未登録の読み取り結果（資料と設問）から再開できる");
await resume.c.close();
ok((await importReqs()).length === moveBefore + 1, `下書きの移動・再開では AI を呼ばない（呼んだのは (4) の準備の1回だけ：${(await importReqs()).length - moveBefore}回）`);

// 11f. 不要なテストの削除（答案が無いテストは削除、答案・成績があるテストはアーカイブ）
await page.goto(BASE + "/tests"); await settle();
await page.getByRole("button", { name: "＋ テストを追加" }).click(); await settle(600);
await page.getByPlaceholder("例：1学期期末テスト").fill("誤登録テスト");
await page.getByRole("button", { name: "登録する" }).click();
await toastSeen(/「誤登録テスト」を登録しました/);
await settle(800);
await page.getByRole("button", { name: "「数学／誤登録テスト」を削除" }).click();
await page.getByText("関連する答案：0 枚").waitFor({ timeout: 10000 });
const dmsg = await page.locator('[aria-label="削除するテスト"]').innerText();
ok(dmsg.includes("誤登録テスト") && dmsg.includes("1 問（満点 4 点）") && dmsg.includes("元に戻せません"), "削除前にテスト名・設問数・関連答案数を表示");
await page.getByRole("button", { name: "削除する" }).click();
await toastSeen(/「数学／誤登録テスト」を削除しました/);
ok((await page.getByRole("button", { name: "「数学／誤登録テスト」を削除" }).count()) === 0, "答案の無いテストは削除できる");
await page.goto(BASE + "/history"); await settle(1000);
const histBeforeArchive = await page.locator("tbody tr").count();
await page.goto(BASE + "/tests"); await settle();
await page.getByRole("button", { name: "「数学／E2E 小テスト」を削除" }).click();
await page.getByText(/関連する答案：\d+ 枚/).waitFor({ timeout: 10000 });
const amsg = await page.locator('[aria-label="削除するテスト"]').innerText();
ok(/関連する答案：[1-9]\d* 枚/.test(amsg) && amsg.includes("アーカイブします"), "答案があるテストは、削除せずアーカイブすると案内");
await page.getByRole("button", { name: "アーカイブする（答案・成績は残す）" }).click();
await toastSeen(/アーカイブしました（答案・成績は残しています）/);
await settle(600);
ok((await text()).includes("アーカイブしたテスト（1件）"), "アーカイブしたテストは一覧から外れ、別欄に出る");
await page.goto(BASE + "/history"); await settle(1000);
ok((await page.locator("tbody tr").count()) === histBeforeArchive, "アーカイブしても答案・成績は残る");
await page.goto(BASE + "/tests"); await settle();
await page.getByRole("button", { name: "元に戻す" }).click();
await toastSeen(/アーカイブから戻しました/);
ok((await page.getByRole("button", { name: "「数学／E2E 小テスト」を削除" }).count()) === 1, "アーカイブから元に戻せる");

// 12. レポート3種
await page.goto(BASE + "/reports"); await settle();
for (const [v, label] of [["student", "個人成績票"], ["unit", "単元別到達度レポート"], ["class", "成績レポート"]]) {
  await page.locator("select").filter({ has: page.locator('option:text("個人成績票（一括）")') }).selectOption(v); await settle(800);
  ok((await text()).includes(label), `レポート：${label}`);
}

// 13. ログアウト → 教員A：保存期間は変更できない
await page.getByRole("button", { name: "ログアウト" }).click();
await page.waitForURL(/\/login/);
await login("teacher@a.example", "pass-A-456");
await page.goto(BASE + "/settings"); await settle();
await page.locator("select").filter({ has: page.locator('option:text("30日で自動削除")') }).selectOption("30");
await toastSeen(/管理者だけです/);
ok(true, "教員は保存期間を変更できず、日本語で案内");
await page.goto(BASE + "/history"); await settle(1000);
ok((await page.locator("tbody tr").count()) === 9, "同じ学校の教員は9件見える");
ok(!(await page.locator("nav").innerText()).includes("モデル比較試験"), "教員のメニューにはモデル比較試験が出ない");
await page.goto(BASE + "/compare"); await settle(800);
ok((await text()).includes("管理者だけが使える画面です"), "教員がモデル比較試験を開いても使えない");
ok((await page.request.get(BASE + "/api/compare")).status() === 403, "教員は比較試験の API を呼べない（HTTP 403）");
await page.goto(BASE + "/tests"); await settle();
ok((await page.getByRole("button", { name: /を削除$/ }).count()) === 0, "教員の画面にはテストの削除ボタンが出ない");

// 14. 他校の教員には1件も見えない
await page.getByRole("button", { name: "ログアウト" }).click();
await page.waitForURL(/\/login/);
await login("teacher@b.example", "pass-B-123");
ok((await text()).includes("別の中学校"), "他校アカウントでログイン");
await page.goto(BASE + "/history"); await settle(1000);
ok((await text()).includes("まだ採点した答案がありません"), "他校の答案は見えない");
await page.goto(subUrl); await settle(2500);
ok((await text()).includes("答案が見つかりません"), "他校の答案URLを直接開いても表示されない");
await page.goto(BASE + "/tests"); await settle();
ok(!(await text()).includes("E2E 小テスト"), "他校のテストは見えない");
// 他校の教員は、学校Aのテストを削除・アーカイブできない（DB の関数を直接呼んでも断られる）
const restLogin = async (email, password) => (await (await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: process.env.ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password }),
})).json()).access_token;
const restApi = (token, path, init = {}) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
  ...init, headers: { apikey: process.env.ANON, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
});
const tokA = await restLogin("admin@a.example", "pass-A-123");
const [testA] = await (await restApi(tokA, "tests?select=id,name&name=eq.E2E%20%E5%B0%8F%E3%83%86%E3%82%B9%E3%83%88")).json();
const tokB = await restLogin("teacher@b.example", "pass-B-123");
const rmB = await restApi(tokB, "rpc/remove_test", { method: "POST", body: JSON.stringify({ p_test_id: testA.id }) });
const delB = await restApi(tokB, `tests?id=eq.${testA.id}`, { method: "DELETE", headers: { prefer: "return=representation" } });
const stillA = await (await restApi(tokA, `tests?select=id,archived_at&id=eq.${testA.id}`)).json();
ok(rmB.status >= 400 && (await delB.json()).length === 0 && stillA.length === 1 && stillA[0].archived_at === null,
  `他校の教員は学校Aのテストを削除・アーカイブできない（HTTP ${rmB.status}）`);
const markB = (await allReqs()).length;
const crossGrade = await page.request.post(BASE + "/api/grade", { data: { submissionId: ids.s3, mode: "cascade", requestId: randomUUID() } });
ok(crossGrade.status() === 404 && (await allReqs()).length === markB, `他校の答案は AI採点できず、モデルも呼ばない（HTTP ${crossGrade.status()}）`);

// 想定どおりのエラーは除く：誤ったパスワードのログイン（手順0）の 400、
// 採点AIが混み合っている場合の確認（手順6b）の 429、比較試験の二重実行を断った 409（手順11b）
const unexpected = errors.filter((e) =>
  !/\/login Failed to load resource: .* 400/.test(e)
  && !/\/history\/[0-9a-f-]+ Failed to load resource: .* 429/.test(e)
  && !/\/compare Failed to load resource: .* 409/.test(e));
await browser.close();
if (unexpected.length) {
  console.log("\n✗ コンソールにエラー・警告があります:");
  unexpected.forEach((e) => console.log("  ", e));
  process.exit(1);
}
console.log("\nOK: シナリオがすべて通りました（コンソールエラーなし）");
