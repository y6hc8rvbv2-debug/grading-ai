// 暗号資産での前払い（lib/billing/crypto.ts）と前払いの金額（lib/billing/prepaid.ts）の単体テスト。本物の決済代行には接続しない
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createCryptoInvoice, cryptoProvider, readCryptoWebhook } from "../../lib/billing/crypto";
import { PREPAID_MONTHS, isPrepaidMonths, prepaidTotal } from "../../lib/billing/prepaid";

const NP = { CRYPTO_PROVIDER: "nowpayments", NOWPAYMENTS_API_KEY: "np_key", NOWPAYMENTS_IPN_SECRET: "np_secret" };
const CB = { CRYPTO_PROVIDER: "coinbase", COINBASE_COMMERCE_API_KEY: "cb_key", COINBASE_COMMERCE_WEBHOOK_SECRET: "cb_secret" };
const ORDER = "0b8d2d1e-7f1a-4c55-9a8b-2f0e8f6c1a11";

test("決済代行はキーと秘密がそろったときだけ使う", () => {
  assert.equal(cryptoProvider({}), null);
  assert.equal(cryptoProvider({ CRYPTO_PROVIDER: "nowpayments", NOWPAYMENTS_API_KEY: "x" }), null, "通知の秘密が無ければ使わない");
  assert.equal(cryptoProvider(NP), "nowpayments");
  assert.equal(cryptoProvider(CB), "coinbase");
});

test("NOWPayments：円建ての請求書を作る（金額・注文番号・通知先）", async () => {
  let sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    sent = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify({ id: 4242, invoice_url: "https://nowpayments.example/invoice/4242" }), { status: 200 });
  }) as unknown as typeof fetch;
  const inv = await createCryptoInvoice({ orderId: ORDER, amountJpy: 8250, description: "ライト 3か月", successUrl: "https://a/ok", cancelUrl: "https://a/", webhookUrl: "https://a/api/billing/crypto/webhook" }, NP, fake);
  assert.deepEqual(inv, { provider: "nowpayments", ref: "np_4242", url: "https://nowpayments.example/invoice/4242" });
  assert.equal(sent!.url, "https://api.nowpayments.io/v1/invoice");
  assert.equal(sent!.headers["x-api-key"], "np_key");
  assert.equal(sent!.body.price_amount, 8250);
  assert.equal(sent!.body.price_currency, "jpy");
  assert.equal(sent!.body.order_id, ORDER);
});

test("Coinbase Commerce：円建ての請求（固定価格）を作る", async () => {
  let body: Record<string, unknown> = {};
  const fake = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ data: { code: "ABC123", hosted_url: "https://commerce.example/ABC123" } }), { status: 201 });
  }) as unknown as typeof fetch;
  const inv = await createCryptoInvoice({ orderId: ORDER, amountJpy: 2750, description: "x", successUrl: "s", cancelUrl: "c", webhookUrl: "w" }, CB, fake);
  assert.equal(inv.ref, "cb_ABC123");
  assert.deepEqual(body.local_price, { amount: "2750", currency: "JPY" });
  assert.deepEqual(body.metadata, { order_id: ORDER });
  await assert.rejects(createCryptoInvoice({ orderId: ORDER, amountJpy: 1, description: "", successUrl: "", cancelUrl: "", webhookUrl: "" }, CB,
    (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch));
});

const sorted = (o: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));

test("NOWPayments の通知：署名（キー順の JSON の HMAC-SHA512）が合うときだけ読む", () => {
  const body = { payment_status: "finished", order_id: ORDER, price_amount: 8250, price_currency: "jpy", invoice_id: 4242, pay_currency: "btc" };
  const raw = JSON.stringify(body);
  const sig = createHmac("sha512", "np_secret").update(sorted(body)).digest("hex");
  assert.deepEqual(readCryptoWebhook(raw, new Headers({ "x-nowpayments-sig": sig }), NP), { orderId: ORDER, amountJpy: 8250, ref: "np_4242", final: "paid" });
  assert.equal(readCryptoWebhook(raw, new Headers({ "x-nowpayments-sig": "00" + sig.slice(2) }), NP), null, "署名が違えば読まない");
  assert.equal(readCryptoWebhook(raw, new Headers({}), NP), null);
  const usd = { ...body, price_currency: "usd" };
  assert.equal(readCryptoWebhook(JSON.stringify(usd), new Headers({ "x-nowpayments-sig": createHmac("sha512", "np_secret").update(sorted(usd)).digest("hex") }), NP), null, "円建て以外は扱わない");
  const waiting = { ...body, payment_status: "partially_paid" };
  assert.equal(readCryptoWebhook(JSON.stringify(waiting), new Headers({ "x-nowpayments-sig": createHmac("sha512", "np_secret").update(sorted(waiting)).digest("hex") }), NP)?.final, "pending", "一部の入金では反映しない");
});

test("Coinbase Commerce の通知：本文そのままの HMAC-SHA256 が合うときだけ読む", () => {
  const raw = JSON.stringify({ event: { type: "charge:confirmed", data: { code: "ABC123", metadata: { order_id: ORDER }, pricing: { local: { amount: "2750", currency: "JPY" } } } } });
  const sig = createHmac("sha256", "cb_secret").update(raw).digest("hex");
  assert.deepEqual(readCryptoWebhook(raw, new Headers({ "x-cc-webhook-signature": sig }), CB), { orderId: ORDER, amountJpy: 2750, ref: "cb_ABC123", final: "paid" });
  assert.equal(readCryptoWebhook(raw + " ", new Headers({ "x-cc-webhook-signature": sig }), CB), null, "本文が1文字でも違えば読まない");
  const pending = raw.replace("charge:confirmed", "charge:pending");
  assert.equal(readCryptoWebhook(pending, new Headers({ "x-cc-webhook-signature": createHmac("sha256", "cb_secret").update(pending).digest("hex") }), CB)?.final, "pending");
});

test("前払いの金額：月額×月数（割引なし）。学校は消費税10%を加える", () => {
  assert.deepEqual([...PREPAID_MONTHS], [1, 3, 6, 12]);
  assert.ok(isPrepaidMonths(6) && !isPrepaidMonths(2) && !isPrepaidMonths("3"));
  assert.deepEqual(prepaidTotal({ amount: 2750, taxBehavior: "inclusive" }, 3), { subtotal: 8250, tax: 0, total: 8250 });
  assert.deepEqual(prepaidTotal({ amount: 40000, taxBehavior: "exclusive" }, 12), { subtotal: 480000, tax: 48000, total: 528000 });
});
