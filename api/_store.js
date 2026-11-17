// サーバー側で共有して使う道具（Node と Edge の両方で動くよう、fetch と Web Crypto だけを使う）
//   ・共有データの置き場（Upstash Redis の REST API）
//   ・利用者IDと端末の結び付け（他人の利用者IDを名乗って契約や利用枠を使えないようにする）
//   ・契約状態（Stripe）と、今月のAI作成数

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const hasStore = Boolean(KV_URL && KV_TOKEN);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const need = (cond, status, message) => { if (!cond) throw new HttpError(status, message); };

export async function kv(...cmd) {
  need(hasStore, 503, 'STORE_NOT_CONFIGURED');
  const r = await fetch(KV_URL, { method: 'POST', headers: { authorization: `Bearer ${KV_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  const data = await r.json();
  if (!r.ok || data.error) throw new HttpError(502, '共有データの保存先でエラーが発生しました');
  return data.result;
}
export const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256(v) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(v))));
}
export async function hmacSha256(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}
export function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ── プラン（金額と月の上限はサーバー側で固定。画面側の値は信用しない） ──
export const PLANS = {
  free: { name: '無料コース', amount: 0, limit: 1 },
  mini: { name: 'ミニコース', amount: 500, limit: 5 },
  individual: { name: '個人・塾コース', amount: 1980, limit: 30 },
  school: { name: '学校コース', amount: 4980, limit: 100 },
  government: { name: '行政コース', amount: 9980, limit: Infinity },
};
export const monthKey = () => new Date().toISOString().slice(0, 7);

// ── 利用者IDと端末の結び付け ──
// 初めて使った端末の鍵（deviceKey）のハッシュを記録し、以後は同じ鍵を持つ端末だけをその利用者として扱う。
// バックアップから復元した端末は同じ鍵を持つので、そのまま使える。
export async function claimUser(userId, deviceKey) {
  need(typeof userId === 'string' && /^[\w-]{8,80}$/.test(userId) && typeof deviceKey === 'string' && deviceKey.length >= 8, 401, 'USER_REQUIRED');
  const keyHash = await sha256(deviceKey);
  const fresh = { keyHash, createdAt: new Date().toISOString() };
  await kv('SET', `js:user:${userId}`, JSON.stringify(fresh), 'NX');
  const user = parse(await kv('GET', `js:user:${userId}`));
  need(user && sameText(user.keyHash, keyHash), 403, 'USER_MISMATCH');
  return user;
}

// ── 契約状態 ──
const ACTIVE = new Set(['active', 'trialing', 'past_due']); // past_due は支払いの再試行中（Stripeが数日間自動で再請求する）
export async function getSubscription(userId) {
  return parse(await kv('GET', `js:sub:${userId}`));
}
// Stripe の subscription オブジェクトから契約状態を保存する（通知が順不同で届いても、新しい情報だけを残す）
export async function saveSubscription(sub, fallback = {}) {
  const meta = sub.metadata || {};
  const userId = meta.userId || fallback.userId;
  if (!userId) return null;
  const prev = await getSubscription(userId);
  const stamp = Number(sub.created || 0) * 1000 + (sub.status === 'canceled' ? 1 : 0);
  // 別の（新しい）契約が既にある場合、古い契約の解約通知で上書きしない
  if (prev && prev.subscriptionId !== sub.id && ACTIVE.has(prev.status) && prev.stamp > stamp) return prev;
  const record = {
    subscriptionId: sub.id,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    planCode: PLANS[meta.planCode] ? meta.planCode : fallback.planCode || prev?.planCode || 'mini',
    status: sub.status,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    currentPeriodEnd: sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null,
    stamp,
    updatedAt: new Date().toISOString(),
  };
  await kv('SET', `js:sub:${userId}`, JSON.stringify(record));
  return record;
}
// いま有効なプラン（支払いが止まった・解約済みなら無料に戻る）
export function effectivePlan(record) {
  if (record && ACTIVE.has(record.status) && PLANS[record.planCode]) return record.planCode;
  return 'free';
}

// ── 今月のAI作成数 ──
export async function usage(userId) {
  return Number(await kv('GET', `js:use:${userId}:${monthKey()}`)) || 0;
}
// 枠を1つ使う。上限を超える場合は使わずに例外を投げる
export async function takeQuota(userId, user) {
  const plan = effectivePlan(await getSubscription(userId));
  const limit = PLANS[plan].limit;
  if (plan === 'free') {
    const expires = new Date(user.createdAt); expires.setMonth(expires.getMonth() + 3);
    need(Date.now() < expires.getTime(), 402, 'TRIAL_EXPIRED');
  }
  const key = `js:use:${userId}:${monthKey()}`;
  const n = await kv('INCR', key);
  if (n === 1) await kv('EXPIRE', key, 60 * 60 * 24 * 40);
  if (n > limit) { await kv('DECR', key); throw new HttpError(402, 'QUOTA_EXCEEDED'); }
  return { plan, used: n, limit };
}
export async function refundQuota(userId) {
  await kv('DECR', `js:use:${userId}:${monthKey()}`);
}
