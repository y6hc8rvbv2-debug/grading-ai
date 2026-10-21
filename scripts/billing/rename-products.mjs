// Stripe のサンドボックス（テスト）の商品名の「テスト採点ver5」を「テスト採点ver6」に変える。
//   使い方：npm run billing:rename-products            … 読み取りだけ（変える予定の商品名を表示する）
//           npm run billing:rename-products -- --apply … 実際に名前を変える
//   対象：16コース（lib/subscription-plans.ts の testPriceId）の料金が属する商品だけ。料金・金額・契約・お客さまの情報は変えない
//   必要な環境変数：STRIPE_SECRET_KEY（テストのキー sk_test_/rk_test_ だけ。本番のキーは断る。値は表示しない）
//     制限付きキーなら Prices の Read と Products の Write があればよい
//   GitHub Actions：stripe-rename（Secret STRIPE_SANDBOX_KEY）から私（Claude）が実行する。docs/AUTO-PREVIEW.md
//   ※ 決済画面の左上の「テスト採点ver5 検証用」は Stripe のアカウントの公開ビジネス名で、ここでは変えられない（Stripe の設定画面で変える）
import Stripe from "stripe";
import { COURSES } from "../../lib/subscription-plans.ts";

const FROM = "テスト採点ver5", TO = "テスト採点ver6";
const APPLY = process.argv.includes("--apply");
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!/^(sk|rk)_test_/.test(key)) { console.log("✗ 停止：テストのキー（sk_test_/rk_test_）の STRIPE_SECRET_KEY がありません。本番のキーでは動きません（値は表示しません）"); process.exit(1); }
const options = { apiVersion: "2026-08-26.dahlia" };
// 手元のテスト用の代役（tests/unit/rename-products.test.ts）
if (process.env.STRIPE_API_BASE_URL) { const u = new URL(process.env.STRIPE_API_BASE_URL); Object.assign(options, { host: u.hostname, port: u.port, protocol: u.protocol.replace(":", "") }); }
const stripe = new Stripe(key, options);

const productIds = new Set();
for (const c of COURSES) {
  const p = await stripe.prices.retrieve(c.testPriceId).catch(() => null);
  if (!p) { console.log(`  △ ${c.key}：料金 ${c.testPriceId} が見つかりません（飛ばします）`); continue; }
  if (p.livemode) { console.log("✗ 停止：本番の料金が見つかりました"); process.exit(1); }
  productIds.add(typeof p.product === "string" ? p.product : p.product.id);
}
let changed = 0, already = 0;
for (const id of productIds) {
  const prod = await stripe.products.retrieve(id);
  if (!prod.name.includes(FROM)) { already++; console.log(`  ✓ そのまま：${prod.name}`); continue; }
  const name = prod.name.replaceAll(FROM, TO);
  if (APPLY) await stripe.products.update(id, { name });
  changed++;
  console.log(`  ${APPLY ? "✓ 変更" : "→ 変更予定"}：${prod.name} → ${name}`);
}
console.log(`\n${APPLY ? "完了" : "読み取りだけ（--apply で変更）"}：商品 ${productIds.size} 件のうち ${APPLY ? "変更" : "変更予定"} ${changed} 件・変更不要 ${already} 件`);
