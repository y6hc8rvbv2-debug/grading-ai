#!/usr/bin/env bash
# ローカルの Supabase（Docker）に対して、アプリをブラウザで通しで動かすシナリオテスト。
#
#   使い方: npm run test:e2e
#
# 前提: Docker が動いていること。初回は Supabase のイメージ取得に数分かかる。
# 手順: Supabase 起動 → DB を初期化（supabase/migrations を適用）→ 初期データ投入
#       → アプリをビルドして起動 → tests/e2e/scenario.mjs を実行 → アプリを停止
#
# 環境変数（任意）
#   SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io   ECR に届かない環境で Docker Hub から取得する
#   CHROMIUM_PATH=/path/to/chrome                 Playwright 同梱のブラウザ以外を使う
#   KEEP_SUPABASE=1                               終了後も Supabase を止めない
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT=${E2E_PORT:-3200}
SERVICES_OFF="studio,imgproxy,edge-runtime,logflare,vector,realtime,mailpit,postgres-meta,supavisor"

echo "== Supabase を起動"
npx supabase start -x "$SERVICES_OFF" >/dev/null 2>&1
echo "== DB を初期化（マイグレーションを適用）"
npx supabase db reset >/dev/null 2>&1

STATUS=$(npx supabase status -o json 2>/dev/null)
ANON=$(node -e "console.log(JSON.parse(process.argv[1]).ANON_KEY)" "$STATUS")
SERVICE=$(node -e "console.log(JSON.parse(process.argv[1]).SERVICE_ROLE_KEY)" "$STATUS")
API=$(node -e "console.log(JSON.parse(process.argv[1]).API_URL)" "$STATUS")

echo "== 初期データを投入"
SUPABASE_URL="$API" SERVICE="$SERVICE" ANON="$ANON" node tests/e2e/seed.mjs

echo "== アプリをビルドして起動（.next-e2e に出力）"
export NEXT_PUBLIC_SUPABASE_URL="$API" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON" NEXT_TELEMETRY_DISABLED=1
export NEXT_DIST_DIR=.next-e2e
npx next build >/dev/null
npx next start -p "$PORT" >/dev/null 2>&1 &
APP=$!
cleanup() {
  kill "$APP" 2>/dev/null || true
  if [ -z "${KEEP_SUPABASE:-}" ]; then npx supabase stop >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
for _ in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$PORT/login" && break; sleep 1; done

echo "== シナリオを実行"
BASE_URL="http://localhost:$PORT" node tests/e2e/scenario.mjs
