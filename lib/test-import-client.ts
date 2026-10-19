// 模範解答・配点表の自動入力：ブラウザから /api/test-import を呼び、終わるまで待つ（lib/data/supabase.ts の importTestKey）。
//
// 無期限に待たない
//   - 1回の要求は IMPORT_REQUEST_TIMEOUT_MS で打ち切る（サーバーの上限 maxDuration=300秒 ＋ 余裕）
//   - 全体は IMPORT_TOTAL_TIMEOUT_MS で打ち切り、理由を示して例外にする
//   - 画面の「中止」（signal）で、すぐに止める
// AI を二重に呼ばない
//   - 待ち直し・再送は同じ requestId で行う。サーバーは同じ requestId を同じ読み取りとして扱う（実行中は 202、終わっていれば同じ結果）
//   - 時間切れ・中止・通信の失敗は resumable=true。画面は同じ requestId を覚えておき、次の「読み取る」で結果を確かめる
import type { ImportResult } from "@/lib/types";

export const IMPORT_REQUEST_TIMEOUT_MS = 330_000;
export const IMPORT_TOTAL_TIMEOUT_MS = 9 * 60_000;
const POLL_MS = 3000;
const MAX_NETWORK_ERRORS = 3;

export type ImportParams = {
  requestId: string; files: { path: string; kind: "key" | "paper" | "student"; name: string }[]; force?: boolean; generate?: boolean;
};
export type ImportResponse = { importId: string; result: ImportResult; cached: boolean };

/** 読み取りを止めたときの例外。resumable なら、同じ requestId で結果を確かめ直せる（AI は呼び直さない） */
export class ImportStopped extends Error {
  constructor(message: string, public reason: "timeout" | "cancel" | "network" | "server", public resumable: boolean) {
    super(message);
  }
}

export const CANCELLED_MESSAGE =
  "読み取りの待機を中止しました。資料と入力内容は残っています。もう一度「AIで読み取って入力する」を押すと、同じ読み取りの結果を確かめます（AI を二重に呼びません）。";

type Deps = {
  fetch?: typeof fetch; now?: () => number; requestTimeoutMs?: number; totalTimeoutMs?: number; pollMs?: number;
};

const minutes = (ms: number) => Math.round(ms / 60_000);

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); signal?.removeEventListener("abort", done); resolve(); }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function pollTestImport(params: ImportParams, signal?: AbortSignal, deps: Deps = {}): Promise<ImportResponse> {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const total = deps.totalTimeoutMs ?? IMPORT_TOTAL_TIMEOUT_MS;
  const perRequest = deps.requestTimeoutMs ?? IMPORT_REQUEST_TIMEOUT_MS;
  const pollMs = deps.pollMs ?? POLL_MS;
  const deadline = now() + total;
  const cancelled = () => new ImportStopped(CANCELLED_MESSAGE, "cancel", true);
  const timedOut = () => new ImportStopped(
    `読み取りが${minutes(total)}分たっても終わりませんでした。資料と入力内容は残っています。` +
    "もう一度「AIで読み取って入力する」を押すと、同じ読み取りの結果を確かめます（AI を二重に呼びません）。続けて失敗するときは、資料の枚数を減らしてください。",
    "timeout", true);
  let networkErrors = 0;

  while (true) {
    if (signal?.aborted) throw cancelled();
    const left = deadline - now();
    if (left <= 0) throw timedOut();

    // 1回の要求：画面の中止・1回の上限・全体の期限のどれかで打ち切る
    const ctrl = new AbortController();
    let expired = false;
    const timer = setTimeout(() => { expired = true; ctrl.abort(); }, Math.min(perRequest, left));
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let res: Response;
    try {
      res = await doFetch("/api/test-import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params), signal: ctrl.signal,
      });
    } catch {
      if (signal?.aborted) throw cancelled();
      if (expired) continue;                       // 応答が来ない：同じ requestId で状態を確かめ直す（全体の期限で止まる）
      if (++networkErrors > MAX_NETWORK_ERRORS) {
        throw new ImportStopped(
          "サーバーに接続できないため読み取れませんでした。インターネット接続を確認して、もう一度お試しください（資料と入力内容は残っています）。",
          "network", true);
      }
      await sleep(2000 * networkErrors, signal);
      continue;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    const json = await res.json().catch(() => null) as { ok?: boolean; error?: string; importId?: string; result?: ImportResult; cached?: boolean } | null;
    if (res.status === 202 || res.status === 504 || (res.status === 502 && !json)) { await sleep(pollMs, signal); continue; }
    if (!res.ok || !json?.ok) {
      throw new ImportStopped(json?.error ?? `読み取りに失敗しました（HTTP ${res.status}）。時間をおいて、もう一度お試しください。`, "server", false);
    }
    return { importId: json.importId!, result: json.result!, cached: !!json.cached };
  }
}
