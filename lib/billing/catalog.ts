import { PERSONAL_TIERS, SCHOOL_PLANS } from "@/lib/subscription-plans";

export const BILLING_PLANS = [
  ...PERSONAL_TIERS.flatMap(p => [false, true].map(night => ({
    id: p.id + (night ? "-night" : ""), name: `個人・塾${p.name}${night ? "（夜間）" : ""}`,
    amount: night ? p.nightPrice : p.price, limit: p.sheets, personal: true, night,
  }))),
  ...SCHOOL_PLANS.flatMap(p => [false, true].map(night => ({
    id: p.id + (night ? "-night" : ""), name: p.name + (night ? "（夜間）" : ""),
    amount: Math.round((night ? p.nightPrice : p.price) * 1.1), limit: p.limit, personal: false, night,
  }))),
];
export const billingPlan = (id: string) => BILLING_PLANS.find(p => p.id === id);

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
