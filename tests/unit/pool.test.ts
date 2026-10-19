// 並列処理（lib/workflow/pool.ts）の単体テスト
import test from "node:test";
import assert from "node:assert/strict";
import { runPool, withBusyRetry } from "../../lib/workflow/pool";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("同時に N 件まで動かし、結果は入力の順番で返す", async () => {
  let running = 0, peak = 0;
  const out = await runPool([30, 10, 20, 5, 15, 25], 3, async (ms, i) => {
    running++; peak = Math.max(peak, running);
    await sleep(ms);
    running--;
    return i * 10;
  });
  assert.equal(peak, 3);
  assert.deepEqual(out.map((r) => (r.ok ? r.value : null)), [0, 10, 20, 30, 40, 50]);
});

test("100件を8件ずつ：順番に待つより大幅に速い", async () => {
  const t0 = Date.now();
  await runPool(Array.from({ length: 100 }, (_, i) => i), 8, async () => sleep(20));
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 100 * 20 / 3, `並列 ${elapsed}ms（順番なら約2000ms）`);
});

test("1件の失敗で全体を止めない", async () => {
  const out = await runPool([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error("だめ"); return n; });
  assert.equal(out[0].ok, true);
  assert.equal(out[1].ok, false);
  assert.equal(out[2].ok, true);
});

test("中止したら、まだ始めていない件は始めない", async () => {
  const ac = new AbortController();
  const started: number[] = [];
  const out = await runPool([1, 2, 3, 4, 5], 1, async (n) => { started.push(n); if (n === 2) ac.abort(); return n; }, { signal: ac.signal });
  assert.deepEqual(started, [1, 2]);
  assert.equal(out.filter((r) => !r.ok && r.skipped).length, 3);
});

test("混み合いのときだけ待ってやり直す", async () => {
  let n = 0;
  const v = await withBusyRetry(async () => { if (++n < 3) throw new Error("採点AIが混み合っています"); return "ok"; }, { sleep: async () => {} });
  assert.equal(v, "ok");
  assert.equal(n, 3);
  let m = 0;
  await assert.rejects(withBusyRetry(async () => { m++; throw new Error("画像が大きすぎます"); }, { sleep: async () => {} }));
  assert.equal(m, 1, "混み合い以外の失敗はやり直さない");
  let k = 0;
  await assert.rejects(withBusyRetry(async () => { k++; throw new Error("混み合って"); }, { retries: 2, sleep: async () => {} }));
  assert.equal(k, 3, "やり直しは回数まで");
});
