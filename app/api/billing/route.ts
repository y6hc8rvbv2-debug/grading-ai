import { NextResponse } from "next/server";
import { isNativeUserAgent } from "@/lib/native";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { CLEAR_CHECKOUT, appUrl, billingEnabled, billingUser, nightEnabled, planAvailability, stripeMode, planPriceId, sameOrigin, stripeClient, syncSubscription, verifiedSchoolTaxRate } from "@/lib/billing/server";
import { BILLING_PLANS, billingPlan } from "@/lib/billing/catalog";

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
    // コースごとに申し込めるか（理由つき）。料金ID・秘密は返さない
    const availability = Object.fromEntries(BILLING_PLANS.map((p) => [p.id, planAvailability(p)]));
    return NextResponse.json({ enabled: true, nightEnabled: nightEnabled(), canManage: profile?.role === "admin", pendingOrders: orders || [], account, used: usage?.length || 0, opusAmount: usage?.reduce((n, x) => n + x.amount, 0) || 0, availability });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "契約情報を確認できません。" }, { status: 503 }); }
}
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "別のサイトからの操作を拒否しました。" }, { status: 403 });
  // ストア用のアプリの中では、申し込み・支払いを受け付けない（lib/native.ts）
  if (isNativeUserAgent(req.headers.get("user-agent"))) return NextResponse.json({ error: "アプリでは、お申し込み・お支払いはできません。" }, { status: 403 });
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
    // 受け付けるのはプランのキーだけ（画面から送られた金額・料金ID・上限は使わない）
    const plan = billingPlan(body?.planId);
    if (!plan) throw Error("このプランは現在申し込めません。");
    const available = planAvailability(plan);
    if (!available.ok) throw Error(available.reason);
    if (plan.night) {
      const { data: worker } = await db.from("billing_worker_state").select("last_seen").eq("id", true).single();
      if (!worker?.last_seen || Date.parse(worker.last_seen) < Date.now() - 3 * 60_000) throw Error("夜間処理を確認中です。後ほどお試しください。");
    }
    if (account?.subscription_id) throw Error("既存の契約は「契約・支払い管理」で変更してください。");
    // 以前の申し込み（決済画面）が残っていれば、状態を Stripe で確かめてから続ける。
    // 以前は完了・期限切れの申し込みの印が残り続け、解約後や24時間後に申し込み直せなかった
    if (account?.checkout_session_id) {
      const old = await stripe.checkout.sessions.retrieve(account.checkout_session_id);
      if (old.status === "open" && old.url && account.checkout_plan === plan.id) return NextResponse.json({ url: old.url });
      if (old.status === "complete") {
        if (old.subscription) await syncSubscription(typeof old.subscription === "string" ? old.subscription : old.subscription.id);
        throw Error("以前のお申し込みが完了しています。画面を再読み込みして、契約状況を確認してください。");
      }
      // 別のプランの決済画面が開いたままなら閉じる（支払われないように）。期限切れならそのまま
      if (old.status === "open") await stripe.checkout.sessions.expire(old.id);
      await db.from("billing_accounts").update(CLEAR_CHECKOUT).eq("school_id", schoolId).eq("checkout_session_id", old.id);
    } else if (account?.checkout_plan && account.checkout_plan !== plan.id && account.checkout_started_at
               && Date.parse(account.checkout_started_at) < Date.now() - 3600_000) {
      // 決済画面を作る途中で止まった申し込み（1時間以上前）は外す
      await db.from("billing_accounts").update(CLEAR_CHECKOUT).eq("school_id", schoolId).is("checkout_session_id", null).eq("checkout_started_at", account.checkout_started_at);
    }
    await db.from("billing_accounts").update({ checkout_plan: plan.id, checkout_started_at: new Date().toISOString() }).eq("school_id", schoolId).is("checkout_plan", null);
    const { data: lock, error: lockError } = await db.from("billing_accounts").select("checkout_plan,checkout_started_at,checkout_session_id").eq("school_id", schoolId).single();
    if (lockError || !lock || lock.checkout_plan !== plan.id) throw Error("別のプランの申し込みが進行中です。しばらくしてから、もう一度お試しください。");
    if (lock.checkout_session_id) {
      const other = await stripe.checkout.sessions.retrieve(lock.checkout_session_id);
      if (other.status === "open" && other.url) return NextResponse.json({ url: other.url });
      throw Error("申し込みの状態を確認しています。画面を再読み込みしてください。");
    }
    const priceId = planPriceId(plan).id;
    if (!priceId) throw Error("このプランの決済設定が未完了です。");
    // Stripe の料金がアプリの料金表と一致することを確かめる（金額・円・毎月・税区分・有効・テスト/本番の別）
    const price = await stripe.prices.retrieve(priceId);
    if (price.unit_amount !== plan.amount || price.currency !== "jpy" || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1
        || price.tax_behavior !== plan.taxBehavior || !price.active || price.livemode !== (stripeMode() === "live")) {
      throw Error("決済側の料金設定がアプリの料金表と一致しません。");
    }
    // 学校（税別）は、作成済みの税率で消費税を加える（無ければ止める）
    const taxRates = plan.taxBehavior === "exclusive" ? [await verifiedSchoolTaxRate(stripe)] : undefined;
    const session = await stripe.checkout.sessions.create({ mode: "subscription", customer,
      line_items: [{ price: priceId, quantity: 1, ...(taxRates ? { tax_rates: taxRates } : {}) }], success_url: `${appUrl()}/billing/return`, cancel_url: appUrl(),
      integration_identifier: `saiten_${randomBytes(8).toString("hex").slice(0,8).replace(/[0-9]/g,"a")}`,
    }, { idempotencyKey: `subscribe-${schoolId}-${plan.id}-${lock.checkout_started_at}` });
    const { error: stored } = await db.from("billing_accounts").update({ checkout_session_id: session.id }).eq("school_id", schoolId);
    if (stored) throw Error("決済画面を保存できません。もう一度お試しください。");
    return NextResponse.json({ url: session.url });
  } catch (e) { return NextResponse.json({ error: e instanceof Error && !/Stripe/.test(e.name) ? e.message : "決済を開始できません。設定を確認してください。" }, { status: 400 }); }
}
