// 個人情報を守る設定（PII Shield）
// ⚠ このファイルはサーバー側のコード（/api/robot-order.js）からだけ読み込むこと（画面側では使わない）
import { createShield } from 'pii-shield';

// .env を自動で読み込まない環境（素の Node.js）向け。Vercel などは自動で読み込む
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
  // 守りたい個人情報の項目（注文フォームの入力項目に合わせている）
  schema: {
    email: { index: 'email', mask: 'email' },
    phone: { index: 'phone', mask: 'phone' },
    name: { mask: 'name' },
    address: { mask: 'address' },
    postal: { mask: 'full' },
  },
  guard: {
    perActor: { maxCalls: 30, maxRecords: 5, windowMs: 60_000 },
    global: { maxCalls: 1000, windowMs: 60_000 },
  },
  // 本番では「必ず守ってほしいこと」に違反していたら起動を止める
  strictSecurity: process.env.NODE_ENV === 'production',
});
