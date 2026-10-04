// チャッピー先生：外部の AI へ送る内容（1問分）のプレビューと、外部の ChatGPT に貼り付ける文章。AI は呼ばない
import { buildContext, buildExternalPrompt, type ReleasedItem } from "@/lib/tutor/prompt";
import { activeConsent, fail, json, releasedItem, requireStudent } from "@/lib/tutor/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await requireStudent(req, { write: true });
  if (ctx instanceof Response) return ctx;
  const b = await req.json().catch(() => null) as { releaseId?: unknown; qno?: unknown } | null;
  const releaseId = String(b?.releaseId ?? ""), qno = Number(b?.qno);
  const { payload, item } = await releasedItem(ctx, releaseId, qno);
  if (!payload || !item) return fail("この問題は、あなたに返却された答案に見つかりません。", 404, "not_found");
  const consent = await activeConsent(ctx);
  const share = { sendAnswer: consent ? !!consent.send_answer : true, sendComment: consent ? !!consent.send_comment : true };
  const context = buildContext(item as ReleasedItem, payload, share);
  return json({ context, external: buildExternalPrompt(context) });
}
