// 前払い（ver6）の金額。料金は月額の一元表（lib/subscription-plans.ts）× 月数で、割引・上乗せはしない。
// 個人・塾は税込、学校は税別に消費税10%を加える（月額の契約と同じ）。
import type { BillingPlan } from "@/lib/billing/catalog";

export const PREPAID_MONTHS = [1, 3, 6, 12] as const;
export type PrepaidMonths = (typeof PREPAID_MONTHS)[number];
export const isPrepaidMonths = (v: unknown): v is PrepaidMonths => PREPAID_MONTHS.includes(v as PrepaidMonths);

/** 支払う金額（円）。subtotal は月額×月数、tax は学校のときだけの消費税（Stripe の税率計算と同じく四捨五入） */
export function prepaidTotal(plan: Pick<BillingPlan, "amount" | "taxBehavior">, months: PrepaidMonths) {
  const subtotal = plan.amount * months;
  const tax = plan.taxBehavior === "exclusive" ? Math.round(subtotal * 0.1) : 0;
  return { subtotal, tax, total: subtotal + tax };
}

/** 支払い方法の案内（画面・特定商取引法の表記で同じ文面を使う） */
export const PAYMENT_METHODS = {
  monthly: "クレジットカード（Visa・Mastercard・JCB・American Express など）、Apple Pay、Google Pay、Link",
  prepaid: "上記に加えて、コンビニ払い・PayPay・銀行振込（Stripe で有効にした方法）",
  crypto: "暗号資産（ビットコイン・イーサリアム・USDC・USDT などのステーブルコイン。決済代行の画面で支払い）",
} as const;
