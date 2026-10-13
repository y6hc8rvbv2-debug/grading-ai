import { NextResponse } from "next/server";
import { POST as grade } from "@/app/api/grade/route";
import { createAdminClient } from "@/lib/supabase/server";
import { appUrl, billingEnabled, nightEnabled, stripeClient, workerAuthorized } from "@/lib/billing/server";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!workerAuthorized(req)) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  if (!billingEnabled()) return NextResponse.json({ error: "課金機能は停止中です" }, { status: 503 });
  const db = createAdminClient();
  try {
    const { error: heartbeat } = await db.from("billing_worker_state").update({ last_seen: new Date().toISOString() }).eq("id", true);
    if (heartbeat) throw heartbeat;
    const { data: abandoned } = await db.from("billing_orders").select("id").eq("status", "pending").is("checkout_id", null).lt("created_at", new Date(Date.now() - 3600_000).toISOString()).limit(5);
    for (const row of abandoned || []) await db.rpc("fail_grading_job", { p_job_id: row.id, p_error: "支払い画面を開かずに予約が期限切れになりました。" });
    const { data: refunds } = await db.from("billing_orders").select("id,payment_intent").eq("status", "refund_pending").limit(5);
    for (const order of refunds || []) {
      if (!order.payment_intent) continue;
      const stripe = stripeClient();
      const previous = await stripe.refunds.list({ payment_intent: order.payment_intent, limit: 10 });
      let refund = previous.data.find(r => r.amount === 55 && r.status !== "failed" && r.status !== "canceled");
      refund ??= await stripe.refunds.create({ payment_intent: order.payment_intent }, { idempotencyKey: `opus-refund-${order.id}` });
      if (refund.status === "succeeded") {
        const { error } = await db.from("billing_orders").update({ status: "refunded" }).eq("id", order.id);
        if (error) throw Error("返金記録の保存に失敗");
      }
    }
    const { data, error } = await db.rpc("billing_claim_queue");
    if (error) throw error;
    const queue = data?.[0];
    if (!queue) return NextResponse.json({ processed: 0 });
    if (queue.night && !nightEnabled()) {
      await db.from("night_queue").update({ lease_until: null }).eq("id", queue.id);
      return NextResponse.json({ processed: 0, paused: true });
    }
    const { data: job } = await db.from("grading_jobs").select("*").eq("id", queue.id).single();
    if (!job) throw Error("採点記録がありません");
    // 中途停止後、実際に呼び始めた段階が10分以上callingなら再呼出しせず失敗として終了。
    const { data: stage } = await db.from("grading_stages").select("started_at").eq("job_id", job.id).eq("status", "calling").maybeSingle();
    if (stage && Date.parse(stage.started_at) < Date.now() - 10 * 60_000) {
      await db.rpc("fail_grading_job", { p_job_id: job.id, p_error: "予約採点が時間切れになりました。再度お申し込みください。" });
    } else {
      const response = await grade(new Request(`${appUrl()}/api/grade`, { method: "POST", headers: { "content-type": "application/json", authorization: req.headers.get("authorization")! }, body: JSON.stringify({ submissionId: job.submission_id, requestId: job.request_id, mode: job.mode, opusConsent: true }) }));
      if (!response.ok && response.status !== 402) await db.rpc("fail_grading_job", { p_job_id: job.id, p_error: "予約採点を完了できませんでした。" });
    }
    const { error: release } = await db.from("night_queue").update({ lease_until: null }).eq("id", queue.id);
    if (release) throw release;
    return NextResponse.json({ processed: 1 });
  } catch { return NextResponse.json({ error: "採点・返金の処理に失敗しました。次回再試行します。" }, { status: 500 }); }
}
