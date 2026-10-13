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
const api = (path, body) => page.evaluate(async ([p, b]) => {
  const r = await fetch(p, b === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [path, body]);

await page.goto(BASE + "/login");
await page.getByLabel("メールアドレス").fill("admin@lite.example");
await page.getByLabel("パスワード").fill("pass-lite-123");
await page.getByRole("button", { name: "ログイン" }).click();
await page.waitForURL(BASE + "/");
await page.getByText("選んだコースを申し込む").first().waitFor();

// ---------------------------------------------------------------- 表示：16コース
const text = await page.evaluate(() => document.body.innerText);
ok(text.includes("個人・塾プラン") && text.includes("学校プラン") && text.includes("通常採点") && text.includes("夜間採点"), "個人・塾と学校を分け、それぞれ通常採点・夜間採点を表示");
for (const c of COURSES) ok(text.includes(priceLabel(c)) && text.includes(limitLabel(c)), `${c.key}：${priceLabel(c)}・${limitLabel(c)}`);
ok(!/price_|txr_|cus_|利益|原価/.test(text), "料金ID・Stripe の内部ID・原価・利益を表示しない");
ok(!text.includes("翌日結果") && text.includes("終わる時刻は答案の量や混み具合で変わり、お約束できません"), "夜間採点の納期を約束しない（既存の仕様の22時〜翌6時の処理だけを書く）");
ok(text.includes("無料プラン") && text.includes("月20回まで"), "無料プランは以前の設定のまま（月20回）");

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
await page.getByRole("button", { name: "選んだコースを申し込む" }).first().click();
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
ok(acc.status === "free" && acc.quota === 20, "決済画面を開いた・戻っただけでは有料の枠を付けない");

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
ok(acc.plan_id === "free" && acc.status === "free" && acc.quota === 20, "解約で無料プラン（月20回）に戻る");

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

ok(errors.length === 0, `コンソールのエラーが無い${errors.length ? "：" + errors.join(" / ") : ""}`);
await browser.close();
sql("update public.billing_config set enabled = false where id = true");
console.log("OK: 料金・決済の画面テストがすべて通りました（Stripe・採点AI は代役）");
