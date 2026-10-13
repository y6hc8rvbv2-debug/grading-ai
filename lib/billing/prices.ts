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

// ---------------------------------------------------------------- 旧料金ID の既存契約（確認できたものだけ）
// 現在の16コースに無い料金ID の契約を、そのままの条件（上限・税区分・対象）で扱うための対応表。
// 値は環境変数 STRIPE_LEGACY_PLANS_JSON（配列）。金額だけで対応先を推測しない：旧プランの仕様を確かめた人が、根拠（source）と一緒に入れる。
//   [{"key":"legacy-…","label":"旧プランの名前","mode":"test|live","priceIds":["price_…"],"monthlyYen":0,"tax":"inclusive|exclusive",
//     "limit":100,"audience":"personal|school","night":false,"source":"根拠（契約書・当時の料金表など）"}]
// 旧プランは新しい申し込みには出さない（Webhook と契約画面だけで使う）。料金の変更・契約の移行・解約はしない。
export type LegacyPlan = {
  key: string; label: string; mode: StripeMode; priceIds: string[]; monthlyYen: number; tax: "inclusive" | "exclusive";
  limit: number; audience: "personal" | "school"; night: boolean; source: string;
};
/** 対応表を読む（形が違う行は使わない。現在の16コースのキー・料金ID と重なる行も使わない） */
export function legacyPlans(json: string | undefined | null): LegacyPlan[] {
  let raw: unknown;
  try { raw = JSON.parse(json || "[]"); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: LegacyPlan[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const ids = Array.isArray(r.priceIds) ? r.priceIds.filter((x): x is string => typeof x === "string" && /^price_[A-Za-z0-9]+$/.test(x)) : [];
    const ok = typeof r.key === "string" && /^legacy-[a-z0-9-]+$/.test(r.key) && !courseByKey(r.key)
      && typeof r.label === "string" && r.label.trim() && (r.mode === "test" || r.mode === "live") && ids.length > 0
      && ids.every((id) => !TEST_IDS.has(id)) && Number.isInteger(r.monthlyYen) && (r.monthlyYen as number) >= 0
      && (r.tax === "inclusive" || r.tax === "exclusive") && Number.isInteger(r.limit) && (r.limit as number) > 0
      && (r.audience === "personal" || r.audience === "school") && typeof r.night === "boolean"
      && typeof r.source === "string" && r.source.trim();
    if (ok) out.push({ key: r.key as string, label: (r.label as string).trim(), mode: r.mode as StripeMode, priceIds: ids, monthlyYen: r.monthlyYen as number,
      tax: r.tax as LegacyPlan["tax"], limit: r.limit as number, audience: r.audience as LegacyPlan["audience"], night: r.night as boolean, source: (r.source as string).trim() });
  }
  return out;
}

/** 契約の料金ID から、反映する条件を決める（現在の16コース → 確認済みの旧プラン）。分からなければ null（推測しない） */
export type ContractTerms = { key: string; label: string; amount: number; taxBehavior: "inclusive" | "exclusive"; limit: number; personal: boolean; night: boolean; legacy: boolean };
export function contractTermsForPriceId(priceId: string, mode: StripeMode | null, env: { liveJson?: string | null; legacyJson?: string | null }): ContractTerms | null {
  const c = courseForPriceId(priceId, mode, env.liveJson);
  if (c) return { key: c.key, label: c.name, amount: c.monthlyYen, taxBehavior: c.tax, limit: c.limit, personal: c.audience === "personal", night: c.night, legacy: false };
  if (!mode) return null;
  const l = legacyPlans(env.legacyJson).find((x) => x.mode === mode && x.priceIds.includes(priceId));
  return l ? { key: l.key, label: l.label, amount: l.monthlyYen, taxBehavior: l.tax, limit: l.limit, personal: l.audience === "personal", night: l.night, legacy: true } : null;
}
