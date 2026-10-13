// 有料プランの一元表（2026-10-13 ユーザー確定の16コース）。画面・特定商取引法の表記・決済（lib/billing/）・採点枠はすべてここを読む。
//   - key は契約の記録（billing_accounts.plan_id）に残る値。以前からの値をそのまま使う（学校プロは "school-upper"）
//   - monthlyYen は Stripe の料金（Price の unit_amount）と同じ。個人・塾は税込（tax_behavior=inclusive）、学校は税別（exclusive）
//   - limit は1か月（契約期間）の採点回数の上限。1回＝生徒1人分の答案（2ページ・20問まで）の採点1回（再採点も1回）。
//     学校は画面で「枚」と書くが、数え方は個人・塾の「答案」と同じ（画像のページ数では数えない）
//   - 夜間コースの上限は、今回の料金表（2026-10-13）では未指定。以前からの仕様（docs/SUBSCRIPTION-PLANS.md の夜間プランの表と
//     「月間上限は通常と同じ」、PR #2 の lib/billing/catalog.ts）の値をそのまま残している。ユーザーの確認待ち（docs/SUBSCRIPTION-PLANS.md）
//   - testPriceId は Stripe のサンドボックス（テスト採点ver5 検証用）の料金ID。本番の料金IDは環境変数 STRIPE_LIVE_PRICE_IDS_JSON（lib/billing/server.ts）
//   利用者の画面には料金ID・原価・利益は出さない
export type Audience = "personal" | "school";
export type Course = {
  key: string; audience: Audience; night: boolean; tier: "mini" | "light" | "standard" | "pro";
  name: string; monthlyYen: number; tax: "inclusive" | "exclusive"; limit: number; testPriceId: string;
};

const c = (key: string, audience: Audience, night: boolean, tier: Course["tier"], name: string, monthlyYen: number, limit: number, testPriceId: string): Course =>
  ({ key, audience, night, tier, name, monthlyYen, tax: audience === "personal" ? "inclusive" : "exclusive", limit, testPriceId });

export const COURSES: readonly Course[] = [
  c("personal-mini", "personal", false, "mini", "ミニ", 1650, 100, "price_1UPkN679SNi0pstBtGaeLtlf"),
  c("personal-light", "personal", false, "light", "ライト", 2750, 200, "price_1UQ16L79SNi0pstB1vOKdQTx"),
  c("personal-standard", "personal", false, "standard", "スタンダード", 3850, 300, "price_1UQ1BL79SNi0pstBDBnv6I0K"),
  c("personal-pro", "personal", false, "pro", "プロ", 12100, 1000, "price_1UQ1D279SNi0pstBKT4gande"),
  c("personal-mini-night", "personal", true, "mini", "ミニ", 1320, 100, "price_1UQ1Ld79SNi0pstBkuDphJJ5"),
  c("personal-light-night", "personal", true, "light", "ライト", 2200, 200, "price_1UQ1KP79SNi0pstBRNqrSOw0"),
  c("personal-standard-night", "personal", true, "standard", "スタンダード", 3080, 300, "price_1UQ1Lx79SNi0pstBzBBns9xg"),
  c("personal-pro-night", "personal", true, "pro", "プロ", 9680, 1000, "price_1UQ1MC79SNi0pstBNEGGKRq1"),
  c("school-mini", "school", false, "mini", "学校ミニ", 40000, 800, "price_1UQ1a179SNi0pstBnv4jCUlW"),
  c("school-light", "school", false, "light", "学校ライト", 120000, 2500, "price_1UQ1aE79SNi0pstBK9Opd0AP"),
  c("school-standard", "school", false, "standard", "学校スタンダード", 200000, 4500, "price_1UQ1G979SNi0pstBYFYmPoJC"),
  c("school-upper", "school", false, "pro", "学校プロ", 300000, 6500, "price_1UQ1Iq79SNi0pstBVOm08xNT"),
  c("school-mini-night", "school", true, "mini", "学校ミニ", 32000, 800, "price_1UQ1Oj79SNi0pstB1G9qy3AK"),
  c("school-light-night", "school", true, "light", "学校ライト", 96000, 2500, "price_1UQ1Ow79SNi0pstBOWDR6BaE"),
  c("school-standard-night", "school", true, "standard", "学校スタンダード", 160000, 4500, "price_1UQ1P779SNi0pstBrFtAOTWO"),
  c("school-upper-night", "school", true, "pro", "学校プロ", 240000, 6500, "price_1UQ1PK79SNi0pstBWktGtsHh"),
];
export const courseByKey = (key: string | null | undefined) => COURSES.find((x) => x.key === key);
export const coursesOf = (audience: Audience, night: boolean) => COURSES.filter((x) => x.audience === audience && x.night === night);

const yen = (n: number) => n.toLocaleString("ja-JP");
/** 「月額1,650円（税込）」「月額40,000円（税別）」 */
export const priceLabel = (x: Course) => `月額${yen(x.monthlyYen)}円（${x.tax === "inclusive" ? "税込" : "税別"}）`;
/** 「月100答案まで」「月800枚まで」 */
export const limitLabel = (x: Course) => `月${yen(x.limit)}${x.audience === "personal" ? "答案" : "枚"}まで`;
/** 「個人・塾 ミニ（通常採点）」 */
export const courseLabel = (x: Course) => `${x.audience === "personal" ? "個人・塾 " : ""}${x.name}（${x.night ? "夜間採点" : "通常採点"}）`;

export const PERSONAL_OPUS_SURCHARGE = 55;

/** 学校プランの説明（コースの段階ごと） */
export const SCHOOL_DESCRIPTIONS: Record<Course["tier"], string> = {
  mini: "小規模校・試験導入向け。クラスの答案をまとめて管理し、先生の確認後に生徒本人へ返却できます。",
  light: "中規模校向け。複数のクラス・教職員で、採点結果の確認と成績管理を進められます。",
  standard: "学校単位の導入向け。採点・本人限定の返却・単元別の弱点分析を日々の指導に活用できます。",
  pro: "大規模な運用を検討する学校向け。多くの答案の採点と、教職員による確認・返却を管理できます。",
};

export const PERSONAL_FEATURES = [
  "答案画像の取り込みとAI採点（1答案2ページ・20問まで）",
  "設問ごとの判定・得点・コメントの確認と修正",
  "赤ペンの位置調整・画像保存・印刷",
  "先生が確認した答案を生徒本人のページへ返却",
  "誤答の復習内容をコピーして、本人のChatGPTで復習",
];

export const SCHOOL_FEATURES = [
  "個人・塾プランの機能",
  "教職員アカウントとクラス・生徒の名簿管理",
  "クラス単位の返却・生徒の受信箱",
  "単元別・設問形式別の弱点分析と成績CSV出力",
  "学校・クラスごとの復習設定と監査ログ",
];

export function currentPlanLabel(plan?: string) {
  if (!plan || plan === "free") return "無料プラン";
  // 旧契約を新しい料金・上限へ自動で置き換えない。
  if (plan === "school") return "学校プラン（既存契約）";
  if (plan === "board") return "教育委員会プラン（既存契約）";
  const x = courseByKey(plan);
  if (x) return courseLabel(x);
  return plan === "personal" ? "個人・塾プラン" : "契約内容をご確認ください";
}
