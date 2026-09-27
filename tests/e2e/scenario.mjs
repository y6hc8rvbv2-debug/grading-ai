// 教員の実際の作業の流れを、ローカル Supabase に対してブラウザで通すシナリオテスト。
// tests/e2e/run.sh から呼ぶ（Supabase 起動・初期データ投入・アプリのビルドを行ってから実行する）。
import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import { promises as fs } from "fs";

const BASE = process.env.BASE_URL || "http://localhost:3200";
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
  await page.locator("header h1").waitFor();
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

// 3. 画像だけ保存（AI採点待ち）
await page.goto(BASE + "/new"); await settle();
ok((await text()).includes("採点AIは接続の準備中です"), "本番では仮採点をしない旨を表示");
await page.locator('input[type=file]:not([capture])').setInputFiles([img(1), img(2)]);
await settle(400);
ok((await text()).includes("2 / 40 枚"), "2枚取り込み");
await page.getByRole("button", { name: "答案を保存する" }).click();
await toastSeen(/2 枚の答案を保存しました/);
ok((await text()).includes("AI採点待ち"), "保存結果に AI採点待ち が出る");

// 4. 仮採点で3〜9番を採点（動作確認用）
await page.getByRole("button", { name: "続けて取り込む" }).click(); await settle();
await page.locator('input[type=file]:not([capture])').setInputFiles([3, 4, 5, 6, 7, 8, 9].map(img));
await settle(400);
// 1,2番は保存済みなので、3〜9番へ割り当て直す
const selects = page.locator("section select, div select").filter({ has: page.locator('option:text("生徒を選ぶ")') });
const n = await selects.count();
for (let i = 0; i < n; i++) await selects.nth(i).selectOption({ label: `2年A組 ${i + 3}番` });
await page.getByLabel(/動作確認用の仮採点を使う/).check();
await page.getByRole("button", { name: "AI採点をはじめる" }).click();
await toastSeen(/7 枚の採点が完了しました/);
ok(!(await text()).includes("[エラー]"), "保存エラーなし");

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
const direct = await page.request.get(src.replace("/object/sign/", "/object/public/").split("?")[0]);
ok(direct.status() >= 400, `署名なしの直リンクは開けない（HTTP ${direct.status()}）`);

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
} else console.log("- 要確認は0件（仮採点の結果による）");

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

// 11. 設定：保存期間（管理者）・監査ログ
await page.goto(BASE + "/settings"); await settle();
await page.locator("select").filter({ has: page.locator('option:text("30日で自動削除")') }).selectOption("180");
await toastSeen(/保存期間を変更しました/);
await page.getByRole("button", { name: "改ざんがないか確認する" }).click();
await toastSeen(/連鎖を確認しました。改ざんはありません/);
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "監査ログを書き出す" }).click()]);
const csv = await fs.readFile(await dl.path(), "utf8");
ok(csv.includes("grading.edit") && csv.includes("submission.review") && csv.includes("test.create"), "監査ログCSVに採点修正・確認・テスト登録が記録");

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
ok((await page.locator("tbody tr").count()) === 7, "同じ学校の教員は7件見える");

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

// 誤ったパスワードでのログイン（手順0）が返す 400 は想定どおりなので除く
const unexpected = errors.filter((e) => !/\/login Failed to load resource: .* 400/.test(e));
await browser.close();
if (unexpected.length) {
  console.log("\n✗ コンソールにエラー・警告があります:");
  unexpected.forEach((e) => console.log("  ", e));
  process.exit(1);
}
console.log("\nOK: シナリオがすべて通りました（コンソールエラーなし）");
