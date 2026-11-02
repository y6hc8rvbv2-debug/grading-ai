// 夜間の Batch 採点・上限を超えた分の従量課金・学校の Opus単独の追加料金（2026-11-02。0026）の画面・API のテスト。
//   tests/e2e-lite/run.sh から、課金と夜間採点を有効にした4つ目のアプリ（同じビルド）に対して呼ぶ。
//   採点AI は代役（tests/e2e/mock-anthropic.mjs の Message Batches）、決済は Stripe の代役（次回の請求に加える項目）。本物には接続しない
//   テストは昼に動くため、取り出しの関数（billing_claim_queue）の「日本時間22時〜6時」の条件だけを、テストの DB で外す（最後に戻す）
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const BASE = process.env.NIGHT_URL, PG = process.env.PG_URL, MOCK = process.env.MOCK_URL, STRIPE = process.env.STRIPE_MOCK_URL, SECRET = process.env.WORKER_SECRET;
const ok = (cond, msg) => { if (!cond) { console.log("✗ FAIL:", msg); throw new Error(msg); } console.log("✓", msg); };
const sql = (q) => execFileSync("psql", [PG, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const S = "b1ab1ab1-0000-0000-0000-000000000000";
const id = (tail) => `b1ab1ab1-0000-0000-0000-${tail.padStart(12, "0")}`;
const TEST = id("e1"), CLASS = id("c1");
const sub = (n) => id(`5${n}`);
const PW = "pass-lite-123";

// ---------------------------------------------------------------- 初期データ（架空の学校・夜間の学校ミニ・上限3）
sql(`insert into public.schools (id, name, code) values ('${S}', '夜間採点の確認校（架空）', 'NIGHT-1');
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ('${id("a1")}', 'night-admin@lite.example', now(), '{"school_id":"${S}","role":"admin"}');
insert into public.classes (id, school_id, grade, name, school_year) values ('${CLASS}', '${S}', 1, 'N1', 2026);
insert into public.tests (id, school_id, name, subject, grade, max_score) values ('${TEST}', '${S}', '夜間テスト', '数学', 1, 10);
insert into public.questions (school_id, test_id, no, label, qtype, unit, points, correct) values
 ('${S}', '${TEST}', 1, '1', 'calc', '', 5, '12'), ('${S}', '${TEST}', 2, '2', 'calc', '', 5, '7');
insert into public.students (id, school_id, class_id, number, exam_no, anon_id)
 select ('b1ab1ab1-0000-0000-0000-0000000000d' || n)::uuid, '${S}', '${CLASS}', n, 'N0' || n, 'N0' || n from generate_series(1, 7) n;
insert into public.submissions (id, school_id, test_id, student_id, class_id, status, progress, image_paths)
 select ('b1ab1ab1-0000-0000-0000-00000000005' || n)::uuid, '${S}', '${TEST}', ('b1ab1ab1-0000-0000-0000-0000000000d' || n)::uuid, '${CLASS}', 'uploaded', 0,
        array['${S}/${TEST}/' || n || '/1.png'] from generate_series(1, 7) n;
update public.billing_config set enabled = true where id = true;
insert into public.billing_accounts (school_id, customer_id, subscription_id, plan_id, status, quota, personal, night)
 values ('${S}', 'cus_night_fixture', 'sub_night_fixture', 'school-mini-night', 'active', 3, false, true);
update public.billing_worker_state set last_seen = now() where id = true;`);
const claimSrc = sql(`select pg_get_functiondef('public.billing_claim_queue()'::regprocedure)`);
sql(claimSrc.replace(/and \(not nq\.night or[\s\S]*?exists\(select 1 from public\.grading_stages s where s\.job_id=nq\.id\)\)/, "").replace(/\n/g, " "));

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(BASE + "/login");
await page.getByLabel("メールアドレス").fill("night-admin@lite.example");
await page.getByLabel("パスワード").fill(PW);
await page.getByRole("button", { name: "ログイン", exact: true }).click();
await page.waitForURL(BASE + "/");
const api = (path, body, headers = {}) => page.evaluate(async ([p, b, h]) => {
  const r = await fetch(p, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [path, body, headers]);
const grade = (n, extra = {}) => api("/api/grade", { submissionId: sub(n), mode: "cascade", requestId: crypto.randomUUID(), ...extra });
const worker = async () => {
  const r = await fetch(`${BASE}/api/billing/worker`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const mockReq = async () => (await fetch(`${MOCK}/__requests`)).json();
const status = (n) => sql(`select status || '/' || coalesce(total_score::text, '-') from public.submissions where id = '${sub(n)}'`);
const dueNow = () => sql(`update public.night_queue set due_at = now() - interval '1 minute' where school_id = '${S}' and status = 'queued'`);
/** 定期処理を、答案がすべて終わるまで回す（Batch の結果は2回目の確認で出る） */
async function drain(ns, max = 8) {
  for (let i = 0; i < max && ns.some((n) => !/^(done|review)/.test(status(n))); i++) { dueNow(); const r = await worker(); if (r.status !== 200) throw Error(`worker ${r.status} ${JSON.stringify(r.json)}`); }
}

// ---------------------------------------------------------------- 1. 夜間の答案は Batch にまとめて送り、結果が出たら保存する
for (const n of [1, 2]) {
  const r = await grade(n);
  ok(r.status === 200 && r.json?.queued, `夜間のコース：採点は予約になる（答案${n}）`);
}
dueNow();
const w1 = await worker();
ok(w1.status === 200 && w1.json?.submitted === 2, `定期処理：2人分を1つの Batch にまとめて送った（${JSON.stringify(w1.json)}）`);
let reqs = await mockReq();
const created = reqs.filter((r) => r.kind === "batch-create");
ok(created.length === 1 && created[0].count === 2, "Batch の要求は1回・2件");
ok(reqs.filter((r) => r.kind === "batch-grade").every((r) => r.problems.length === 0 && r.model === "claude-haiku-5-5"), "Batch の中身は3モデル併用の1段目（Haiku）で、要求の形に問題なし");
ok(reqs.filter((r) => r.kind === "grade").length === 0, "すぐの採点（割引なし）は呼んでいない");
ok(sql(`select count(*) from public.grading_stages s join public.ai_batches b on b.id = s.batch_id where s.school_id = '${S}' and s.status = 'calling' and b.status = 'in_progress'`) === "2", "段階の記録は Batch に結び付いて結果待ち");
const w2 = await worker();
ok(w2.json?.applied === 0 && status(1).startsWith("processing"), "結果がまだ出ていない間は待つ（呼び直さない）");
await worker();
ok(/^done\/10/.test(status(1)) && /^done\/10/.test(status(2)), `Batch の結果で採点が終わった（${status(1)}・${status(2)}）`);
const cost = Number(sql(`select cost_usd from public.grading_stages where submission_id = '${sub(1)}'`));
ok(Math.abs(cost - (1200 * 0.10 + 300 * 0.50) / 1e6 * 0.5) < 1e-9, `AI の費用は通常の半分で記録（$${cost}）`);
ok(sql(`select count(*) from public.ai_batches where status = 'ended'`) === "1", "Batch の記録は終わり");

// ---------------------------------------------------------------- 2. 確認が必要な答案は、次の Batch で上の段階（Sonnet）に回す
await fetch(`${MOCK}/__script`, { method: "POST", body: JSON.stringify({ "claude-haiku-5-5": ["contradict"] }) });
ok((await grade(3)).json?.queued, "答案3を予約");
await drain([3]);
reqs = await mockReq();
ok(reqs.some((r) => r.kind === "batch-grade" && r.model === "claude-sonnet-5-5" && r.problems.length === 0), "1段目で点検の理由が残った答案は、次の Batch で Sonnet に回した");
ok(/^(done|review)\/10/.test(status(3)), `上の段階の結果で採点が終わった（${status(3)}）`);
ok(sql(`select count(*) from public.billing_usage where school_id = '${S}' and status = 'done'`) === "3", "3答案で今月の上限（3）に達した");

// ---------------------------------------------------------------- 3. 上限を超えた分：管理者が有効にするまでは止まる → 有効にすると警告と単価 → 同意して採点 → 翌月の請求に加える
let r = await grade(4);
ok(r.status === 409 && r.json?.code === "quota_overage_off" && /管理者/.test(r.json?.error), "従量課金が無効の間は、上限で止まり、管理者が有効にする方法を案内");
ok((await api("/api/billing", { action: "overage", enabled: true, capYen: 100 })).status === 401, "従量課金の設定にはパスワードの確認が要る");
r = await api("/api/billing", { action: "overage", enabled: true, capYen: 100, password: PW });
ok(r.status === 200 && r.json?.ok, "管理者が従量課金を有効にした（月の上限額100円）");
r = await grade(4);
ok(r.status === 402 && r.json?.code === "overage_consent" && r.json?.unitYen === 20 && r.json?.tax === "税別" && r.json?.capYen === 100, `同意が無いと採点せず、警告と単価を返す（${r.json?.error}）`);
r = await grade(4, { overageConsent: true });
ok(r.status === 200 && r.json?.queued, "同意すると、従量課金で予約を受け付ける");
ok((await grade(5, { overageConsent: true })).json?.queued, "答案5も同意して予約");
// ストア用のアプリの中からの同意は受け付けない（追加料金がかかる操作をアプリでさせない）
const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
const native = await fetch(`${BASE}/api/grade`, { method: "POST", headers: { cookie, origin: BASE, "content-type": "application/json", "user-agent": "Mozilla/5.0 (iPhone) TestSaitenApp/1" },
  body: JSON.stringify({ submissionId: sub(6), mode: "cascade", requestId: crypto.randomUUID(), overageConsent: true }) });
const nj = await native.json();
ok(native.status === 402 && nj.code === "overage_consent", "ストア用のアプリからは、従量課金の同意を受け付けない（402 のまま）");
await drain([4, 5]);
await worker();   // 請求は、採点が終わった次の回の定期処理で Stripe に加える（本番は毎分）
ok(sql(`select string_agg(charge_status, ',' order by created_at) from public.billing_usage where school_id = '${S}' and kind = 'overage'`).split(",").every((x) => x === "synced"), "採点が終わった超過分は、次回の請求に加えた（Stripe）");
let items = await (await fetch(`${STRIPE}/__invoiceitems`)).json();
const over = items.filter((i) => i["metadata[kind]"] === "overage");
ok(over.length === 2 && over.every((i) => i.amount === "20" && i.currency === "jpy" && i.subscription === "sub_night_fixture" && i["tax_rates[0]"] === "txr_test_jp10"),
  "請求の項目：1答案20円（税別・消費税の税率つき）を、この契約の次回の請求に");
await worker();
ok((await (await fetch(`${STRIPE}/__invoiceitems`)).json()).length === items.length, "同じ答案を二重に請求しない");
ok(sql(`select sum(overage_yen) from public.billing_usage where school_id = '${S}'`) === "40", "今月の従量課金は40円");

// ---------------------------------------------------------------- 4. 学校の Opus単独：同意が無いと断る → 同意すると 50円（税別）を翌月の請求に
sql(`update public.billing_accounts set quota = 100 where school_id = '${S}'`);
r = await api("/api/grade", { submissionId: sub(7), mode: "opus", requestId: crypto.randomUUID() });
ok(r.status === 402 && r.json?.code === "school_opus_consent" && r.json?.unitYen === 50, `学校の Opus単独は、同意が無いと採点せず金額を返す（${r.json?.error}）`);
r = await api("/api/grade", { submissionId: sub(7), mode: "opus", requestId: crypto.randomUUID(), opusConsent: true });
ok(r.status === 200 && r.json?.queued, "同意すると受け付ける（学校はその場の支払いではない）");
await drain([7]);
await worker();
reqs = await mockReq();
ok(reqs.some((x) => x.kind === "batch-grade" && x.model === "claude-opus-5-5" && x.problems.length === 0), "夜間の Opus単独も Batch で送る（Batch では fallbacks を付けない）");
items = await (await fetch(`${STRIPE}/__invoiceitems`)).json();
ok(items.some((i) => i["metadata[kind]"] === "opus" && i.amount === "50" && i["tax_rates[0]"] === "txr_test_jp10"), "学校の Opus単独：50円（税別）を次回の請求に加えた");

// ---------------------------------------------------------------- 5. 画面と表記
await page.goto(BASE + "/");
await page.getByText("上限を超えた分の従量課金：有効（月の上限額 100円）").waitFor({ timeout: 20000 });
ok(true, "ダッシュボードのサブスクリプションに、従量課金の状態（有効・月の上限額）を表示");
ok((await page.evaluate(() => document.body.innerText)).includes("1答案 20円（税別）"), "従量課金の単価を表示");
await page.goto(BASE + "/tokushoho");
const t = await page.evaluate(() => document.body.innerText);
ok(t.includes("学校プランの「Opus 単独」の採点：1回（1枚）につき 50円（税別）") && t.includes("月の上限を超えた分"), "特定商取引法に基づく表記に、学校の Opus単独と従量課金の料金を書いた");
ok(errors.length === 0, `画面のエラーなし${errors.length ? "：" + errors.slice(0, 2).join(" / ") : ""}`);

sql(claimSrc.replace(/\n/g, " "));
sql("update public.billing_config set enabled = false where id = true");
await browser.close();
console.log("✓ 夜間の Batch 採点・従量課金・学校の Opus単独の追加料金");
