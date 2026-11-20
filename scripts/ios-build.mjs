// iPhoneアプリ用に画面をビルドし、ios/ に反映する。
// 使い方: APP_URL=https://（本番URL） npm run ios:build
import { execSync } from 'node:child_process';

const url = (process.env.APP_URL || '').trim().replace(/\/$/, '');
if (!/^https:\/\/[^/\s]+$/.test(url) || /vercel\.app$/.test(new URL(url).host) && /-[a-z0-9]{9}-/.test(url)) {
  console.error('APP_URL に本番のURL（https:// から始まり末尾に / なし。プレビュー用のURLは不可）を指定してください。例: APP_URL=https://jugyo-studio.example.com npm run ios:build');
  process.exit(1);
}
const env = { ...process.env, VITE_API_BASE: url, VITE_PUBLIC_URL: url };
execSync('npx vite build --outDir dist-ios --emptyOutDir', { stdio: 'inherit', env });
execSync('npx cap sync ios', { stdio: 'inherit', env });
console.log(`\n✅ ios/ に反映しました（サーバー: ${url}）。次は Xcode で開いてアーカイブします: npm run ios:open`);
