// チャッピー先生の API で共通に使う確認（サーバー専用）。
//   - 機能の停止スイッチ（環境変数 TUTOR_FEATURE=off）。既存の採点は止めない
//   - 同じサイトからの要求か（CSRF 対策：Origin または Sec-Fetch-Site）
//   - ログイン中の利用者が、配信先として登録された生徒か（生徒の ID はクライアントから受け取らない）
//   - 応答はキャッシュさせない
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const featureOff = () => (process.env.TUTOR_FEATURE ?? "").toLowerCase() === "off";

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store, private", "x-content-type-options": "nosniff" } });
}
export const fail = (message: string, status: number, code = "") => json({ error: message, code }, status);

/** 同じサイトからの要求か（フォームの送信を他サイトから仕掛けられないようにする） */
export function sameOrigin(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (!origin) return site === "same-origin";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  try { return new URL(origin).host === host; } catch { return false; }
}

/** HTTPS か（手元の開発・テスト環境は除く）。キーは HTTPS でしか受け取らない */
export function secureTransport(req: Request) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0];
  if (host === "localhost" || host === "127.0.0.1") return true;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return proto === "https";
}

export type StudentCtx = { db: Awaited<ReturnType<typeof createClient>>; userId: string; studentId: string };

/** ログイン中の生徒。生徒でなければエラーの応答を返す */
export async function requireStudent(req: Request, opts: { write?: boolean } = {}): Promise<StudentCtx | NextResponse> {
  if (featureOff()) return fail("チャッピー先生は現在停止しています。先生に確認してください。", 503, "feature_off");
  if (opts.write && !sameOrigin(req)) return fail("この画面からの操作ではありません。ページを開き直してください。", 403, "csrf");
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return fail("ログインしてください。", 401, "login");
  const { data: sid } = await db.rpc("current_student_id");
  if (!sid) return fail("この画面は、先生が配信先に登録した生徒のアカウントで使えます。", 403, "not_student");
  return { db, userId: user.id, studentId: String(sid) };
}

/** 1問分の返却内容と、送ってよい項目（同意） */
export async function releasedItem(ctx: StudentCtx, releaseId: string, qno: number) {
  const { data: rel } = await ctx.db.from("result_releases").select("id, payload").eq("id", releaseId).maybeSingle();
  const payload = (rel?.payload ?? null) as { items?: { qno: number }[]; grade?: number; subject?: string; showModelAnswer?: boolean } | null;
  const item = payload?.items?.find((i) => Number(i.qno) === qno) ?? null;
  return { payload, item };
}

export async function activeConsent(ctx: StudentCtx) {
  const { data } = await ctx.db.from("tutor_consents").select("payer, send_answer, send_comment, save_transcript, share_with_teacher, revoked_at")
    .eq("student_id", ctx.studentId).maybeSingle();
  return data && !data.revoked_at ? data : null;
}

/** start_tutor_session などの断る理由（tutor_*）を、本人向けの文にする */
export function sessionRefusal(message: string): { text: string; status: number; code: string } {
  const m = message.match(/tutor_[a-z_]+/)?.[0] ?? "";
  const table: Record<string, [string, number]> = {
    tutor_disabled: ["チャッピー先生は、学校またはクラスで有効になっていません。先生に確認してください。", 403],
    tutor_no_consent: ["先に「送る内容と同意」を確認して、同意してください。", 403],
    tutor_not_found: ["この問題は、あなたに返却された答案に見つかりません。", 404],
    tutor_busy: ["ほかの画面でチャッピー先生と話しています。そちらを終えてからもう一度お試しください。", 409],
    tutor_too_many: ["短い時間に何度も始めています。少し時間をおいてからお試しください（1時間に6回まで）。", 429],
    tutor_daily_limit: ["今日の利用時間の上限に達しました。明日また使えます。", 429],
    tutor_not_student: ["生徒のアカウントでログインしてください。", 403],
  };
  const [text, status] = table[m] ?? ["会話を始められませんでした。時間をおいてお試しください。", 500];
  return { text, status, code: m || "unknown" };
}
