// 模擬の Redis と Stripe を使って、Webhook・契約記録・利用枠の流れを確認する
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
process.env.KV_REST_API_URL = 'https://kv.test'; process.env.KV_REST_API_TOKEN = 't';
process.env.STRIPE_SECRET_KEY = 'sk_test_x'; process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const mem = new Map(); const ttl = new Set();
const subs = { sub_1: { id: 'sub_1', customer: 'cus_1', status: 'active', created: 1000, cancel_at_period_end: false, current_period_end: 2000, metadata: { userId: 'user-aaaaaaaa', planCode: 'individual' } } };
globalThis.fetch = async (url, init = {}) => {
  const ok = (body, status = 200) => new Response(JSON.stringify(body), { status });
  if (String(url).startsWith('https://kv.test')) {
    const [cmd, key, ...a] = JSON.parse(init.body);
    switch (cmd) {
      case 'SET': { if (a.includes('NX') && mem.has(key)) return ok({ result: null }); mem.set(key, a[0]); return ok({ result: 'OK' }); }
      case 'GET': return ok({ result: mem.get(key) ?? null });
      case 'DEL': mem.delete(key); return ok({ result: 1 });
      case 'INCR': { const n = (Number(mem.get(key)) || 0) + 1; mem.set(key, String(n)); return ok({ result: n }); }
      case 'DECR': { const n = (Number(mem.get(key)) || 0) - 1; mem.set(key, String(n)); return ok({ result: n }); }
      case 'EXPIRE': ttl.add(key); return ok({ result: 1 });
      case 'SADD': { const s = new Set(JSON.parse(mem.get(key) || '[]')); const had = s.has(a[0]); s.add(a[0]); mem.set(key, JSON.stringify([...s])); return ok({ result: had ? 0 : 1 }); }
      case 'HGET': return ok({ result: null });
      default: throw new Error('unexpected ' + cmd);
    }
  }
  const m = /subscriptions\/(\w+)/.exec(url);
  if (String(url).startsWith('https://api.stripe.com') && m) return ok(subs[m[1]]);
  throw new Error('unexpected fetch ' + url);
};

const { default: mod } = await import(ROOT + '/api/stripe-webhook.js');
const hook = mod.fetch;
const store = await import(ROOT + '/api/_store.js');
const send = (event, { secret = 'whsec_test', t = Math.floor(Date.now() / 1000) } = {}) => {
  const raw = JSON.stringify(event);
  const sig = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return hook(new Request('https://x/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body: raw }));
};

test('偽の署名・古い署名は拒否', async () => {
  assert.equal((await send({ id: 'evt_bad', type: 'x' }, { secret: 'wrong' })).status, 400);
  assert.equal((await send({ id: 'evt_old', type: 'x' }, { t: Math.floor(Date.now() / 1000) - 3600 })).status, 400);
});

test('申し込み完了 → 有料プランになる', async () => {
  const r = await send({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1', metadata: { userId: 'user-aaaaaaaa', planCode: 'individual' } } } });
  assert.equal(r.status, 200);
  const rec = await store.getSubscription('user-aaaaaaaa');
  assert.equal(rec.planCode, 'individual'); assert.equal(store.effectivePlan(rec), 'individual'); assert.equal(rec.customerId, 'cus_1');
});

test('同じ通知の再送は1回だけ処理', async () => {
  const r = await send({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });
  assert.equal((await r.json()).duplicate, true);
});

test('支払い失敗(past_due)は再請求中なので有効、解約(deleted)で無料に戻る', async () => {
  await send({ id: 'evt_2', type: 'customer.subscription.updated', data: { object: { ...subs.sub_1, status: 'past_due' } } });
  assert.equal(store.effectivePlan(await store.getSubscription('user-aaaaaaaa')), 'individual');
  await send({ id: 'evt_3', type: 'customer.subscription.deleted', data: { object: { ...subs.sub_1, status: 'canceled' } } });
  assert.equal(store.effectivePlan(await store.getSubscription('user-aaaaaaaa')), 'free');
});

test('利用者IDは最初の端末に結び付き、他の端末からは使えない', async () => {
  await store.claimUser('user-bbbbbbbb', 'device-key-1');
  await assert.rejects(store.claimUser('user-bbbbbbbb', 'device-key-2'), /USER_MISMATCH/);
});

test('無料コースは月1件まで。上限を超えると数えずに拒否', async () => {
  const user = await store.claimUser('user-cccccccc', 'device-key-3');
  await store.takeQuota('user-cccccccc', user);
  await assert.rejects(store.takeQuota('user-cccccccc', user), /QUOTA_EXCEEDED/);
  assert.equal(await store.usage('user-cccccccc'), 1);
});

test('有料(個人・塾)は30件まで使える', async () => {
  mem.set('js:sub:user-dddddddd', JSON.stringify({ planCode: 'individual', status: 'active', subscriptionId: 's', stamp: 1 }));
  const user = await store.claimUser('user-dddddddd', 'device-key-4');
  for (let i = 0; i < 30; i++) await store.takeQuota('user-dddddddd', user);
  await assert.rejects(store.takeQuota('user-dddddddd', user), /QUOTA_EXCEEDED/);
});
