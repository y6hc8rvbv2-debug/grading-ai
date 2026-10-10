// アプリのアイコンと起動画面の画像を、1つのデザイン（SVG）から作る（文字を使わない：答案の紙と赤ペンの丸・チェック）。
//   node scripts/mobile/make-icons.mjs
// 書き出し先：public/icons（Web・PWA）、ios/App/App/Assets.xcassets、android/app/src/main/res（既存の画像と同じ大きさで上書き）
// ストアの掲載用：store/icon-1024.png（App Store）・store/icon-512.png（Google Play）・store/feature-graphic.png（1024x500）
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const NAVY = "#1E3A5F", CREAM = "#F6F4EF", RED = "#D7263D";

/** 答案の紙と赤ペン（1024 四方の座標）。scale で中央に縮める */
const mark = (scale = 1) => `
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
    <g transform="rotate(-6 512 512)">
      <rect x="250" y="170" width="524" height="684" rx="36" fill="#FFFFFF"/>
      ${[300, 380, 460, 540, 620, 700].map((y) => `<rect x="320" y="${y}" width="${y === 460 ? 250 : 384}" height="22" rx="11" fill="#C9CED6"/>`).join("")}
    </g>
    <path d="M300 470 C 300 360, 520 330, 640 380 C 760 430, 760 560, 610 600 C 470 638, 300 600, 296 500"
          fill="none" stroke="${RED}" stroke-width="46" stroke-linecap="round"/>
    <path d="M560 720 L 640 800 L 800 610" fill="none" stroke="${RED}" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
const svg = (w, h, body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ""}${body}</svg>`;
const centered = (w, h, size, inner) => `<g transform="translate(${(w - size) / 2} ${(h - size) / 2}) scale(${size / 1024})">${inner}</g>`;

const designs = {
  icon: (s) => svg(s, s, `<g transform="scale(${s / 1024})">${mark(0.92)}</g>`, NAVY),
  round: (s) => svg(s, s, `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}" fill="${NAVY}"/><g transform="scale(${s / 1024})">${mark(0.78)}</g>`),
  foreground: (s) => svg(s, s, `<g transform="scale(${s / 1024})">${mark(0.6)}</g>`),
  maskable: (s) => svg(s, s, `<g transform="scale(${s / 1024})">${mark(0.7)}</g>`, NAVY),
  splash: (w, h) => svg(w, h, centered(w, h, Math.min(w, h) * 0.32, `<rect width="1024" height="1024" rx="220" fill="${NAVY}"/>${mark(0.92)}`), CREAM),
  feature: (w, h) => svg(w, h, centered(w, h, h * 0.7, `<rect width="1024" height="1024" rx="220" fill="${NAVY}"/>${mark(0.92)}`), CREAM),
};

const pngSize = (file) => { const b = readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
async function render(file, w, h, content, transparent = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${content}</body></html>`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, await page.locator("svg").screenshot({ omitBackground: transparent, type: "png" }));
  console.log(`  ${file.slice(ROOT.length)} (${w}x${h})`);
}

// Web・PWA
for (const [name, s, d] of [["icon-192.png", 192, "icon"], ["icon-512.png", 512, "icon"], ["maskable-512.png", 512, "maskable"], ["apple-touch-icon.png", 180, "icon"]]) {
  await render(join(ROOT, "public/icons", name), s, s, designs[d](s));
}
// ストアの掲載用
await render(join(ROOT, "store/icon-1024.png"), 1024, 1024, designs.icon(1024));
await render(join(ROOT, "store/icon-512.png"), 512, 512, designs.icon(512));
await render(join(ROOT, "store/feature-graphic.png"), 1024, 500, designs.feature(1024, 500));
// iOS
if (existsSync(join(ROOT, "ios"))) {
  await render(join(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"), 1024, 1024, designs.icon(1024));
  for (const f of walk(join(ROOT, "ios/App/App/Assets.xcassets/Splash.imageset")).filter((f) => f.endsWith(".png"))) {
    const { w, h } = pngSize(f); await render(f, w, h, designs.splash(w, h));
  }
}
// Android
if (existsSync(join(ROOT, "android"))) {
  for (const f of walk(join(ROOT, "android/app/src/main/res")).filter((f) => f.endsWith(".png"))) {
    const { w, h } = pngSize(f);
    const n = f.split("/").pop();
    if (n === "ic_launcher.png") await render(f, w, h, designs.icon(w));
    else if (n === "ic_launcher_round.png") await render(f, w, h, designs.round(w), true);
    else if (n === "ic_launcher_foreground.png") await render(f, w, h, designs.foreground(w), true);
    else if (n === "splash.png") await render(f, w, h, designs.splash(w, h));
  }
  writeFileSync(join(ROOT, "android/app/src/main/res/values/ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${NAVY}</color>\n</resources>\n`);
}
await browser.close();
