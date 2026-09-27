/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // E2E テスト（tests/e2e/run.sh）は別フォルダにビルドして、開発用の .next を汚さない
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
