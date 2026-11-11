// 以前から公開している「守りダッシュボード」の画面を、ビルド結果にも含める
import { cpSync, existsSync, mkdirSync } from 'node:fs';
if (existsSync('security-guard/index.html')) {
  mkdirSync('dist/security-guard', { recursive: true });
  cpSync('security-guard/index.html', 'dist/security-guard/index.html');
}
