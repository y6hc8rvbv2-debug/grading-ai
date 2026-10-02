// ============================================================================
// 接続の確認（設定画面の「AI採点の準備状況」）
//
//   GET /api/health   ログイン中の教職員に、AI採点に必要な準備がそろっているかを返す
//
// 返すのは「はい / いいえ」だけ。APIキーの値や接続先の情報は返さない。
// DB への確認は読み取りだけ（0004 の関数は存在しない答案IDで呼び、書き込む前に止まることを使う）。
// ============================================================================
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiConfig } from "@/lib/ai/grade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZERO = "00000000-0000-0000-0000-000000000000";
const missing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST202" || e.code === "PGRST205" || e.code === "42P01" || e.code === "42883"
    || /could not find|does not exist/i.test(e.message ?? ""));

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json({ supabase: false, ai: aiConfig().enabled, env: process.env.VERCEL_ENV ?? "local" });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインしていません。もう一度ログインしてください。" }, { status: 401 });

  // 0004：AI採点の保存関数。存在しない答案IDで呼ぶと「答案が見つかりません」で止まる（何も書き込まない）
  const { error: e4 } = await supabase.rpc("save_ai_grading", { p_submission_id: ZERO, p_quality: {}, p_items: [] });
  // 0005：モデル比較試験の記録（管理者以外は RLS で0件になるだけ）
  const { error: e5 } = await supabase.from("model_compare_runs").select("id", { head: true, count: "exact" }).limit(1);
  // 0006：採点方式（3モデル併用）と AI採点の記録
  const { error: e6 } = await supabase.from("grading_jobs").select("id", { head: true, count: "exact" }).limit(1);
  // 0007：模範解答からの自動入力
  const { error: e7 } = await supabase.from("test_imports").select("id", { head: true, count: "exact" }).limit(1);
  // 0008：テストの削除・アーカイブ（存在しないIDで呼ぶと「見つからない」か「管理者だけ」で止まる。何も変更しない）
  const { error: e8 } = await supabase.rpc("remove_test", { p_test_id: ZERO });

  return NextResponse.json({
    supabase: true,
    ai: aiConfig().enabled,
    migrations: { "0004": !missing(e4), "0005": !missing(e5), "0006": !missing(e6), "0007": !missing(e7), "0008": !missing(e8) },
    env: process.env.VERCEL_ENV ?? "local",
  });
}
