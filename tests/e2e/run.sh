#!/usr/bin/env bash
# ローカルの Supabase（Docker）に対して、アプリをブラウザで通しで動かすシナリオテスト。
#
#   使い方: npm run test:e2e
#
# 前提: Docker が動いていること。初回は Supabase のイメージ取得に数分かかる。
# 手順: Supabase 起動 → DB を初期化（supabase/migrations を適用）→ 初期データ投入
#       → 採点AIの代役を起動 → アプリをビルドして起動 → tests/e2e/scenario.mjs を実行 → 停止
# 本物の Anthropic API は呼ばない（APIキーも不要）。
#
# 環境変数（任意）
#   SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io   ECR に届かない環境で Docker Hub から取得する
#   CHROMIUM_PATH=/path/to/chrome                 Playwright 同梱のブラウザ以外を使う
#   KEEP_SUPABASE=1                               終了後も Supabase を止めない
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT=${E2E_PORT:-3200}
MOCK_PORT=${MOCK_ANTHROPIC_PORT:-4010}

# 前回の実行が残っていると、古いサーバーに対してテストしてしまうので止める
for p in "$PORT" "$MOCK_PORT"; do
  if curl -s -o /dev/null "http://127.0.0.1:$p/"; then
    echo "✗ ポート $p が使用中です。前回のテストのサーバーが残っていないか確認してください（例: pkill -f next-server）"
    exit 1
  fi
done
SERVICES_OFF="studio,imgproxy,edge-runtime,logflare,vector,realtime,mailpit,postgres-meta,supavisor"

echo "== Supabase を起動"
npx supabase start -x "$SERVICES_OFF" >/dev/null 2>&1
echo "== DB を初期化（マイグレーションを適用）"
npx supabase db reset >/dev/null 2>&1

STATUS=$(npx supabase status -o json 2>/dev/null)
ANON=$(node -e "console.log(JSON.parse(process.argv[1]).ANON_KEY)" "$STATUS")
SERVICE=$(node -e "console.log(JSON.parse(process.argv[1]).SERVICE_ROLE_KEY)" "$STATUS")
API=$(node -e "console.log(JSON.parse(process.argv[1]).API_URL)" "$STATUS")

# db reset の後はコンテナが再起動するので、認証とDB APIが応答するまで待つ
for _ in $(seq 1 60); do
  curl -sf -o /dev/null -H "apikey: $ANON" "$API/auth/v1/health" \
    && curl -sf -o /dev/null -H "apikey: $ANON" "$API/rest/v1/" && break
  sleep 1
done

echo "== 初期データを投入"
SUPABASE_URL="$API" SERVICE="$SERVICE" ANON="$ANON" node tests/e2e/seed.mjs

echo "== 採点AIの代役（tests/e2e/mock-anthropic.mjs）を起動"
DUMMY_KEY="sk-ant-e2e-dummy-key-not-real"
EXPECTED_API_KEY="$DUMMY_KEY" MOCK_ANTHROPIC_PORT="$MOCK_PORT" node tests/e2e/mock-anthropic.mjs >/dev/null 2>&1 &
MOCK=$!

echo "== アプリをビルドして起動（.next-e2e に出力）"
export NEXT_PUBLIC_SUPABASE_URL="$API" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON" NEXT_TELEMETRY_DISABLED=1
export NEXT_DIST_DIR=.next-e2e
node_modules/.bin/next build >/dev/null
# APIキーがブラウザ向けのファイルに入っていないこと（サーバーの環境変数にだけ置く）
if grep -rq "$DUMMY_KEY" .next-e2e/static 2>/dev/null; then echo "✗ APIキーがブラウザ向けのファイルに含まれています"; exit 1; fi
ANTHROPIC_API_KEY="$DUMMY_KEY" ANTHROPIC_BASE_URL="http://127.0.0.1:$MOCK_PORT" \
  node_modules/.bin/next start -p "$PORT" >/dev/null 2>&1 &
APP=$!
cleanup() {
  # 子プロセス（next-server）ごと止める
  pkill -P "$APP" 2>/dev/null || true
  kill "$APP" "$MOCK" 2>/dev/null || true
  if [ -z "${KEEP_SUPABASE:-}" ]; then npx supabase stop >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
for _ in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$PORT/login" && break; sleep 1; done

echo "== シナリオを実行"
BASE_URL="http://localhost:$PORT" MOCK_URL="http://127.0.0.1:$MOCK_PORT" node tests/e2e/scenario.mjs
if grep -rq "$DUMMY_KEY" .next-e2e/static 2>/dev/null; then echo "✗ APIキーがブラウザ向けのファイルに含まれています"; exit 1; fi
