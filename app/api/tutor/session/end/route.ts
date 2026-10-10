// チャッピー先生：会話を終える（画面を閉じたときは sendBeacon で呼ぶ）。サーバーが本人のキーで通話も切る。
// 文字起こしは、本人が「会話を保存する」に同意しているときだけ保存する（DB の権限でも確かめる）
import { activeConsent, hangupSessions, json, requireStudent } from "@/lib/tutor/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await requireStudent(req, { write: true, evenIfOff: true });
  if (ctx instanceof Response) return ctx;
  const text = await req.text();
  let b: Record<string, unknown> = {};
  try { b = JSON.parse(text.slice(0, 30000)); } catch { /* 壊れた本文は空として扱う */ }
  const sessionId = String(b.sessionId ?? "");
  const usage = typeof b.usage === "object" && b.usage ? b.usage : {};
  await ctx.db.rpc("end_tutor_session", {
    p_id: sessionId, p_reason: String(b.reason ?? "user").slice(0, 40),
    p_seconds: Math.max(0, Math.round(Number(b.seconds) || 0)), p_usage: usage,
  });
  await hangupSessions(ctx, "user", { sessionId });
  const transcript = typeof b.transcript === "string" ? b.transcript.slice(0, 20000) : "";
  if (transcript) {
    const consent = await activeConsent(ctx);
    if (consent?.save_transcript) {
      const { data: school } = await ctx.db.rpc("current_student_school");
      await ctx.db.from("tutor_transcripts").upsert({ session_id: sessionId, school_id: school, student_id: ctx.studentId, body: transcript }, { onConflict: "session_id", ignoreDuplicates: true });
    }
  }
  return json({ ok: true });
}
