// 料金・決済の画面テスト（tests/e2e-lite/run.sh から、store.mjs の後に呼ぶ）。本物の Stripe・本物の AI には接続しない。
//   Stripe は代役（stripe-mock.mjs）、採点AI は罠（要求が来たら 500）。アプリは課金を有効にした2つ目のサーバー（BILL_URL）で動かす。
//   確かめること：16コースの表示（税込/税別・答案/枚・桁区切り・料金ID を出さない）→ 申し込めないコースの理由 → 画面から送った値を使わない →
//   決済画面への引き渡し（テスト用の料金ID・学校は税率つき）→ 戻ってきただけでは有料にならない → 署名つきの通知で契約を反映 →
//   通知の重複でも枠を二重に付けない → 採点の上限の境目（失敗は枠を戻す・上限で断り AI を呼ばない）→ 解約で無料に戻る
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { COURSES } from "../../lib/subscription-plans.ts";
import { limitLabel, priceLabel } from "../../lib/subscription-plans.ts";

const BASE = process.env.BILL_URL, MOCK = process.env.STRIPE_MOCK_URL, TRAP = process.env.TRAP_URL, PG = process.env.PG_URL;
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const ok = (cond, msg) => { if (!cond) { console.log("✗ FAIL:", msg); throw new Error(msg); } console.log("✓", msg); };
const sql = (q) => execFileSync("psql", [PG, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const SCHOOL = "eeeeeeee-0000-0000-0000-000000000000";
const mockLog = async () => (await fetch(`${MOCK}/__log`)).json();
const trapHits = async () => (await (await fetch(`${TRAP}/__hits`)).json()).length;
const stripe = new Stripe("sk_test_signature_only");
const hook = async (type, object, { badSignature = false } = {}) => {
  const payload = JSON.stringify({ id: `evt_${randomUUID()}`, object: "event", type, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: badSignature ? "whsec_wrong" : SECRET });
  const r = await fetch(`${BASE}/api/billing/webhook`, { method: "POST", headers: { "stripe-signature": header, "content-type": "application/json" }, body: payload });
  return r.status;
};

sql("update public.billing_config set enabled = true where id = true");
const errors = [];
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));
// 申し込み・前払い・契約の管理はパスワードの聞き直しが要る（再認証）。テストでは、指定が無ければ正しいパスワードを付ける
const withPassword = (path, body) => body && typeof body === "object" && !("password" in body) && (path === "/api/billing/prepaid" || (path === "/api/billing" && body.action !== "resync"))
  ? { ...body, password: "pass-lite-123" } : body;
const api = (path, body) => rawApi(path, withPassword(path, body));
const rawApi = (path, body) => page.evaluate(async ([p, b]) => {
  const r = await fetch(p, b === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [path, body]);

await page.goto(BASE + "/login");
await page.getByLabel("メールアドレス").fill("admin@lite.example");
await page.getByLabel("パスワード").fill("pass-lite-123");
await page.getByRole("button", { name: "ログイン" }).click();
await page.waitForURL(BASE + "/");
await page.getByText("選んだコースを月額で申し込む").first().waitFor();

// ---------------------------------------------------------------- 表示：16コース
const text = await page.evaluate(() => document.body.innerText);
ok(text.includes("個人・塾プラン") && text.includes("学校プラン") && text.includes("通常採点") && text.includes("夜間採点"), "個人・塾と学校を分け、それぞれ通常採点・夜間採点を表示");
for (const c of COURSES) ok(text.includes(priceLabel(c)) && text.includes(limitLabel(c)), `${c.key}：${priceLabel(c)}・${limitLabel(c)}`);
ok(!/price_|txr_|cus_|利益|原価/.test(text), "料金ID・Stripe の内部ID・原価・利益を表示しない");
ok(!text.includes("翌日結果") && text.includes("終わる時刻は答案の量や混み具合で変わり、お約束できません"), "夜間採点の納期を約束しない（既存の仕様の22時〜翌6時の処理だけを書く）");
ok(text.includes("無料プラン") && text.includes("月30答案まで・3モデル併用で採点"), "無料プランは月30答案まで・3モデル併用");

// ---------------------------------------------------------------- 申し込めるか（サーバーが判定）
const info = (await api("/api/billing")).json;
ok(info.availability["personal-mini"].ok && info.availability["school-mini"].ok, "通常のコース（個人・学校）は申し込める");
ok(COURSES.filter((c) => c.night).every((c) => !info.availability[c.key].ok && /夜間採点/.test(info.availability[c.key].reason)), "夜間採点が無効の環境：夜間の8コースは理由を出して申し込みを止める");
ok(!JSON.stringify(info).includes("price_"), "契約情報の API は料金ID を返さない");
ok(text.includes("夜間採点のコースは、現在お申し込みを受け付けていません"), "止めている理由が画面に出る");

// ---------------------------------------------------------------- 画面から送った値を使わない
const before = (await mockLog()).filter((x) => x.path === "/v1/checkout/sessions").length;
for (const bad of [{ planId: "price_1UPkN679SNi0pstBtGaeLtlf" }, { planId: "personal-mini-night" }, { planId: { id: "personal-mini" } }, { priceId: "price_1UPkN679SNi0pstBtGaeLtlf", amount: 1 }]) {
  const r = await api("/api/billing", bad);
  ok(r.status === 400, `申し込みを断る：${JSON.stringify(bad)}`);
}
ok((await mockLog()).filter((x) => x.path === "/v1/checkout/sessions").length === before, "断った申し込みでは決済画面を作らない");

// ---------------------------------------------------------------- 決済画面への引き渡し（個人・塾 ミニ）
// 再認証：パスワードが無い・違う申し込みは断り、決済画面を作らない
{
  const n0 = (await mockLog()).filter((x) => x.path === "/v1/checkout/sessions").length;
  const r1 = await rawApi("/api/billing", { planId: "personal-mini" });
  const r2 = await rawApi("/api/billing", { planId: "personal-mini", password: "wrong-password" });
  const r3 = await rawApi("/api/billing/prepaid", { planId: "personal-light", months: 3, method: "stripe", password: "wrong-password" });
  ok([r1, r2, r3].every((r) => r.status === 401 && r.json?.code === "reauth"), "パスワードが無い・違う申し込み・前払いは断る（再認証）");
  ok((await mockLog()).filter((x) => x.path === "/v1/checkout/sessions").length === n0, "再認証に失敗したら決済画面を作らない");
}
await page.getByRole("button", { name: "選んだコースを月額で申し込む" }).first().click();
await page.getByLabel("本人確認のパスワード").fill("pass-lite-123");
await page.getByRole("button", { name: "続ける" }).click();
await page.waitForURL(/\/pay\/cs_test_/);
const created = (await mockLog()).filter((x) => x.path === "/v1/checkout/sessions").at(-1).form;
ok(created.mode === "subscription" && created["line_items[0][price]"] === "price_1UPkN679SNi0pstBtGaeLtlf" && created["line_items[0][quantity]"] === "1", "決済画面には、サーバーが選んだテスト用の料金ID（個人・塾ミニ）を1つだけ渡す");
ok(!created["line_items[0][tax_rates][0]"], "個人・塾（税込）には税率を付けない");
ok((await mockLog()).some((x) => x.path === "/v1/prices/price_1UPkN679SNi0pstBtGaeLtlf"), "申し込みの前に Stripe の料金（金額・税区分・毎月）を確かめる");
const csId = page.url().split("/pay/")[1];

// 成功ページに戻っただけでは有料にならない
await page.goto(BASE + "/billing/return");
await page.getByText("支払いの確認").waitFor();
await page.goto(BASE + "/");
let acc = (await api("/api/billing")).json.account;
ok(acc.status === "free" && acc.quota === 30, "決済画面を開いた・戻っただけでは有料の枠を付けない");

// ---------------------------------------------------------------- 署名つきの通知で契約を反映。重複しても二重に付けない
const done = await (await fetch(`${MOCK}/__complete/${csId}`, { method: "POST" })).json();
ok(await hook("checkout.session.completed", { id: csId, object: "checkout.session" }, { badSignature: true }) === 400, "署名の違う通知は断る");
acc = (await api("/api/billing")).json.account;
ok(acc.status === "free", "署名の違う通知では契約を変えない");
ok(await hook("checkout.session.completed", { id: csId, object: "checkout.session" }) === 200, "支払い完了の通知を受け付ける");
acc = (await api("/api/billing")).json.account;
ok(acc.plan_id === "personal-mini" && acc.status === "active" && acc.quota === 100, "契約を反映：個人・塾ミニ・契約中・月100回");
for (let i = 0; i < 2; i++) ok(await hook("checkout.session.completed", { id: csId, object: "checkout.session" }) === 200, `同じ通知の再送（${i + 1}回目）`);
ok(await hook("customer.subscription.updated", { id: done.subscription, object: "subscription" }) === 200, "契約の更新の通知");
acc = (await api("/api/billing")).json.account;
ok(acc.quota === 100 && acc.plan_id === "personal-mini", "通知が重複しても枠は100のまま（二重に付けない）");

// ---------------------------------------------------------------- 採点の上限の境目（サーバーが判定）
const period = sql(`select period_start from public.billing_accounts where school_id = '${SCHOOL}'`);
sql(`insert into public.billing_usage(id, school_id, submission_id, period_start, status)
     select gen_random_uuid(), '${SCHOOL}', 'eeeeeeee-0000-0000-0000-000000000051', '${period}', 'done' from generate_series(1, 99)`);
const usedNow = () => Number(sql(`select count(*) from public.billing_usage where school_id = '${SCHOOL}' and period_start = '${period}' and status in ('reserved','done')`));
ok(usedNow() === 99, "使用済み 99 / 100");
const hits0 = await trapHits();
let g = await api("/api/grade", { submissionId: "eeeeeeee-0000-0000-0000-000000000051", mode: "cascade", requestId: randomUUID() });
ok(!(g.status === 409 && /上限/.test(g.json?.error || "")), "100回目は受け付ける（上限の手前）");
ok((await trapHits()) > hits0, "100回目は採点AI（罠）を呼んだ");
ok(usedNow() === 99, "採点に失敗した回は枠を戻す（使用済みは 99 のまま）");
sql(`insert into public.billing_usage(id, school_id, submission_id, period_start, status) values (gen_random_uuid(), '${SCHOOL}', 'eeeeeeee-0000-0000-0000-000000000051', '${period}', 'done')`);
const hits1 = await trapHits();
g = await api("/api/grade", { submissionId: "eeeeeeee-0000-0000-0000-000000000051", mode: "cascade", requestId: randomUUID() });
ok(g.status === 409 && /月間採点上限/.test(g.json?.error || ""), "101回目（100 / 100 のあと）は断る");
ok((await trapHits()) === hits1, "上限で断った採点では AI を呼ばない（費用がかからない）");
ok((await api("/api/billing")).json.used === 100, "画面の今期の採点は 100");

// ---------------------------------------------------------------- 解約で無料に戻り、申し込み直せる
await fetch(`${MOCK}/__cancel/${done.subscription}`, { method: "POST" });
ok(await hook("customer.subscription.deleted", { id: done.subscription, object: "subscription" }) === 200, "解約の通知");
acc = (await api("/api/billing")).json.account;
ok(acc.plan_id === "free" && acc.status === "free" && acc.quota === 30, "解約で無料プラン（月30答案）に戻る");

// ---------------------------------------------------------------- 学校（税別）：作成済みの税率（10%）を付けて引き渡す
let r = await api("/api/billing", { planId: "school-mini" });
ok(r.status === 200 && /\/pay\/cs_test_/.test(r.json.url), "解約のあと、学校ミニを申し込める");
let last = (await mockLog()).filter((x) => x.path === "/v1/checkout/sessions").at(-1).form;
ok(last["line_items[0][price]"] === "price_1UQ1a179SNi0pstBnv4jCUlW" && last["line_items[0][tax_rates][0]"] === "txr_test_jp10", "学校ミニ：テスト用の料金ID（税別40,000円）と消費税10%の税率を渡す");
ok((await mockLog()).some((x) => x.path === "/v1/tax_rates/txr_test_jp10"), "税率（10%・税別に加算・有効）を Stripe で確かめる");
r = await api("/api/billing", { planId: "school-upper" });
last = (await mockLog()).filter((x) => x.path === "/v1/checkout/sessions").at(-1).form;
ok(r.status === 200 && last["line_items[0][price]"] === "price_1UQ1Iq79SNi0pstBVOm08xNT", "別のコース（学校プロ）に選び直すと、開いていた決済画面を閉じて作り直す");
ok((await mockLog()).some((x) => /\/v1\/checkout\/sessions\/cs_test_\d+\/expire/.test(x.path)), "前の決済画面は閉じる（支払われないように）");

// ---------------------------------------------------------------- 旧料金ID の既存契約
// 確認済みの旧プラン（price_LegacyLite01 → legacy-lite-old：月150回）と、対応の分からない料金（price_UnknownLite01）
const customer = sql(`select customer_id from public.billing_accounts where school_id = '${SCHOOL}'`);
const subscribe = async (price) => (await (await fetch(`${MOCK}/__subscribe`, { method: "POST", body: JSON.stringify({ customer, price }) })).json()).subscription;
const read = async () => (await api("/api/billing")).json;

// 対応の分からない料金：権限を推測で付けず、いまの権限も変えず、管理者に確認待ちとして見せる
const unknownSub = await subscribe("price_UnknownLite01");
ok(await hook("customer.subscription.created", { id: unknownSub, object: "subscription" }) === 200, "対応の分からない料金の通知も受け付ける（記録して、再送の繰り返しにしない）");
let b2 = await read();
ok(b2.account.plan_id === "free" && b2.account.quota === 30 && b2.account.status === "free", "対応の分からない料金：有料の権限を付けない（無料・月30答案のまま）");
ok(b2.review && /料金表・旧プランの対応表に無い/.test(b2.review.reason) && !JSON.stringify(b2).includes("price_UnknownLite01"), "管理者に確認待ちと理由を見せる（料金ID は返さない）");
ok(await hook("customer.subscription.updated", { id: unknownSub, object: "subscription" }) === 200 && (await read()).account.quota === 30, "同じ契約の通知の再送でも権限は変わらない");
await page.goto(BASE + "/");
await page.getByText("契約の内容を確認しています").waitFor();
ok((await page.evaluate(() => document.body.innerText)).includes("いまの契約の状況・採点の回数は変えていません"), "画面：確認待ちの表示（いまの権限は変えていない）");
r = await api("/api/billing", { planId: "personal-mini" });
ok(r.status === 400 && /確認待ち/.test(r.json.error), "確認待ちの間は新しい申し込みを受け付けない（二重の契約を防ぐ）");
await page.getByRole("button", { name: "契約を再確認" }).click();
await page.getByText("確認待ちのまま").waitFor();
ok((await read()).account.quota === 30, "「契約を再確認」：対応表に無いままなら確認待ちのまま（権限は変えない）");
await fetch(`${MOCK}/__cancel/${unknownSub}`, { method: "POST" });
ok(await hook("customer.subscription.deleted", { id: unknownSub, object: "subscription" }) === 200, "その契約の解約の通知");
b2 = await read();
ok(!b2.review && b2.account.plan_id === "free", "解約されると確認待ちが外れる");

// 確認済みの旧プラン：対応表どおりの上限で扱い、契約画面に旧プランの名前を出す
const legacySub = await subscribe("price_LegacyLite01");
ok(await hook("customer.subscription.created", { id: legacySub, object: "subscription" }) === 200, "旧料金ID の契約の通知");
b2 = await read();
ok(b2.account.plan_id === "legacy-lite-old" && b2.account.quota === 150 && b2.account.status === "active" && !b2.review, "旧プランの対応表どおりに反映（月150回・契約中）");
ok(b2.planLabel === "旧ライト（既存契約）", "契約画面に旧プランの名前（既存契約）を出す");
const period2 = sql(`select period_start from public.billing_accounts where school_id = '${SCHOOL}'`);
sql(`insert into public.billing_usage(id, school_id, submission_id, period_start, status)
     select gen_random_uuid(), '${SCHOOL}', 'eeeeeeee-0000-0000-0000-000000000051', '${period2}', 'done' from generate_series(1, 7)`);
for (const t of ["customer.subscription.updated", "customer.subscription.updated"]) ok(await hook(t, { id: legacySub, object: "subscription" }) === 200, "旧プランの通知の再送");
b2 = await read();
ok(b2.account.quota === 150 && b2.used === 7, "再送しても旧プランの上限（150）と使用済み（7）はそのまま");
await page.goto(BASE + "/");
await page.getByText("旧ライト（既存契約）").first().waitFor();
ok(!(await page.evaluate(() => document.body.innerText)).includes("契約の内容を確認しています"), "画面：旧プランの名前を表示し、確認待ちは出ない");

// ---------------------------------------------------------------- ver6：前払い（1・3・6・12か月分）
await fetch(`${MOCK}/__cancel/${legacySub}`, { method: "POST" });
ok(await hook("customer.subscription.deleted", { id: legacySub, object: "subscription" }) === 200 && (await read()).account.plan_id === "free", "（前提）月額の契約を解約して無料プランに戻す");
ok((await api("/api/billing/prepaid")).json.crypto === false, "暗号資産の決済代行を設定していない環境では、暗号資産の前払いを出さない");
r = await api("/api/billing/prepaid", { planId: "personal-light", months: 3, method: "crypto" });
ok(r.status === 400 && /暗号資産/.test(r.json.error), "暗号資産の設定が無ければ断る");
for (const bad of [{ planId: "personal-light", months: 2, method: "stripe" }, { planId: "personal-light-night", months: 1, method: "stripe" }, { planId: "personal-light", months: 3, method: "stripe", amount: 1 }]) {
  const x = await api("/api/billing/prepaid", bad);
  if (bad.amount) ok(x.status === 200, "画面から送った金額は無視する（サーバーが料金表から決める）");
  else ok(x.status === 400, `前払いの申し込みを断る：${JSON.stringify(bad)}`);
}
r = await api("/api/billing/prepaid", { planId: "personal-light", months: 3, method: "stripe" });
ok(r.status === 200 && /\/pay\/cs_test_/.test(r.json.url) && r.json.total === 8250, "前払い：個人・塾ライト3か月分（2,750円×3＝8,250円・税込）の決済画面");
last = (await mockLog()).filter((x) => x.path === "/v1/checkout/sessions").at(-1).form;
ok(last.mode === "payment" && last["line_items[0][quantity]"] === "3" && last["line_items[0][price_data][unit_amount]"] === "2750" && last["metadata[kind]"] === "prepaid", "1回払い・単価2,750円×3か月・前払いの印を Stripe に渡す（支払い方法は Stripe 側で自動）");
ok(!last["payment_method_types[0]"], "支払い方法を固定しない（コンビニ・PayPay などダッシュボードで有効にした方法が出る）");
const prepaidCs = r.json.url.split("/pay/")[1];
ok((await read()).account.status === "free", "支払いの通知の前は有料にしない");
await fetch(`${MOCK}/__complete/${prepaidCs}`, { method: "POST" });
ok(await hook("checkout.session.completed", { id: prepaidCs, object: "checkout.session" }) === 200, "前払いの支払い完了の通知");
b2 = await read();
ok(b2.account.plan_id === "personal-light" && b2.account.status === "active" && b2.account.quota === 200, "前払いを反映：個人・塾ライト・月200回");
const until = Date.parse(b2.account.prepaid_until);
ok(until > Date.now() + 88 * 86400_000 && until < Date.now() + 93 * 86400_000, "前払いの期限は3か月後");
ok(await hook("checkout.session.completed", { id: prepaidCs, object: "checkout.session" }) === 200 && Date.parse((await read()).account.prepaid_until) === until, "同じ通知の再送で期限を二重に延ばさない");
r = await api("/api/billing", { planId: "personal-mini" });
ok(r.status === 400 && /前払いの期間中/.test(r.json.error), "前払いの期間中は月額の契約を重ねて申し込めない");
r = await api("/api/billing/prepaid", { planId: "personal-pro", months: 1, method: "stripe" });
ok(r.status === 400 && /別のコースの前払い/.test(r.json.error), "前払いの期間中に別のコースは申し込めない（同じコースの延長はできる）");
await page.goto(BASE + "/");
await page.getByText(/前払い：.*まで/).first().waitFor();
ok(true, "画面に前払いの期限を表示");
ok(Number(sql(`select count(*) from public.billing_prepaid where school_id = '${SCHOOL}' and status = 'applied'`)) === 1, "前払いの注文は1件だけ反映");

ok(errors.length === 0, `コンソールのエラーが無い${errors.length ? "：" + errors.join(" / ") : ""}`);
await browser.close();
sql("update public.billing_config set enabled = false where id = true");
console.log("OK: 料金・決済の画面テストがすべて通りました（Stripe・採点AI は代役）");
