import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { appUrl, billingEnabled, billingUser, nightEnabled, priceMap, sameOrigin, stripeClient } from "@/lib/billing/server";
import { billingPlan } from "@/lib/billing/catalog";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { db, schoolId, user } = await billingUser();
    if (!billingEnabled()) return NextResponse.json({ enabled: false, nightEnabled: false });
    const { data: account, error } = await db.from("billing_accounts").select("plan_id,status,quota,period_start,period_end,night,personal").eq("school_id", schoolId).maybeSingle();
    if (error) throw Error("契約台帳の準備が完了していません。");
    const { data: usage, error: e } = await db.from("billing_usage").select("status,amount").eq("school_id", schoolId).eq("period_start", account?.period_start || new Date(0).toISOString()).in("status", ["reserved", "done"]);
    if (e) throw Error("利用量を確認できません。");
    const { data: profile } = await db.from("profiles").select("role").eq("id", user.id).single();
    const { data: jobs } = await db.from("grading_jobs").select("id").eq("created_by", user.id).eq("status", "running");
    const { data: orders } = jobs?.length ? await db.from("billing_orders").select("id").in("id", jobs.map(j => j.id)).eq("status", "pending") : { data: [] };
    return NextResponse.json({ enabled: true, nightEnabled: nightEnabled(), canManage: profile?.role === "admin", pendingOrders: orders || [], account, used: usage?.length || 0, opusAmount: usage?.reduce((n, x) => n + x.amount, 0) || 0 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "契約情報を確認できません。" }, { status: 503 }); }
}
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "別のサイトからの操作を拒否しました。" }, { status: 403 });
  try {
    if (!billingEnabled()) throw Error("決済の設定が完了していません。");
    const { user, schoolId } = await billingUser(true);
    const body = await req.json();
    const db = createAdminClient();
    let { data: account } = await db.from("billing_accounts").select("*").eq("school_id", schoolId).maybeSingle();
    if (!account) {
      const { error } = await db.from("billing_accounts").upsert({ school_id: schoolId }, { onConflict: "school_id", ignoreDuplicates: true });
      if (error) throw Error("契約情報を作成できません。");
      ({ data: account } = await db.from("billing_accounts").select("*").eq("school_id", schoolId).single());
    }
    const stripe = stripeClient();
    let customer = account?.customer_id as string | null;
    if (!customer) {
      const c = await stripe.customers.create({ email: user.email }, { idempotencyKey: `school-customer-${schoolId}` });
      customer = c.id;
      const { error } = await db.from("billing_accounts").update({ customer_id: customer }).eq("school_id", schoolId);
      if (error) throw Error("支払者を保存できません。");
    }
    if (body.action === "portal") {
      const portal = await stripe.billingPortal.sessions.create({ customer, return_url: appUrl() });
      return NextResponse.json({ url: portal.url });
    }
    const plan = billingPlan(body.planId);
    if (!plan || (plan.night && !nightEnabled())) throw Error("このプランは現在申し込めません。");
    if (plan.night) {
      const { data: worker } = await db.from("billing_worker_state").select("last_seen").eq("id", true).single();
      if (!worker?.last_seen || Date.parse(worker.last_seen) < Date.now() - 3 * 60_000) throw Error("夜間処理を確認中です。後ほどお試しください。");
    }
    if (account?.subscription_id) throw Error("既存の契約は「契約・支払い管理」で変更してください。");
    if (account?.checkout_session_id) {
      const old = await stripe.checkout.sessions.retrieve(account.checkout_session_id);
      if (old.status === "open" && old.url && account.checkout_plan === plan.id) return NextResponse.json({ url: old.url });
      throw Error("以前の申し込みを確認しています。管理者が契約状況を確認してください。");
    }
    const { data: locked, error: lockError } = await db.from("billing_accounts").update({ checkout_plan: plan.id, checkout_started_at: new Date().toISOString() }).eq("school_id", schoolId).is("checkout_plan", null).select("checkout_plan").maybeSingle();
    if (lockError || (!locked && account?.checkout_plan !== plan.id)) throw Error("別のプランの申し込みが進行中です。管理者が確認してください。");
    if (!locked && account?.checkout_started_at && Date.parse(account.checkout_started_at) < Date.now() - 23 * 3600_000) throw Error("申し込みの状態を管理者が確認してください。");
    const priceId = priceMap()[plan.id];
    if (!priceId) throw Error("このプランの決済設定が未完了です。");
    const price = await stripe.prices.retrieve(priceId);
    if (price.unit_amount !== plan.amount || price.currency !== "jpy" || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1 || price.tax_behavior !== "inclusive") throw Error("決済側の料金設定がアプリの料金表と一致しません。");
    const session = await stripe.checkout.sessions.create({ mode: "subscription", customer,
      line_items: [{ price: priceId, quantity: 1 }], success_url: `${appUrl()}/billing/return`, cancel_url: appUrl(),
      integration_identifier: `saiten_${randomBytes(8).toString("hex").slice(0,8).replace(/[0-9]/g,"a")}`,
    }, { idempotencyKey: `subscribe-${schoolId}-${plan.id}` });
    const { error: stored } = await db.from("billing_accounts").update({ checkout_session_id: session.id }).eq("school_id", schoolId);
    if (stored) throw Error("決済画面を保存できません。もう一度お試しください。");
    return NextResponse.json({ url: session.url });
  } catch (e) { return NextResponse.json({ error: e instanceof Error && !/Stripe/.test(e.name) ? e.message : "決済を開始できません。設定を確認してください。" }, { status: 400 }); }
}
