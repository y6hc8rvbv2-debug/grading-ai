import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { billingEnabled, stripeClient, syncSubscription } from "@/lib/billing/server";

export async function POST(req: Request) {
  if (!billingEnabled() || !process.env.STRIPE_WEBHOOK_SECRET) return NextResponse.json({ error: "設定未完了" }, { status: 503 });
  const stripe = stripeClient();
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") || "", process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return NextResponse.json({ error: "署名が一致しません" }, { status: 400 }); }
  try {
    if (event.type.startsWith("customer.subscription.")) await syncSubscription((event.data.object as Stripe.Subscription).id);
    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const inv = event.data.object as Stripe.Invoice;
      const sub = inv.parent?.subscription_details?.subscription;
      if (sub) await syncSubscription(typeof sub === "string" ? sub : sub.id);
    }
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)) {
      const session = await stripe.checkout.sessions.retrieve((event.data.object as Stripe.Checkout.Session).id);
      if (session.mode === "subscription" && session.subscription) await syncSubscription(typeof session.subscription === "string" ? session.subscription : session.subscription.id);
      if (session.mode === "payment") {
        const db = createAdminClient();
        const { data: order, error: lookup } = await db.from("billing_orders").select("*").eq("checkout_id", session.id).single();
        if (lookup || !order) throw Error("決済と採点予約を照合できません。");
        const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const { data: account } = await db.from("billing_accounts").select("customer_id").eq("school_id", order.school_id).single();
        if (account?.customer_id !== customer || session.amount_total !== 55 || session.currency !== "jpy") throw Error("支払者・金額が一致しません。");
        if (session.payment_status === "paid") {
          const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
          const { error } = await db.from("billing_orders").update({ status: order.status === "expired" ? "refund_pending" : "paid", payment_intent: intent }).eq("id", order.id).in("status", ["pending", "expired"]);
          if (error) throw Error("入金を保存できません。");
        } else if (session.status === "expired" || event.type === "checkout.session.async_payment_failed") {
          const { error } = await db.rpc("fail_grading_job", { p_job_id: order.id, p_error: "Opus追加料金の支払いが完了しませんでした" });
          if (error) throw Error("予約を取り消せません。");
        }
      }
    }
    return NextResponse.json({ received: true });
  } catch { return NextResponse.json({ error: "決済情報の反映に失敗しました。再送してください。" }, { status: 500 }); }
}
