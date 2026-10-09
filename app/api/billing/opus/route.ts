import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { appUrl, billingEnabled, billingUser, sameOrigin, stripeClient } from "@/lib/billing/server";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "操作元を確認できません。" }, { status: 403 });
  try {
    if (!billingEnabled()) throw Error("決済の準備が完了していません。");
    const { db, schoolId, user } = await billingUser();
    const { jobId } = await req.json();
    const { data: job } = await db.from("grading_jobs").select("id,created_by,status").eq("id", jobId).single();
    if (!job || job.created_by !== user.id || job.status !== "running") throw Error("採点予約が見つかりません。");
    const admin = createAdminClient();
    const { data: order } = await admin.from("billing_orders").select("*").eq("id", jobId).eq("school_id", schoolId).single();
    if (!order || order.status !== "pending") throw Error("この採点の支払いは受付できません。");
    const stripe = stripeClient();
    if (order.checkout_id) {
      const old = await stripe.checkout.sessions.retrieve(order.checkout_id);
      if (old.status !== "open" || !old.url) throw Error("支払いの状態を確認しています。採点履歴を確認してください。");
      return NextResponse.json({ url: old.url });
    }
    if (Date.now() - Date.parse(order.created_at) > 23 * 3600_000) throw Error("期限を過ぎた予約です。管理者に取り消しを依頼してください。");
    const { data: account } = await admin.from("billing_accounts").select("customer_id").eq("school_id", schoolId).single();
    if (!account?.customer_id) throw Error("契約の支払者が未登録です。");
    const session = await stripe.checkout.sessions.create({ mode: "payment", customer: account.customer_id,
      line_items: [{ price_data: { currency: "jpy", unit_amount: 55, tax_behavior: "inclusive", product_data: { name: "Opus単独採点・1答案" } }, quantity: 1 }],
      success_url: `${appUrl()}/billing/return`, cancel_url: appUrl(),
      integration_identifier: `saiten_${randomBytes(8).toString("hex").slice(0,8).replace(/[0-9]/g,"a")}`,
    }, { idempotencyKey: `opus-job-${jobId}` });
    const { error } = await admin.from("billing_orders").update({ checkout_id: session.id }).eq("id", jobId);
    if (error) throw Error("支払い情報を保存できません。もう一度お試しください。");
    return NextResponse.json({ url: session.url });
  } catch (e) { return NextResponse.json({ error: e instanceof Error && !/Stripe/.test(e.name) ? e.message : "決済を開始できません。" }, { status: 400 }); }
}
