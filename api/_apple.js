// iPhoneアプリ内課金（Apple）の確認。Apple が署名した購入情報を検証し、契約状態を記録する。
//   必要な設定: APPLE_BUNDLE_ID（アプリのID）/ APPLE_APP_ID（App Store Connect の数字のApple ID。本番の確認に必要）
//   共有データの置き場（KV）も必要。
import { createHash } from 'node:crypto';
import { SignedDataVerifier, Environment } from '@apple/app-store-server-library';
import { kv, parse, PLANS } from './_store.js';

export const hasApple = Boolean(process.env.APPLE_BUNDLE_ID);

// App Store Connect で作る商品ID と プランの対応（金額は App Store Connect 側で設定する）
export const APPLE_PRODUCTS = {
  jugyo_mini_monthly: 'mini',
  jugyo_individual_monthly: 'individual',
  jugyo_school_monthly: 'school',
  jugyo_government_monthly: 'government',
};

// Apple Root CA - G3（https://www.apple.com/certificateauthority/ で公開されている証明書）。
// 読み込み時に SHA-256 の指紋を確かめ、Apple が公表している値と違えば使わない。
const APPLE_ROOT_CA_G3 = 'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==';
const APPLE_ROOT_CA_G3_SHA256 = '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';

function rootCerts() {
  const der = Buffer.from(APPLE_ROOT_CA_G3, 'base64');
  if (createHash('sha256').update(der).digest('hex') !== APPLE_ROOT_CA_G3_SHA256) throw new Error('Apple root certificate mismatch');
  return [der];
}

const verifiers = {};
function verifierFor(env) {
  const production = env === Environment.PRODUCTION;
  const appId = Number(process.env.APPLE_APP_ID) || undefined;
  if (production && !appId) throw new Error('APPLE_APP_ID is required for production');
  verifiers[env] ||= new SignedDataVerifier(rootCerts(), true, production ? Environment.PRODUCTION : Environment.SANDBOX, process.env.APPLE_BUNDLE_ID, production ? appId : undefined);
  return verifiers[env];
}
// 署名を確かめる前に、どちらの環境（本番／テスト）のデータかだけを読む。検証は必ずその後に行う
function peekEnvironment(jws, pick = (p) => p.environment) {
  try {
    const payload = JSON.parse(Buffer.from(String(jws).split('.')[1], 'base64url').toString('utf8'));
    return pick(payload) === Environment.PRODUCTION ? Environment.PRODUCTION : Environment.SANDBOX;
  } catch { return Environment.SANDBOX; }
}

export async function verifyTransaction(jws) {
  return verifierFor(peekEnvironment(jws)).verifyAndDecodeTransaction(jws);
}
export async function verifyRenewal(jws) {
  return verifierFor(peekEnvironment(jws)).verifyAndDecodeRenewalInfo(jws);
}
export async function verifyNotification(signedPayload) {
  return verifierFor(peekEnvironment(signedPayload, (p) => p.data?.environment || p.summary?.environment)).verifyAndDecodeNotification(signedPayload);
}

// 購入情報 → 契約状態の記録（Stripe と同じ形。accessUntil を過ぎたら自動で無料に戻る）
export function appleRecord(tx, renewal = null, now = Date.now()) {
  const planCode = APPLE_PRODUCTS[tx.productId];
  const grace = Number(renewal?.gracePeriodExpiresDate) || 0;
  let status = 'expired';
  if (tx.revocationDate) status = 'canceled'; // 返金・取り消し
  else if (Number(tx.expiresDate) > now) status = 'active';
  else if (grace > now) status = 'past_due'; // 支払いの猶予期間中（Apple が再請求中）
  return {
    source: 'apple',
    subscriptionId: tx.originalTransactionId,
    customerId: null,
    planCode: planCode && PLANS[planCode] ? planCode : 'free',
    productId: tx.productId,
    status,
    cancelAtPeriodEnd: renewal ? Number(renewal.autoRenewStatus) === 0 : false,
    currentPeriodEnd: tx.expiresDate ? Math.floor(Number(tx.expiresDate) / 1000) : null,
    accessUntil: tx.revocationDate ? 1 : Math.max(Number(tx.expiresDate) || 0, grace) + 60 * 60 * 1000, // 通知の遅れを考えて1時間の余裕
    environment: tx.environment,
    stamp: Number(tx.signedDate) || Number(tx.purchaseDate) || now,
    updatedAt: new Date(now).toISOString(),
  };
}

// 記録先の利用者を決めて保存する。
//   ・アプリで購入した時は appAccountToken（＝利用者ID）が付く
//   ・別の端末で「購入を復元」した時は、その時の利用者に付け替える（Apple の契約は Apple ID ごとのため）
export async function saveAppleTransaction(tx, renewal, { userId } = {}) {
  const orig = tx.originalTransactionId;
  if (!orig || !APPLE_PRODUCTS[tx.productId]) return null;
  const mapped = await kv('GET', `js:aorig:${orig}`);
  const owner = userId || mapped || tx.appAccountToken;
  if (!owner) return null;
  if (userId && mapped && mapped !== userId) {
    // 付け替え：前の利用者からこの契約の記録を外す
    const old = parse(await kv('GET', `js:asub:${mapped}`));
    if (old?.subscriptionId === orig) await kv('DEL', `js:asub:${mapped}`);
  }
  if (userId || !mapped) await kv('SET', `js:aorig:${orig}`, owner);
  const record = appleRecord(tx, renewal);
  const prev = parse(await kv('GET', `js:asub:${owner}`));
  if (prev && prev.subscriptionId === orig && prev.stamp > record.stamp) return prev; // 古い情報で上書きしない
  await kv('SET', `js:asub:${owner}`, JSON.stringify(record));
  return { userId: owner, record };
}
