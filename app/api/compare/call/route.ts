// ============================================================================
// 採点モデルの比較試験：1モデルを1回だけ呼ぶ（管理者専用）
//
//   POST /api/compare/call  (multipart/form-data)
//     runId        試験の ID（/api/compare の start で作ったもの）
//     displayName  モデルの表示名（例: Claude Haiku 4.5）
//     image        答案画像（JPEG / PNG / WebP / GIF）
//
// - 画像の sha256 が試験開始時と違えば断る（3モデルに同じ画像を渡すため）
// - 「未実行 → 呼び出し中」への切り替えは DB の条件付き更新で1回だけ成功する。
//   2回目以降（連打・別タブ・再送）は API を呼ばずに断る
// - 失敗しても再試行しない。結果（成功・失敗）は比較試験の表にだけ保存する
// ============================================================================
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  buildCompareInput, callCompareModel, compareAvailability, compareClient, judgeCompare,
} from "@/lib/ai/compare";
import { RESULT_COLUMNS, UUID, compareGate, fail, finishIfComplete, MAX_COMPARE_IMAGE_BYTES } from "../gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 1モデルの採点に数十秒〜数分かかることがある
export const maxDuration = 300;

const MEDIA = /^image\/(jpeg|png|webp|gif)$/;

export async function POST(request: Request) {
  const g = await compareGate();
  if ("error" in g) return g.error;
  const { supabase } = g;

  const avail = compareAvailability();
  if (!avail.enabled) return fail(avail.reason, 503);

  const form = await request.formData().catch(() => null);
  const runId = String(form?.get("runId") ?? "");
  const displayName = String(form?.get("displayName") ?? "");
  const image = form?.get("image");
  if (!UUID.test(runId) || !displayName) return fail("試験が指定されていません。画面を再読み込みしてください。", 400);
  if (!(image instanceof Blob) || image.size === 0) return fail("答案画像が届いていません。画像を選び直してください。", 400);
  if (image.size > MAX_COMPARE_IMAGE_BYTES) return fail("答案画像が大きすぎます（4MBまで）。", 400);
  if (!MEDIA.test(image.type)) return fail("JPEG / PNG の画像を選んでください（HEIC・PDF はこの試験では使えません）。", 400);

  const { data: run } = await supabase.from("model_compare_runs")
    .select("id, status, image_sha256").eq("id", runId).maybeSingle();
  if (!run) return fail("比較試験が見つかりません。画面を再読み込みしてください。", 404);
  if (run.status !== "running") return fail("この比較試験は終わっています（中止または完了）。モデルは呼び出していません。", 409, { code: "not_running" });

  const buf = Buffer.from(await image.arrayBuffer());
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== run.image_sha256) {
    return fail("試験を始めたときと違う画像です。3モデルに同じ画像を渡すため、実行しませんでした。", 400);
  }

  // 1回だけ「呼び出し中」にできる。すでに呼び出し済みなら API を呼ばない
  const { data: claimed } = await supabase.from("model_compare_results")
    .update({ status: "calling", started_at: new Date().toISOString() })
    .eq("run_id", runId).eq("display_name", displayName).eq("status", "pending")
    .select("id, model_id");
  if (!claimed?.length || !claimed[0].model_id) {
    return fail("このモデルは、この試験ですでに呼び出したか、利用できません。二重実行を防ぐため、呼び出しませんでした。", 409, { code: "already_called" });
  }
  const row = claimed[0];

  const input = buildCompareInput({ kind: "image", mediaType: image.type as "image/jpeg", data: buf.toString("base64") });
  const r = await callCompareModel(compareClient(), displayName, row.model_id as string, input);
  const judge = r.ok && r.items ? judgeCompare(r.items) : null;

  const { data: saved, error } = await supabase.from("model_compare_results").update({
    status: r.ok ? "done" : "error",
    finished_at: new Date().toISOString(),
    elapsed_ms: r.elapsedMs,
    served_model: r.servedModel ?? null,
    stop_reason: r.stopReason ?? null,
    usage: r.usage ?? null,
    cost_usd: r.costUsd ?? null,
    items: r.items?.map((it) => ({ ...it, ai_raw: undefined })) ?? null,
    raw: r.raw ?? null,
    judge,
    error: r.error ?? null,
    input_fingerprint: input.fingerprint,
  }).eq("id", row.id).select(RESULT_COLUMNS).single();
  await finishIfComplete(supabase, runId);
  if (error || !saved) {
    return fail("モデルの結果を保存できませんでした。API は呼び出し済みのため、再実行はしません。", 500);
  }
  return NextResponse.json({ result: saved });
}
