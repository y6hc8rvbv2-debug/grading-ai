// 模範解答の自動入力が「読み取り中」のまま止まらないことの単体テスト。本物の API・ブラウザは使わない。
//   - lib/test-import-client.ts：通信の待ち時間の上限・中止・同じ requestId での待ち直し・失敗の理由
//   - lib/ai-consent.ts：同意の画面が受け取らなければ待ち続けない・答えるまで待つ
//   - 同意の画面が、開いている画面（Modal）の裏に隠れない（静的な検査）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pollTestImport, ImportStopped, type ImportParams } from "@/lib/test-import-client";

const params: ImportParams = { requestId: "11111111-1111-4111-8111-111111111111", files: [{ path: "s/imports/r/1.jpg", kind: "key", name: "1.jpg" }] };
const result = { title: "t", subject: "数学", maxScore: 4, questions: [], warnings: [] };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** 呼ばれた要求の本文を記録する fetch の代役 */
function fakeFetch(handler: (n: number, init: RequestInit) => Promise<Response>) {
  const bodies: string[] = [];
  const f = (async (_url: unknown, init: RequestInit) => { bodies.push(String(init.body)); return handler(bodies.length, init); }) as typeof fetch;
  return { f, bodies };
}
/** signal で中断されるまで応答しない要求（通信が止まった状態） */
const hang = (init: RequestInit) => new Promise<Response>((_, reject) => {
  init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
});

test("実行中（202）のあいだは同じ requestId で待ち直し、終わったら結果を返す", async () => {
  const { f, bodies } = fakeFetch(async (n) => (n < 3 ? json(202, { ok: true, pending: true }) : json(200, { ok: true, importId: "imp", result, cached: false })));
  const r = await pollTestImport(params, undefined, { fetch: f, pollMs: 1 });
  assert.equal(r.importId, "imp");
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every((b) => JSON.parse(b).requestId === params.requestId), "待ち直しはすべて同じ requestId（AI を二重に呼ばない）");
});

test("応答が来ない要求は1回の上限で打ち切り、全体の上限で理由を示して止まる（無期限に待たない）", async () => {
  const { f, bodies } = fakeFetch((_n, init) => hang(init));
  const t0 = Date.now();
  await assert.rejects(pollTestImport(params, undefined, { fetch: f, requestTimeoutMs: 30, totalTimeoutMs: 120, pollMs: 1 }), (e: unknown) => {
    assert.ok(e instanceof ImportStopped);
    assert.equal(e.reason, "timeout");
    assert.equal(e.resumable, true, "時間切れは、同じ読み取りの結果を確かめ直せる");
    assert.match(e.message, /終わりませんでした/);
    assert.match(e.message, /資料と入力内容は残っています/);
    return true;
  });
  assert.ok(Date.now() - t0 < 2000);
  assert.ok(bodies.length >= 2, "1回の上限で打ち切って、同じ requestId で確かめ直す");
});

test("サーバーが 504（関数の時間切れ）を返し続けても、全体の上限で止まる", async () => {
  const { f } = fakeFetch(async () => json(504, { error: "timeout" }));
  await assert.rejects(pollTestImport(params, undefined, { fetch: f, totalTimeoutMs: 50, pollMs: 5 }),
    (e: unknown) => e instanceof ImportStopped && e.reason === "timeout");
});

test("画面の「中止する」で、待っている要求をすぐに止める", async () => {
  const ctrl = new AbortController();
  const { f } = fakeFetch((_n, init) => hang(init));
  setTimeout(() => ctrl.abort(), 20);
  await assert.rejects(pollTestImport(params, ctrl.signal, { fetch: f }), (e: unknown) => {
    assert.ok(e instanceof ImportStopped);
    assert.equal(e.reason, "cancel");
    assert.equal(e.resumable, true);
    return true;
  });
});

test("サーバーの失敗は理由をそのまま示し、次は新しい読み取りにする（resumable=false）", async () => {
  const { f } = fakeFetch(async () => json(409, { error: "前回の読み取りが時間内に終わりませんでした。", code: "failed" }));
  await assert.rejects(pollTestImport(params, undefined, { fetch: f }), (e: unknown) => {
    assert.ok(e instanceof ImportStopped);
    assert.equal(e.resumable, false);
    assert.match(e.message, /前回の読み取り/);
    return true;
  });
});

test("通信の失敗が続いたら、接続の確認を案内して止める", async () => {
  const { f, bodies } = fakeFetch(async () => { throw new TypeError("Failed to fetch"); });
  const ctrl = new AbortController();
  // 再試行の待ち（2秒・4秒・6秒）を短くするため、待ちの途中で中止はせず、上限回数で止まることだけを見る
  const p = pollTestImport(params, ctrl.signal, { fetch: f });
  await assert.rejects(p, (e: unknown) => e instanceof ImportStopped && e.reason === "network");
  assert.equal(bodies.length, 4);
});

/* ---------------------------------------------------------------- AI への送信の同意 */

class MemoryStorage { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const g = globalThis as unknown as { window: EventTarget; localStorage: MemoryStorage };
g.window = new EventTarget();
g.localStorage = new MemoryStorage();

test("同意の画面が受け取らなければ、待ち続けずに理由を示して止める（AI には送らない）", async () => {
  const { requireAiConsent } = await import("@/lib/ai-consent");
  await assert.rejects(requireAiConsent(), /同意を確認する画面を表示できませんでした/);
});

test("同意の画面が受け取ったら、先生が答えるまで待つ（送らない → 例外、同意 → 続ける）", async () => {
  const { requireAiConsent, onAiConsentRequest, hasAiConsent, setAiConsent } = await import("@/lib/ai-consent");
  const answers: boolean[] = [false, true];
  const off = onAiConsentRequest((done) => { const a = answers.shift()!; setTimeout(() => done(a), 1500); });
  await assert.rejects(requireAiConsent(), /同意していないため/, "1秒を過ぎても、画面が受け取っていれば止めない");
  assert.equal(hasAiConsent(), false);
  await requireAiConsent();
  assert.equal(hasAiConsent(), true);
  off();
  // 端末に保存できない環境でも、同じ画面のあいだは2度たずねない。取り消したら、またたずねる
  g.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } } as unknown as MemoryStorage;
  assert.equal(hasAiConsent(), true);
  setAiConsent(false);
  assert.equal(hasAiConsent(), false);
});

test("同意の画面は document.body に出し、開いている画面（Modal の既定の重なり順 200）より手前に重ねる", () => {
  const dialog = readFileSync(new URL("../../components/AiConsentDialog.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../../components/ui.tsx", import.meta.url), "utf8");
  assert.match(dialog, /createPortal\(/);
  assert.match(dialog, /document\.body/);
  const z = Number(dialog.match(/AI_CONSENT_Z = (\d+)/)?.[1]);
  const modalDefault = Number(ui.match(/zIndex = (\d+) \}: P\)/)?.[1]);
  const toast = Number(ui.match(/bottom: 14, zIndex: (\d+)/)?.[1]);
  assert.ok(modalDefault > 0 && z > modalDefault && z > toast, `同意の画面 ${z} > 画面 ${modalDefault}・通知 ${toast}`);
  assert.match(dialog, /zIndex=\{AI_CONSENT_Z\}/);
});

test("「テストを追加」は、資料を保存する前に同意を確かめ、待ち時間の上限と中止を持つ", () => {
  const form = readFileSync(new URL("../../components/screens/NewTestForm.tsx", import.meta.url), "utf8");
  const run = form.slice(form.indexOf("const runImport = async"), form.indexOf("const applyImport = "));
  assert.ok(run.indexOf("await requireAiConsent()") > 0 && run.indexOf("await requireAiConsent()") < run.indexOf("uploadWithLimit("), "同意 → 保存 → 読み取り の順");
  assert.match(run, /importTestKey\([\s\S]*\{ signal: ctrl\.signal \}\)/);
  assert.match(form, /待つのを中止する/);
  assert.match(run, /pendingImport\.current\?\.key === key \? pendingImport\.current\.requestId/, "時間切れ・中止のあとは同じ requestId で確かめ直す");
});

test("サーバーは AI の呼び出しに期限を付け、強制終了で残った「実行中」を片付ける", () => {
  const route = readFileSync(new URL("../../app/api/test-import/route.ts", import.meta.url), "utf8");
  const deadline = Number(route.match(/AI_DEADLINE_MS = (\d+)_(\d+)/)?.slice(1).join(""));
  const maxDuration = Number(route.match(/maxDuration = (\d+)/)?.[1]);
  assert.ok(deadline > 0 && deadline < maxDuration * 1000, "Vercel の上限より前に AI の呼び出しを打ち切る");
  // ver6：1回の呼び出しは ask() にまとめ、どの呼び出しにも期限（deadline.signal か、それに連動する判定の signal）を渡す
  assert.match(route, /\{ signal: o\.signal \}\)\.finalMessage\(\)/);
  assert.match(route, /signal: deadline\.signal/);
  assert.match(route, /deadline\.signal\.addEventListener\("abort", onDeadline/);
  assert.match(route, /\.eq\("input_sha", inputSha\)\.eq\("status", "running"\)\.lt\("created_at", staleBefore\)/);
  assert.match(route, /STALE_RUNNING_MS = \(maxDuration \+ 60\) \* 1000/);
});
