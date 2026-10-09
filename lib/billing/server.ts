import "server-only";
import Stripe from "stripe";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { billingPlan } from "./catalog";

export const billingEnabled = () => process.env.BILLING_ENABLED === "on";
export const nightEnabled = () => billingEnabled() && process.env.NIGHT_GRADING_ENABLED === "on";
export const stripeClient = () => {
  if (!process.env.STRIPE_SECRET_KEY) throw Error("決済の設定が完了していません。");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-08-26.dahlia", maxNetworkRetries: 2 });
};
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
export function priceMap(): Record<string, string> {
  return JSON.parse(process.env.STRIPE_PRICE_IDS_JSON || "{}");
}
export async function syncSubscription(id: string) {
  const stripe = stripeClient();
  const sub = await stripe.subscriptions.retrieve(id, { expand: ["latest_invoice"] });
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const db = createAdminClient();
  const { data: account, error } = await db.from("billing_accounts").select("school_id,subscription_id").eq("customer_id", customer).single();
  if (error || !account) throw Error("契約の支払者が見つかりません。");
  // 既存契約と別のsubscriptionで上書きしない（二重契約を防ぐ）。
  if (account.subscription_id && account.subscription_id !== id) return;
  if (sub.items.data.length !== 1) throw Error("契約の商品が一致しません。");
  const item = sub.items.data[0];
  const planId = Object.entries(priceMap()).find(([, price]) => price === item.price.id)?.[0];
  const plan = planId && billingPlan(planId);
  if (!plan || item.quantity !== 1 || item.price.currency !== "jpy" || item.price.unit_amount !== plan.amount) throw Error("契約の料金が料金表と一致しません。");
  const invoice = typeof sub.latest_invoice === "object" && sub.latest_invoice ? sub.latest_invoice : null;
  const paid = invoice?.status === "paid";
  const active = sub.status === "active" && paid;
  const { error: update } = await db.from("billing_accounts").update({
    subscription_id: sub.id, plan_id: plan.id, quota: plan.limit,
    personal: plan.personal, night: plan.night, status: active ? "active" : sub.status === "active" ? "payment_pending" : sub.status,
    period_start: new Date(item.current_period_start * 1000).toISOString(),
    period_end: new Date(item.current_period_end * 1000).toISOString(),
  }).eq("school_id", account.school_id);
  if (update) throw Error("契約情報の保存に失敗しました。");
}
