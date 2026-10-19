// 同時に N 件ずつ処理する（ver6：答案の保存・AI採点・振り分けを並列にして、全体の時間を短くする）。
// 結果は入力と同じ順番で返す。1件の失敗で全体を止めない（失敗は { ok: false, error } として返す）。
// signal を中止すると、まだ始めていない件は始めない（始めた件は最後まで待つ）。

export type PoolResult<R> = { ok: true; value: R } | { ok: false; error: unknown; skipped?: boolean };

export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  opts: { signal?: AbortSignal; onSettled?: (index: number, result: PoolResult<R>) => void } = {},
): Promise<PoolResult<R>[]> {
  const results: PoolResult<R>[] = new Array(items.length);
  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length || 1));
  let next = 0;
  const lane = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      if (opts.signal?.aborted) {
        results[i] = { ok: false, error: new Error("中止しました"), skipped: true };
        opts.onSettled?.(i, results[i]);
        continue;
      }
      try {
        results[i] = { ok: true, value: await worker(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
      opts.onSettled?.(i, results[i]);
    }
  };
  await Promise.all(Array.from({ length: limit }, lane));
  return results;
}

/** 混み合い（429・「混み合って」）のときだけ、少し待ってからやり直す。それ以外の失敗はすぐ返す */
export async function withBusyRetry<R>(fn: () => Promise<R>, opts: { retries?: number; waitMs?: number; isBusy?: (e: unknown) => boolean; sleep?: (ms: number) => Promise<void> } = {}): Promise<R> {
  const retries = opts.retries ?? 2;
  const isBusy = opts.isBusy ?? ((e) => /混み合って|429|rate.?limit/i.test(e instanceof Error ? e.message : String(e)));
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries || !isBusy(e)) throw e;
      // 少しずつ待ち時間を延ばし、同時に再開しないようにばらつかせる
      await sleep((opts.waitMs ?? 15_000) * (attempt + 1) * (0.75 + Math.random() * 0.5));
    }
  }
}
