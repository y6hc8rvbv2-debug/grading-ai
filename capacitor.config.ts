// iPhoneアプリ（Capacitor）の設定。
// 画面一式（dist-ios）はアプリの中に入れて動かす。指導案・記録などのデータも端末の中に保存するので、
// 通信できない場所でも、AI以外の機能（作成済みの指導案の閲覧・編集・記録・タイマーなど）が使える。
// AI・課金などのサーバー処理だけを本番のサーバー（ビルド時の APP_URL）に問い合わせる。アプリの中に秘密（APIキーなど）は入れない。
// ビルド手順: APP_URL=https://（本番URL） npm run ios:build（docs/IOS-RELEASE.md）
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // アプリの ID（Bundle ID）。App Store Connect・Vercel の APPLE_BUNDLE_ID と同じ値。一度アップロードすると変えられない
  appId: 'jp.jugyostudio.app',
  appName: '授業スタジオ',
  webDir: 'dist-ios',
  appendUserAgent: 'JugyoStudioApp/1',
  ios: {
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
