// ストアに出すための要件の画面テスト（tests/e2e-lite/run.sh から、review-copy.mjs の後に呼ぶ）。
//   - ログインなしで読める公開ページ（起動画面・プライバシーポリシー・利用規約・サポート・アカウントの削除）と、アプリの情報（manifest・アイコン）
//   - 未完成の機能・架空の数値（準備中・為替・料金表・利用者の声）が画面に無い
//   - 答案を AI に送る前に、送る内容を示して同意をたずねる（同意しなければ送らない）
//   - 本人によるアカウントの削除（生徒・先生。学校の最後の管理者は削除できない）
//   - 生徒の新規登録は、利用規約・プライバシーポリシー（13歳未満は保護者）への同意が無いとできない
import { chromium } from "playwright";
import zlib from "node:zlib";

const BASE = process.env.BASE_URL, GW = process.env.GATEWAY_URL, TRAP = process.env.TRAP_URL;
const ok = (cond, msg) => { if (!cond) { console.log("✗ FAIL:", msg); throw new Error(msg); } console.log("✓", msg); };
const errors = [];
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
});
const watch = (page, who) => {
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`[${who}] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${who}] ${e.message}`));
};
const token = async (email) => (await (await fetch(`${GW}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "pass-lite-123" }),
})).json()).access_token;
const rest = async (tok, path) => (await fetch(`${GW}/rest/v1/${path}`, { headers: { authorization: `Bearer ${tok}` } })).json();
const ID = (n) => `eeeeeeee-0000-0000-0000-0000000000${n}`;

// ---------------------------------------------------------------- 公開ページ（ログインなし・スマホ幅）
const pub = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
watch(pub, "公開");
for (const [path, must] of [
  ["/start", ["テスト採点ver5", "先生・職員", "生徒", "プライバシーポリシー"]],
  ["/privacy", ["プライバシーポリシー", "検証用の提供者", "support@example.com", "Anthropic", "氏名は扱いません", "13歳未満", "削除"]],
  ["/terms", ["利用規約", "検証用の提供者", "AI の採点は下書き", "購入や課金はありません"]],
  ["/support", ["サポート", "support@example.com", "アカウントの削除"]],
  ["/account-deletion", ["アカウントの削除", "検証用の提供者", "削除されるもの", "残るもの", "support@example.com"]],
]) {
  const res = await pub.goto(BASE + path);
  const text = await pub.evaluate(() => document.body.innerText);
  ok(res.status() === 200 && pub.url() === BASE + path, `${path} はログインなしで開ける`);
  ok(must.every((m) => text.includes(m)), `${path} に必要な内容がある（${must.join("・")}）`);
  ok(!text.includes("未設定です"), `${path} に未設定の項目が無い`);
  ok((await pub.evaluate(() => document.documentElement.scrollWidth)) <= 390, `${path} はスマホ幅で横にはみ出さない`);
}
const manifest = await (await fetch(BASE + "/manifest.webmanifest")).json();
ok(manifest.name === "テスト採点ver5" && manifest.start_url === "/start" && manifest.icons.length >= 3, "アプリの情報（manifest）：名前・起動画面・アイコン");
for (const icon of manifest.icons) {
  const r = await fetch(BASE + icon.src);
  ok(r.status === 200 && r.headers.get("content-type") === "image/png", `アイコン ${icon.src} が開ける`);
}

// ---------------------------------------------------------------- 生徒の新規登録：同意が無いと登録できない
await pub.goto(BASE + "/student");
await pub.getByLabel("メール").fill("new-student@example.com");
await pub.getByLabel("パスワード").fill("pass-new-12345");
const signup = pub.getByRole("button", { name: "初めて：アカウント登録" });
ok(await signup.isDisabled(), "利用規約・プライバシーポリシーへの同意のチェックが無いと、登録できない");
await pub.getByRole("checkbox").check();
ok(!(await signup.isDisabled()), "同意すると登録できる（13歳未満は保護者といっしょに）");
ok((await pub.getByRole("link", { name: "プライバシーポリシー" }).count()) > 0 && (await pub.getByRole("link", { name: "利用規約" }).count()) > 0, "登録画面から規約とポリシーを読める");

// ---------------------------------------------------------------- 先生：未完成の機能・架空の数値が無い
const admCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const adm = await admCtx.newPage();
watch(adm, "先生");
const adminRequests = [];
admCtx.on("request", (r) => adminRequests.push(`${r.method()} ${new URL(r.url()).pathname}`));
await adm.goto(BASE + "/login");
ok((await adm.evaluate(() => document.body.innerText)).includes("生徒の方はこちら") && !(await adm.evaluate(() => document.body.innerText)).includes("提出リンク"), "ログイン画面：生徒の入口があり、無い機能（提出リンク）を案内しない");
await adm.getByLabel("メールアドレス").fill("admin@lite.example");
await adm.getByLabel("パスワード").fill("pass-lite-123");
await adm.getByRole("button", { name: "ログイン" }).click();
await adm.waitForURL(BASE + "/");
await adm.getByText("よくある質問").waitFor();
const dash = await adm.evaluate(() => document.body.innerText);
for (const ng of ["為替", "ユーザーの声", "サブスクリプション", "¥9,800", "0120-", "準備中", "GDPR", "デモ", "ver.3", "提出用リンクとQRコード"]) {
  ok(!dash.includes(ng), `ダッシュボードに「${ng}」が無い（架空の数値・未完成の機能を出さない）`);
}
ok(dash.includes("利用規約とプライバシー") && dash.includes("support@example.com"), "ダッシュボード：規約・プライバシーと問い合わせ先");
await adm.goto(BASE + "/settings");
await adm.getByText("AIエンジン").first().waitFor();
const settings = await adm.evaluate(() => document.body.innerText);
ok(!settings.includes("準備中") && !settings.includes("複合機・印刷機との連携") && !settings.includes("連携コード"), "設定画面に未完成の機能（準備中・複合機の連携）が無い");
await adm.goto(BASE + "/new");
await adm.getByText("1. 答案の取り込み方法を選ぶ").waitFor();
const newg = await adm.evaluate(() => document.body.innerText);
ok(!newg.includes("生徒モバイル提出") && !newg.includes("印刷機・コピー機") && !newg.includes("準備中") && newg.includes("PDF一括"), "新規採点に未完成の取り込み方法が無い（PDF一括で複合機のスキャンを取り込める）");

// ---------------------------------------------------------------- AI に送る前の同意
const png = (() => {
  const w = 600, h = 800;
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (x * 7 + y * 3) % 256;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
})();
await adm.locator('input[type="file"]').first().setInputFiles({ name: "answer.png", mimeType: "image/png", buffer: png });
const scan = adm.getByRole("button", { name: /自動振り分け/ });
await scan.waitFor();
await adm.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /自動振り分け/.test(b.textContent ?? "") && !b.disabled));
await scan.click();
await adm.getByText("AI に送る内容の確認").waitFor();
const dialog = await adm.evaluate(() => document.body.innerText);
ok(dialog.includes("Anthropic") && dialog.includes("答案の写真") && dialog.includes("送らない"), "AI に送る前に、送り先と送る内容を示して同意をたずねる");
await adm.getByRole("button", { name: "送らない" }).click();
await adm.getByText(/同意していないため/).first().waitFor();
ok(!adminRequests.some((r) => r === "POST /api/intake"), "同意しなければ、答案を AI に送らない（/api/intake を呼ばない）");
await scan.click();
await adm.getByRole("button", { name: "同意して AI に送る" }).click();
await adm.waitForTimeout(1500);
ok(adminRequests.some((r) => r === "POST /api/intake"), "同意すると送る（この環境では採点AIのキーが無いので、サーバーが断る）");
ok(await adm.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("ai-consent:"))), "同意はこの端末に残る（設定画面から取り消せる）");
await adm.goto(BASE + "/settings");
await adm.getByRole("button", { name: "同意を取り消す" }).click();
ok(!(await adm.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("ai-consent:")))), "設定画面で同意を取り消せる");
ok((await (await fetch(TRAP + "/__hits")).json()).length === 0, "採点AI・OpenAI の宛先に要求が来ていない");

// ---------------------------------------------------------------- アカウントの削除
// 先生（この学校の唯一の管理者）は削除できない
const delCard = adm.getByTestId("account-deletion");
await delCard.getByRole("button", { name: "アカウントを削除する" }).click();
const delBtn = delCard.getByRole("button", { name: "削除する", exact: true });
ok(await delBtn.isDisabled(), "「削除」と入力するまで削除できない");
await delCard.getByLabel("確認の文字").fill("削除");
await delBtn.click();
await delCard.getByText(/最後の管理者/).waitFor();
ok((await rest(await token("admin@lite.example"), "profiles?select=id")).length >= 1, "学校の最後の管理者は削除できない（アカウントは残る）");

// 生徒B：アカウントを削除する → ログインできない。学校の記録（返却した内容）は残る
const stu = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
watch(stu, "生徒B");
await stu.goto(BASE + "/student");
await stu.getByLabel("メール").fill("stu-b@lite.example");
await stu.getByLabel("パスワード").fill("pass-lite-123");
await stu.getByRole("button", { name: "ログイン", exact: true }).click();
await stu.getByRole("button", { name: "アカウント" }).click();
await stu.getByTestId("account-deletion").getByRole("button", { name: "アカウントを削除する" }).click();
ok((await stu.evaluate(() => document.body.innerText)).includes("残るもの"), "削除の前に、消えるもの・残るものを示す");
await stu.getByLabel("確認の文字").fill("削除");
await stu.getByRole("button", { name: "削除する", exact: true }).click();
await stu.getByText("アカウントを削除しました").waitFor();
ok((await stu.getByLabel("メール").count()) === 1, "削除するとログアウトし、ログインの画面に戻る");
const relogin = await fetch(`${GW}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "stu-b@lite.example", password: "pass-lite-123" }) });
ok(relogin.status === 400, "削除したアカウントではログインできない");
const admTok = await token("admin@lite.example");
ok((await rest(admTok, `student_accounts?select=student_id&student_id=eq.${ID(22)}`)).length === 0, "生徒の返却先の登録は消える");
ok((await rest(admTok, `result_releases?select=id&student_id=eq.${ID(22)}`)).length === 1, "返却した内容は学校の記録として残る");
const audit = await rest(admTok, "audit_logs?select=action,detail&action=eq.account.delete");
ok(audit.length === 1 && audit[0].detail.role === "student", "削除は監査ログに残る（だれかは残さない）");

ok(errors.length === 0, `コンソールのエラーが無い${errors.length ? "：\n" + errors.join("\n") : ""}`);
await browser.close();
console.log("OK: ストアの要件の画面テストがすべて通りました");
