// ============================================================================
// 採点モデルの比較試験（管理者専用）
//
//   GET  /api/compare                              使えるか・条件・自分の試験の記録（新しい順10件）
//   POST /api/compare { action: "start", ... }     試験を始める（Models API でモデルID を確かめ、記録を作る）
//   POST /api/compare { action: "abort", runId }   実行中の試験を中止する（未実行のモデルは呼ばない）
//   POST /api/compare { action: "delete", runId }  試験の記録を消す
//
// 各モデルの呼び出しは /api/compare/call（1回の要求で1モデル）。
// 答案・成績（submissions / submission_items）には一切書き込まない。答案画像も保存しない。
// ANTHROPIC_API_KEY はサーバーの中だけで使い、応答・ログには出さない。
// ============================================================================
import { NextResponse } from "next/server";
import {
  COMPARE_ANSWER_KEY, COMPARE_CANDIDATES, COMPARE_EXPECTED, PRICES, PRICING_SOURCE,
  compareAvailability, compareClient, describeCompareError, resolveCompareModels,
} from "@/lib/ai/compare";
import { RUN_COLUMNS, UUID, cleanupStale, compareGate, fail, MAX_COMPARE_IMAGE_BYTES } from "./gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONDITIONS = {
  candidates: COMPARE_CANDIDATES,
  answerKey: COMPARE_ANSWER_KEY,
  pointsEach: 20,
  rubric: "各問20点・正答のみ加点・部分点なし",
  retries: 0,
  fallbacks: "なし",
  thinking: "指定なし（各モデルの既定）",
  prices: PRICES,
  pricingSource: PRICING_SOURCE,
  // 照合専用。モデルへの入力には入らない（画面で結果と並べて表示するためだけに返す）
  expected: COMPARE_EXPECTED,
  maxImageBytes: MAX_COMPARE_IMAGE_BYTES,
};

export async function GET() {
  const g = await compareGate();
  if ("error" in g) return g.error;
  await cleanupStale(g.supabase, g.user.id);
  const { data: runs, error } = await g.supabase
    .from("model_compare_runs").select(RUN_COLUMNS)
    .order("created_at", { ascending: false }).limit(10);
  if (error) {
    return fail("比較試験の記録を読み込めませんでした。管理者が Supabase で 0005_model_compare.sql を実行済みか確認してください。", 500);
  }
  const avail = compareAvailability();
  return NextResponse.json({ ...avail, conditions: CONDITIONS, runs: runs ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";

  const g = await compareGate();
  if ("error" in g) return g.error;
  const { supabase, user, schoolId } = g;

  /* ------------------------------------------------ 中止・削除 */
  if (action === "abort" || action === "delete") {
    const runId = typeof body?.runId === "string" ? body.runId : "";
    if (!UUID.test(runId)) return fail("試験が指定されていません。画面を再読み込みしてください。", 400);
    if (action === "abort") {
      const { error } = await supabase.from("model_compare_runs")
        .update({ status: "failed", finished_at: new Date().toISOString(), note: "管理者が中止しました" })
        .eq("id", runId).eq("status", "running");
      if (error) return fail("試験を中止できませんでした。画面を再読み込みしてください。", 500);
      return NextResponse.json({ ok: true });
    }
    const { error } = await supabase.from("model_compare_runs").delete().eq("id", runId).neq("status", "running");
    if (error) return fail("記録を削除できませんでした。時間をおいて、もう一度お試しください。", 500);
    return NextResponse.json({ ok: true });
  }

  if (action !== "start") return fail("操作が指定されていません。画面を再読み込みしてください。", 400);

  /* ------------------------------------------------ 試験を始める */
  const avail = compareAvailability();
  if (!avail.enabled) return fail(avail.reason, 503);

  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const imageSha256 = typeof body?.imageSha256 === "string" ? body.imageSha256.toLowerCase() : "";
  const imageName = typeof body?.imageName === "string" ? body.imageName.slice(0, 200) : "";
  const imageBytes = typeof body?.imageBytes === "number" ? Math.trunc(body.imageBytes) : 0;
  const rerun = body?.rerun === true;
  if (!UUID.test(requestId)) return fail("画面の情報が足りません。画面を再読み込みしてください。", 400);
  if (!/^[0-9a-f]{64}$/.test(imageSha256) || imageBytes <= 0) return fail("答案画像を選び直してください。", 400);
  if (imageBytes > MAX_COMPARE_IMAGE_BYTES) return fail("答案画像が大きすぎます（4MBまで）。長辺2400px程度に縮小してください。", 400);

  await cleanupStale(supabase, user.id);

  // 同じ操作の再送（ボタンの連打・通信の再送）は、同じ試験として返す
  const { data: same } = await supabase.from("model_compare_runs").select(RUN_COLUMNS).eq("request_id", requestId).maybeSingle();
  if (same) return NextResponse.json({ run: same, reused: true });

  const { data: running } = await supabase.from("model_compare_runs").select("id").eq("status", "running").limit(1);
  if (running?.length) {
    return fail("実行中の比較試験があります。終わるまで待つか、「中止する」を押してから始めてください。", 409, { code: "running", runId: running[0].id });
  }
  if (!rerun) {
    const { data: done } = await supabase.from("model_compare_runs").select("id")
      .eq("image_sha256", imageSha256).eq("status", "done").limit(1);
    if (done?.length) {
      return fail("この画像はすでに比較しました。もう一度 API を呼ぶ場合は「同じ画像でもう一度実行する」にチェックを入れてください。", 409, { code: "already_done", runId: done[0].id });
    }
  }

  // Models API で正式なモデルID を確かめる（見つからないモデルは代替しない）
  let resolved: Awaited<ReturnType<typeof resolveCompareModels>>;
  try {
    resolved = await resolveCompareModels(compareClient());
  } catch (e) {
    return fail(`Models API でモデルを確認できませんでした。採点は実行していません。（${describeCompareError(e)}）`, 502);
  }

  const { data: run, error: e1 } = await supabase.from("model_compare_runs").insert({
    school_id: schoolId,
    created_by: user.id,
    request_id: requestId,
    image_name: imageName,
    image_sha256: imageSha256,
    image_bytes: imageBytes,
    settings: {
      rubric: CONDITIONS.rubric, answerKey: COMPARE_ANSWER_KEY, answerKeySent: true,
      retries: 0, fallbacks: "なし", thinking: CONDITIONS.thinking, maxTokens: 16000,
      pricingSource: PRICING_SOURCE, modelsListed: resolved.listed,
      vercelEnv: process.env.VERCEL_ENV ?? "local",
    },
  }).select("id").single();
  if (e1 || !run) {
    if (e1?.code === "23505") {
      return fail("実行中の比較試験があります。終わるまで待つか、「中止する」を押してから始めてください。", 409, { code: "running" });
    }
    return fail("比較試験の記録を作れませんでした。管理者が Supabase で 0005_model_compare.sql を実行済みか確認してください。", 500);
  }

  const { error: e2 } = await supabase.from("model_compare_results").insert(
    resolved.models.map((m, i) => ({
      school_id: schoolId,
      created_by: user.id,
      run_id: run.id,
      position: i + 1,
      display_name: m.displayName,
      model_id: m.modelId,
      status: m.modelId ? "pending" : "unavailable",
      error: m.modelId ? null : "Models API に見つからないため未実行（代わりのモデルは使いません）",
    })),
  );
  if (e2) {
    await supabase.from("model_compare_runs").update({ status: "failed", note: "記録の作成に失敗" }).eq("id", run.id);
    return fail("比較試験の記録を作れませんでした。時間をおいて、もう一度お試しください。", 500);
  }
  // 利用不可しか無ければ、ここで試験を終える
  if (resolved.models.every((m) => !m.modelId)) {
    await supabase.from("model_compare_runs").update({ status: "done", finished_at: new Date().toISOString() }).eq("id", run.id);
  }

  await supabase.from("audit_logs").insert({
    school_id: schoolId,
    actor_id: user.id,
    action: "compare.start",
    target_table: "model_compare_runs",
    target_id: run.id,
    detail: { models: resolved.models, image_sha256: imageSha256, rerun },
  });

  const { data: full } = await supabase.from("model_compare_runs").select(RUN_COLUMNS).eq("id", run.id).single();
  return NextResponse.json({ run: full, reused: false });
}
