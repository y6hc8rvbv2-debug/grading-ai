// ログインセッションを維持するための proxy（Next.js 16 で middleware から名前が変わった）
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Supabase が未設定ならデモモード。ログイン確認をしない。
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // セッションを更新する。この呼び出しを省くとトークンが失効する。
  const { data: { user } } = await supabase.auth.getUser();

  // 生徒の画面とチャッピー先生の API は、答案・会話を端末や共有のキャッシュに残さない
  const path = request.nextUrl.pathname;
  if (path.startsWith("/student") || path.startsWith("/api/tutor") || path.startsWith("/submit") || path.startsWith("/api/submit")) {
    response.headers.set("cache-control", "no-store, private");
  }

  // 未ログインならログイン画面へ。次はログインなしで開ける：
  //   ログイン画面・生徒の画面・起動画面・規約などの公開ページ（ストアの審査・保護者も読める）・アプリの情報（manifest）
  //   チャッピー先生・アカウント削除・保存期間の削除（Cron）の API は、自分で 401 を返す
  //   決済の通知（Stripe の署名で確かめる）と予約採点の定期処理（BILLING_WORKER_SECRET で確かめる）も、ログインなしで届く必要がある
  //   ver6：生徒のタブレット・スマホからの提出（先生が配ったリンクのトークンで確かめる）、暗号資産の決済の通知（署名で確かめる）
  const isPublic = ["/login", "/student", "/submit", "/api/submit", "/api/billing/crypto/webhook", "/start", "/privacy", "/terms", "/support", "/account-deletion", "/tokushoho", "/auth/callback", "/manifest.webmanifest", "/api/tutor", "/api/account", "/api/retention", "/api/billing/webhook", "/api/billing/worker"]
    .some((p) => path === p || path.startsWith(p + "/"));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
