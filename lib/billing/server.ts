import "server-only";
import Stripe from "stripe";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { FREE_QUOTA, billingPlan, type BillingPlan } from "./catalog";
import { availabilityOf, contractTermsForPriceId, legacyPlans, priceIdFor, stripeModeOf } from "./prices";
import { courseByKey, currentPlanLabel } from "@/lib/subscription-plans";

export const billingEnabled = () => process.env.BILLING_ENABLED === "on";
export const nightEnabled = () => billingEnabled() && process.env.NIGHT_GRADING_ENABLED === "on";
/** いまのキーの種類（test / live / null）。キーの値は外に出さない */
export const stripeMode = () => stripeModeOf(process.env.STRIPE_SECRET_KEY);
export const stripeClient = () => {
  const key = process.env.STRIPE_SECRET_KEY;
  const mode = stripeModeOf(key);
  if (!key || !mode) throw Error("決済の設定が完了していません。");
  const options: Stripe.StripeConfig = { apiVersion: "2026-08-26.dahlia", maxNetworkRetries: 2 };
  // 手元の代役（tests/e2e-lite の Stripe の代役）。テスト用のキーのときだけ使い、本番のキーでは向け先を変えない
  const base = process.env.STRIPE_API_BASE_URL;
  if (base && mode === "test") {
    const u = new URL(base);
    Object.assign(options, { host: u.hostname, port: u.port, protocol: u.protocol.replace(":", "") as "http" | "https" });
  }
  return new Stripe(key, options);
};

/** コースの料金ID（キーの種類に合わせて、テスト用か本番用かを選ぶ） */
export function planPriceId(plan: BillingPlan) {
  const course = courseByKey(plan.id);
  if (!course) return { id: null, reason: "このプランは現在申し込めません。" };
  return priceIdFor(course, stripeMode(), process.env.STRIPE_LIVE_PRICE_IDS_JSON);
}

/** 学校（税別）のコースで消費税を加える税率（Stripe に作成済みのもの。新しく作らない）。
 *  無ければ学校のコースの申し込みを止める（税別の金額だけを請求しないため） */
export const schoolTaxRateId = () => (process.env.STRIPE_SCHOOL_TAX_RATE_ID || "").trim() || null;

/** 申し込めるか（画面に理由を出す。秘密・料金ID は返さない）。判定は lib/billing/prices.ts の availabilityOf */
export function planAvailability(plan: BillingPlan): { ok: boolean; reason?: string } {
  const course = courseByKey(plan.id);
  if (!course) return { ok: false, reason: "このプランは現在申し込めません。" };
  return availabilityOf(course, { billing: billingEnabled(), night: nightEnabled(), key: process.env.STRIPE_SECRET_KEY,
    liveJson: process.env.STRIPE_LIVE_PRICE_IDS_JSON, schoolTaxRateId: schoolTaxRateId() });
}

/** 学校のコースに使う税率を Stripe で確かめる（10%・税別に加算・有効・キーと同じ環境） */
export async function verifiedSchoolTaxRate(stripe: Stripe) {
  const id = schoolTaxRateId();
  if (!id) throw Error("消費税の設定が完了していないため、学校のコースのお申し込みを停止しています。");
  const rate = await stripe.taxRates.retrieve(id);
  if (!rate.active || rate.inclusive || Number(rate.percentage) !== 10 || rate.livemode !== (stripeMode() === "live")) {
    throw Error("消費税の設定が料金表と一致しないため、学校のコースのお申し込みを停止しています。");
  }
  return rate.id;
}
export function appUrl() {
  const value = process.env.BILLING_APP_URL;
  if (!value || !/^https:\/\//.test(value)) throw Error("決済の戻り先URLが未設定です。");
  return new URL(value).origin;
}
export function sameOrigin(req: Request) {
  return req.headers.get("origin") === new URL(req.url).origin;
}
export function workerAuthorized(req: Request) {
  const key = process.env.BILLING_WORKER_SECRET;
  const got = req.headers.get("authorization") || "";
  const wanted = `Bearer ${key}`;
  return !!key && key.length >= 32 && got.length === wanted.length && timingSafeEqual(Buffer.from(got), Buffer.from(wanted));
}
export async function billingUser(adminOnly = false) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw Error("ログインしてください。");
  const { data: profile } = await db.from("profiles").select("school_id,role").eq("id", user.id).single();
  if (!profile || !["admin", "teacher"].includes(profile.role) || (adminOnly && profile.role !== "admin")) throw Error("この操作を行う権限がありません。");
  return { db, user, schoolId: profile.school_id as string };
}
/** 日本時間の暦月（無料プランの枠の期間）。billing_reserve（0017）と同じ区切り */
export function freePeriod(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const start = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 3600_000;
  const end = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + 1, 1) - 9 * 3600_000;
  return { period_start: new Date(start).toISOString(), period_end: new Date(end).toISOString() };
}
/** 申し込み中の印（決済画面の作成中・表示中）を外す値 */
export const CLEAR_CHECKOUT = { checkout_plan: null, checkout_session_id: null, checkout_started_at: null };
/** 契約の表示名（現在の16コース・確認済みの旧プラン・以前の学校の契約） */
export function contractLabel(planId: string | null | undefined) {
  const legacy = legacyPlans(process.env.STRIPE_LEGACY_PLANS_JSON).find((x) => x.key === planId);
  return legacy ? `${legacy.label}（既存契約）` : currentPlanLabel(planId ?? undefined);
}
/** 確認待ち（料金表に無い料金ID。0018）の記録を外す値 */
export const CLEAR_REVIEW = { review_subscription_id: null, review_price_id: null, review_reason: null, review_at: null };

export async function syncSubscription(id: string) {
  const stripe = stripeClient();
  const sub = await stripe.subscriptions.retrieve(id, { expand: ["latest_invoice"] });
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const db = createAdminClient();
  const { data: account, error } = await db.from("billing_accounts").select("school_id,subscription_id").eq("customer_id", customer).single();
  if (error || !account) throw Error("契約の支払者が見つかりません。");
  // 既存契約と別のsubscriptionで上書きしない（二重契約を防ぐ）。
  if (account.subscription_id && account.subscription_id !== id) return { review: false as const };
  // 解約・期限切れ：無料プランに戻す（以前は解約後も「契約の支払いを確認してください」のまま採点できず、再申し込みもできなかった）
  if (sub.status === "canceled" || sub.status === "incomplete_expired") {
    const { error: reset } = await db.from("billing_accounts").update({
      subscription_id: null, plan_id: "free", status: "free", quota: FREE_QUOTA, personal: true, night: false,
      ...freePeriod(), ...CLEAR_CHECKOUT, ...CLEAR_REVIEW,
    }).eq("school_id", account.school_id);
    if (reset) throw Error("契約情報の保存に失敗しました。");
    return { review: false as const };
  }
  // 料金ID から反映する条件を決める（現在の16コース → 確認済みの旧プランの対応表。テスト用と本番用を混ぜない）
  const item = sub.items.data.length === 1 ? sub.items.data[0] : null;
  const terms = item ? contractTermsForPriceId(item.price.id, stripeMode(), { liveJson: process.env.STRIPE_LIVE_PRICE_IDS_JSON, legacyJson: process.env.STRIPE_LEGACY_PLANS_JSON }) : null;
  const mismatch = !item ? "契約の商品が1つではありません"
    : !terms ? "料金表・旧プランの対応表に無い料金です"
    : item.quantity !== 1 || item.price.currency !== "jpy" || item.price.unit_amount !== terms.amount || item.price.tax_behavior !== terms.taxBehavior
      || item.price.livemode !== (stripeMode() === "live") ? "料金の金額・税区分・数量が対応表と一致しません" : null;
  if (!item || !terms || mismatch) {
    // 推測で有料の権限を付けない。いまのプラン・上限・状態も変えない。確認待ちとして記録し、管理者の画面に出す（0018）
    const { error: review } = await db.from("billing_accounts").update({
      review_subscription_id: sub.id, review_price_id: item?.price.id ?? null, review_reason: mismatch, review_at: new Date().toISOString(),
    }).eq("school_id", account.school_id);
    if (review) throw Error("確認待ちの契約を記録できません。");
    return { review: true as const };
  }
  const invoice = typeof sub.latest_invoice === "object" && sub.latest_invoice ? sub.latest_invoice : null;
  const paid = invoice?.status === "paid";
  const active = sub.status === "active" && paid;
  const { error: update } = await db.from("billing_accounts").update({
    subscription_id: sub.id, plan_id: terms.key, quota: terms.limit,
    personal: terms.personal, night: terms.night, status: active ? "active" : sub.status === "active" ? "payment_pending" : sub.status,
    period_start: new Date(item.current_period_start * 1000).toISOString(),
    period_end: new Date(item.current_period_end * 1000).toISOString(),
    // 契約ができたので、申し込み中の印を外す（残すと、解約後に申し込み直せなかった）
    ...CLEAR_CHECKOUT, ...CLEAR_REVIEW,
  }).eq("school_id", account.school_id);
  if (update) throw Error("契約情報の保存に失敗しました。");
  return { review: false as const };
}
