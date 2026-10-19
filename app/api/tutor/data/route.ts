// チャッピー先生：本人の学習データ（復習の状態・振り返り・文字起こし）を消す。API キーの削除とは別
import { fail, json, requireStudent } from "@/lib/tutor/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  const ctx = await requireStudent(req, { write: true });
  if (ctx instanceof Response) return ctx;
  const results = await Promise.all([
    ctx.db.from("tutor_progress").delete().eq("student_id", ctx.studentId).neq("source", "teacher"),
    ctx.db.from("tutor_reflections").delete().eq("student_id", ctx.studentId),
    ctx.db.from("tutor_transcripts").delete().eq("student_id", ctx.studentId),
  ]);
  if (results.some((r) => r.error)) return fail("学習データを消せませんでした。時間をおいてお試しください。", 500, "delete_failed");
  await ctx.db.rpc("tutor_log", { p_action: "data_deleted" });
  return json({ ok: true });
}
