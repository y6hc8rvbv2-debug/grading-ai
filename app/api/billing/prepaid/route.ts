// ============================================================================
// 前払い（ver6）：1・3・6・12か月分をまとめて支払う
//
//   POST /api/billing/prepaid { planId, months, method: "stripe" | "crypto" }（管理者だけ） → { url }
//     stripe … Stripe の支払い画面（1回払い）。カード・Apple Pay・Google Pay に加え、コンビニ払い・PayPay・銀行振込など
//              Stripe のダッシュボードで有効にした方法が自動で出る（コードの変更は不要）
//     crypto … 暗号資産の決済代行（lib/billing/crypto.ts）の支払い画面
//   支払いの確認は通知（/api/billing/webhook・/api/billing/crypto/webhook）で行い、billing_apply_prepaid（0019）で反映する。
// 受け付けるのはプランのキーと月数だけ（画面から送られた金額は使わない）。ストア用のアプリの中では受け付けない。
// ============================================================================
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isNativeUserAgent } from "@/lib/native";
import { createAdminClient } from "@/lib/supabase/server";
import { REAUTH_ERROR, verifyPassword } from "@/lib/security";
import { appUrl, billingEnabled, billingUser, planAvailability, sameOrigin, stripeClient, verifiedSchoolTaxRate } from "@/lib/billing/server";
import { billingPlan } from "@/lib/billing/catalog";
import { isPrepaidMonths, prepaidTotal } from "@/lib/billing/prepaid";
import { createCryptoInvoice, cryptoProvider } from "@/lib/billing/crypto";
import { courseByKey, courseLabel } from "@/lib/subscription-plans";

export const dynamic = "force-dynamic";

export async function GET() {
  // 画面の案内用：前払い・暗号資産が使えるか（秘密は返さない）
  return NextResponse.json({ enabled: billingEnabled(), crypto: billingEnabled() && !!cryptoProvider() });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "別のサイトからの操作を拒否しました。" }, { status: 403 });
  if (isNativeUserAgent(req.headers.get("user-agent"))) return NextResponse.json({ error: "アプリでは、お申し込み・お支払いはできません。" }, { status: 403 });
  try {
    if (!billingEnabled()) throw Error("決済の設定が完了していません。");
    const { user, schoolId } = await billingUser(true);
    const body = await req.json().catch(() => ({}));
    // 再認証（2026-10-22）：前払いの申し込みの前に管理者のパスワードを確かめる
    if (!(await verifyPassword(user.email, body?.password))) return NextResponse.json({ error: REAUTH_ERROR, code: "reauth" }, { status: 401 });
    const plan = billingPlan(body?.planId);
    const course = plan ? courseByKey(plan.id) : undefined;
    if (!plan || !course) throw Error("このプランは現在申し込めません。");
    if (!isPrepaidMonths(body?.months)) throw Error("前払いの月数は 1・3・6・12 か月から選んでください。");
    const method = body?.method === "crypto" ? "crypto" : body?.method === "stripe" ? "stripe" : null;
    if (!method) throw Error("支払い方法を選んでください。");
    // 夜間コースは定期処理の確認が要るので、前払いでは通常のコースだけを扱う
    if (plan.night) throw Error("夜間コースは月額の契約でお申し込みください。");
    const available = planAvailability(plan);
    if (method === "stripe" && !available.ok) throw Error(available.reason);
    if (method === "crypto" && !cryptoProvider()) throw Error("暗号資産での支払いは、まだ設定されていません。");

    const db = createAdminClient();
    const { data: account } = await db.from("billing_accounts").select("subscription_id,plan_id,prepaid_until,customer_id").eq("school_id", schoolId).maybeSingle();
    if (account?.subscription_id) throw Error("月額の契約中です。前払いに切り替えるときは、先に「契約・支払い管理」で解約してください。");
    if (account?.prepaid_until && Date.parse(account.prepaid_until) > Date.now() && account.plan_id !== plan.id) {
      throw Error("別のコースの前払いの期間中です。期間が終わってから、別のコースをお申し込みください（同じコースは延長できます）。");
    }
    const months = body.months;
    const total = prepaidTotal(plan, months);
    const orderId = randomUUID();
    const label = `${courseLabel(course)} ${months}か月分（前払い）`;
    const { error: e1 } = await db.from("billing_prepaid").insert({
      id: orderId, school_id: schoolId, plan_id: plan.id, months, amount: total.total, method,
      provider: method === "stripe" ? "stripe" : cryptoProvider(), quota: plan.limit, personal: plan.personal, night: plan.night, created_by: user.id,
    });
    if (e1) throw Error("前払いの注文を作れませんでした。管理者が 0019_ver6.sql を実行済みか確認してください。");

    let url: string;
    let ref: string;
    if (method === "stripe") {
      const stripe = stripeClient();
      let customer = account?.customer_id as string | null;
      if (!customer) {
        const c = await stripe.customers.create({ email: user.email }, { idempotencyKey: `school-customer-${schoolId}` });
        customer = c.id;
        await db.from("billing_accounts").upsert({ school_id: schoolId, customer_id: customer }, { onConflict: "school_id" });
      }
      const taxRates = plan.taxBehavior === "exclusive" ? [await verifiedSchoolTaxRate(stripe)] : undefined;
      const session = await stripe.checkout.sessions.create({
        mode: "payment", customer,
        line_items: [{
          quantity: months,
          price_data: { currency: "jpy", unit_amount: plan.amount, tax_behavior: plan.taxBehavior, product_data: { name: `${courseLabel(course)}（前払い・1か月）` } },
          ...(taxRates ? { tax_rates: taxRates } : {}),
        }],
        metadata: { kind: "prepaid", order_id: orderId },
        payment_intent_data: { metadata: { kind: "prepaid", order_id: orderId } },
        success_url: `${appUrl()}/billing/return?prepaid=1`, cancel_url: appUrl(),
      }, { idempotencyKey: `prepaid-${orderId}` });
      if (!session.url) throw Error("支払い画面を作れませんでした。");
      url = session.url; ref = session.id;
    } else {
      const inv = await createCryptoInvoice({
        orderId, amountJpy: total.total, description: label,
        successUrl: `${appUrl()}/billing/return?prepaid=1`, cancelUrl: appUrl(), webhookUrl: `${appUrl()}/api/billing/crypto/webhook`,
      });
      url = inv.url; ref = inv.ref;
    }
    await db.from("billing_prepaid").update({ provider_ref: ref }).eq("id", orderId);
    return NextResponse.json({ url, orderId, total: total.total });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error && !/Stripe/.test(e.name) ? e.message : "支払いを開始できません。設定を確認してください。" }, { status: 400 });
  }
}
