// 共有データの置き場（Upstash Redis）の接続設定と、エラーの見分けのテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.KV_REST_API_URL = '  https://example-1.upstash.io/\n'; // 空白・改行・末尾の / が混じっても使える
process.env.KV_REST_API_TOKEN = '"tok-a"\n';
let reply = () => new Response(JSON.stringify({ result: 'PONG' }));
let seen = null;
globalThis.fetch = async (url, init) => { seen = { url, auth: init.headers.authorization }; return reply(); };
const s = await import(new URL('../api/_store.js', import.meta.url));

test('空白・引用符・末尾の / を取り除いて接続する', async () => {
  assert.equal(s.hasStore, true); assert.equal(s.storeSource, 'KV_REST_API_URL');
  assert.equal(await s.kv('PING'), 'PONG');
  assert.equal(seen.url, 'https://example-1.upstash.io'); assert.equal(seen.auth, 'Bearer tok-a');
});

test('変数名の違いに対応（KV_ / UPSTASH_ / 接頭辞付き / 接続文字列）', () => {
  assert.equal(s.resolveStore({ UPSTASH_REDIS_REST_URL: 'https://u.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' }).source, 'UPSTASH_REDIS_REST_URL');
  const p = s.resolveStore({ STORAGE_KV_REST_API_URL: 'https://p.upstash.io', STORAGE_KV_REST_API_TOKEN: 't2' });
  assert.equal(p.source, 'STORAGE_KV_REST_API_URL'); assert.equal(p.token, 't2');
  const c = s.resolveStore({ KV_URL: 'rediss://default:abc%3D@c.upstash.io:6379' });
  assert.deepEqual([c.url, c.token, c.source], ['https://c.upstash.io', 'abc=', 'KV_URL']);
  assert.equal(s.resolveStore({ REDIS_URL: 'redis://default:x@other-host.example:6379' }).source, null); // Upstash 以外は使わない
  assert.equal(s.resolveStore({ KV_REST_API_URL: 'https://x.upstash.io' }).source, null); // トークンが無ければ未設定
  assert.equal(s.resolveStore({}).source, null);
});

test('トークンの誤り・読み取り専用・接続失敗を見分ける（どれも 503）', async () => {
  reply = () => new Response('{"error":"Unauthorized"}', { status: 401 });
  await assert.rejects(s.kv('PING'), (e) => e.status === 503 && e.message === 'STORE_AUTH_FAILED');
  reply = () => new Response(JSON.stringify({ error: 'NOPERM this user has no permissions to run the set command' }), { status: 400 });
  await assert.rejects(s.kv('SET', 'a', 'b'), (e) => e.message === 'STORE_READ_ONLY_TOKEN');
  reply = () => { throw new TypeError('fetch failed'); };
  await assert.rejects(s.kv('PING'), (e) => e.message === 'STORE_UNREACHABLE');
  const h = await s.storeHealth();
  assert.deepEqual([h.configured, h.reachable, h.error, h.source], [true, false, 'STORE_UNREACHABLE', 'KV_REST_API_URL']);
});

test('保存先につながらない時、利用回数の確認は失敗する（制限を外さない）', async () => {
  reply = () => { throw new TypeError('fetch failed'); };
  await assert.rejects(s.claimUser('user-aaaaaaaa', 'device-key-1'), /STORE_UNREACHABLE/);
});
