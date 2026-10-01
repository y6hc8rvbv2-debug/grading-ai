/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // E2E テスト（tests/e2e/run.sh）は別フォルダにビルドして、開発用の .next を汚さない
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // HEIC の変換（サーバー側）は WebAssembly を含むので、バンドルせずに Node から読み込む
    serverComponentsExternalPackages: ["heic-decode", "libheif-js"],
  },
};

export default nextConfig;
