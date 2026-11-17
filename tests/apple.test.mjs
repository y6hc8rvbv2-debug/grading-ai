// Apple（iPhoneアプリ内課金）の契約記録のテスト。模擬の保存先を使う（Apple の署名検証そのものは Apple 公式ライブラリに任せる）
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.KV_REST_API_URL = 'https://kv.test'; process.env.KV_REST_API_TOKEN = 't';
process.env.APPLE_BUNDLE_ID = 'jp.jugyostudio.app';

const mem = new Map();
globalThis.fetch = async (url, init = {}) => {
  const ok = (result) => new Response(JSON.stringify({ result }));
  if (!String(url).startsWith('https://kv.test')) throw new Error('unexpected fetch ' + url);
  const [cmd, ...keys] = JSON.parse(init.body); const [key, val, ...a] = keys;
  if (cmd === 'SET') { if (a.includes('NX') && mem.has(key)) return ok(null); mem.set(key, val); return ok('OK'); }
  if (cmd === 'GET') return ok(mem.get(key) ?? null);
  if (cmd === 'DEL') { keys.forEach((k) => mem.delete(k)); return ok(1); }
  throw new Error('unexpected ' + cmd);
};
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const apple = await import(ROOT + '/api/_apple.js');
const store = await import(ROOT + '/api/_store.js');

const now = Date.now(); const DAY = 86400000;
const tx = (o = {}) => ({ originalTransactionId: 'orig-1', productId: 'jugyo_individual_monthly', expiresDate: now + 20 * DAY, signedDate: now, appAccountToken: 'aaaaaaaa-0000-4000-8000-000000000001', environment: 'Sandbox', ...o });

test('有効な購入は個人・塾コースになる', async () => {
  const r = await apple.saveAppleTransaction(tx());
  assert.equal(r.userId, 'aaaaaaaa-0000-4000-8000-000000000001');
  const e = await store.entitlement('aaaaaaaa-0000-4000-8000-000000000001');
  assert.equal(e.plan, 'individual'); assert.equal(e.source, 'apple');
});

test('期限切れ・返金は無料に戻る。支払い猶予期間中は使える', () => {
  assert.equal(store.effectivePlan(apple.appleRecord(tx({ expiresDate: now - DAY }))), 'free');
  assert.equal(store.effectivePlan(apple.appleRecord(tx({ revocationDate: now }))), 'free');
  assert.equal(store.effectivePlan(apple.appleRecord(tx({ expiresDate: now - DAY }), { gracePeriodExpiresDate: now + 3 * DAY })), 'individual');
});

test('通知が届かなくても、有効期限を過ぎれば自動で無料に戻る', () => {
  const rec = apple.appleRecord(tx({ expiresDate: now + 1000 }));
  rec.accessUntil = now - 1; // 期限切れを再現
  assert.equal(store.effectivePlan(rec), 'free');
});

test('自動更新オフは「解約予定」として記録', () => {
  assert.equal(apple.appleRecord(tx(), { autoRenewStatus: 0 }).cancelAtPeriodEnd, true);
});

test('購入の復元で、新しい利用者に契約が付け替わる', async () => {
  await apple.saveAppleTransaction(tx(), null, { userId: 'bbbbbbbb-0000-4000-8000-000000000002' });
  assert.equal((await store.entitlement('bbbbbbbb-0000-4000-8000-000000000002')).plan, 'individual');
  assert.equal((await store.entitlement('aaaaaaaa-0000-4000-8000-000000000001')).plan, 'free');
  // その後の Apple からの通知も、付け替え後の利用者に記録される
  const r = await apple.saveAppleTransaction(tx({ productId: 'jugyo_school_monthly', signedDate: now + 1 }));
  assert.equal(r.userId, 'bbbbbbbb-0000-4000-8000-000000000002');
  assert.equal((await store.entitlement('bbbbbbbb-0000-4000-8000-000000000002')).plan, 'school');
});

test('古い通知で新しい情報を上書きしない', async () => {
  await apple.saveAppleTransaction(tx({ expiresDate: now - DAY, signedDate: now - 5 * DAY }));
  assert.equal((await store.entitlement('bbbbbbbb-0000-4000-8000-000000000002')).plan, 'school');
});

test('知らない商品IDは記録しない', async () => {
  assert.equal(await apple.saveAppleTransaction(tx({ originalTransactionId: 'orig-x', productId: 'other' })), null);
});

test('Web(Stripe)とApple の両方がある時は上限の大きい方', async () => {
  mem.set('js:sub:cccccccc-0000-4000-8000-000000000003', JSON.stringify({ planCode: 'mini', status: 'active', subscriptionId: 's', stamp: 1 }));
  await apple.saveAppleTransaction(tx({ originalTransactionId: 'orig-3', productId: 'jugyo_government_monthly', appAccountToken: 'cccccccc-0000-4000-8000-000000000003' }));
  assert.equal((await store.entitlement('cccccccc-0000-4000-8000-000000000003')).plan, 'government');
});

test('偽の購入情報（署名なし）は Apple 公式ライブラリで拒否される', async () => {
  const fake = [{ alg: 'ES256' }, { productId: 'jugyo_government_monthly', environment: 'Sandbox' }].map((x) => Buffer.from(JSON.stringify(x)).toString('base64url')).join('.') + '.c2ln';
  await assert.rejects(apple.verifyTransaction(fake));
});
