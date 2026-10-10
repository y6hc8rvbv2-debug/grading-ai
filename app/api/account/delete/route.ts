// 本人によるアカウントの削除（App Store・Google Play の要件。docs/STORE-RELEASE.md）。
//   1. 本人のセッションで prepare_account_deletion()（0016）：最後の管理者でないかを確かめ、本人を指す参照を外す
//   2. Supabase Auth の管理 API で本人の auth.users を削除する（service_role はこの処理と見回り・保存期間の削除だけに使う）
// 削除するのはログインした本人だけ（ID はクライアントから受け取らない）。確認の文字（「削除」）が無い要求は断る。
import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store, private" } });

/** 同じサイトからの要求か（他サイトから削除を仕掛けられないようにする） */
function sameOrigin(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (!origin) return site === "same-origin";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "この画面からの操作ではありません。ページを開き直してください。" }, 403);
  const b = await req.json().catch(() => null) as { confirm?: unknown } | null;
  if (b?.confirm !== "削除") return json({ error: "確認のため「削除」と入力してください。" }, 400);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return json({ error: "サーバーの設定（SUPABASE_SERVICE_ROLE_KEY）が無いため、いまは削除できません。お問い合わせ先にご連絡ください。" }, 503);
  }
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return json({ error: "ログインしてください。" }, 401);

  const { data: prepared, error: prepError } = await db.rpc("prepare_account_deletion");
  if (prepError) {
    const missing = prepError.code === "PGRST202" || /prepare_account_deletion/.test(prepError.message);
    return json({ error: missing
      ? "アカウントの削除の準備ができていません（管理者が 0016_account_deletion.sql を実行します）。お問い合わせ先にご連絡ください。"
      : prepError.message }, missing ? 503 : 409);
  }
  const { error: delError } = await createAdminClient().auth.admin.deleteUser(user.id);
  if (delError) return json({ error: "アカウントを削除できませんでした。時間をおいてもう一度お試しください。" }, 502);
  // 削除した利用者のセッション（クッキー）を消す
  await db.auth.signOut().catch(() => {});
  return json({ ok: true, role: (prepared as { role?: string } | null)?.role ?? "none" });
}
