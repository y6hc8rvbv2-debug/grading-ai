// ログインセッションを維持するための middleware（Next.js 14 App Router）
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
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
  if (path.startsWith("/student") || path.startsWith("/api/tutor")) {
    response.headers.set("cache-control", "no-store, private");
  }

  // 未ログインならログイン画面へ。次はログインなしで開ける：
  //   ログイン画面・生徒の画面・起動画面・規約などの公開ページ（ストアの審査・保護者も読める）・アプリの情報（manifest）
  //   チャッピー先生・アカウント削除・保存期間の削除（Cron）の API は、自分で 401 を返す
  const isPublic = ["/login", "/student", "/start", "/privacy", "/terms", "/support", "/account-deletion", "/auth/callback", "/manifest.webmanifest", "/api/tutor", "/api/account", "/api/retention"]
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
