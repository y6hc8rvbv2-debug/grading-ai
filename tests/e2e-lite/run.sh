#!/usr/bin/env bash
# Docker を使わない画面テスト：「本人の ChatGPT で復習」（B方式）をスマホ幅のブラウザで通しで確かめる。
#
#   使い方: npm run test:e2e:lite（root で実行する場合は postgres ユーザーで DB を動かす）
#
# 構成（すべて手元。本物の AI・Supabase のクラウドは使わない）
#   - 専用の PostgreSQL（一時フォルダに作る。ポート 5433）に、Supabase の土台の代役（supabase/tests/00_supabase_shim.sql）と
#     supabase/migrations を全部適用し、tests/e2e-lite/seed.sql で先生の操作（配信先の登録・教師確認・本人への返却）まで行う
#   - 本物の PostgREST（RLS は本物）。無ければ公式の配布物（v12.2.3）を取得して sha256 を確かめる（POSTGREST_BIN で指定も可）
#   - tests/e2e-lite/gateway.mjs：ログイン・答案画像の部分だけの代役
#   - 採点AI・OpenAI の宛先は「罠」のサーバーに向け、1回でも要求が来たら失敗にする
#   - アプリは、暗号鍵・CRON_SECRET・service_role・API キーを一切渡さずに起動する（B方式がそれらなしで動くことの確認）
set -euo pipefail
cd "$(dirname "$0")/../.."

PG_PORT=${LITE_PG_PORT:-5433}
REST_PORT=${LITE_REST_PORT:-54398}
GW_PORT=${LITE_GATEWAY_PORT:-54399}
TRAP_PORT=${LITE_TRAP_PORT:-54397}
APP_PORT=${LITE_APP_PORT:-3300}
for p in "$PG_PORT" "$REST_PORT" "$GW_PORT" "$TRAP_PORT" "$APP_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "✗ ポート $p が使用中です"; exit 1; fi
done

WORK=$(mktemp -d /tmp/saiten-e2e-lite.XXXXXX)
PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
[ -n "$PGBIN" ] || { echo "✗ PostgreSQL（initdb）が見つかりません"; exit 1; }
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"

PIDS=()
cleanup() {
  for p in "${PIDS[@]}"; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done
  as_pg "$PGBIN/pg_ctl -D $WORK/pg -m fast stop" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== 専用の PostgreSQL を起動（$WORK、ポート $PG_PORT）"
as_pg "$PGBIN/initdb -D $WORK/pg --auth=trust -U postgres -E UTF8 --locale=C.UTF-8" >/dev/null
as_pg "$PGBIN/pg_ctl -D $WORK/pg -o '-p $PG_PORT -k $WORK -c listen_addresses=127.0.0.1' -l $WORK/pg.log -w start" >/dev/null
SU=(psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PG_PORT" -U postgres)
APPDB=(psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PG_PORT" -U app_owner -d lite)
"${SU[@]}" -d postgres -c "create database lite"
"${SU[@]}" -d lite -f supabase/tests/00_supabase_shim.sql >/dev/null

echo "== マイグレーションを全部適用（0001〜）"
for f in supabase/migrations/*.sql; do "${APPDB[@]}" -f "$f" >/dev/null; done
"${SU[@]}" -d lite -c "create role authenticator login noinherit; grant anon, authenticated, service_role to authenticator;"
echo "== 初期データ（配信先の登録・教師確認・本人への返却まで本物の関数で）"
"${SU[@]}" -d lite -f tests/e2e-lite/seed.sql >/dev/null

echo "== PostgREST を起動"
POSTGREST_BIN=${POSTGREST_BIN:-}
if [ -z "$POSTGREST_BIN" ]; then
  curl -sSL -o "$WORK/pgrst.tar.xz" https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
  echo "9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c  $WORK/pgrst.tar.xz" | sha256sum -c --quiet
  tar -xJf "$WORK/pgrst.tar.xz" -C "$WORK"
  POSTGREST_BIN="$WORK/postgrest"
fi
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
PGRST_DB_URI="postgres://authenticator@127.0.0.1:$PG_PORT/lite" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
  PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT="$REST_PORT" PGRST_SERVER_HOST=127.0.0.1 \
  "$POSTGREST_BIN" > "$WORK/postgrest.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 30); do curl -sf -o /dev/null "http://127.0.0.1:$REST_PORT/" && break; sleep 1; done

echo "== ログイン・画像の代役と、AI の宛先の罠を起動"
LITE_USERS='{"admin@lite.example":{"id":"eeeeeeee-0000-0000-0000-000000000001","password":"pass-lite-123"},"stu-a@lite.example":{"id":"eeeeeeee-0000-0000-0000-000000000002","password":"pass-lite-123"},"stu-b@lite.example":{"id":"eeeeeeee-0000-0000-0000-000000000003","password":"pass-lite-123"}}'
GATEWAY_PORT="$GW_PORT" POSTGREST_URL="http://127.0.0.1:$REST_PORT" JWT_SECRET="$JWT_SECRET" LITE_USERS="$LITE_USERS" \
  node tests/e2e-lite/gateway.mjs > "$WORK/gateway.log" 2>&1 &
PIDS+=($!)
node -e "
  const hits = [];
  require('http').createServer((q, s) => { if (q.url === '/__hits') { s.end(JSON.stringify(hits)); return; } hits.push(q.method + ' ' + q.url); s.writeHead(500); s.end('{}'); })
    .listen($TRAP_PORT, '127.0.0.1');" > "$WORK/trap.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 20); do curl -sf -o /dev/null "http://127.0.0.1:$GW_PORT/__requests" && curl -sf -o /dev/null "http://127.0.0.1:$TRAP_PORT/__hits" && break; sleep 0.5; done

echo "== アプリをビルドして起動（.next-lite。暗号鍵・CRON_SECRET・service_role・API キーは渡さない）"
ANON=$(JWT_SECRET="$JWT_SECRET" node -e "
  const c = require('crypto'); const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ role: 'anon', exp: Math.floor(Date.now() / 1000) + 86400 });
  console.log(h + '.' + p + '.' + c.createHmac('sha256', process.env.JWT_SECRET).update(h + '.' + p).digest('base64url'));")
CLEAN_ENV=(env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u TUTOR_KEY_ENCRYPTION_KEY -u CRON_SECRET -u SUPABASE_SERVICE_ROLE_KEY -u TUTOR_INAPP -u TUTOR_FEATURE)
"${CLEAN_ENV[@]}" NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$GW_PORT" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON" NEXT_TELEMETRY_DISABLED=1 NEXT_DIST_DIR=.next-lite \
  node_modules/.bin/next build >/dev/null
"${CLEAN_ENV[@]}" NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$GW_PORT" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON" NEXT_TELEMETRY_DISABLED=1 NEXT_DIST_DIR=.next-lite \
  ANTHROPIC_BASE_URL="http://127.0.0.1:$TRAP_PORT" TUTOR_OPENAI_BASE_URL="http://127.0.0.1:$TRAP_PORT/v1" \
  node_modules/.bin/next start -p "$APP_PORT" > "$WORK/app.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$APP_PORT/login" && break; sleep 1; done

echo "== シナリオ（tests/e2e-lite/review-copy.mjs）"
BASE_URL="http://localhost:$APP_PORT" GATEWAY_URL="http://127.0.0.1:$GW_PORT" TRAP_URL="http://127.0.0.1:$TRAP_PORT" \
  node tests/e2e-lite/review-copy.mjs || { echo "--- app.log"; tail -40 "$WORK/app.log"; echo "--- postgrest.log"; tail -20 "$WORK/postgrest.log"; exit 1; }
