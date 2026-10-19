import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { BILLING_PLANS, billingPlan, isNight, nextNightStart } from "../../lib/billing/catalog";
import { availabilityOf, contractTermsForPriceId, courseForPriceId, legacyPlans, priceIdFor, stripeModeOf } from "../../lib/billing/prices";
import { COURSES, courseByKey, courseLabel, currentPlanLabel, limitLabel, priceLabel } from "../../lib/subscription-plans";
// 2026-10-13 ユーザー確定の16コース（金額・税区分・上限・テスト用の料金ID）
const CONFIRMED: [string, number, "inclusive" | "exclusive", number | null, string][] = [
  ["personal-mini", 1650, "inclusive", 100, "price_1UPkN679SNi0pstBtGaeLtlf"],
  ["personal-light", 2750, "inclusive", 200, "price_1UQ16L79SNi0pstB1vOKdQTx"],
  ["personal-standard", 3850, "inclusive", 300, "price_1UQ1BL79SNi0pstBDBnv6I0K"],
  ["personal-pro", 12100, "inclusive", 1000, "price_1UQ1D279SNi0pstBKT4gande"],
  ["personal-mini-night", 1320, "inclusive", null, "price_1UQ1Ld79SNi0pstBkuDphJJ5"],
  ["personal-light-night", 2200, "inclusive", null, "price_1UQ1KP79SNi0pstBRNqrSOw0"],
  ["personal-standard-night", 3080, "inclusive", null, "price_1UQ1Lx79SNi0pstBzBBns9xg"],
  ["personal-pro-night", 9680, "inclusive", null, "price_1UQ1MC79SNi0pstBNEGGKRq1"],
  ["school-mini", 40000, "exclusive", 800, "price_1UQ1a179SNi0pstBnv4jCUlW"],
  ["school-light", 120000, "exclusive", 2500, "price_1UQ1aE79SNi0pstBK9Opd0AP"],
  ["school-standard", 200000, "exclusive", 4500, "price_1UQ1G979SNi0pstBYFYmPoJC"],
  ["school-upper", 300000, "exclusive", 6500, "price_1UQ1Iq79SNi0pstBVOm08xNT"],
  ["school-mini-night", 32000, "exclusive", null, "price_1UQ1Oj79SNi0pstB1G9qy3AK"],
  ["school-light-night", 96000, "exclusive", null, "price_1UQ1Ow79SNi0pstBOWDR6BaE"],
  ["school-standard-night", 160000, "exclusive", null, "price_1UQ1P779SNi0pstBrFtAOTWO"],
  ["school-upper-night", 240000, "exclusive", null, "price_1UQ1PK79SNi0pstBWktGtsHh"],
];
test("16コースの金額・税区分・通常コースの上限・テスト用の料金ID が確定の表と一致（画面と決済が同じ表を読む）", () => {
  assert.equal(COURSES.length, 16);
  assert.equal(BILLING_PLANS.length, 16);
  for (const [key, yen, tax, limit, price] of CONFIRMED) {
    const c = courseByKey(key)!; const p = billingPlan(key)!;
    assert.ok(c && p, key);
    assert.equal(c.monthlyYen, yen, key); assert.equal(p.amount, yen, key);
    assert.equal(c.tax, tax, key); assert.equal(p.taxBehavior, tax, key);
    assert.equal(c.testPriceId, price, key);
    if (limit !== null) { assert.equal(c.limit, limit, key); assert.equal(p.limit, limit, key); }
    else assert.ok(c.limit > 0, `${key}：夜間の上限は以前の仕様の値（無制限にしない）`);
    assert.equal(c.night, key.endsWith("-night"), key);
  }
  assert.equal(new Set(COURSES.map((c) => c.testPriceId)).size, 16, "料金ID は重複しない");
});
test("表示：個人・塾は税込・答案、学校は税別・枚。桁区切りあり。料金ID は表示しない", () => {
  assert.equal(priceLabel(courseByKey("personal-pro")!), "月額12,100円（税込）");
  assert.equal(limitLabel(courseByKey("personal-pro")!), "月1,000答案まで");
  assert.equal(priceLabel(courseByKey("school-upper")!), "月額300,000円（税別）");
  assert.equal(limitLabel(courseByKey("school-light")!), "月2,500枚まで");
  assert.equal(currentPlanLabel("school-upper"), "学校プロ（通常採点）");
  assert.equal(currentPlanLabel("personal-mini-night"), "個人・塾 ミニ（夜間採点）");
  assert.equal(currentPlanLabel("school"), "学校プラン（既存契約）", "以前の契約は新しいコースに置き換えない");
  for (const c of COURSES) for (const s of [priceLabel(c), limitLabel(c), courseLabel(c)]) assert.ok(!s.includes("price_"));
});
test("画面から送られた値は使わない：許可されたキーだけ", () => {
  assert.equal(billingPlan("price_1UPkN679SNi0pstBtGaeLtlf"), undefined, "料金ID を直接は受け付けない");
  assert.equal(billingPlan({ id: "personal-mini", amount: 1 }), undefined);
  assert.equal(billingPlan("personal-mini; drop"), undefined);
});
test("テスト用と本番用の料金ID を混ぜない", () => {
  const mini = courseByKey("personal-mini")!;
  assert.equal(stripeModeOf("sk_test_x"), "test"); assert.equal(stripeModeOf("rk_live_x"), "live"); assert.equal(stripeModeOf("pk_test_x"), null); assert.equal(stripeModeOf(""), null);
  assert.equal(priceIdFor(mini, "test").id, "price_1UPkN679SNi0pstBtGaeLtlf");
  assert.equal(priceIdFor(mini, null).id, null, "キーが無ければ申し込めない");
  assert.equal(priceIdFor(mini, "live").id, null, "本番の料金ID が無ければ本番の申し込みを止める");
  assert.equal(priceIdFor(mini, "live", JSON.stringify({ "personal-mini": "price_1UPkN679SNi0pstBtGaeLtlf" })).id, null, "本番でテスト用の ID を使わない");
  assert.equal(priceIdFor(mini, "live", "{broken").id, null);
  assert.equal(priceIdFor(mini, "live", JSON.stringify({ "personal-mini": "price_LIVEabc" })).id, "price_LIVEabc");
  assert.equal(courseForPriceId("price_1UQ1Iq79SNi0pstBVOm08xNT", "test")?.key, "school-upper");
  assert.equal(courseForPriceId("price_1UQ1Iq79SNi0pstBVOm08xNT", "live"), undefined, "本番の通知でテスト用の ID の契約を有効にしない");
  assert.equal(courseForPriceId("price_LIVEabc", "live", JSON.stringify({ "personal-mini": "price_LIVEabc" }))?.key, "personal-mini");
  assert.equal(courseForPriceId("price_unknown", "test"), undefined);
});
test("夜間は日本時間22時〜翌6時。境界・日付またぎ", () => {
  for (const [time,night] of [["2026-10-09T21:59:59+09:00",false],["2026-10-09T22:00:00+09:00",true],["2026-10-10T05:59:59+09:00",true],["2026-10-10T06:00:00+09:00",false]] as const) assert.equal(isNight(new Date(time)), night);
  assert.equal(nextNightStart(new Date("2026-10-09T12:00:00+09:00")).toISOString(), "2026-10-09T13:00:00.000Z");
});
test("Stripe署名は改変・未署名・期限切れを拒否", () => {
  const stripe = new Stripe("sk_test_placeholder");
  const payload = JSON.stringify({ id: "evt_mock", object: "event", type: "invoice.paid" });
  const secret = "whsec_fixture_only";
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal(stripe.webhooks.constructEvent(payload, header, secret).id, "evt_mock");
  assert.throws(() => stripe.webhooks.constructEvent(payload + " ", header, secret));
  assert.throws(() => stripe.webhooks.constructEvent(payload, "", secret));
  const expired = stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: 1 });
  assert.throws(() => stripe.webhooks.constructEvent(payload, expired, secret));
});

test("申し込みを止める条件：決済が無効・キーなし・本番の料金ID なし・夜間が無効・学校の消費税の設定なし", () => {
  const mini = courseByKey("personal-mini")!, school = courseByKey("school-mini")!, night = courseByKey("personal-mini-night")!;
  const env = { billing: true, night: false, key: "sk_test_x", schoolTaxRateId: "txr_x" };
  assert.equal(availabilityOf(mini, env).ok, true);
  assert.equal(availabilityOf(mini, { ...env, billing: false }).ok, false);
  assert.equal(availabilityOf(mini, { ...env, key: "" }).ok, false);
  assert.match(availabilityOf(mini, { ...env, key: "sk_live_x" }).reason!, /本番の料金/);
  assert.match(availabilityOf(night, env).reason!, /夜間採点/);
  assert.equal(availabilityOf(night, { ...env, night: true }).ok, true);
  assert.match(availabilityOf(school, { ...env, schoolTaxRateId: null }).reason!, /消費税/);
  assert.equal(availabilityOf(school, env).ok, true);
});

test("旧料金ID の対応表：確認済み（根拠つき）の行だけを使い、16コース・テスト用の ID と重ねない", () => {
  const row = { key: "legacy-old-a", label: "旧A", mode: "live", priceIds: ["price_OLDa1"], monthlyYen: 9800, tax: "inclusive", limit: 150, audience: "personal", night: false, source: "当時の料金表" };
  assert.equal(legacyPlans(JSON.stringify([row])).length, 1);
  for (const bad of [
    { ...row, source: "" },                                      // 根拠が無い
    { ...row, key: "personal-mini" },                            // 現在のコースのキー
    { ...row, key: "old-a" },                                    // legacy- で始まらない
    { ...row, priceIds: ["price_1UPkN679SNi0pstBtGaeLtlf"] },     // 現在のテスト用の料金ID
    { ...row, limit: 0 },                                        // 上限なし（無制限にしない）
    { ...row, mode: "prod" },
  ]) assert.equal(legacyPlans(JSON.stringify([bad])).length, 0, JSON.stringify(bad));
  assert.deepEqual(legacyPlans("{broken"), []);
  assert.deepEqual(legacyPlans(undefined), []);
});
test("契約の料金ID → 反映する条件：16コース → 確認済みの旧プラン → 不明は null（推測しない）。テストと本番を混ぜない", () => {
  const legacyJson = JSON.stringify([{ key: "legacy-old-a", label: "旧A", mode: "live", priceIds: ["price_OLDa1"], monthlyYen: 9800, tax: "inclusive", limit: 150, audience: "personal", night: false, source: "当時の料金表" }]);
  assert.equal(contractTermsForPriceId("price_1UQ1Iq79SNi0pstBVOm08xNT", "test", {})?.key, "school-upper");
  const old = contractTermsForPriceId("price_OLDa1", "live", { legacyJson })!;
  assert.equal(old.key, "legacy-old-a"); assert.equal(old.limit, 150); assert.equal(old.legacy, true); assert.equal(old.amount, 9800);
  assert.equal(contractTermsForPriceId("price_OLDa1", "test", { legacyJson }), null, "本番の旧プランをテストの契約に使わない");
  assert.equal(contractTermsForPriceId("price_SAME9800", "live", { legacyJson }), null, "同じ金額でも、対応表に無い料金ID は推測しない");
  assert.equal(contractTermsForPriceId("price_OLDa1", null, { legacyJson }), null);
});
test("学校の夜間の上限は通常と同じ（2026-10-13 確定）", () => {
  for (const t of ["mini", "light", "standard", "pro"]) {
    const n = COURSES.find((c) => c.audience === "school" && !c.night && c.tier === t)!, x = COURSES.find((c) => c.audience === "school" && c.night && c.tier === t)!;
    assert.equal(x.limit, n.limit);
  }
});
