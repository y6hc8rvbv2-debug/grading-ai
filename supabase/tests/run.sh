#!/usr/bin/env bash
# ローカルの PostgreSQL にマイグレーションを流し、RLS テストを実行する。
#   使い方: bash supabase/tests/run.sh
# 前提: PostgreSQL 15 以上が起動していて、postgres スーパーユーザーで接続できること。
set -euo pipefail
cd "$(dirname "$0")/../.."

DB=saiten_test
PSQL_SU=(psql -X -v ON_ERROR_STOP=1 -q -U postgres)
PSQL_APP=(psql -X -v ON_ERROR_STOP=1 -q -U app_owner -h localhost -d "$DB")

"${PSQL_SU[@]}" -d postgres -c "drop database if exists $DB"
"${PSQL_SU[@]}" -d postgres -c "drop role if exists app_owner" -c "drop role if exists anon" \
  -c "drop role if exists authenticated" -c "drop role if exists service_role" 2>/dev/null || true
"${PSQL_SU[@]}" -d postgres -c "create database $DB"
"${PSQL_SU[@]}" -d "$DB" -f supabase/tests/00_supabase_shim.sql
"${PSQL_SU[@]}" -d postgres -c "alter role app_owner password 'app_owner'"

export PGPASSWORD=app_owner
for f in supabase/migrations/*.sql; do
  echo "== $f"
  "${PSQL_APP[@]}" -f "$f"
done

echo "== supabase/tests/rls_test.sql"
"${PSQL_APP[@]}" -f supabase/tests/rls_test.sql
echo "OK: すべてのテストが通りました"
