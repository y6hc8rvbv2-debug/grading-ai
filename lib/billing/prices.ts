// Stripe の料金ID の選び方（テスト用と本番用を混ぜない）。秘密は扱わない（キーの種類だけを見る）。
//   - サンドボックス（sk_test_・rk_test_）：lib/subscription-plans.ts の testPriceId を使う
//   - 本番（sk_live_・rk_live_）：環境変数 STRIPE_LIVE_PRICE_IDS_JSON（{"personal-mini":"price_…", …}）だけを使う。
//     無いコース・テスト用の料金ID が入っているコースは申し込みを止める（テストの ID で本番の決済をしない）
//   - それ以外のキー・キーなし：申し込みを止める
import { COURSES, courseByKey, type Course } from "@/lib/subscription-plans";

export type StripeMode = "test" | "live";

/** キーの種類（値そのものは返さない） */
export function stripeModeOf(key: string | undefined | null): StripeMode | null {
  if (!key) return null;
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return null;
}

const TEST_IDS = new Set(COURSES.map((x) => x.testPriceId));

/** 本番の料金ID の表（読めない・形が違えば空。テスト用の ID は除く） */
export function liveMap(json: string | undefined | null): Record<string, string> {
  let raw: unknown;
  try { raw = JSON.parse(json || "{}"); } catch { return {}; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (courseByKey(k) && typeof v === "string" && /^price_[A-Za-z0-9]+$/.test(v) && !TEST_IDS.has(v)) out[k] = v;
  }
  return out;
}

/** コースの料金ID。使えなければ null と理由 */
export function priceIdFor(course: Course, mode: StripeMode | null, liveJson?: string | null): { id: string | null; reason?: string } {
  if (!mode) return { id: null, reason: "決済の設定が完了していません。" };
  if (mode === "test") return { id: course.testPriceId };
  const id = liveMap(liveJson)[course.key];
  return id ? { id } : { id: null, reason: "このコースの本番の料金が設定されていないため、お申し込みを停止しています。" };
}

/** 料金ID からコースを探す（いまのキーの種類の表だけ。Webhook で使う） */
export function courseForPriceId(priceId: string, mode: StripeMode | null, liveJson?: string | null): Course | undefined {
  if (mode === "test") return COURSES.find((x) => x.testPriceId === priceId);
  if (mode === "live") {
    const key = Object.entries(liveMap(liveJson)).find(([, v]) => v === priceId)?.[0];
    return courseByKey(key);
  }
  return undefined;
}

export type BillingEnv = { billing: boolean; night: boolean; key?: string | null; liveJson?: string | null; schoolTaxRateId?: string | null };
/** コースを申し込めるか（理由つき）。決済の有効・料金ID（テスト/本番）・夜間の受付・学校の消費税の設定を見る */
export function availabilityOf(course: Course, env: BillingEnv): { ok: boolean; reason?: string } {
  if (!env.billing) return { ok: false, reason: "お申し込みの受付は始まっていません。" };
  const price = priceIdFor(course, stripeModeOf(env.key), env.liveJson);
  if (!price.id) return { ok: false, reason: price.reason };
  if (course.night && !env.night) return { ok: false, reason: "夜間採点のコースは、現在お申し込みを受け付けていません。" };
  if (course.tax === "exclusive" && !env.schoolTaxRateId) return { ok: false, reason: "消費税の設定が完了していないため、学校のコースのお申し込みを停止しています。" };
  return { ok: true };
}
