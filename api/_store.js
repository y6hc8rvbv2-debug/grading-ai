// サーバー側で共有して使う道具（Node と Edge の両方で動くよう、fetch と Web Crypto だけを使う）
//   ・共有データの置き場（Upstash Redis の REST API）
//   ・利用者IDと端末の結び付け（他人の利用者IDを名乗って契約や利用枠を使えないようにする）
//   ・契約状態（Stripe）と、今月のAI作成数

// ── 共有データの置き場（Upstash Redis）の接続先 ──
// Vercel の連携で作られる変数名は、作り方によって次のように変わるため、どれでも使えるようにする。
//   KV_REST_API_URL / KV_REST_API_TOKEN（Vercel の Upstash 連携。接頭辞付きの例: STORAGE_KV_REST_API_URL）
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN（Upstash の画面からコピーした場合）
//   KV_URL / REDIS_URL（rediss://default:トークン@xxx.upstash.io:6379 の形。Upstash のものだけ REST に読み替える）
// 値の前後の空白・改行・引用符は取り除く（貼り付け時の混入でつながらなくなるのを防ぐ）。値そのものはログにも画面にも出さない。
const clean = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '').trim();
export function resolveStore(env = process.env) {
  const pairs = [['KV_REST_API_URL', 'KV_REST_API_TOKEN'], ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']];
  for (const [u, t] of pairs) {
    if (clean(env[u]) && clean(env[t])) return { url: clean(env[u]).replace(/\/$/, ''), token: clean(env[t]), source: u };
  }
  // 接頭辞付き。Vercel の Storage 連携で接頭辞を変えると「接頭辞_REST_API_URL」の形になる
  //   例: STORAGE_REST_API_URL と STORAGE_REST_API_TOKEN、STORAGE_KV_REST_API_URL と STORAGE_KV_REST_API_TOKEN
  for (const name of Object.keys(env).sort()) {
    const m = /^(.+)_(REST_API_URL|REST_URL)$/.exec(name);
    if (!m) continue;
    const tokenName = `${m[1]}_${m[2].replace(/URL$/, 'TOKEN')}`;
    if (clean(env[name]) && clean(env[tokenName])) return { url: clean(env[name]).replace(/\/$/, ''), token: clean(env[tokenName]), source: name };
  }
  // 接続文字列（rediss://…@xxx.upstash.io）からの読み替え
  for (const name of Object.keys(env).sort()) {
    if (!/(^|_)(KV_URL|REDIS_URL|URL)$/.test(name)) continue;
    try {
      const u = new URL(clean(env[name]));
      if (/^rediss?:$/.test(u.protocol) && /\.upstash\.io$/.test(u.hostname) && u.password) return { url: `https://${u.hostname}`, token: decodeURIComponent(u.password), source: name };
    } catch { /* 形式が違うものは使わない */ }
  }
  return { url: '', token: '', source: null };
}
const STORE = resolveStore();
export const hasStore = Boolean(STORE.url && STORE.token);
export const storeSource = STORE.source; // どの変数名を使ったか（値ではなく名前だけ）

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const need = (cond, status, message) => { if (!cond) throw new HttpError(status, message); };

// 保存先のエラーを、原因が分かる合図（値は含めない）に分ける。どれも 503 にし、利用回数の確認ができない時は作成を止める
function storeError(code) {
  console.error(`[store] ${code} (env: ${storeSource || 'none'})`);
  return new HttpError(503, code);
}
export async function kv(...cmd) {
  need(hasStore, 503, 'STORE_NOT_CONFIGURED');
  let r;
  try {
    r = await fetch(STORE.url, { method: 'POST', headers: { authorization: `Bearer ${STORE.token}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  } catch {
    throw storeError('STORE_UNREACHABLE'); // URL の誤り・通信の失敗
  }
  let data = {};
  try { data = await r.json(); } catch { /* 本文なし */ }
  if (r.status === 401 || r.status === 403) throw storeError('STORE_AUTH_FAILED'); // トークンの誤り
  if (/NOPERM/i.test(String(data.error || ''))) throw storeError('STORE_READ_ONLY_TOKEN'); // 読み取り専用のトークン
  if (!r.ok || data.error) throw storeError(`STORE_ERROR_${r.status}`);
  return data.result;
}

// 接続の確認（診断用）。保存先に PING を送り、結果の合図だけを返す
export async function storeHealth() {
  // つながらない時の手がかりとして、Redis に関係しそうな環境変数の「名前」だけを返す（値は返さない）
  if (!hasStore) return { configured: false, reachable: false, source: null, error: 'STORE_NOT_CONFIGURED', envNames: Object.keys(process.env).filter((n) => /KV|REDIS|UPSTASH|STORAGE/i.test(n)).sort() };
  try {
    const pong = await kv('PING');
    return { configured: true, reachable: pong === 'PONG', source: storeSource, error: null };
  } catch (e) {
    return { configured: true, reachable: false, source: storeSource, error: e.message };
  }
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
// Apple の契約は「有効期限（accessUntil）」も確かめる（通知が届かなかった場合でも期限で切れるように）
export function effectivePlan(record) {
  if (!record || !ACTIVE.has(record.status) || !PLANS[record.planCode]) return 'free';
  if (record.accessUntil && Date.now() > record.accessUntil) return 'free';
  return record.planCode;
}

// Apple（iPhoneアプリ内課金）の契約は、Stripe とは別の場所に記録する
export async function getAppleSubscription(userId) {
  return parse(await kv('GET', `js:asub:${userId}`));
}
// Stripe と Apple のうち、上限の大きい方を有効なプランとする
const rank = (code) => Object.keys(PLANS).indexOf(code);
export async function entitlement(userId) {
  const [stripe, apple] = await Promise.all([getSubscription(userId), getAppleSubscription(userId)]);
  const a = effectivePlan(stripe); const b = effectivePlan(apple);
  return { plan: rank(b) > rank(a) ? b : a, stripe, apple, source: rank(b) > rank(a) ? 'apple' : a !== 'free' ? 'stripe' : null };
}

// ── 今月のAI作成数 ──
export async function usage(userId) {
  return Number(await kv('GET', `js:use:${userId}:${monthKey()}`)) || 0;
}
// 枠を1つ使う。上限を超える場合は使わずに例外を投げる
export async function takeQuota(userId, user) {
  const { plan } = await entitlement(userId);
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

// iPhoneアプリ（Capacitor）の画面からの通信だけを、別の住所からの通信として許可する
export const APP_ORIGINS = new Set(['capacitor://localhost', 'ionic://localhost', 'https://localhost']);
export function corsHeaders(origin) {
  if (!APP_ORIGINS.has(origin)) return {};
  return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'Origin' };
}
