// ストア用のアプリ（iOS・Android）の設定。アプリは本番の Web アプリ（NEXT_PUBLIC_APP_URL）の起動画面 /start を開く。
// 画面・データ・AI 採点はすべて本番のサーバーで動き、アプリの中に秘密（API キーなど）は入れない。
// 使い方は docs/STORE-RELEASE.md（npm run mobile:sync で、この設定を ios/・android/ に反映する）。
import type { CapacitorConfig } from "@capacitor/cli";

const url = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!/^https:\/\/[^/\s]+$/.test(url)) {
  throw new Error("NEXT_PUBLIC_APP_URL（本番の URL。https:// から、末尾の / なし）を設定してから実行してください（docs/STORE-RELEASE.md）");
}

const config: CapacitorConfig = {
  // アプリの ID（Bundle ID / パッケージ名）。ios/・android/ の設定と同じ値。ストアに一度アップロードすると変えられない
  appId: "jp.tesutosaiten.app",
  appName: "テスト採点",
  // 通信できないときに出す画面（mobile/www/offline.html）。ここには秘密もデータも置かない
  webDir: "mobile/www",
  server: {
    url: `${url}/start`,
    // アプリの中で開くのは本番のサイトだけ。ほかのサイト（ChatGPT など）は、端末のブラウザ・アプリで開く
    allowNavigation: [new URL(url).host],
    errorPath: "offline.html",
    cleartext: false,
  },
  ios: {
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
