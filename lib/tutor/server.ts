// チャッピー先生の API で共通に使う確認（サーバー専用）。
//   - 機能の停止スイッチ（環境変数 TUTOR_FEATURE=off）。既存の採点は止めない
//   - アプリ内の会話（A方式：本人の API キーでの音声・文字の会話）は、環境変数 TUTOR_INAPP=on のときだけ。
//     既定は無効（いまの方針は「本人の ChatGPT で復習」＝B方式だけ。B方式はブラウザだけで動き、この API を使わない）
//   - 同じサイトからの要求か（CSRF 対策：Origin または Sec-Fetch-Site）
//   - ログイン中の利用者が、配信先として登録された生徒か（生徒の ID はクライアントから受け取らない）
//   - 応答はキャッシュさせない
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptKey } from "@/lib/tutor/crypto";
import { hangupCallDetailed, looksLikeKey } from "@/lib/tutor/openai";

import { featureOff, inAppEnabled } from "@/lib/tutor/mode";
export { featureOff, inAppEnabled };

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
export async function requireStudent(req: Request, opts: { write?: boolean; evenIfOff?: boolean; inApp?: boolean } = {}): Promise<StudentCtx | NextResponse> {
  // 停止中でも、会話を止める操作（生存確認・終了・同意の撤回・キーの削除）は受け付ける
  if (featureOff() && !opts.evenIfOff) return fail("チャッピー先生は現在停止しています。先生に確認してください。", 503, "feature_off");
  // アプリ内の会話を始める・キーを登録する・同意する操作は、A方式を使う設定のときだけ
  if (opts.inApp && !inAppEnabled()) return fail("アプリ内の AI との会話は使っていません。「ChatGPT で復習」を使ってください。", 403, "inapp_off");
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

/** 本人のキー：今回渡されたもの（保存しない方式）か、保存した暗号文を復号したもの。どちらも無ければ null（他のキーは使わない） */
export async function studentKey(ctx: StudentCtx, provided?: unknown): Promise<string | null> {
  if (typeof provided === "string" && looksLikeKey(provided)) return provided.trim();
  const { data: cred } = await ctx.db.from("tutor_credentials").select("ciphertext, status").eq("student_id", ctx.studentId).maybeSingle();
  if (!cred || cred.status !== "active" || !cred.ciphertext) return null;
  try { return decryptKey(cred.ciphertext, ctx.studentId); } catch { return null; }
}

/**
 * 本人の会話の通話をサーバーから切り、会話の記録を終える（sessionId を省くと、進行中の会話すべて）。
 * 通話を切る資格情報は、会話を始めたときに暗号化して置いたもの（tutor_call_secrets。誰も読めない表）を使う。
 * そのため「保存しない」で登録したキーでも、ブラウザからキーを受け取らずに切れる。
 * 切れなかったときも記録は終え、結果を記録する（見回り /api/tutor/sweep が間隔を広げて再試行する）。
 */
export async function hangupSessions(ctx: StudentCtx, reason: string, opts: { sessionId?: string } = {}) {
  let q = ctx.db.from("tutor_sessions").select("id, call_id, status, hangup_status").eq("student_id", ctx.studentId);
  q = opts.sessionId ? q.eq("id", opts.sessionId) : q.eq("status", "active");
  const { data: rows } = await q;
  let hungUp = 0, missed = 0;
  for (const r of rows ?? []) {
    if (r.status === "active") await ctx.db.rpc("end_tutor_session", { p_id: r.id, p_reason: reason, p_seconds: 0, p_usage: {} });
    if (!r.call_id || r.hangup_status === "done" || r.hangup_status === "gave_up") continue;
    const res = await hangupWithSecret(ctx, r.id, r.call_id);
    if (res.ok) hungUp++; else missed++;
  }
  return { hungUp, missed };
}

/** 会話の資格情報で通話を切り、結果を記録する（生徒の要求の中） */
async function hangupWithSecret(ctx: StudentCtx, sessionId: string, callId: string) {
  const { data: secret } = await ctx.db.rpc("tutor_call_secret", { p_id: sessionId });
  let res: { ok: boolean; error: string };
  if (!secret) res = { ok: false, error: "資格情報が無い" };
  else {
    let key = "";
    try { key = decryptKey(String(secret), sessionId); } catch { /* 下で失敗として記録 */ }
    res = key ? await hangupCallDetailed(key, callId) : { ok: false, error: "復号できない" };
  }
  if (secret) await ctx.db.rpc("tutor_hangup_result", { p_id: sessionId, p_ok: res.ok, p_error: res.error });
  return res;
}
