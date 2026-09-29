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

// 3. 画像だけ保存（AI採点待ち）
await page.goto(BASE + "/new"); await settle(1200);
ok((await text()).includes("AI（Claude）が答案を読み取って採点します"), "採点AIが使えることを表示");
ok(!(await text()).includes("動作確認用の仮採点"), "採点AIがあるときは乱数の仮採点を選べない");
await page.locator('input[type=file]:not([capture])').setInputFiles([img(1), img(2)]);
await settle(600);
ok((await text()).includes("2 / 40 枚"), "2枚取り込み");
await page.getByLabel(/画像の保存だけ行い/).check();
await page.getByRole("button", { name: "答案を保存する" }).click();
await toastSeen(/2 枚の答案を保存しました/);
ok((await text()).includes("AI採点待ち"), "保存だけを選ぶと AI採点待ち になる");

// 4. 保存してAI採点（3〜9番）
await page.getByRole("button", { name: "続けて取り込む" }).click(); await settle();
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
const direct = await page.request.get(src.replace("/object/sign/", "/object/public/").split("?")[0]);
ok(direct.status() >= 400, `署名なしの直リンクは開けない（HTTP ${direct.status()}）`);

// 6b. 保存済みの答案を AI で採点する（失敗 → 元に戻る → もう一度で成功）
await fetch(MOCK + "/__mode", { method: "POST", body: JSON.stringify({ mode: "ratelimit" }) });
await page.getByRole("button", { name: "AIで採点する" }).click();
await toastSeen(/採点AIが混み合っています/);
await settle(800);
ok((await text()).includes("この答案はまだ採点されていません"), "AI採点に失敗したら、答案は採点待ちのまま（元の状態に戻る）");
await page.getByRole("button", { name: "AIで採点する" }).click();
await toastSeen(/AI採点が終わりました（\d+点）/);
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
ok(sent.every((r) => r.imageType === "image/png"), "答案画像を PNG として送っている");

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

// 11. 設定：保存期間（管理者）・監査ログ
await page.goto(BASE + "/settings"); await settle();
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
