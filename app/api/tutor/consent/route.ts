// チャッピー先生：外部の AI（OpenAI）へ送る内容・会話の保存・先生への共有の同意と、その撤回
import { fail, hangupSessions, json, requireStudent } from "@/lib/tutor/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await requireStudent(req, { write: true, inApp: true });
  if (ctx instanceof Response) return ctx;
  const b = await req.json().catch(() => null) as Record<string, unknown> | null;
  const payer = b?.payer === "guardian" ? "guardian" : b?.payer === "self" ? "self" : null;
  if (!payer) return fail("料金を支払う人（本人／保護者）を選んでください。", 400, "payer");
  if (b?.termsConfirmed !== true) return fail("利用条件（年齢・保護者の同意など）を確認したことにチェックしてください。", 400, "terms");
  const { data: school } = await ctx.db.rpc("current_student_school");
  const { error } = await ctx.db.from("tutor_consents").upsert({
    student_id: ctx.studentId, school_id: school, user_id: ctx.userId, payer, terms_confirmed: true,
    send_answer: b?.sendAnswer !== false, send_comment: b?.sendComment !== false,
    save_transcript: b?.saveTranscript === true, share_with_teacher: b?.shareWithTeacher === true,
    agreed_at: new Date().toISOString(), revoked_at: null,
  }, { onConflict: "student_id" });
  if (error) return fail("同意を保存できませんでした。時間をおいてお試しください。", 500, "save_failed");
  await ctx.db.rpc("tutor_log", { p_action: "consent_given" });
  return json({ ok: true });
}

/** 同意を撤回する（進行中の会話の通話を切る。保存した会話の文字起こしも消える） */
export async function DELETE(req: Request) {
  const ctx = await requireStudent(req, { write: true, evenIfOff: true });
  if (ctx instanceof Response) return ctx;
  await hangupSessions(ctx, "consent_revoked");
  const { error } = await ctx.db.from("tutor_consents").update({ revoked_at: new Date().toISOString() }).eq("student_id", ctx.studentId);
  if (error) return fail("同意を撤回できませんでした。時間をおいてお試しください。", 500, "revoke_failed");
  await ctx.db.rpc("tutor_log", { p_action: "consent_revoked" });
  return json({ ok: true });
}
