// Vercel の Preview（push のたびに Vercel が自動で作る URL）を、ログインなしで見られる範囲で確かめる。
//
//   node scripts/preview/check.mjs <Preview の URL> [--shots <保存するフォルダ>] [--email <検証用の教職員> --password-env <変数名>]
//
//   - 公開ページ（/start・/login・/privacy・/terms）が開ける / でたらめな提出リンクを断る / 画面にエラーが出ない
//   - --shots があれば、スマホ幅と PC 幅の画面写真を保存する（ブラウザは Playwright。CHROMIUM_PATH で指定可）
//   - --email と --password-env があれば、検証用の教職員でログインし、/api/health（AI採点の準備状況）を表示する。
//     パスワードは環境変数から読み、画面・ログに出さない
//   - Vercel の「Deployment Protection」が有効なら、環境変数 VERCEL_AUTOMATION_BYPASS_SECRET（Vercel の
//     Protection Bypass for Automation の値）を使って通る。値は表示しない
//   本物の AI・決済は呼ばない（ログインして画面を見るだけ）。
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const BASE = (args.find((a) => /^https?:\/\//.test(a)) ?? "").replace(/\/$/, "");
if (!BASE) { console.log("使い方: node scripts/preview/check.mjs https://<preview>.vercel.app [--shots dir]"); process.exit(2); }
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
const headers = BYPASS ? { "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" } : {};
const hide = (s) => String(s).replaceAll(BYPASS || "\u0000", "***");

let failed = 0;
const ok = (m) => console.log(`✓ ${m}`);
const ng = (m) => { failed++; console.log(`✗ ${m}`); };

async function get(path) {
  const res = await fetch(BASE + path, { headers, redirect: "manual" });
  return { status: res.status, text: await res.text(), location: res.headers.get("location") ?? "" };
}

// 1. HTTP で確かめる
const first = await get("/start");
if (first.status === 401 || /vercel\.com\/login|sso-api/.test(first.location + first.text.slice(0, 2000))) {
  ng(`Vercel のログイン（Deployment Protection）で止められました。VERCEL_AUTOMATION_BYPASS_SECRET を設定してください（docs/AUTO-PREVIEW.md）`);
  process.exit(1);
}
for (const p of ["/start", "/login", "/privacy", "/terms", "/support"]) {
  const r = p === "/start" ? first : await get(p);
  r.status === 200 ? ok(`${p} が開ける`) : ng(`${p} が ${r.status}`);
}
// セキュリティのヘッダー（next.config.mjs。2026-10-22）
{
  const res = await fetch(BASE + "/login", { headers, redirect: "manual" });
  const need = { "x-frame-options": /SAMEORIGIN|DENY/i, "x-content-type-options": /nosniff/i, "content-security-policy": /frame-ancestors/i, "strict-transport-security": /max-age/i, "permissions-policy": /camera/i };
  const missing = Object.entries(need).filter(([k, re]) => !re.test(res.headers.get(k) ?? "")).map(([k]) => k);
  missing.length ? ng(`セキュリティのヘッダーが足りません：${missing.join(", ")}`) : ok("セキュリティのヘッダー（枠への埋め込み禁止・HTTPS だけ・種類の推測禁止・カメラ/マイクの範囲）が付いている");
}
{
  const r = await get("/api/submit/not-a-real-token");
  if (r.status === 503) console.log("△ 生徒の端末からの提出は未設定（サーバーに SUPABASE_SERVICE_ROLE_KEY が無い）");
  else r.status >= 400 && r.status < 500 ? ok(`でたらめな提出リンクを断る（${r.status}）`) : ng(`でたらめな提出リンクが ${r.status}`);
}

// 2. ブラウザで確かめる（コンソールのエラー・画面写真・任意でログイン）
const SHOTS = arg("--shots");
const EMAIL = arg("--email");
const PASS = arg("--password-env") ? process.env[arg("--password-env")] ?? "" : "";
const { chromium } = await import("playwright");
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  // クラウドの開発環境は外への通信が代理サーバー経由（手元の URL は直接）
  ...(process.env.HTTPS_PROXY && !/\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE + "/") ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
});
try {
  for (const [name, viewport] of [["phone", { width: 390, height: 844 }], ["pc", { width: 1366, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport, extraHTTPHeaders: headers, ignoreHTTPSErrors: false, locale: "ja-JP" });
    const page = await ctx.newPage();
    const errors = [];
    // vercel.live は Vercel が Preview にだけ差し込むツールバー（アプリの外）。届かなくてもアプリの不具合ではないので数えない
    page.on("console", (m) => { if (m.type() === "error" && !/^https:\/\/vercel\.live\//.test(m.location().url ?? "")) errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    for (const p of ["/start", "/login"]) {
      await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 60_000 });
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}${p.replace(/\//g, "_")}.png`, fullPage: true }); }
    }
    if (EMAIL && PASS && name === "pc") {
      await page.goto(BASE + "/login", { waitUntil: "networkidle" });
      await page.locator('input[type="email"]').fill(EMAIL);
      await page.locator('input[type="password"]').fill(PASS);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }).then(() => ok("検証用の教職員でログインできる"), () => ng("ログインできない"));
      const health = await page.evaluate(async () => (await fetch("/api/health")).json()).catch((e) => ({ error: String(e) }));
      console.log(`  AI採点の準備状況：${JSON.stringify(health)}`);
      if (health.migrations && Object.values(health.migrations).some((v) => !v)) ng("検証用 DB に足りないマイグレーションがあります");
      if (SHOTS) { await page.waitForLoadState("networkidle"); await page.screenshot({ path: `${SHOTS}/pc_dashboard.png`, fullPage: false }); }
    }
    errors.length ? ng(`${name}：画面のエラー ${errors.length} 件：${hide(errors.slice(0, 3).join(" / ")).slice(0, 400)}`) : ok(`${name}（${viewport.width}px）：画面のエラーなし`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (SHOTS) console.log(`  画面写真：${SHOTS}`);
console.log(failed ? `\n✗ ${failed} 件の問題があります` : "\n✓ Preview の確認はすべて通りました");
process.exit(failed ? 1 : 0);
