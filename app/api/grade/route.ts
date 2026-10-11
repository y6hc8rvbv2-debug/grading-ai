// ============================================================================
// 採点AIの Route Handler
//
//   GET  /api/grade
//        採点AIが使えるか（APIキーが設定されているか）と、各段階のモデルID
//   POST /api/grade { submissionId, mode: "opus" | "cascade", requestId }
//        保存済みの答案を AI で採点する。1回の要求で呼ぶモデルは1つだけ（Vercel の関数の時間制限のため）。
//        3モデル併用で上の段階に回すときは { done: false, next } を返し、画面が同じ requestId で続きを要求する。
//        終わったら { done: true, ... } を返す。
//
// 二重課金を防ぐ仕組み（supabase/migrations/0006_grading_modes.sql）
//   - requestId ごとに採点の記録（grading_jobs）を1つ作る。同じ requestId の再送（連打・通信の再送）は同じ採点の続きとして扱う
//   - 同じ答案で同時に動ける採点は1つだけ
//   - 各段階（haiku / sonnet / opus）は、呼ぶ前に記録を作る。同じ段階の記録がすでにあれば呼ばない
// 途中で失敗したときは、答案の状態を採点前に戻し、既存の成績には何も書き込まない
// （採点結果の保存は finish_grading_job で、記録の確定と同じトランザクションで行う）。
//
// DB と Storage には、ログイン中の教員のセッション（anon キー + Cookie）でアクセスする。
// service_role は使わないので、読み書きできるのは RLS が許す自校の答案だけ。
// サーバーに置くのは ANTHROPIC_API_KEY だけ（ブラウザ・応答・ログには出さない）。
// ============================================================================
import { targetedTest, mergeTargeted } from "@/lib/ai/targeted";
import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { rubricFromRow } from "@/lib/db/rubric";
import { typeLabelOf } from "@/lib/grading/engine";
import {
  aiConfig, callClaude, normalizeResult, GradingError,
  type AnswerPage, type GradeTest, type NormalizedItem, type NormalizedQuality,
} from "@/lib/ai/grade";
import {
  PLAN, FLAG_MESSAGE, addChecks, escalationReasons, finalizeItems, markDisagreement, stageModel, stageOptions,
  type Reason,
} from "@/lib/ai/cascade";
import { heicToJpeg, looksLikeHeic } from "@/lib/ai/heic";
import { costOfStage, type GradingMode, type GradingStage } from "@/lib/grading/cost";
import { billingEnabled, nightEnabled, sameOrigin, workerAuthorized } from "@/lib/billing/server";
import type { QType, Rubric } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 1段階の採点に数十秒〜数分かかることがある。Vercel のプランの上限まで待つ
export const maxDuration = 300;

const MAX_PAGES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // Claude API の画像1枚の上限
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: message, ...extra }, { status });

type Supa = Awaited<ReturnType<typeof createClient>>;
type StageRow = {
  id: string; stage: GradingStage; position: number; model_id: string; status: "calling" | "done" | "error";
  escalate: boolean; reasons: Reason[]; items: NormalizedItem[] | null; quality: NormalizedQuality | null;
  cost_usd: number | null; started_at: string;
};
type JobRow = {
  id: string; submission_id: string; mode: GradingMode; status: "running" | "done" | "failed";
  final_stage: GradingStage | null; needs_review: boolean | null; decision: Record<string, unknown>;
  total_cost_usd: number; error: string | null;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("ログインしていません。もう一度ログインしてください。", 401);
  const cfg = aiConfig();
  return NextResponse.json({
    enabled: cfg.enabled,
    model: cfg.enabled ? cfg.model : null,
    models: cfg.enabled ? { haiku: stageModel("haiku"), sonnet: stageModel("sonnet"), opus: stageModel("opus") } : null,
  });
}

/* ------------------------------------------------------------------ 入力（答案・設問・採点基準・画像） */

async function loadInputs(supabase: Supa, sub: { school_id: string; test_id: string; image_paths: string[] | null }) {
  const paths: string[] = sub.image_paths ?? [];
  if (!paths.length) {
    throw new GradingError("この答案には原本画像がないため、AI採点できません。「新規採点」で答案画像を取り込み直してください。", 400);
  }
  if (paths.length > MAX_PAGES) throw new GradingError(`1人分の答案は${MAX_PAGES}ページまでです。ページを分けて取り込んでください。`, 400);
  if (paths.some(path => path.split("/")[0] !== sub.school_id)) throw new GradingError("答案画像の所属校が一致しません。", 403);

  const [{ data: test, error: e2 }, { data: questions, error: e3 }, { data: rubrics, error: e4 }] = await Promise.all([
    supabase.from("tests").select("id, name, subject, grade, answer_lang").eq("id", sub.test_id).eq("school_id", sub.school_id).single(),
    supabase.from("questions").select("*").eq("test_id", sub.test_id).eq("school_id", sub.school_id).order("no"),
    supabase.from("rubrics").select("*").eq("school_id", sub.school_id).or(`test_id.eq.${sub.test_id},test_id.is.null`),
  ]);
  if (e2 || e3 || e4 || !test) throw new GradingError("テストの設問を読み込めませんでした。時間をおいて、もう一度お試しください。", 500);
  if (!questions?.length) throw new GradingError("このテストには設問が登録されていません。テスト管理で設問を登録してください。", 400);
  // テスト専用の採点基準があればそれを、無ければ学校の既定値を使う
  const rubric: Rubric = rubricFromRow(
    rubrics?.find((r) => r.test_id === sub.test_id) ?? rubrics?.find((r) => r.test_id === null)
  );
  const gradeTest: GradeTest = {
    subject: test.subject, name: test.name, grade: test.grade, answerLang: test.answer_lang,
    questions: questions.map((q) => ({
      no: q.no, label: q.label, type: q.qtype as QType, typeLabel: typeLabelOf(q.qtype),
      unit: q.unit, points: q.points, correct: q.correct, model: q.model_answer, keywords: q.keywords ?? [],
    })),
  };

  // 原本画像（全ページ）。HEIC のまま保存された答案は JPEG に変換してから送る
  const pages: AnswerPage[] = [];
  for (const path of paths) {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const heicExt = ext === "heic" || ext === "heif";
    const mediaType =
      ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "png" ? "image/png"
      : ext === "webp" ? "image/webp"
      : ext === "gif" ? "image/gif"
      : ext === "pdf" ? "pdf" : heicExt ? "heic" : null;
    if (!mediaType) throw new GradingError(`対応していない形式のファイルです（.${ext}）。JPEG / PNG / HEIC / PDF で取り込んでください。`, 400);

    const { data: blob, error } = await supabase.storage.from("answer-sheets").download(path);
    if (error || !blob) throw new GradingError("答案画像を読み込めませんでした。時間をおいて、もう一度お試しください。", 500);
    let buf: Buffer = Buffer.from(await blob.arrayBuffer());
    if (mediaType === "pdf") {
      if (buf.length > MAX_PDF_BYTES) throw new GradingError("PDF が大きすぎます（25MBまで）。ページを分けて取り込んでください。", 400);
      pages.push({ kind: "pdf", data: buf.toString("base64") });
      continue;
    }
    let type = mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "heic";
    if (type === "heic" || looksLikeHeic(buf)) {
      try {
        buf = await heicToJpeg(buf);
        type = "image/jpeg";
      } catch {
        throw new GradingError("HEIC 形式の写真を変換できませんでした。iPhone の「設定 → カメラ → フォーマット」を「互換性優先」にして撮り直すか、JPEG で保存し直して取り込んでください。", 400);
      }
    }
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new GradingError("答案画像が大きすぎます（1枚5MBまで）。「新規採点」で取り込み直すと自動で縮小されます。", 400);
    }
    pages.push({ kind: "image", mediaType: type as Exclude<typeof type, "heic">, data: buf.toString("base64") });
  }
  return { gradeTest, rubric, pages };
}

/* ------------------------------------------------------------------ 採点 */

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { submissionId?: unknown; mode?: unknown; requestId?: unknown; opusConsent?: unknown } | null;
  const submissionId = typeof body?.submissionId === "string" ? body.submissionId : "";
  const mode: GradingMode = body?.mode === "cascade" ? "cascade" : "opus";
  if (body?.mode !== "cascade" && body?.mode !== "opus") return fail("採点方式を選んでください。", 400);
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  if (!UUID.test(submissionId)) return fail("採点する答案が指定されていません。画面を再読み込みしてください。", 400);
  if (!UUID.test(requestId)) return fail("画面の情報が古くなっています。画面を再読み込みしてから、もう一度お試しください。", 400);

  const internal = workerAuthorized(request);
  if (!internal && !sameOrigin(request)) return fail("操作元を確認できません。", 403);
  const authDb = internal ? createAdminClient() : await createClient();
  const supabase = internal || billingEnabled() ? createAdminClient() : authDb;
  const { data: { user: sessionUser } } = internal ? { data: { user: null } } : await authDb.auth.getUser();
  const { data: queuedJob } = internal ? await supabase.from("grading_jobs").select("created_by").eq("request_id", requestId).single() : { data: null };
  const user = internal && queuedJob ? { id: queuedJob.created_by } : sessionUser;
  if (!user) return fail("ログインしていません。もう一度ログインしてください。", 401);

  const { data: actor } = await authDb.from("profiles").select("school_id,role").eq("id", user.id).single();
  if (!actor || !["admin", "teacher"].includes(actor.role)) return fail("採点を行う権限がありません。", 403);
  const { data: enforce, error: configError } = await supabase.rpc("billing_is_enabled");
  if (enforce && !billingEnabled()) return fail("課金機能の設定を確認中です。採点を一時停止しています。", 503);
  if (billingEnabled() && (configError || !enforce)) return fail("課金台帳の準備が完了していません。", 503);
  const cfg = aiConfig();
  if (!cfg.enabled) {
    return fail("採点AIが設定されていません。管理者に、サーバーの環境変数 ANTHROPIC_API_KEY の設定を依頼してください。", 503);
  }

  const { data: sub, error: e1 } = await supabase
    .from("submissions")
    .select("id, school_id, test_id, status, progress, image_paths")
    .eq("id", submissionId)
    .eq("school_id", actor.school_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (e1) return fail("答案を読み込めませんでした。時間をおいて、もう一度お試しください。", 500);
  if (!sub) return fail("答案が見つかりません。削除されたか、他校の答案です。", 404);

  /* ------------------------------------------------ 採点の記録（requestId ごとに1つ） */
  const { data: existingQueue } = billingEnabled() ? await supabase.from("night_queue").select("id").eq("id", (await supabase.from("grading_jobs").select("id").eq("request_id", requestId).maybeSingle()).data?.id || "00000000-0000-0000-0000-000000000000").maybeSingle() : { data: null };
  if (!existingQueue) await supabase.rpc("expire_stale_grading_jobs", { p_submission_id: submissionId });
  let { data: job } = await supabase.from("grading_jobs").select("*").eq("request_id", requestId).maybeSingle() as { data: JobRow | null };
  if (job && (job.submission_id !== submissionId || job.mode !== mode)) return fail("画面の情報が古くなっています。画面を再読み込みしてください。", 400);
  if (job?.status === "done") return NextResponse.json(await summary(supabase, job));
  if (job?.status === "failed") return fail(job.error || "このAI採点は中断されました。もう一度「AIで採点する」を押してください。", 409, { code: "failed" });

  let inputs: Awaited<ReturnType<typeof loadInputs>> | null = null;
  if (!job) {
    // 入力に問題があれば、記録を作る前に断る（費用はかからない）
    try { inputs = await loadInputs(supabase, sub); } catch (e) { return errorResponse(e); }
    if (billingEnabled()) {
      const admin = createAdminClient();
      const { data: enabled } = await admin.from("billing_config").select("enabled").eq("id", true).single();
      if (!enabled?.enabled) return fail("課金台帳の有効化が未完了です。", 503);
      const { data: account } = await admin.from("billing_accounts").select("night").eq("school_id", sub.school_id).maybeSingle();
      if (account?.night && !nightEnabled()) return fail("夜間採点は一時停止しています。", 503);
      if (account?.night || mode === "opus") {
        const { data: worker } = await admin.from("billing_worker_state").select("last_seen").eq("id", true).single();
        if (!worker?.last_seen || Date.parse(worker.last_seen) < Date.now() - 3 * 60_000) return fail("予約採点の定期処理を確認中です。後ほどお試しください。", 503);
      }
      const { data: created, error } = await admin.rpc("billing_start_job", { p_school: sub.school_id, p_user: user.id, p_submission: submissionId, p_request: requestId, p_mode: mode, p_enforced: true, p_consent: body?.opusConsent === true });
      if (error || !created) return fail(error?.code === "23505" ? "この答案には進行中の採点・予約があります。採点履歴を確認してください。" : error?.message || "採点枠を確保できませんでした。", 409);
      job = created as JobRow;
    } else {
    const { data: created, error } = await supabase.from("grading_jobs").insert({
      school_id: sub.school_id, submission_id: submissionId, created_by: user.id, request_id: requestId, mode,
      prev_status: sub.status, prev_progress: sub.progress,
    }).select("*").single();
    if (error?.code === "23505") {
      // 同じ requestId がほぼ同時に届いた → 先に作られた記録を使う。別の操作なら、採点中として断る
      const { data: again } = await supabase.from("grading_jobs").select("*").eq("request_id", requestId).maybeSingle();
      if (!again) return fail("この答案は、いま別の画面でAI採点しています。終わるまでお待ちください。", 409, { code: "busy" });
      job = again as JobRow;
    } else if (error || !created) {
      return fail("AI採点を始められませんでした。管理者が Supabase で 0006_grading_modes.sql を実行済みか確認してください。", 500);
    } else {
      job = created as JobRow;
      await supabase.from("submissions").update({ status: "processing", progress: 30 }).eq("id", submissionId);
    }
    }
  }
  const theJob = job as JobRow;
  if (billingEnabled()) {
    const { data: order } = await supabase.from("billing_orders").select("status").eq("id", theJob.id).maybeSingle();
    if (order && order.status !== "paid") return fail("Opus単独の追加55円の支払いが必要です。", 402, { jobId: theJob.id, requiresPayment: true });
    const { data: queue } = await supabase.from("night_queue").select("id,night,due_at").eq("id", theJob.id).maybeSingle();
    if (queue && !internal) return NextResponse.json({ ok: true, done: false, queued: true, dueAt: queue.due_at, jobId: theJob.id });
  }

  /* ------------------------------------------------ 次の段階を決める */
  const rows = await stageRows(supabase, theJob.id);
  if (rows.some((r) => r.status === "calling")) {
    // 同じ requestId の要求が、いまモデルを呼んでいる（再送・連打）→ 呼ばずに待ってもらう
    return NextResponse.json({ ok: true, done: false, pending: true, stage: rows.find((r) => r.status === "calling")!.stage }, { status: 202 });
  }
  const plan = PLAN[theJob.mode];
  const last = rows.at(-1);
  const ctx = { schoolId: sub.school_id as string, userId: user.id };
  if (last && last.status === "done" && !last.escalate) return finish(supabase, theJob, rows, ctx);
  const nextIndex = last ? plan.indexOf(last.stage) + 1 : 0;
  if (nextIndex >= plan.length) return finish(supabase, theJob, rows, ctx);
  const stage = plan[nextIndex];

  try {
    inputs ??= await loadInputs(supabase, sub);
  } catch (e) {
    await supabase.rpc("fail_grading_job", { p_job_id: theJob.id, p_error: e instanceof Error ? e.message : "入力の読み込みに失敗" });
    return errorResponse(e);
  }

  /* ------------------------------------------------ この段階を1回だけ呼ぶ */
  const opts = stageOptions(stage, theJob.mode);
  const { data: claimed, error: claimError } = await supabase.from("grading_stages").insert({
    school_id: sub.school_id, job_id: theJob.id, submission_id: submissionId,
    stage, position: nextIndex + 1, model_id: opts.model,
  }).select("id").single();
  if (claimError || !claimed) {
    // 同じ段階の記録がすでにある（同時の再送）→ 呼ばない
    return NextResponse.json({ ok: true, done: false, pending: true, stage }, { status: 202 });
  }

  const t0 = Date.now();
  try {
    const previous = [...rows].reverse().find(r=>r.status === "done" && r.items);
    const selectedTest = targetedTest(inputs.gradeTest, previous?.items ?? null, previous?.quality?.ok === true);
    const { parsed, model, usage, stopReason } = await callClaude({ pages: inputs.pages, test: selectedTest, rubric: inputs.rubric }, opts);
    const tokens = {
      input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0,
    };
    const normalized = normalizeResult(parsed, selectedTest, inputs.rubric);
    const quality = normalized.quality;
    addChecks(normalized.items, selectedTest);
    const items = mergeTargeted(inputs.gradeTest, normalized.items, previous?.items ?? null);
    // 前の段階と判定が分かれた設問（最後の段階でだけ、要確認の理由にする）
    const prevDone = [...rows].reverse().find((r) => r.status === "done" && r.items);
    const isLast = nextIndex === plan.length - 1;
    if (isLast && prevDone) markDisagreement(normalized.items, prevDone.items);
    const reasons = escalationReasons(items);
    if (!quality.ok) reasons.push({ code: "quality", msg: `答案全体：${FLAG_MESSAGE.quality}（${quality.issues.map((i) => i.k).join("・")}）` });
    const escalate = !isLast && reasons.length > 0;
    await supabase.from("grading_stages").update({
      status: "done", escalate, reasons, items, quality, served_model: model, stop_reason: stopReason,
      usage: tokens, cost_usd: costOfStage(stage, tokens), elapsed_ms: Date.now() - t0, finished_at: new Date().toISOString(),
    }).eq("id", claimed.id);
    if (escalate) {
      return NextResponse.json({ ok: true, done: false, stage, next: plan[nextIndex + 1], reasons: reasons.map((r) => r.msg) });
    }
    return finish(supabase, theJob, await stageRows(supabase, theJob.id), ctx);
  } catch (e) {
    const err = e as GradingError & { unusable?: boolean; usage?: { input_tokens?: number; output_tokens?: number }; model?: string; stopReason?: string };
    const tokens = err.usage ? { input: err.usage.input_tokens ?? 0, output: err.usage.output_tokens ?? 0 } : null;
    const isLast = nextIndex === plan.length - 1;
    // 3モデル併用で、応答が採点結果として使えない（拒否・途中終了・壊れた JSON）→ 上の段階に回す
    const escalate = !!err.unusable && !isLast;
    const message = e instanceof Error ? e.message : "採点AIの呼び出しに失敗しました";
    await supabase.from("grading_stages").update({
      status: "error", escalate, error: message.slice(0, 500), served_model: err.model ?? null, stop_reason: err.stopReason ?? null,
      reasons: escalate ? [{ code: "unusable", msg: `答案全体：${FLAG_MESSAGE.unusable}（${message}）` }] : [],
      usage: tokens, cost_usd: tokens ? costOfStage(stage, tokens) : null,
      elapsed_ms: Date.now() - t0, finished_at: new Date().toISOString(),
    }).eq("id", claimed.id);
    if (escalate) {
      return NextResponse.json({ ok: true, done: false, stage, next: plan[nextIndex + 1], reasons: [FLAG_MESSAGE.unusable] });
    }
    await supabase.rpc("fail_grading_job", { p_job_id: theJob.id, p_error: message });
    if (!(e instanceof GradingError)) console.error("AI採点で予期しないエラー", e instanceof Error ? e.name : "unknown");
    return errorResponse(e);
  }
}

/* ------------------------------------------------------------------ 補助 */

async function stageRows(supabase: Supa, jobId: string) {
  const { data } = await supabase.from("grading_stages").select("*").eq("job_id", jobId).order("position");
  return (data ?? []) as StageRow[];
}

/** 最後に結果が出た段階の採点を確定して保存する（保存と記録の確定は1つのトランザクション） */
async function finish(supabase: Supa, job: JobRow, rows: StageRow[], ctx: { schoolId: string; userId: string }) {
  const final = [...rows].reverse().find((r) => r.status === "done" && r.items && r.quality);
  if (!final) {
    await supabase.rpc("fail_grading_job", { p_job_id: job.id, p_error: "どのモデルからも採点結果を得られませんでした" });
    return fail("どのモデルからも採点結果を得られませんでした。画像を確認して、もう一度お試しください。", 502);
  }
  const items = finalizeItems(final.items!, { mode: job.mode, stage: final.stage, model: final.model_id });
  // 最後の段階でも点検の理由が残った＝上のモデルでも解決しなかった（要確認）
  const unresolved = final.reasons.length > 0;
  const needsReview = items.some((i) => i.need_review);
  const decision = {
    stages: rows.map((r) => ({ stage: r.stage, model: r.model_id, status: r.status, escalate: r.escalate, reasons: r.reasons.map((x) => x.msg) })),
    final_stage: final.stage,
    unresolved,
    review_reasons: final.reasons.map((r) => r.msg),
  };
  const { error } = await supabase.rpc("finish_grading_job", {
    p_job_id: job.id, p_stage: final.stage, p_quality: final.quality, p_items: items,
    p_needs_review: needsReview, p_decision: decision,
  });
  if (error && error.code !== "55000") {
    await supabase.rpc("fail_grading_job", { p_job_id: job.id, p_error: error.message });
    return fail(`採点結果を保存できませんでした。${/[ぁ-んァ-ン一-龥]/.test(error.message) ? error.message : "時間をおいて、もう一度お試しください。"}`, 500);
  }
  const { data: done } = await supabase.from("grading_jobs").select("*").eq("id", job.id).single();
  const result = await summary(supabase, (done ?? job) as JobRow);

  await supabase.from("audit_logs").insert({
    school_id: ctx.schoolId,
    actor_id: ctx.userId,
    action: "grading.ai",
    target_table: "submissions",
    target_id: job.submission_id,
    detail: {
      mode: job.mode, final_stage: final.stage, model: final.model_id,
      stages: rows.map((r) => r.stage), need_review: items.filter((i) => i.need_review).length,
      cost_usd: result.costUsd,
    },
  });
  return NextResponse.json(result);
}

async function summary(supabase: Supa, job: JobRow) {
  const { data: items } = await supabase.from("submission_items").select("earned, need_review, is_blank").eq("submission_id", job.submission_id);
  const list = items ?? [];
  const rows = await stageRows(supabase, job.id);
  return {
    ok: true,
    done: true,
    mode: job.mode,
    finalStage: job.final_stage,
    model: rows.find((r) => r.stage === job.final_stage)?.model_id ?? null,
    stages: rows.map((r) => r.stage),
    total: list.reduce((a, i) => a + (i.earned ?? 0), 0),
    needReview: list.filter((i) => i.need_review).length,
    blank: list.length > 0 && list.every((i) => i.is_blank),
    costUsd: Number(job.total_cost_usd ?? 0),
  };
}

function errorResponse(e: unknown) {
  if (e instanceof GradingError) return fail(e.message, e.status);
  return fail("AI採点に失敗しました。時間をおいて、もう一度お試しください。", 500);
}
