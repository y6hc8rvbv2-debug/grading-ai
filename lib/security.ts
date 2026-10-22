// セキュリティの共通の確認（2026-10-22 の点検で追加。docs/SECURITY-REVIEW.md）。サーバー専用
import { timingSafeEqual } from "node:crypto";

/** ほかのサイトから送られた要求か（CSRF 対策）。ブラウザは別サイトからの POST に Origin（と Sec-Fetch-Site）を付ける。
 *  Origin が無い要求（サーバー間・テストの道具）は、ログインの Cookie が付かないので通してよい */
export function crossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return true;
  return req.headers.get("sec-fetch-site") === "cross-site";
}

/** 合言葉（Authorization: Bearer …）を、時間差で中身を推測されない方法で比べる */
export function bearerMatches(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** 1人の教職員が24時間に AI を呼べる回数（盗まれたアカウント・不具合の繰り返しで費用が膨らむのを止める。ふだんの使い方では届かない） */
export const DAILY_LIMIT = { intake: 2000, testImport: 60 } as const;
export const dayAgo = () => new Date(Date.now() - 24 * 3600 * 1000).toISOString();

/** パスワードの聞き直し（再認証）：大事な操作（アカウントの削除・契約の申し込みや変更）の前に、本人のパスワードを確かめる。
 *  ログイン中の画面を他人に使われた・セッションを盗まれた場合でも、パスワードを知らなければ実行できない。
 *  確かめるためだけの一時的なログインを作り、すぐにそのログインだけを取り消す（本人のほかのログインはそのまま） */
export async function verifyPassword(email: string | undefined | null, password: unknown): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!email || typeof password !== "string" || !password || password.length > 200 || !url || !anon) return false;
  const { createClient } = await import("@supabase/supabase-js");
  const tmp = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await tmp.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  await tmp.auth.signOut({ scope: "local" }).catch(() => undefined);
  return true;
}
export const REAUTH_ERROR = "確認のため、ログインのパスワードを入力してください（パスワードが違う場合も、このメッセージになります）。";
