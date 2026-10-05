// チャッピー先生：会話中の生存確認（20秒ごと）。
// 1回の上限・学校やクラスでの停止・同意の撤回・機能の停止（TUTOR_FEATURE=off）を見つけたら、
// サーバーが本人のキーで通話を切り、{ continue: false, reason } を返す（画面も接続を閉じる）
import { featureOff, hangupSessions, json, requireStudent } from "@/lib/tutor/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await requireStudent(req, { write: true, evenIfOff: true });
  if (ctx instanceof Response) return ctx;
  const b = await req.json().catch(() => null) as { sessionId?: unknown; seconds?: unknown } | null;
  const sessionId = String(b?.sessionId ?? "");
  if (featureOff()) {
    await hangupSessions(ctx, "feature_off", { sessionId });
    return json({ continue: false, reason: "feature_off" });
  }
  const { data: reason } = await ctx.db.rpc("heartbeat_tutor_session", { p_id: sessionId, p_seconds: Math.max(0, Math.round(Number(b?.seconds) || 0)) });
  if (reason === "ok") return json({ continue: true, reason });
  let why = String(reason ?? "ended");
  if (why === "ended") {
    // 見回り（/api/tutor/sweep）が先に終わらせていたときは、その理由を画面に伝える
    const { data: s } = await ctx.db.from("tutor_sessions").select("end_reason").eq("id", sessionId).maybeSingle();
    if (s?.end_reason && ["time_limit", "disabled", "no_consent", "feature_off", "no_heartbeat"].includes(s.end_reason)) why = s.end_reason;
  }
  await hangupSessions(ctx, why, { sessionId });
  return json({ continue: false, reason: why });
}
