// ログインセッションを維持するための proxy（Next.js 16 で middleware から名前が変わった）
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientIp, geoBlockedBody, geoDecision } from "./lib/geo";

export async function proxy(request: NextRequest) {
  // 海外の IP アドレスからのアクセスを断る（lib/geo.ts。ログイン・データの読み出しより前）
  const geo = geoDecision(
    { path: request.nextUrl.pathname, country: request.headers.get("x-vercel-ip-country"), ip: clientIp(request.headers), bypass: request.headers.get("x-vercel-protection-bypass") },
    process.env,
  );
  if (!geo.allow) {
    // 記録は国だけ（IP アドレス・利用者は書かない）
    console.warn(`[geo] blocked country=${geo.country}`);
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "このサービスは日本国内からのみ利用できます。", code: "geo_blocked" }, { status: 403 });
    }
    return new NextResponse(geoBlockedBody(), { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

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

  // 二段階認証（0022）：設定済みの人が1段階目（パスワード）だけで止まっていたら、コードの入力に戻す（DB も 2段階目まで済まないとデータを返さない）
  if (user && !isPublic) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      if (path.startsWith("/api/")) return NextResponse.json({ error: "二段階認証のコードを入力してください。ページを開き直してください。" }, { status: 401 });
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?mfa=1";
      return NextResponse.redirect(url);
    }
    // 0027：管理者で二段階認証をまだ設定していない → 設定の画面へ（DB も、設定して2段階目まで済むまで学校のデータを返さない）
    if (aal?.nextLevel !== "aal2" && user.app_metadata?.role === "admin") {
      const { data: required, error } = await supabase.rpc("my_mfa_required");
      if (!error && required === true) {
        if (path.startsWith("/api/")) return NextResponse.json({ error: "管理者は二段階認証の設定が必要です。ログインし直して、設定してください。", code: "mfa_setup" }, { status: 401 });
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.search = "?mfa=setup";
        return NextResponse.redirect(url);
      }
    }
  }

  // 海外の遮断が動いているかを外から確かめられるよう、判定の理由だけを付ける（国・IP は付けない）
  response.headers.set("x-geo-check", geo.reason);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
