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
"${PSQL_APP[@]}" -f supabase/tests/ver6_test.sql
"${PSQL_APP[@]}" -f supabase/tests/security_test.sql
"${PSQL_APP[@]}" -f supabase/tests/workflow_test.sql
echo "== supabase/tests/tutor_test.sql"
"${PSQL_APP[@]}" -f supabase/tests/tutor_test.sql
echo "== supabase/tests/tutor_sweep_test.sql"
"${PSQL_APP[@]}" -f supabase/tests/tutor_sweep_test.sql
echo "== supabase/tests/review_copy_test.sql"
"${PSQL_APP[@]}" -f supabase/tests/review_copy_test.sql
echo "== supabase/tests/account_deletion_test.sql"
"${PSQL_APP[@]}" -f supabase/tests/account_deletion_test.sql
echo "== supabase/tests/billing_test.sql"
"${PSQL_APP[@]}" -o /dev/null -f supabase/tests/billing_test.sql
echo " OK: billing_test（課金の無効/有効・サーバーでの採点の確定・失敗の枠戻し・Opus の支払い前は実行しない・返金待ち・アカウントの削除）"
echo "== supabase/tests/access_test.sql"
"${PSQL_APP[@]}" -f supabase/tests/access_test.sql
echo "== supabase/tests/upgrade_test.sh（本番と同じ順の適用）"
bash supabase/tests/upgrade_test.sh
echo "== supabase/tests/verify_db_test.sh（検証用 DB への適用スクリプト）"
bash supabase/tests/verify_db_test.sh
echo "OK: すべてのテストが通りました"
