// ============================================================================
// 採点AIの Route Handler
//
//   GET  /api/grade                   採点AIが使えるか（APIキーが設定されているか）
//   POST /api/grade { submissionId }  保存済みの答案を AI で採点して保存する
//
// DB と Storage には、ログイン中の教員のセッション（anon キー + Cookie）でアクセスする。
// service_role は使わないので、読み書きできるのは RLS が許す自校の答案だけ。
// サーバーに置くのは ANTHROPIC_API_KEY だけ（ブラウザには出さない）。
// ============================================================================
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rubricFromRow } from "@/lib/db/rubric";
import { typeLabelOf } from "@/lib/grading/engine";
import {
  aiConfig, callClaude, normalizeResult, GradingError,
  type AnswerPage, type GradeTest,
} from "@/lib/ai/grade";
import { heicToJpeg, looksLikeHeic } from "@/lib/ai/heic";
import type { QType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 1枚の採点に数十秒かかることがある。Vercel のプランの上限まで待つ
export const maxDuration = 300;

const MAX_PAGES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // Claude API の画像1枚の上限
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("ログインしていません。もう一度ログインしてください。", 401);
  const cfg = aiConfig();
  return NextResponse.json({ enabled: cfg.enabled, model: cfg.enabled ? cfg.model : null });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { submissionId?: unknown } | null;
  const submissionId = typeof body?.submissionId === "string" ? body.submissionId : "";
  if (!UUID.test(submissionId)) return fail("採点する答案が指定されていません。画面を再読み込みしてください。", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("ログインしていません。もう一度ログインしてください。", 401);

  const cfg = aiConfig();
  if (!cfg.enabled) {
    return fail("採点AIが設定されていません。管理者に、サーバーの環境変数 ANTHROPIC_API_KEY の設定を依頼してください。", 503);
  }

  /* ------------------------------------------------ 答案・テスト・採点基準を読む */
  const { data: sub, error: e1 } = await supabase
    .from("submissions")
    .select("id, school_id, test_id, status, progress, image_paths")
    .eq("id", submissionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (e1) return fail("答案を読み込めませんでした。時間をおいて、もう一度お試しください。", 500);
  if (!sub) return fail("答案が見つかりません。削除されたか、他校の答案です。", 404);
  const paths: string[] = sub.image_paths ?? [];
  if (!paths.length) {
    return fail("この答案には原本画像がないため、AI採点できません。「新規採点」で答案画像を取り込み直してください。", 400);
  }
  if (paths.length > MAX_PAGES) return fail(`1人分の答案は${MAX_PAGES}ページまでです。ページを分けて取り込んでください。`, 400);

  const [{ data: test, error: e2 }, { data: questions, error: e3 }, { data: rubrics, error: e4 }] = await Promise.all([
    supabase.from("tests").select("id, name, subject, grade, answer_lang").eq("id", sub.test_id).single(),
    supabase.from("questions").select("*").eq("test_id", sub.test_id).order("no"),
    supabase.from("rubrics").select("*").or(`test_id.eq.${sub.test_id},test_id.is.null`),
  ]);
  if (e2 || e3 || e4 || !test) return fail("テストの設問を読み込めませんでした。時間をおいて、もう一度お試しください。", 500);
  if (!questions?.length) return fail("このテストには設問が登録されていません。テスト管理で設問を登録してください。", 400);
  // テスト専用の採点基準があればそれを、無ければ学校の既定値を使う
  const rubric = rubricFromRow(
    rubrics?.find((r) => r.test_id === sub.test_id) ?? rubrics?.find((r) => r.test_id === null)
  );

  const gradeTest: GradeTest = {
    subject: test.subject, name: test.name, grade: test.grade, answerLang: test.answer_lang,
    questions: questions.map((q) => ({
      no: q.no, label: q.label, type: q.qtype as QType, typeLabel: typeLabelOf(q.qtype),
      unit: q.unit, points: q.points, correct: q.correct, model: q.model_answer, keywords: q.keywords ?? [],
    })),
  };

  /* ------------------------------------------------ 原本画像を読む */
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
    if (!mediaType) return fail(`対応していない形式のファイルです（.${ext}）。JPEG / PNG / HEIC / PDF で取り込んでください。`, 400);

    const { data: blob, error } = await supabase.storage.from("answer-sheets").download(path);
    if (error || !blob) return fail("答案画像を読み込めませんでした。時間をおいて、もう一度お試しください。", 500);
    let buf: Buffer = Buffer.from(await blob.arrayBuffer());
    if (mediaType === "pdf") {
      if (buf.length > MAX_PDF_BYTES) return fail("PDF が大きすぎます（25MBまで）。ページを分けて取り込んでください。", 400);
      pages.push({ kind: "pdf", data: buf.toString("base64") });
      continue;
    }
    // HEIC のまま保存された答案（以前の取り込み）は、採点AIが読める JPEG に変換してから送る
    let type = mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "heic";
    if (type === "heic" || looksLikeHeic(buf)) {
      try {
        buf = await heicToJpeg(buf);
        type = "image/jpeg";
      } catch {
        return fail("HEIC 形式の写真を変換できませんでした。iPhone の「設定 → カメラ → フォーマット」を「互換性優先」にして撮り直すか、JPEG で保存し直して取り込んでください。", 400);
      }
    }
    if (buf.length > MAX_IMAGE_BYTES) {
      return fail("答案画像が大きすぎます（1枚5MBまで）。「新規採点」で取り込み直すと自動で縮小されます。", 400);
    }
    pages.push({ kind: "image", mediaType: type as Exclude<typeof type, "heic">, data: buf.toString("base64") });
  }

  /* ------------------------------------------------ 採点中にする */
  const before = { status: sub.status, progress: sub.progress };
  await supabase.from("submissions").update({ status: "processing", progress: 30 }).eq("id", submissionId);
  const restore = () =>
    supabase.from("submissions").update(before).eq("id", submissionId);

  /* ------------------------------------------------ 採点AIを呼ぶ → 保存 */
  try {
    const { parsed, model, usage } = await callClaude({ pages, test: gradeTest, rubric });
    const { items, quality } = normalizeResult(parsed, gradeTest, rubric);

    const { error: e5 } = await supabase.rpc("save_ai_grading", {
      p_submission_id: submissionId,
      p_quality: quality,
      p_items: items,
    });
    if (e5) {
      await restore();
      return fail(`採点結果を保存できませんでした。${e5.message.match(/[ぁ-んァ-ン一-龥]/) ? e5.message : "時間をおいて、もう一度お試しください。"}`, 500);
    }

    await supabase.from("audit_logs").insert({
      school_id: sub.school_id,
      actor_id: user.id,
      action: "grading.ai",
      target_table: "submissions",
      target_id: submissionId,
      detail: {
        model,
        items: items.length,
        need_review: items.filter((i) => i.need_review).length,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      },
    });

    return NextResponse.json({
      ok: true,
      model,
      total: items.reduce((a, i) => a + i.earned, 0),
      needReview: items.filter((i) => i.need_review).length,
      blank: items.every((i) => i.is_blank),
    });
  } catch (e) {
    await restore();
    if (e instanceof GradingError) return fail(e.message, e.status);
    console.error("AI採点で予期しないエラー", e);
    return fail("AI採点に失敗しました。時間をおいて、もう一度お試しください。", 500);
  }
}
