#!/usr/bin/env bash
# 本番と同じ「0001〜0003 が適用済みでデータがある DB」に 0004〜0013 を足す手順を、手元の PostgreSQL で確かめる（docs/DB-RUNBOOK.md）。
#   - 途中でエラーになったファイルは何も残さない（各ファイルが1つのトランザクション）
#   - 同じファイルを2回流すと2回目はエラーになり、何も変わらない
#   - 0004〜0013 を足しても、既存データの件数・合計が変わらない（supabase/runbook/check.sql で比べる）
#   使い方: bash supabase/tests/upgrade_test.sh（supabase/tests/run.sh から呼ぶ）
set -euo pipefail
cd "$(dirname "$0")/../.."

DB=saiten_upgrade
PSQL_SU=(psql -X -v ON_ERROR_STOP=1 -q -U postgres)
export PGPASSWORD=app_owner
PSQL_APP=(psql -X -v ON_ERROR_STOP=1 -q -U app_owner -h localhost -d "$DB")
fail() { echo "✗ $1"; exit 1; }

"${PSQL_SU[@]}" -d postgres -c "drop database if exists $DB"
"${PSQL_SU[@]}" -d postgres -c "create database $DB"
# ロールは run.sh で作成済み（同じクラスタ）なので、作成のエラーは無視して残り（auth・extensions）を作る
psql -X -q -U postgres -d "$DB" -f supabase/tests/00_supabase_shim.sql >/dev/null 2>&1 || true

# 1. 本番と同じ状態：0001〜0003 と、既存のデータ
for f in supabase/migrations/000[1-3]*.sql; do "${PSQL_APP[@]}" -f "$f"; done
"${PSQL_SU[@]}" -d "$DB" <<'SQL'
with s as (insert into public.schools (name, code) values ('移行確認校', 'UPG-1') returning id),
c as (insert into public.classes (school_id, grade, name, school_year) select id, 2, 'A', 2026 from s returning id, school_id),
st as (insert into public.students (school_id, class_id, number, exam_no, anon_id) select school_id, id, 1, '2A01', '生徒001' from c returning id, school_id, class_id),
t as (insert into public.tests (school_id, name, subject, grade) select id, '既存のテスト', '数学', 2 from s returning id, school_id),
q as (insert into public.questions (school_id, test_id, no, label, qtype, points, correct)
      select school_id, id, n, '大問1-(' || n || ')', 'calc', 5, 'x' from t, generate_series(1, 3) n returning id, school_id, test_id, no),
sub as (insert into public.submissions (school_id, test_id, student_id, class_id, status, progress)
        select t.school_id, t.id, st.id, st.class_id, 'done', 100 from t, st returning id)
insert into public.submission_items (school_id, submission_id, question_id, qno, mark, earned)
select q.school_id, sub.id, q.id, q.no, (case when q.no = 2 then '×' else '○' end)::public.mark_type, case when q.no = 2 then 0 else 5 end from q, sub;
SQL
before=$("${PSQL_APP[@]}" -A -t -f supabase/runbook/check.sql)
echo "$before" | grep -q "^0003|v_qtype_mastery ビュー|t$" || fail "check.sql：0003 が適用済みと出ない"
echo "$before" | grep -q "^0004|save_ai_grading 関数|f$" || fail "check.sql：0004 が未適用と出ない"
echo "✓ 適用前の確認（check.sql）：0001〜0003 は適用済み、0004〜0013 は未適用"

# 2. 途中でエラーになったファイルは何も残さない（0005 の commit の直前でわざと失敗させる）
"${PSQL_APP[@]}" -f supabase/migrations/0004_ai_grading.sql
sed 's/^commit;$/select 1\/0;\ncommit;/' supabase/migrations/0005_model_compare.sql > /tmp/upgrade_0005_fail.sql
if "${PSQL_APP[@]}" -f /tmp/upgrade_0005_fail.sql >/dev/null 2>&1; then fail "わざと失敗させた 0005 が成功した"; fi
[ "$("${PSQL_APP[@]}" -A -t -c "select to_regclass('public.model_compare_runs') is null")" = "t" ] || fail "途中で失敗した 0005 の表が残った"
echo "✓ 途中でエラーになったファイルは、何も残さない（0005 の表は作られていない）"

# 3. 同じファイルを2回流すと、2回目はエラーで止まり、何も変わらない
"${PSQL_APP[@]}" -f supabase/migrations/0005_model_compare.sql
if "${PSQL_APP[@]}" -f supabase/migrations/0005_model_compare.sql >/dev/null 2>&1; then fail "0005 を2回流せてしまった"; fi
[ "$("${PSQL_APP[@]}" -A -t -c "select count(*) from pg_trigger where tgname = 'model_compare_runs_guard'")" = "1" ] || fail "2回目で重複した"
echo "✓ 同じファイルを2回流すと2回目はエラーになり、重複しない"

# 4. 残りを順に適用し、既存データが変わらないこと
for f in supabase/migrations/000[6-9]*.sql supabase/migrations/001[0-3]*.sql; do "${PSQL_APP[@]}" -f "$f"; done
after=$("${PSQL_APP[@]}" -A -t -f supabase/runbook/check.sql)
[ "$(echo "$after" | grep -c '^00[01][0-9]|.*|t$')" = "13" ] || fail "check.sql：0001〜0013 がすべて適用済みと出ない"
counts() { echo "$1" | grep -E '^(学校|教職員|クラス|生徒|テスト|設問|採点基準|答案|答案の設問|監査ログ)\|'; }
[ "$(counts "$before")" = "$(counts "$after")" ] || { echo "$(counts "$before")"; echo "---"; echo "$(counts "$after")"; fail "既存データの件数・合計が変わった"; }
echo "$after" | grep -E '^[a-z_]+\|f\|' && fail "RLS が無効の表がある"
echo "✓ 0004〜0013 を足しても、既存データの件数・合計は同じ。すべての表で RLS が有効"
"${PSQL_SU[@]}" -d postgres -c "drop database $DB"
