/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // E2E テスト（tests/e2e/run.sh）は別フォルダにビルドして、開発用の .next を汚さない
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // HEIC の変換（サーバー側）は WebAssembly を含むので、バンドルせずに Node から読み込む（Next.js 15 で experimental から移動）
  serverExternalPackages: ["heic-decode", "libheif-js"],
  // セキュリティのヘッダー（2026-10-22 の点検。docs/SECURITY-REVIEW.md）
  //   ほかのサイトの枠の中に表示させない（クリックジャッキング対策）・ファイルの種類の推測をさせない・HTTPS だけで開く・
  //   カメラ（答案の撮影）とマイク（音声入力）はこのサイトだけ。位置情報・支払いの API は使わない
  //   スクリプトの読み込み元の制限（CSP の script-src）は、Next.js・Supabase・Vercel の Preview の道具を壊さないよう今は付けない
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
      ],
    }];
  },
};

export default nextConfig;
