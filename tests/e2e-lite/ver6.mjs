// ver6 の画面テスト（tests/e2e-lite/run.sh から、billing.mjs の後に呼ぶ）。本物の AI・Supabase のクラウドには接続しない。
//   採点AI は代役（tests/e2e/mock-anthropic.mjs。答案の写真に埋め込んだ印で受験番号・テスト名を「読む」）。
//   確かめること：
//     ①②⑨ おまかせモード：答案を入れるだけで、振り分け（クラス・生徒・テスト）→ 自動確認 → 自動開始 → 並列のAI採点
//     ④ 生徒のスマホから提出（QRのリンク・出席番号・撮影・提出）→ 先生の画面に届き、そのまま AI採点。上書きの拒否
//     ③ 模範解答がないときの作成：下書きと独立検算 → 一致した設問は確認を省く・食い違いは判定に回す
//     ⑦ AIエンジン：新しいモデルの案内とワンタップの切り替え
//     12 ヘッダー右上の 🌐 で言語を切り替え（RTL を含む）
//     11 便利機能：すばやく移動（Ctrl+K）・統計と校務用CSV（未提出つき）・同じ解答のまとめ判定・キー操作・テストの複製・コメントの定型文・今月のAI採点
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import zlib from "node:zlib";

const BASE = process.env.V6_URL, MOCK = process.env.MOCK_URL, PG = process.env.PG_URL, GW = process.env.GATEWAY_URL, SERVICE = process.env.SERVICE_JWT;
const ok = (cond, msg) => { if (!cond) { console.log("✗ FAIL:", msg); throw new Error(msg); } console.log("✓", msg); };
const sql = (q) => execFileSync("psql", [PG, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const SCHOOL = "eeeeeeee-0000-0000-0000-000000000000";
const CLASS = "eeeeeeee-0000-0000-0000-000000000061";
const TEST = "eeeeeeee-0000-0000-0000-000000000081";
const TITLE = "ver6確認テスト";
const mockReq = async () => (await fetch(`${MOCK}/__requests`)).json();

// ---------------------------------------------------------------- 初期データ（架空。実名は持たない）
sql(`insert into public.classes(id, school_id, grade, name, school_year) values ('${CLASS}', '${SCHOOL}', 2, 'ver6', 2026);
insert into public.students(id, school_id, class_id, number, exam_no, anon_id) values
 ('eeeeeeee-0000-0000-0000-000000000071', '${SCHOOL}', '${CLASS}', 1, 'V601', '生徒V1'),
 ('eeeeeeee-0000-0000-0000-000000000072', '${SCHOOL}', '${CLASS}', 2, 'V602', '生徒V2'),
 ('eeeeeeee-0000-0000-0000-000000000073', '${SCHOOL}', '${CLASS}', 3, 'V603', '生徒V3'),
 ('eeeeeeee-0000-0000-0000-000000000074', '${SCHOOL}', '${CLASS}', 4, 'V604', '生徒V4'),
 ('eeeeeeee-0000-0000-0000-000000000075', '${SCHOOL}', '${CLASS}', 5, 'V605', '生徒V5');
insert into public.tests(id, school_id, name, subject, grade, max_score) values ('${TEST}', '${SCHOOL}', '${TITLE}', '数学', 2, 10);
insert into public.questions(id, school_id, test_id, no, label, qtype, unit, points, correct, model_answer) values
 ('eeeeeeee-0000-0000-0000-000000000091', '${SCHOOL}', '${TEST}', 1, '大問1-(1)', 'calc', '計算', 5, '12', '3×4=12'),
 ('eeeeeeee-0000-0000-0000-000000000092', '${SCHOOL}', '${TEST}', 2, '大問1-(2)', 'calc', '方程式', 5, 'x=3', '両辺を2でわる');`);

// 答案の写真の代わり（PNG）。tEXt に「EXAM:受験番号|TITLEHEX:テスト名」を入れる（採点AIの代役が読む）
function answerPng(examNo, shade = 0) {
  const w = 600, h = 800;
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (x * 5 + y * 3 + shade) % 256;
  const text = Buffer.from(`Comment\0EXAM:${examNo}|TITLEHEX:${Buffer.from(TITLE, "utf8").toString("hex")}`, "latin1");
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("tEXt", text), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const errors = [];
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));
const api = (path, body) => page.evaluate(async ([p, b]) => {
  const r = await fetch(p, b === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [path, body]);
const text = () => page.evaluate(() => document.body.innerText);
// V6_SHOT_DIR を指定すると、主な画面の写真を撮る（docs/screenshots/ver6/ の更新用）
const shot = async (name, p = page) => { if (process.env.V6_SHOT_DIR) await p.screenshot({ path: `${process.env.V6_SHOT_DIR}/${name}.png`, fullPage: false }); };
const consent = async () => { const b = page.getByRole("button", { name: "同意して AI に送る" }); if (await b.isVisible().catch(() => false)) await b.click(); };

await page.goto(BASE + "/login");
await page.getByLabel("メールアドレス").fill("admin@lite.example");
await page.getByLabel("パスワード").fill("pass-lite-123");
await page.getByRole("button", { name: "ログイン" }).click();
await page.waitForURL(BASE + "/");

// ================================================================ ①②⑨ おまかせモード
await page.goto(BASE + "/new");
await page.getByText("おまかせモード").first().waitFor();
ok(await page.getByLabel(/おまかせモード/).isChecked().catch(() => true), "おまかせモードは既定でオン");
const t0 = Date.now();
await page.locator('input[type="file"]').first().setInputFiles(["V601", "V602", "V603"].map((no, i) => ({ name: `answer_${no}.png`, mimeType: "image/png", buffer: answerPng(no, i) })));
await page.getByText("AI に送る内容の確認").waitFor({ timeout: 20000 });
await consent();
await page.getByText(/自動確認：3 人分の生徒の割り当て・ページ順に問題はありません/).waitFor({ timeout: 30000 });
let body = await text();
ok(body.includes(`答案に印刷されたテスト名から「${TITLE}」を選びました`), "答案に印刷されたテスト名から、テストを自動で選ぶ");
ok(body.includes("2年ver6組"), "受験番号から、クラスを自動で選ぶ（2年ver6組）");
ok(body.includes("受験番号で照合"), "生徒は受験番号で照合して割り当てる（取り込み順ではない）");
const intakes = (await mockReq()).filter((r) => r.kind === "intake");
ok(intakes.length === 3 && intakes.every((r) => r.model === "claude-haiku-5-5" && !r.problems.length), "自動振り分けは高速AI（Haiku 5.5）で3枚を読み取る");
ok(await page.getByLabel("生徒・ページ順・不足や見切れがないことを確認しました").isChecked(), "問題がないので、確認のチェックを自動で付けた");
ok(await page.getByLabel("今回の答案と、テスト名・設問・正答・配点が一致しています").isChecked(), "テスト名が一致したので、正答・配点の確認も自動で付けた");
await page.getByText(/秒後に採点を始めます/).waitFor({ timeout: 10000 });
await page.getByText("おまかせモード").first().scrollIntoViewIfNeeded();
await shot("01-omakase-ready");
ok(true, "準備がそろうと、数秒後に自動で採点を始める（取り消せる）");
await page.getByText("採点が完了しました").waitFor({ timeout: 90000 });
await shot("02-graded-in-parallel");
const elapsed = (Date.now() - t0) / 1000;
const grades = (await mockReq()).filter((r) => r.kind === "grade");
ok(grades.length === 3 && grades.every((g) => g.model === "claude-haiku-5-5" && g.problems.length === 0), `3人分を高速AIで採点（形の検査OK：effort low・設問と採点基準をキャッシュに載せる）`);
const stats = await (await fetch(`${MOCK}/__stats`)).json();
ok(stats.maxInFlight >= 2, `複数の答案を同時に採点した（同時に最大 ${stats.maxInFlight} 件。1件1.5秒の代役で全体 ${elapsed.toFixed(1)} 秒）`);
const graded = sql(`select count(*) || '/' || sum(total_score) from public.submissions where test_id = '${TEST}' and status = 'done'`);
ok(graded === "3/30", `3人とも採点済み・満点（${graded}）`);
body = await text();
ok(!body.includes("AI採点中 "), "終わるとヘッダーの「AI採点中」が消える");

// ================================================================ ④ 生徒のスマホから提出
await page.goto(BASE + "/processing");
await page.getByRole("button", { name: /生徒の端末から集める/ }).first().click();
await page.getByText("生徒のタブレット・スマホから答案を集める").waitFor();
const dialog = page.getByRole("dialog", { name: "生徒のタブレット・スマホから答案を集める" });
await dialog.locator("select").nth(0).selectOption({ label: `数学／${TITLE}` });
await dialog.locator("select").nth(1).selectOption({ value: CLASS });
await page.getByRole("button", { name: "提出リンクを作る" }).click();
await page.getByAltText("提出用のQRコード").waitFor();
await shot("03-teacher-qr-link");
const link = (await text()).match(/http:\/\/localhost:\d+\/submit\/[A-Za-z0-9_-]{24,}/)?.[0];
ok(!!link, "提出リンクとQRコードを表示");
ok(Number(sql(`select count(*) from public.submission_links where test_id = '${TEST}' and char_length(token) >= 32`)) === 1, "推測できない長さのトークンで保存");

const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
const phoneErrors = [];
phone.on("pageerror", (e) => phoneErrors.push(e.message));
await phone.goto(link);
await phone.getByText(TITLE).waitFor();
ok(!(await phone.evaluate(() => document.body.innerText)).match(/V60\d|生徒V/), "生徒の画面に受験番号・匿名IDを出さない（出席番号だけ）");
await phone.getByRole("button", { name: "4", exact: true }).click();
await phone.locator('input[type="file"][multiple]').setInputFiles({ name: "IMG_0004.png", mimeType: "image/png", buffer: answerPng("V604", 9) });
await phone.getByText("1ページ目").waitFor();
await shot("04-student-phone-submit", phone);
await phone.getByRole("button", { name: "③ 提出する" }).click();
await phone.getByText("提出しました").waitFor({ timeout: 20000 });
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "生徒の画面はスマホ幅で横にはみ出さない");
await page.getByText(/提出 1 \/ 5 人/).waitFor({ timeout: 15000 }).catch(async (e) => {
  console.log("--- 先生の画面", (await text()).slice(0, 1500));
  console.log("--- DB", sql(`select status, student_id from public.link_uploads`), sql(`select id, class_id from public.submission_links`));
  throw e;
});
ok(true, "先生の画面に、届いた答案が出席番号の一覧で出る（4秒ごとに確認）");
await page.getByText(/AI採点済み 1 人/).waitFor({ timeout: 30000 });
await shot("05-teacher-received-and-graded");
const mobileSub = sql(`select source || '/' || status || '/' || total_score || '/' || cardinality(image_paths) from public.submissions where test_id = '${TEST}' and student_id = 'eeeeeeee-0000-0000-0000-000000000074'`);
ok(mobileSub === "mobile/done/10/1", `届いた答案を、そのまま AI採点した（${mobileSub}）`);
// 先生が取り込んだ答案（1番）は、生徒が上書きできない
await phone.goto(link);
await phone.getByRole("button", { name: "1", exact: true }).click();
await phone.locator('input[type="file"][multiple]').setInputFiles({ name: "IMG_0001.png", mimeType: "image/png", buffer: answerPng("V601", 3) });
await phone.getByText("1ページ目").waitFor();
await phone.getByRole("button", { name: "③ 提出する" }).click();
await phone.getByText(/すでに先生が取り込んだか、採点が始まっています/).waitFor({ timeout: 15000 });
ok(sql(`select source || '/' || status from public.submissions where test_id = '${TEST}' and student_id = 'eeeeeeee-0000-0000-0000-000000000071'`) === "file/done", "先生が取り込んで採点した答案は、生徒が出し直しても上書きされない");
await phone.goto(BASE + "/submit/not-a-real-token-xxxxxxxxxxxxxxxxxxxx");
await phone.getByText(/期限切れか、取り消されています/).waitFor();
ok(true, "でたらめなリンクでは提出画面を出さない");
ok(phoneErrors.length === 0, "生徒の画面にエラーが無い");
await page.getByRole("button", { name: "受付を締め切る" }).click();
await page.getByText("受付は終了しました").waitFor();
ok(sql(`select count(*) from public.submission_links where test_id = '${TEST}' and revoked_at is not null`) === "1", "受付を締め切れる");
await page.keyboard.press("Escape");
await page.goto(BASE + "/");

// ================================================================ ③ 模範解答がないときの作成（下書き＋独立検算）
const importOnce = async (verifyMode) => {
  const rid = randomUUID();
  const path = `${SCHOOL}/imports/${rid}/1.png`;
  const up = await fetch(`${GW}/storage/v1/object/answer-sheets/${path}`, { method: "POST", headers: { authorization: `Bearer ${SERVICE}`, "content-type": "image/png" }, body: answerPng("PAPER", 1) });
  if (!up.ok) throw new Error("資料を置けませんでした");
  if (verifyMode) await fetch(`${MOCK}/__script`, { method: "POST", body: JSON.stringify({ verify: [verifyMode] }) });
  return api("/api/test-import", { requestId: rid, files: [{ path, kind: "paper", name: "問題用紙.png" }], generate: true, force: true });
};
let imp = await importOnce();
ok(imp.status === 200 && imp.json.result.questions.length === 20, "問題用紙だけから20問の模範解答案を作る");
const reqs = (await mockReq()).filter((r) => r.kind === "import" || r.kind === "verify");
ok(reqs.some((r) => r.kind === "import" && r.model === "claude-sonnet-5-5") && reqs.some((r) => r.kind === "verify" && r.model === "claude-opus-5-5"), "下書きは標準AI（Sonnet 5.5）、独立検算は最上位AI（Opus 5.5）");
const agreed = imp.json.result.questions.filter((q) => q.check?.status === "agree");
ok(agreed.length >= 10 && agreed.every((q) => !q.flags.some((f) => f.includes("AIが問題文から作成した"))), `2つのAIが一致した ${agreed.length} 問は、個別の確認を省ける`);
ok(imp.json.result.warnings.some((w) => w.includes("検算一致")), "結果に検算一致の件数を出す");
imp = await importOnce("differ");
const first = imp.json.result.questions[0];
ok(first.check?.status === "disagree" && first.flags.some((f) => f.includes("2つのAIの答えが違います")), "答えが食い違った設問は、要確認にして両方の答えを示す");
ok((await mockReq()).some((r) => r.kind === "adjudicate" && r.model === "claude-opus-5-5"), "食い違いは最上位AIの判定に回す");

// ================================================================ ⑦ AIエンジン
await page.goto(BASE + "/settings");
await page.getByText("新しいモデル：Claude Sonnet 6").waitFor({ timeout: 15000 });
await page.getByText("新しいモデル：Claude Sonnet 6").scrollIntoViewIfNeeded();
await shot("06-ai-engine");
body = await text();
ok(body.includes("Claude Haiku 5.5") && body.includes("Claude Sonnet 5.5") && body.includes("Claude Opus 5.5"), "設定画面に段階ごとのモデル（Haiku 5.5 / Sonnet 5.5 / Opus 5.5）を表示");
await page.getByRole("button", { name: "このモデルに切り替える" }).click();
await page.getByText("AIエンジンの設定を保存しました").waitFor();
ok(sql(`select model_standard from public.ai_settings where school_id = '${SCHOOL}'`) === "claude-sonnet-6", "ワンタップで新しいモデルに切り替え、学校の設定に保存");
await page.getByRole("button", { name: "おすすめに戻す" }).click();
await page.getByText("AIエンジンの設定を保存しました").first().waitFor();
ok(sql(`select coalesce(model_standard, 'null') from public.ai_settings where school_id = '${SCHOOL}'`) === "null", "「おすすめに戻す」で既定のモデルに戻る");
ok((await api("/api/ai/models", { standard: "gpt-5" })).status === 400, "一覧に無いモデルは保存できない");

// ================================================================ 12 ヘッダー右上の 🌐
const globe = page.getByRole("button", { name: /表示言語を切り替える/ });
const header = await page.locator("header").first().boundingBox();
const gb = await globe.boundingBox();
const others = await page.locator("header button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
ok(gb && header && Math.abs(Math.max(...others) - (gb.x + gb.width)) < 1 && gb.y < header.y + header.height, "🌐 はヘッダーのいちばん右（右上）にある");
await globe.click();
await shot("07-language-menu-top-right");
await page.getByPlaceholder(/言語を検索/).fill("english");
await page.getByRole("dialog", { name: "表示言語" }).getByRole("option", { name: /English/ }).first().click();
await page.locator("h1").filter({ hasText: "Settings" }).first().waitFor();
ok(true, "English を選ぶと画面の表示が英語になる");
await globe.click();
await page.getByPlaceholder(/言語を検索/).fill("arab");
await page.getByRole("dialog", { name: "表示言語" }).getByRole("option", { name: /العربية/ }).click();
ok(await page.evaluate(() => !!document.querySelector('[dir="rtl"]')), "アラビア語では右から左の表示になる");
await globe.click();
await page.getByPlaceholder(/言語を検索/).fill("日本語");
await page.getByRole("dialog", { name: "表示言語" }).getByRole("option", { name: /日本語/ }).click();
await page.locator("h1").filter({ hasText: "設定" }).first().waitFor();

// ================================================================ 11 便利機能
// すばやく移動
await page.keyboard.press("Control+k");
await page.getByPlaceholder(/画面・生徒/).fill("成績");
await shot("08-command-palette");
await page.keyboard.press("Enter");
await page.waitForURL(BASE + "/scores");
ok(true, "Ctrl+K で画面の名前を探して移動できる");
// 統計と校務用CSV
await page.getByText("テストの統計").waitFor();
await page.locator("select").first().selectOption({ value: CLASS });
await page.getByText(/未提出：5番/).waitFor();
await page.getByText("テストの統計").scrollIntoViewIfNeeded();
await shot("09-score-stats");
body = await text();
ok(body.includes("平均") && body.includes("中央値") && body.includes("標準偏差"), "テストの統計（平均・中央値・標準偏差）と未提出者を表示");
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /校務用CSV/ }).click()]);
const csv = readFileSync(await dl.path(), "utf8");
ok(csv.includes("出席番号") && csv.includes("偏差値") && csv.includes("大問1-(1)(5点)") && csv.split("\n").length === 6 && /未提出/.test(csv), "校務用CSV：名簿の全員（未提出を含む）・設問別の得点・偏差値");
// 同じ解答のまとめ判定 → キー操作
sql(`update public.submission_items set need_review = true, detected = '12' where qno = 1 and submission_id in (select id from public.submissions where test_id = '${TEST}' and source = 'file')`);
sql(`update public.submission_items set need_review = true, detected = 'x=3' where qno = 2 and submission_id in (select id from public.submissions where test_id = '${TEST}' and source = 'mobile')`);
await page.goto(BASE + "/review");
await page.getByText("同じ解答をまとめて確定").waitFor();
await shot("10-same-answer-bulk");
await page.getByRole("button", { name: "3件を ○ で確定" }).click();
await page.getByText("3 件をまとめて ○ で確定しました").waitFor();
ok(sql(`select count(*) from public.submission_items i join public.submissions s on s.id = i.submission_id where s.test_id = '${TEST}' and i.need_review`) === "1", "同じ解答の3人分を1回で確定");
await page.locator("body").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("1");
await page.getByText("要確認はゼロです").waitFor();
ok(sql(`select count(*) from public.submission_items i join public.submissions s on s.id = i.submission_id where s.test_id = '${TEST}' and i.need_review`) === "0", "キーボードの「1」で ○ に確定");
// テストの複製
await page.goto(BASE + "/tests");
await page.getByText(TITLE).first().waitFor();
const card = page.locator("section").filter({ hasText: TITLE }).first();
await card.getByRole("button", { name: "複製" }).click();
await page.getByText(`「${TITLE}（コピー）」を作りました`).waitFor();
ok(sql(`select count(*) from public.questions q join public.tests t on t.id = q.test_id where t.name = '${TITLE}（コピー）'`) === "2", "テストを設問ごと複製（答案・成績は写さない）");
// コメントの定型文
const subId = sql(`select id from public.submissions where test_id = '${TEST}' and student_id = 'eeeeeeee-0000-0000-0000-000000000072'`);
await page.goto(`${BASE}/history/${subId}`);
await page.getByRole("tab", { name: /設問別採点/ }).click();
await page.getByText("よくできました").first().click();
await page.getByRole("button", { name: "単位を忘れずに" }).first().click();
await shot("11-comment-templates");
await page.getByRole("button", { name: "保存", exact: true }).first().click();
await page.getByText("コメントを更新しました").waitFor();
ok(sql(`select count(*) from public.submission_items where submission_id = '${subId}' and comment = '単位を忘れずに'`) === "1", "赤ペンコメントを定型文からワンタップで入れる");
// 今月の AI採点
await page.goto(BASE + "/");
await page.getByText("今月の AI採点").waitFor();
await page.getByText("今月の AI採点").scrollIntoViewIfNeeded();
await shot("12-dashboard-ai-usage");
ok(/AI採点\s*\n?\s*[4-9]/.test(await text()) || (await text()).includes("AIの費用"), "ダッシュボードに今月の AI採点（件数・費用・時間）を表示");
// セキュリティ対策の表示（ダッシュボードの欄・よくある質問）
ok((await page.getByTestId("security-measures").innerText()).includes("二段階認証"), "ダッシュボードにセキュリティ対策を表示");
await page.getByText("不正アクセスへの対策はしていますか？").click();
ok((await text()).includes("学校ごとにデータを分け、他校からは見えないようにしています"), "よくある質問にセキュリティ対策の答え");

// ================================================================ ⑨ 100枚以上：120人分を一度に入れて、おまかせで採点する
const BIG = "eeeeeeee-0000-0000-0000-000000000062";
sql(`insert into public.classes(id, school_id, grade, name, school_year) values ('${BIG}', '${SCHOOL}', 3, '大規模', 2026);
insert into public.students(id, school_id, class_id, number, exam_no, anon_id)
  select gen_random_uuid(), '${SCHOOL}', '${BIG}', n, 'B' || lpad(n::text, 3, '0'), '生徒B' || n from generate_series(1, 120) n;`);
await page.goto(BASE + "/new");
await page.getByText("おまかせモード").first().waitFor();
const before = (await mockReq()).filter((r) => r.kind === "grade").length;
const tBig = Date.now();
await page.locator('input[type="file"]').first().setInputFiles(Array.from({ length: 120 }, (_, i) => {
  const no = `B${String(i + 1).padStart(3, "0")}`;
  return { name: `scan_${no}.png`, mimeType: "image/png", buffer: answerPng(no, 40 + i) };
}));
await page.getByText(/自動確認：120 人分の生徒の割り当て・ページ順に問題はありません/).waitFor({ timeout: 120000 });
await shot("13-120-sheets-auto-checked");
ok(true, "120枚を一度に取り込み、全員を受験番号で自動で振り分けた");
await page.getByText("採点が完了しました").waitFor({ timeout: 240000 }).catch(async (e) => { console.log("--- 画面", (await text()).slice(-1500)); throw e; });
const bigSec = (Date.now() - tBig) / 1000;
const bigGrades = (await mockReq()).filter((r) => r.kind === "grade").length - before;
const bigDone = sql(`select count(*) from public.submissions where class_id = '${BIG}' and status = 'done' and total_score = 10`);
const peak = (await (await fetch(`${MOCK}/__stats`)).json()).maxInFlight;
ok(bigGrades === 120 && bigDone === "120", `120人分をすべて採点（AI への要求 ${bigGrades} 件・採点済み ${bigDone} 人）`);
// 手元のテストのサーバーは HTTP/1.1 なので、ブラウザは同じ宛先に同時に6本までしか送れない（本番の Vercel は HTTP/2 で、この上限は無い）
ok(peak >= 6, `複数の答案を同時に採点（同時に最大 ${peak} 件。設定は8件、手元の HTTP/1.1 ではブラウザの上限6件）`);
ok(bigSec < 120, `120人分（1件1.5秒の代役）が ${bigSec.toFixed(0)} 秒で終わった（順番に採点すると 180 秒以上）`);

ok(errors.length === 0, `コンソールのエラーが無い${errors.length ? "：" + errors.join(" / ") : ""}`);
await browser.close();
console.log("OK: ver6 の画面テストがすべて通りました（採点AI は代役）");
