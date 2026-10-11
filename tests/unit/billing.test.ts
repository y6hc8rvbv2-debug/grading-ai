import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { BILLING_PLANS, isNight, nextNightStart } from "../../lib/billing/catalog";
test("通常・夜間16プランの金額・枠が承認済み料金と一致", () => {
  assert.equal(BILLING_PLANS.length, 16);
  assert.deepEqual(BILLING_PLANS.filter(p => p.personal && !p.night).map(p => [p.amount,p.limit]), [[1650,100],[2750,200],[3850,300],[12100,1000]]);
  assert.deepEqual(BILLING_PLANS.filter(p => p.personal && p.night).map(p => p.amount), [1320,2200,3080,9680]);
  assert.deepEqual(BILLING_PLANS.filter(p => !p.personal && !p.night).map(p => [p.amount,p.limit]), [[44000,800],[132000,2500],[220000,4500],[330000,6500]]);
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
