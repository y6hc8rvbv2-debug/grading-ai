// ストアに出す前の確認（読み取りだけ）：npm run store:check
//   - 公開の情報（提供者名・問い合わせ先・本番の URL）が設定されているか
//   - ios/・android/ の アプリID・名前・権限の説明・アイコンが入っているか
//   - 公開ページ・アカウントの削除・保存期間の削除・AI 送信の同意のコードがあるか
// 本番の URL を指定したときは（STORE_CHECK_ONLINE=1）、公開ページが開けるかも確かめる。
import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p) => readFileSync(ROOT + p, "utf8");
const problems = [], oks = [];
const check = (ok, label, fix) => (ok ? oks.push(label) : problems.push(`${label}\n    → ${fix}`));

const provider = (process.env.NEXT_PUBLIC_APP_PROVIDER ?? "").trim();
const email = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "").trim();
const url = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
check(!!provider, "提供者名（NEXT_PUBLIC_APP_PROVIDER）", "開発者アカウントの名義と同じ名前を設定する");
check(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), "問い合わせ先（NEXT_PUBLIC_SUPPORT_EMAIL）", "ストアのサポート欄と同じメールアドレスを設定する");
check(/^https:\/\/[^/\s]+$/.test(url) && !/example|invalid|localhost/.test(url), "本番の URL（NEXT_PUBLIC_APP_URL）", "https:// から始まる本番の URL（末尾の / なし）を設定する");

const appId = "jp.tesutosaiten.app";
check(read("capacitor.config.ts").includes(`appId: "${appId}"`), "capacitor.config.ts の アプリID", `appId を ${appId} にする`);
check(existsSync(ROOT + "android/app/build.gradle") && read("android/app/build.gradle").includes(`applicationId "${appId}"`), "Android の パッケージ名", "npx cap add android をやり直す");
check(existsSync(ROOT + "ios/App/App.xcodeproj/project.pbxproj") && read("ios/App/App.xcodeproj/project.pbxproj").includes(`PRODUCT_BUNDLE_IDENTIFIER = ${appId};`), "iOS の Bundle ID", "npx cap add ios をやり直す");
const plist = existsSync(ROOT + "ios/App/App/Info.plist") ? read("ios/App/App/Info.plist") : "";
check(plist.includes("NSCameraUsageDescription") && plist.includes("NSPhotoLibraryUsageDescription"), "iOS のカメラ・写真の使い道の説明", "Info.plist に NSCameraUsageDescription・NSPhotoLibraryUsageDescription を入れる");
check(plist.includes("<string>テスト採点</string>"), "iOS のアプリ名", "Info.plist の CFBundleDisplayName をテスト採点にする");
check(existsSync(ROOT + "android/app/src/main/AndroidManifest.xml") && read("android/app/src/main/AndroidManifest.xml").includes("android.permission.CAMERA"), "Android のカメラの権限", "AndroidManifest.xml に CAMERA を入れる");
for (const f of ["store/icon-1024.png", "store/icon-512.png", "store/feature-graphic.png", "public/icons/icon-512.png", "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"]) {
  check(existsSync(ROOT + f), `画像 ${f}`, "node scripts/mobile/make-icons.mjs を実行する");
}
for (const f of ["app/privacy/page.tsx", "app/terms/page.tsx", "app/support/page.tsx", "app/account-deletion/page.tsx", "app/start/page.tsx",
  "app/api/account/delete/route.ts", "app/api/retention/purge/route.ts", "supabase/migrations/0016_account_deletion.sql", "lib/ai-consent.ts"]) {
  check(existsSync(ROOT + f), `ファイル ${f}`, "リポジトリを最新にする");
}
check(read("vercel.json").includes("/api/retention/purge"), "保存期間の削除（Vercel Cron）", "vercel.json に crons を入れる");

if (process.env.STORE_CHECK_ONLINE === "1" && url) {
  for (const p of ["/start", "/privacy", "/terms", "/support", "/account-deletion", "/manifest.webmanifest"]) {
    const r = await fetch(url + p, { redirect: "manual" }).catch(() => null);
    check(!!r && r.status === 200, `公開ページ ${url}${p}`, "Vercel の Production にデプロイし、ログインなしで開けるか確かめる");
  }
}

for (const o of oks) console.log(`✓ ${o}`);
for (const p of problems) console.log(`✗ ${p}`);
console.log(problems.length ? `\n${problems.length} 件の準備が残っています（docs/STORE-RELEASE.md）` : "\nストアに出すための準備（このリポジトリで確かめられるもの）はそろっています");
process.exit(problems.length ? 1 : 0);
