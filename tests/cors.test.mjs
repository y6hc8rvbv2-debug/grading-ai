// iPhoneアプリからの通信だけを許可し、他のサイトからは許可しないことのテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { corsHeaders } = await import(new URL('../api/_store.js', import.meta.url));

test('iPhoneアプリ（capacitor://localhost）は許可', () => {
  assert.equal(corsHeaders('capacitor://localhost')['access-control-allow-origin'], 'capacitor://localhost');
});
test('他のサイト・空の値は許可しない', () => {
  assert.deepEqual(corsHeaders('https://evil.example'), {});
  assert.deepEqual(corsHeaders(undefined), {});
  assert.deepEqual(corsHeaders('capacitor://localhost.evil.example'), {});
});
