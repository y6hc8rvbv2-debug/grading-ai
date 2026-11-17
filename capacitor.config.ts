// iPhoneアプリ（Capacitor）の設定。アプリは本番の Web アプリ（APP_URL）を開く。
// 画面・データ・AI はすべて本番のサーバーで動き、アプリの中に秘密（APIキーなど）は入れない。
// アプリ内での有料プランの申し込みは Apple のアプリ内課金（@capgo/native-purchases）を使う。手順は docs/IOS-RELEASE.md。
import type { CapacitorConfig } from '@capacitor/cli';

// 本番の URL（末尾の / なし）。例: APP_URL=https://jugyo-studio.example.com npx cap sync ios
const url = (process.env.APP_URL || '').trim().replace(/\/$/, '');
if (!/^https:\/\/[^/\s]+$/.test(url)) {
  throw new Error('APP_URL に本番の URL（https:// から始まり、末尾に / を付けない）を指定してください（docs/IOS-RELEASE.md）');
}

const config: CapacitorConfig = {
  // アプリの ID（Bundle ID）。App Store Connect・Vercel の APPLE_BUNDLE_ID と同じ値にする。一度アップロードすると変えられない
  appId: process.env.APPLE_BUNDLE_ID || 'jp.jugyostudio.app',
  appName: '授業スタジオ',
  // 通信できない時に出す画面（mobile/www/offline.html）
  webDir: 'mobile/www',
  appendUserAgent: 'JugyoStudioApp/1',
  server: {
    url,
    // アプリの中で開くのは本番のサイトだけ。ほかのサイトは端末のブラウザで開く
    allowNavigation: [new URL(url).host],
    errorPath: 'offline.html',
    cleartext: false,
  },
  ios: {
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
