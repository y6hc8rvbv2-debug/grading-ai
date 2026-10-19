// モデル比較試験の API で共通の入口チェック（サーバー専用）。
// ログイン中の本人が、学校の管理者であることを確かめる。DB へは本人のセッション（RLS）でアクセスする。
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: message, ...extra }, { status });

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Vercel の関数が受け取れる本文は 4.5MB まで。画像はブラウザで縮小してから送る */
export const MAX_COMPARE_IMAGE_BYTES = 4 * 1024 * 1024;

export async function compareGate() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { error: fail("モデル比較試験は Supabase に接続した環境でだけ使えます。", 503) } as const;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: fail("ログインしていません。もう一度ログインしてください。", 401) } as const;
  const { data: prof } = await supabase.from("profiles").select("school_id, role").eq("id", user.id).maybeSingle();
  if (!prof?.school_id || prof.role !== "admin") {
    return { error: fail("モデル比較試験は、学校の管理者だけが使えます。", 403) } as const;
  }
  return { supabase, user, schoolId: prof.school_id as string } as const;
}

type Supa = Awaited<ReturnType<typeof createClient>>;

/** 画面を閉じるなどで残った「実行中」を片付ける（本人の分だけ） */
export async function cleanupStale(supabase: Supa, uid: string) {
  const now = new Date();
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  await supabase.from("model_compare_results")
    .update({
      status: "error", finished_at: now.toISOString(),
      error: "結果を記録できないまま時間切れになりました。API は呼ばれた可能性があるため、費用は Anthropic Console で確認してください。",
    })
    .eq("created_by", uid).eq("status", "calling").lt("started_at", ago(6));
  await supabase.from("model_compare_runs")
    .update({ status: "failed", finished_at: now.toISOString(), note: "時間切れ（画面を閉じたなど）" })
    .eq("created_by", uid).eq("status", "running").lt("created_at", ago(20));
}

/** 呼び出していないモデル・呼び出し中のモデルが残っていなければ、試験を終える */
export async function finishIfComplete(supabase: Supa, runId: string) {
  const { count } = await supabase.from("model_compare_results")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId).in("status", ["pending", "calling"]);
  if (count === 0) {
    await supabase.from("model_compare_runs")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", runId).eq("status", "running");
  }
}

export const RESULT_COLUMNS =
  "id, run_id, position, display_name, model_id, status, started_at, finished_at, elapsed_ms, served_model, stop_reason, usage, cost_usd, items, judge, error, input_fingerprint";
export const RUN_COLUMNS =
  `id, status, image_name, image_sha256, image_bytes, settings, note, created_at, finished_at, results:model_compare_results(${RESULT_COLUMNS})`;
