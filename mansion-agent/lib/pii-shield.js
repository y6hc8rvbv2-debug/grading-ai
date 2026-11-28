// 個人情報を守る設定（PII Shield）
// ⚠ このファイルはサーバー側のコードからだけ読み込むこと（画面側・スマホアプリでは使わない）
import { createShield } from 'pii-shield';

// .env を自動で読み込まない環境（素の Node.js）向け。Next.js や Vercel などは自動で読み込む
if (!process.env.PII_KEY_V1 && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch {
    // .env が無い場合は、サーバーに設定された環境変数をそのまま使う
  }
}

export const shield = createShield({
  keys: { 1: process.env.PII_KEY_V1 },
  activeKeyVersion: 1,
  indexKey: process.env.PII_INDEX_KEY,
  // 守りたい個人情報の項目。アプリに合わせて追加・削除する
  schema: {
    email: { index: 'email', mask: 'email' },
    phone: { index: 'phone', mask: 'phone' },
    name: { mask: 'name' },
    address: { mask: 'address' },
  },
  // 本番では「必ず守ってほしいこと」に違反していたら起動を止める
  strictSecurity: process.env.NODE_ENV === 'production',
});
