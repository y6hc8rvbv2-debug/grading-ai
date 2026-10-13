// 決済で使うプランの一覧。値は lib/subscription-plans.ts の COURSES（一元表）から作り、ここでは独自の金額・上限を持たない。
import { COURSES, courseByKey, type Course } from "@/lib/subscription-plans";

/** 無料プランの月間の採点回数（0017 の billing_accounts.quota の既定と同じ） */
export const FREE_QUOTA = 20;

export type BillingPlan = {
  id: string; name: string;
  /** Stripe の Price の unit_amount（円）。個人・塾は税込額、学校は税別額 */
  amount: number;
  taxBehavior: Course["tax"];
  limit: number; personal: boolean; night: boolean;
};
const toPlan = (x: Course): BillingPlan => ({
  id: x.key, name: `${x.audience === "personal" ? "個人・塾" : ""}${x.name}${x.night ? "（夜間）" : ""}`,
  amount: x.monthlyYen, taxBehavior: x.tax, limit: x.limit, personal: x.audience === "personal", night: x.night,
});
export const BILLING_PLANS: readonly BillingPlan[] = COURSES.map(toPlan);
/** 許可されたプランのキーだけを受け付ける（画面から送られた金額・料金ID・上限は使わない） */
export const billingPlan = (id: unknown) => (typeof id === "string" ? (courseByKey(id) ? toPlan(courseByKey(id)!) : undefined) : undefined);

// 日本時間22:00〜06:00。受付は終日、処理は次の夜間帯。
export function nextNightStart(now = new Date()): Date {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const hour = jst.getUTCHours();
  if (hour >= 22 || hour < 6) return now;
  jst.setUTCHours(22, 0, 0, 0);
  return new Date(jst.getTime() - 9 * 3600_000);
}
export function isNight(now = new Date()) {
  const h = new Date(now.getTime() + 9 * 3600_000).getUTCHours();
  return h >= 22 || h < 6;
}
