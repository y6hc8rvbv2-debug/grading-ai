// 暗号資産の決済代行からの通知（ver6）。署名を確かめ、注文の番号・金額・通貨が一致し、支払いが確定したときだけ前払いを反映する。
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { billingEnabled } from "@/lib/billing/server";
import { cryptoProvider, readCryptoWebhook } from "@/lib/billing/crypto";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  if (!billingEnabled() || !cryptoProvider()) return NextResponse.json({ error: "設定未完了" }, { status: 503 });
  const raw = await req.text();
  const paid = readCryptoWebhook(raw, req.headers);
  if (!paid) return NextResponse.json({ error: "署名が一致しません" }, { status: 400 });
  if (!UUID.test(paid.orderId)) return NextResponse.json({ received: true });   // このアプリの注文ではない
  try {
    const db = createAdminClient();
    const { data: order } = await db.from("billing_prepaid").select("id,amount,status,method,provider").eq("id", paid.orderId).maybeSingle();
    if (!order || order.method !== "crypto" || order.provider !== cryptoProvider()) return NextResponse.json({ received: true });
    if (paid.final === "pending") return NextResponse.json({ received: true });
    if (paid.final === "failed") {
      await db.from("billing_prepaid").update({ status: "failed" }).eq("id", order.id).eq("status", "pending");
      return NextResponse.json({ received: true });
    }
    // 金額が一致しない（不足・過払い）ときは反映しない。決済代行の画面で解決（resolved）された通知を待つ
    if (paid.amountJpy !== order.amount) return NextResponse.json({ received: true, mismatch: true });
    const { error } = await db.rpc("billing_apply_prepaid", { p_order: order.id });
    if (error) throw error;
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: "反映に失敗しました。再送してください。" }, { status: 500 });
  }
}
