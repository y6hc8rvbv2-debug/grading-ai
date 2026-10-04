// チャッピー先生：会話中の生存確認。時間の上限を超えたら { continue: false }（画面は会話を止める）
import { json, requireStudent } from "@/lib/tutor/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await requireStudent(req, { write: true });
  if (ctx instanceof Response) return ctx;
  const b = await req.json().catch(() => null) as { sessionId?: unknown; seconds?: unknown } | null;
  const { data } = await ctx.db.rpc("heartbeat_tutor_session", { p_id: String(b?.sessionId ?? ""), p_seconds: Math.max(0, Math.round(Number(b?.seconds) || 0)) });
  return json({ continue: data === true });
}
