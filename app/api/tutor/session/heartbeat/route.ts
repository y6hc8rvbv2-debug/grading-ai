// チャッピー先生：会話中の生存確認（20秒ごと）。
// 1回の上限・学校やクラスでの停止・同意の撤回・機能の停止（TUTOR_FEATURE=off）を見つけたら、
// サーバーが本人のキーで通話を切り、{ continue: false, reason } を返す（画面も接続を閉じる）
import { featureOff, hangupSessions, json, requireStudent } from "@/lib/tutor/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await requireStudent(req, { write: true, evenIfOff: true });
  if (ctx instanceof Response) return ctx;
  const b = await req.json().catch(() => null) as { sessionId?: unknown; seconds?: unknown; apiKey?: unknown } | null;
  const sessionId = String(b?.sessionId ?? "");
  if (featureOff()) {
    await hangupSessions(ctx, "feature_off", { sessionId, apiKey: b?.apiKey });
    return json({ continue: false, reason: "feature_off" });
  }
  const { data: reason } = await ctx.db.rpc("heartbeat_tutor_session", { p_id: sessionId, p_seconds: Math.max(0, Math.round(Number(b?.seconds) || 0)) });
  if (reason === "ok") return json({ continue: true, reason });
  await hangupSessions(ctx, String(reason ?? "ended"), { sessionId, apiKey: b?.apiKey });
  return json({ continue: false, reason: reason ?? "ended" });
}
