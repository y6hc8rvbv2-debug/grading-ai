// ============================================================================
// 暗号資産（ビットコイン・イーサリアム・USDC/USDT などのステーブルコイン）での前払い（ver6・サーバー専用）
//
// Stripe の暗号資産・ステーブルコイン決済は、2026-10 時点で日本の事業者は使えない（米国の事業者だけ）。
// そのため暗号資産は決済代行の「請求書（ホスト型の支払い画面）」を使う。どちらか一方を環境変数で選ぶ:
//   CRYPTO_PROVIDER=nowpayments … NOWPAYMENTS_API_KEY・NOWPAYMENTS_IPN_SECRET（BTC・ETH・USDT・USDC など多数）
//   CRYPTO_PROVIDER=coinbase    … COINBASE_COMMERCE_API_KEY・COINBASE_COMMERCE_WEBHOOK_SECRET
// 金額は円で決め（JPY 建て）、相場の換算・送金の確認は決済代行が行う。アプリは暗号資産を預からない。
// 支払いの完了は決済代行からの通知（署名を確かめる）で知り、注文の金額・通貨・番号が一致したときだけ反映する。
// 月額の自動更新はできないため、1・3・6・12か月分の前払いとして扱う。
// ============================================================================
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export type CryptoProvider = "nowpayments" | "coinbase";

export function cryptoProvider(env: Record<string, string | undefined> = process.env): CryptoProvider | null {
  const p = (env.CRYPTO_PROVIDER || "").trim().toLowerCase();
  if (p === "nowpayments" && env.NOWPAYMENTS_API_KEY && env.NOWPAYMENTS_IPN_SECRET) return "nowpayments";
  if (p === "coinbase" && env.COINBASE_COMMERCE_API_KEY && env.COINBASE_COMMERCE_WEBHOOK_SECRET) return "coinbase";
  return null;
}

/** 手元の代役（テスト）に向けるときだけ使う。本番の宛先は変えない */
function base(provider: CryptoProvider, env: Record<string, string | undefined>) {
  const override = env.CRYPTO_API_BASE_URL;
  if (override && env.NODE_ENV !== "production") return override.replace(/\/$/, "");
  return provider === "nowpayments" ? "https://api.nowpayments.io" : "https://api.commerce.coinbase.com";
}

export type CryptoInvoice = { provider: CryptoProvider; ref: string; url: string };

/** 支払い画面（請求書）を作る */
export async function createCryptoInvoice(o: {
  orderId: string; amountJpy: number; description: string; successUrl: string; cancelUrl: string; webhookUrl: string;
}, env: Record<string, string | undefined> = process.env, doFetch: typeof fetch = fetch): Promise<CryptoInvoice> {
  const provider = cryptoProvider(env);
  if (!provider) throw Error("暗号資産での支払いは、まだ設定されていません。");
  if (provider === "nowpayments") {
    const res = await doFetch(`${base(provider, env)}/v1/invoice`, {
      method: "POST",
      headers: { "x-api-key": env.NOWPAYMENTS_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        price_amount: o.amountJpy, price_currency: "jpy", order_id: o.orderId, order_description: o.description.slice(0, 200),
        ipn_callback_url: o.webhookUrl, success_url: o.successUrl, cancel_url: o.cancelUrl,
      }),
    });
    const j = await res.json().catch(() => ({})) as { id?: string | number; invoice_url?: string };
    if (!res.ok || !j.invoice_url || j.id == null) throw Error("暗号資産の支払い画面を作れませんでした。時間をおいて、もう一度お試しください。");
    return { provider, ref: `np_${j.id}`, url: j.invoice_url };
  }
  const res = await doFetch(`${base(provider, env)}/charges`, {
    method: "POST",
    headers: { "X-CC-Api-Key": env.COINBASE_COMMERCE_API_KEY!, "X-CC-Version": "2018-03-22", "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "テスト採点 前払い", description: o.description.slice(0, 200), pricing_type: "fixed_price",
      local_price: { amount: String(o.amountJpy), currency: "JPY" }, metadata: { order_id: o.orderId },
      redirect_url: o.successUrl, cancel_url: o.cancelUrl,
    }),
  });
  const j = await res.json().catch(() => ({})) as { data?: { code?: string; hosted_url?: string } };
  if (!res.ok || !j.data?.hosted_url || !j.data.code) throw Error("暗号資産の支払い画面を作れませんでした。時間をおいて、もう一度お試しください。");
  return { provider, ref: `cb_${j.data.code}`, url: j.data.hosted_url };
}

/** キーを辞書順に並べた JSON（NOWPayments の署名の作り方） */
function sortedJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${sortedJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const safeEqualHex = (a: string, b: string) => {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

export type CryptoPaid = { orderId: string; amountJpy: number; ref: string; final: "paid" | "failed" | "pending" };

/** 決済代行からの通知を確かめて読む。署名が合わなければ null（何もしない） */
export function readCryptoWebhook(raw: string, headers: Headers, env: Record<string, string | undefined> = process.env): CryptoPaid | null {
  const provider = cryptoProvider(env);
  if (!provider) return null;
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return null; }
  if (provider === "nowpayments") {
    const sig = headers.get("x-nowpayments-sig") || "";
    const want = createHmac("sha512", env.NOWPAYMENTS_IPN_SECRET!).update(sortedJson(body)).digest("hex");
    if (!safeEqualHex(sig, want)) return null;
    if (String(body.price_currency || "").toLowerCase() !== "jpy") return null;
    const status = String(body.payment_status || "");
    return {
      orderId: String(body.order_id || ""), amountJpy: Number(body.price_amount), ref: `np_${body.invoice_id ?? ""}`,
      final: status === "finished" ? "paid" : ["failed", "expired", "refunded"].includes(status) ? "failed" : "pending",
    };
  }
  const sig = headers.get("x-cc-webhook-signature") || "";
  const want = createHmac("sha256", env.COINBASE_COMMERCE_WEBHOOK_SECRET!).update(raw).digest("hex");
  if (!safeEqualHex(sig, want)) return null;
  const event = (body.event ?? {}) as { type?: string; data?: { code?: string; metadata?: { order_id?: string }; pricing?: { local?: { amount?: string; currency?: string } } } };
  const local = event.data?.pricing?.local;
  if (String(local?.currency || "").toUpperCase() !== "JPY") return null;
  const type = String(event.type || "");
  return {
    orderId: String(event.data?.metadata?.order_id || ""), amountJpy: Number(local?.amount), ref: `cb_${event.data?.code ?? ""}`,
    final: type === "charge:confirmed" || type === "charge:resolved" ? "paid" : type === "charge:failed" ? "failed" : "pending",
  };
}
