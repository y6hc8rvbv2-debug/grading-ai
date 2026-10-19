// 既存の契約と料金ID の照合（読み取りだけ）。Stripe・DB のどちらにも書き込まない。
//   使い方：npm run billing:audit
//   必要な環境変数（チャットには貼らない。手元のターミナル・Vercel の環境で設定する）：
//     STRIPE_SECRET_KEY            読み取りだけの制限付きキー（rk_test_… / rk_live_…）を推奨。Subscriptions・Prices・Account の Read
//     STRIPE_LIVE_PRICE_IDS_JSON   本番の照合に使う（本番のキーのとき）
//     STRIPE_LEGACY_PLANS_JSON     確認済みの旧プランの対応表（あれば）
//     （DB も照合するとき）NEXT_PUBLIC_SUPABASE_URL・SUPABASE_SERVICE_ROLE_KEY ― billing_accounts を読むだけ
//   表示するもの：接続先のアカウントID・テスト/本番の別・契約の件数（状態別）・料金ID ごとの件数と分類（16コース／旧プラン／不明）・
//                DB の契約（プラン・状態）の件数と、Stripe と食い違う行の学校ID。メールアドレス・カード・キーの値は表示しない
import Stripe from "stripe";
import { COURSES } from "../../lib/subscription-plans.ts";
import { contractTermsForPriceId, stripeModeOf } from "../../lib/billing/prices.ts";

const key = process.env.STRIPE_SECRET_KEY;
const mode = stripeModeOf(key);
if (!mode) { console.log("✗ STRIPE_SECRET_KEY がありません（sk_test_/rk_test_/sk_live_/rk_live_ のキーを環境変数に設定してください。値は表示しません）"); process.exit(1); }
const stripe = new Stripe(key, { apiVersion: "2026-08-26.dahlia" });
const env = { liveJson: process.env.STRIPE_LIVE_PRICE_IDS_JSON, legacyJson: process.env.STRIPE_LEGACY_PLANS_JSON };

const account = await stripe.accounts.retrieve().catch(() => null);
console.log(`接続先：${account?.id ?? "（アカウントID を読めないキー）"}・${mode === "test" ? "テスト（サンドボックス）" : "本番"}`);
if (account?.id && account.id !== "acct_1UPk8C79SNi0pstB") console.log("  ※ 指定のアカウント（acct_1UPk8C79SNi0pstB）とは別のアカウントです");

// 16コースの料金がこの環境にあるか（テストのときだけ。本番は STRIPE_LIVE_PRICE_IDS_JSON の ID）
if (mode === "test") {
  let okCount = 0;
  for (const c of COURSES) {
    const p = await stripe.prices.retrieve(c.testPriceId).catch(() => null);
    const ok = p && p.active && !p.livemode && p.currency === "jpy" && p.unit_amount === c.monthlyYen && p.tax_behavior === c.tax && p.recurring?.interval === "month" && p.recurring?.interval_count === 1;
    if (ok) okCount++; else console.log(`  ✗ ${c.key}：料金が料金表と一致しない、または見つからない`);
  }
  console.log(`16コースの料金：${okCount}/16 が料金表と一致`);
}

// 契約（すべての状態）を料金ID ごとに数える
const byPrice = new Map(), byStatus = new Map(), subsById = new Map();
for await (const s of stripe.subscriptions.list({ status: "all", limit: 100 })) {
  byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
  subsById.set(s.id, s);
  for (const it of s.items.data) {
    const e = byPrice.get(it.price.id) ?? { n: 0, statuses: new Set(), amount: it.price.unit_amount, tax: it.price.tax_behavior };
    e.n++; e.statuses.add(s.status); byPrice.set(it.price.id, e);
  }
}
console.log(`契約の件数：${[...subsById.keys()].length}（${[...byStatus].map(([k, v]) => `${k} ${v}`).join("・") || "なし"}）`);
let unknown = 0;
for (const [id, e] of byPrice) {
  const t = contractTermsForPriceId(id, mode, env);
  const kind = !t ? "不明（料金表・旧プランの対応表に無い）" : t.legacy ? `旧プラン ${t.key}` : `16コース ${t.key}`;
  if (!t) unknown++;
  console.log(`  ${id}：${e.n}件（${[...e.statuses].join("・")}）・${e.amount}円・${e.tax} → ${kind}`);
}
console.log(unknown ? `✗ 対応の分からない料金ID：${unknown}個（旧プランの仕様を確かめて STRIPE_LEGACY_PLANS_JSON に入れる。金額だけで対応先を決めない）` : "✓ 対応の分からない料金ID はありません");

// DB の契約（任意）
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url && service) {
  const r = await fetch(`${url}/rest/v1/billing_accounts?select=school_id,plan_id,status,subscription_id,review_price_id`, { headers: { apikey: service, authorization: `Bearer ${service}` } });
  if (!r.ok) { console.log(`DB：billing_accounts を読めません（HTTP ${r.status}。0017・0018 を適用済みか確かめてください）`); process.exit(unknown ? 2 : 0); }
  const rows = await r.json();
  const known = new Set(["free", ...COURSES.map((c) => c.key)]);
  console.log(`DB の契約：${rows.length}校（${[...new Set(rows.map((x) => x.status))].map((st) => `${st} ${rows.filter((x) => x.status === st).length}`).join("・")}）`);
  for (const x of rows) {
    const sub = x.subscription_id ? subsById.get(x.subscription_id) : null;
    const notes = [];
    if (!known.has(x.plan_id) && !String(x.plan_id).startsWith("legacy-")) notes.push(`プラン ${x.plan_id} は料金表に無い`);
    if (x.subscription_id && !sub) notes.push("Stripe（このキーの環境）に契約が無い");
    if (x.review_price_id) notes.push("確認待ちの契約あり");
    if (notes.length) console.log(`  学校 ${x.school_id}：${notes.join("・")}`);
  }
} else console.log("DB：照合していません（NEXT_PUBLIC_SUPABASE_URL・SUPABASE_SERVICE_ROLE_KEY が無い。SQL Editor で supabase/runbook/billing-audit.sql を実行しても確かめられます）");
process.exit(unknown ? 2 : 0);
