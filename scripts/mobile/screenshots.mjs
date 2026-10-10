// ストアに載せる画面写真を撮る（デモモードのアプリ＝サンプルのデータで撮る。実在の学校・生徒のデータは使わない）。
//   1. デモモードでアプリを起動：NEXT_DIST_DIR=.next-demo npx next build && NEXT_DIST_DIR=.next-demo npx next start -p 3400
//      （NEXT_PUBLIC_SUPABASE_URL を設定しない＝デモモード）
//   2. BASE_URL=http://localhost:3400 node scripts/mobile/screenshots.mjs
// 書き出し先：store/screenshots/{iphone-6.9,ipad-13,android-phone}/NN-name.png
//   iPhone 6.9 インチ 1320x2868（App Store で必須）・iPad 13 インチ 2064x2752（iPad でも動くため必須）・Android 1080x1920（Google Play）
// 生徒の画面（返却・ChatGPT で復習）は Supabase が必要なので、tests/e2e-lite を STORE_SHOT_DIR=store/screenshots で動かして撮る。
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3400";
const OUT = new URL("../../store/screenshots/", import.meta.url).pathname;
export const DEVICES = {
  "iphone-6.9": { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  "ipad-13": { viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  "android-phone": { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const [name, opts] of Object.entries(DEVICES)) {
  mkdirSync(OUT + name, { recursive: true });
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const shot = async (file) => { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}${name}/${file}.png` }); console.log(`  ${name}/${file}.png`); };
  await page.goto(BASE + "/start"); await shot("01-start");
  await page.goto(BASE + "/"); await page.getByText("よくある質問").first().waitFor(); await shot("02-dashboard");
  await page.goto(BASE + "/new"); await page.getByText("1. 答案の取り込み方法を選ぶ").waitFor(); await shot("03-new-grading");
  await page.goto(BASE + "/history"); await page.waitForTimeout(800);
  // 採点済みの答案を1枚開き、原本に重ねた赤ペンを写す
  const row = page.locator("tbody tr, [role=row]").first();
  if (await row.count()) { await row.click(); await page.waitForTimeout(1500); await shot("04-red-pen"); }
  await page.goto(BASE + "/weakness"); await page.waitForTimeout(1000); await shot("05-weakness");
  await ctx.close();
}
await browser.close();
