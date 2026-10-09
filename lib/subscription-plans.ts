// ユーザー承認済みの料金・月間上限に基づく表示用カタログ。契約・請求・利用制限とは連動しない。
// 個人・塾は税込月額。基本は3モデル併用、Opus単独は選択時の追加料金。
export const PERSONAL_TIERS = [
  { id: "personal-mini", name: "ミニ", sheets: 100, price: 1650, nightPrice: 1320 },
  { id: "personal-light", name: "ライト", sheets: 200, price: 2750, nightPrice: 2200 },
  { id: "personal-standard", name: "スタンダード", sheets: 300, price: 3850, nightPrice: 3080 },
  { id: "personal-pro", name: "プロ", sheets: 1000, price: 12100, nightPrice: 9680 },
] as const;
export const PERSONAL_OPUS_SURCHARGE = 55;

export const SCHOOL_PLANS = [
  { id: "school-mini", name: "学校ミニ", price: 40000, limit: 800, nightPrice: 32000, description: "小規模校・試験導入向け。クラスの答案をまとめて管理し、先生の確認後に生徒本人へ返却できます。" },
  { id: "school-light", name: "学校ライト", price: 120000, limit: 2500, nightPrice: 96000, description: "中規模校向け。複数のクラス・教職員で、採点結果の確認と成績管理を進められます。" },
  { id: "school-standard", name: "学校スタンダード", price: 200000, limit: 4500, nightPrice: 160000, description: "学校単位の導入向け。採点・本人限定の返却・単元別の弱点分析を日々の指導に活用できます。" },
  // 30万円プランの正式名称はユーザー確認済み。
  { id: "school-upper", name: "学校プロ", price: 300000, limit: 6500, nightPrice: 240000, description: "大規模な運用を検討する学校向け。月間6,500枚までの採点と、教職員による確認・返却を管理できます。" },
] as const;

export const PERSONAL_FEATURES = [
  "答案画像・PDFの取り込みとAI採点",
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
  const personal = PERSONAL_TIERS.find(p => p.id === plan);
  if (personal) return `個人・塾${personal.name}`;
  return SCHOOL_PLANS.find(p => p.id === plan)?.name ?? (plan === "personal" ? "個人・塾プラン" : "契約内容をご確認ください");
}
