// 定期処理（毎分。pg_cron → pg_net → この API。docs/BILLING-NIGHT.md）。合言葉（CRON の Bearer）が要る
//   1. 生存の記録・期限切れの Opus 支払いの取り消し・返金
//   2. 上限を超えた分・学校の Opus単独の請求を、Stripe の次回の請求に加える（2026-11-02。0026。採点が終わったものだけ）
//   3. 夜間の採点：Batch（AI の費用が半分。lib/grading/batch.ts）にまとめて送り、結果が出たら同じ後処理で保存する。
//      夜間以外の予約（個人・塾の Opus単独の支払い後）は、今までどおり1件ずつすぐに採点する
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { POST as grade } from "@/app/api/grade/route";
import { createAdminClient } from "@/lib/supabase/server";
import { appUrl, billingEnabled, nightEnabled, schoolTaxRateId, stripeClient, workerAuthorized } from "@/lib/billing/server";
import { BATCH_LEASE_HOURS, BATCH_MAX_REQUESTS, nightBatchEnabled } from "@/lib/grading/batch";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Admin = ReturnType<typeof createAdminClient>;
type QueueRow = { id: string; night: boolean };
type JobRow = { id: string; submission_id: string; request_id: string; mode: string };

export async function POST(req: Request) {
  if (!workerAuthorized(req)) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  if (!billingEnabled()) return NextResponse.json({ error: "課金機能は停止中です" }, { status: 503 });
  const db = createAdminClient();
  const auth = req.headers.get("authorization")!;
  const callGrade = (body: Record<string, unknown>) =>
    grade(new Request(`${appUrl()}/api/grade`, { method: "POST", headers: { "content-type": "application/json", authorization: auth }, body: JSON.stringify(body) }));
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
    const charged = await syncCharges(db);

    // 夜間の Batch：まず結果が出たものを当てはめ、次に新しい答案をまとめて送る
    let applied = 0, submitted = 0;
    if (nightEnabled() && nightBatchEnabled()) {
      applied = await collectBatches(db, callGrade);
    }

    let processed = 0;
    const nightJobs: { queue: QueueRow; job: JobRow }[] = [];
    for (let i = 0; i < BATCH_MAX_REQUESTS + 1; i++) {
      const { data, error } = await db.rpc("billing_claim_queue");
      if (error) throw error;
      const queue = data?.[0] as QueueRow | undefined;
      if (!queue) break;
      if (queue.night && !nightEnabled()) {
        await db.from("night_queue").update({ lease_until: null }).eq("id", queue.id);
        if (processed + nightJobs.length === 0) return NextResponse.json({ processed: 0, paused: true, charged });
        break;
      }
      const { data: job } = await db.from("grading_jobs").select("id,submission_id,request_id,mode").eq("id", queue.id).single();
      if (!job) throw Error("採点記録がありません");
      if (queue.night && nightBatchEnabled()) { nightJobs.push({ queue, job: job as JobRow }); continue; }
      // 夜間以外（Opus単独の支払い後など）・Batch を止めているとき：今までどおり1件ずつ
      if (processed >= 1) { await db.from("night_queue").update({ lease_until: null }).eq("id", queue.id); break; }
      await runNow(db, job as JobRow, callGrade);
      await db.from("night_queue").update({ lease_until: null }).eq("id", queue.id);
      processed++;
    }
    if (nightJobs.length) submitted = await submitBatch(db, nightJobs, callGrade);
    return NextResponse.json({ processed, submitted, applied, charged });
  } catch { return NextResponse.json({ error: "採点・返金・請求の処理に失敗しました。次回再試行します。" }, { status: 500 }); }
}

/** 今までどおりの1件ずつの採点（途中で止まった段階が10分以上 calling のままなら、呼び直さず失敗にする） */
async function runNow(db: Admin, job: JobRow, callGrade: (b: Record<string, unknown>) => Promise<Response>) {
  const { data: stage } = await db.from("grading_stages").select("started_at,batch_id").eq("job_id", job.id).eq("status", "calling").maybeSingle();
  if (stage && !stage.batch_id && Date.parse(stage.started_at) < Date.now() - 10 * 60_000) {
    await db.rpc("fail_grading_job", { p_job_id: job.id, p_error: "予約採点が時間切れになりました。再度お申し込みください。" });
    return;
  }
  const response = await callGrade({ submissionId: job.submission_id, requestId: job.request_id, mode: job.mode, opusConsent: true });
  if (!response.ok && response.status !== 402) await db.rpc("fail_grading_job", { p_job_id: job.id, p_error: "予約採点を完了できませんでした。" });
}

const anthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });

/** 夜間の答案の「次の段階」の要求をまとめて Batch に送る。送れなかったら段階の記録を消して、次回やり直す */
async function submitBatch(db: Admin, list: { queue: QueueRow; job: JobRow }[], callGrade: (b: Record<string, unknown>) => Promise<Response>) {
  const requests: { custom_id: string; params: Record<string, unknown> }[] = [];
  const jobsInBatch: string[] = [];
  for (const { queue, job } of list) {
    // 前回の送信が途中で止まって残った段階（Batch に入っていない calling）は消してやり直す
    await db.from("grading_stages").delete().eq("job_id", job.id).eq("status", "calling").is("batch_id", null).lt("started_at", new Date(Date.now() - 10 * 60_000).toISOString());
    const res = await callGrade({ submissionId: job.submission_id, requestId: job.request_id, mode: job.mode, opusConsent: true, batch: "prepare" });
    const json = await res.json().catch(() => null) as { batch?: { stageId: string; params: Record<string, unknown> } } | null;
    if (res.ok && json?.batch) { requests.push({ custom_id: json.batch.stageId, params: json.batch.params }); jobsInBatch.push(job.id); continue; }
    if (!res.ok && res.status !== 402 && res.status !== 202) await db.rpc("fail_grading_job", { p_job_id: job.id, p_error: "夜間の採点を準備できませんでした。" });
    await db.from("night_queue").update({ lease_until: null }).eq("id", queue.id);
  }
  if (!requests.length) return 0;
  const { data: row, error } = await db.from("ai_batches").insert({ status: "submitting", request_count: requests.length }).select("id").single();
  if (error || !row) throw Error("Batch の記録を作れません");
  try {
    const batch = await anthropic().beta.messages.batches.create({ requests } as unknown as Anthropic.Beta.Messages.BatchCreateParams);
    await db.from("ai_batches").update({ status: "in_progress", provider_batch_id: batch.id }).eq("id", row.id);
    await db.from("grading_stages").update({ batch_id: row.id }).in("id", requests.map((r) => r.custom_id));
    await db.from("night_queue").update({ lease_until: new Date(Date.now() + BATCH_LEASE_HOURS * 3600_000).toISOString() }).in("id", jobsInBatch);
    return requests.length;
  } catch {
    await db.from("ai_batches").update({ status: "failed", error: "送信に失敗しました", ended_at: new Date().toISOString() }).eq("id", row.id);
    await db.from("grading_stages").delete().in("id", requests.map((r) => r.custom_id)).eq("status", "calling");
    await db.from("night_queue").update({ lease_until: null }).in("id", jobsInBatch);
    return 0;
  }
}

/** 結果が出た Batch を読み、答案ごとに同じ後処理で保存する。上の段階に回す答案は、次回の Batch に入る */
async function collectBatches(db: Admin, callGrade: (b: Record<string, unknown>) => Promise<Response>) {
  const { data: open } = await db.from("ai_batches").select("id,provider_batch_id").eq("status", "in_progress").order("created_at").limit(5);
  let applied = 0;
  for (const b of open || []) {
    const client = anthropic();
    const info = await client.beta.messages.batches.retrieve(b.provider_batch_id!);
    if (info.processing_status !== "ended") continue;
    const seen = new Set<string>();
    for await (const r of await client.beta.messages.batches.results(b.provider_batch_id!)) {
      seen.add(r.custom_id);
      const { data: stage } = await db.from("grading_stages").select("id,job_id,status").eq("id", r.custom_id).maybeSingle();
      if (!stage || stage.status !== "calling") continue;
      const { data: job } = await db.from("grading_jobs").select("id,submission_id,request_id,mode").eq("id", stage.job_id).single();
      if (!job) continue;
      const res = await callGrade({ submissionId: job.submission_id, requestId: job.request_id, mode: job.mode, opusConsent: true, batch: "apply", stageId: stage.id, result: r.result });
      if (!res.ok && res.status !== 402) await db.rpc("fail_grading_job", { p_job_id: job.id, p_error: "夜間の採点を完了できませんでした。" });
      await db.from("night_queue").update({ lease_until: null }).eq("id", job.id);
      applied++;
    }
    // 結果の無かった要求（あり得ないが念のため）は失敗にする
    const { data: left } = await db.from("grading_stages").select("id,job_id").eq("batch_id", b.id).eq("status", "calling");
    for (const s of left || []) if (!seen.has(s.id)) {
      await db.rpc("fail_grading_job", { p_job_id: s.job_id, p_error: "夜間の採点の結果が返りませんでした。もう一度お申し込みください。" });
      await db.from("night_queue").update({ lease_until: null }).eq("id", s.job_id);
    }
    await db.from("ai_batches").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", b.id);
  }
  return applied;
}

/** 上限を超えた分・学校の Opus単独の料金を、Stripe の次回の請求に加える（同じ答案を二重に請求しない：答案ごとの冪等キー） */
async function syncCharges(db: Admin) {
  const { data: rows } = await db.from("billing_usage").select("id,school_id,overage_yen,opus_yen").eq("charge_status", "pending").order("created_at").limit(20);
  if (!rows?.length) return 0;
  const stripe = stripeClient();
  let n = 0;
  for (const u of rows) {
    const { data: a } = await db.from("billing_accounts").select("customer_id,subscription_id,personal").eq("school_id", u.school_id).single();
    if (!a?.customer_id) continue;   // 支払者が無い（あり得ないが、次回また確かめる）
    // 学校（税別）は消費税の税率を付ける。個人・塾は税込の金額
    const taxRates = a.personal ? [] : schoolTaxRateId() ? [schoolTaxRateId()!] : null;
    if (taxRates === null) continue;
    const items: string[] = [];
    const add = async (kind: "overage" | "opus", amount: number, description: string) => {
      const item = await stripe.invoiceItems.create({
        customer: a.customer_id!, ...(a.subscription_id ? { subscription: a.subscription_id } : {}),
        currency: "jpy", amount, description, ...(taxRates.length ? { tax_rates: taxRates } : {}),
        metadata: { usage_id: u.id, kind },
      }, { idempotencyKey: `usage-${kind}-${u.id}` });
      items.push(item.id);
    };
    if (u.overage_yen > 0) await add("overage", u.overage_yen, `上限を超えた分の採点（1答案・${a.personal ? "税込" : "税別"}）`);
    if (u.opus_yen > 0) await add("opus", u.opus_yen, "Opus単独採点の追加料金（1答案・税別）");
    const { error } = await db.from("billing_usage").update({ charge_status: "synced", stripe_items: items }).eq("id", u.id).eq("charge_status", "pending");
    if (error) throw Error("請求の記録を保存できません");
    n++;
  }
  return n;
}
