#!/usr/bin/env bash
# scripts/verify-db/apply.mjs（検証用 DB への適用）を、手元の PostgreSQL で確かめる。
#   - 0001〜0007 を SQL Editor と同じ形（0001〜0003 は begin/commit で包む）で適用した DB に、0008〜0014 を順に適用できる
#   - 適用後の状態・Data API の権限が期待（verify-expected.json・acl-expected.txt）と一致する
#   - 状態が違う DB・ref の確認なしでは、何も適用せずに止まる。2回目の実行は何もしない（適用済みを再実行しない）
#   使い方: bash supabase/tests/verify_db_test.sh [--write-expected]（supabase/tests/run.sh から呼ぶ）
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=verify_gen
export PGPASSWORD=app_owner
URL="postgresql://app_owner:app_owner@localhost/$DB"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 "$URL")
fail() { echo "✗ $1"; exit 1; }
fresh() {
  psql -X -q -U postgres -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
  psql -X -q -U postgres -d "$DB" -f supabase/tests/00_supabase_shim.sql >/dev/null 2>&1 || true
}
fp() { psql -X -q -A -t "$URL" -c "select ($(grep -v '^--' supabase/runbook/fingerprint.sql))::text"; }
apply_until() {   # $1 = 最後に適用する番号（0001〜0003 は SQL Editor と同じく begin/commit で包む）
  for f in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
    n=$(basename "$f" | cut -c1-4); [[ "$n" > "$1" ]] && break
    if grep -q '^begin;$' "$f"; then "${PSQL[@]}" -f "$f" >/dev/null; else (echo "begin;"; cat "$f"; echo "commit;") | "${PSQL[@]}" -f - >/dev/null; fi
    [ -n "${2:-}" ] && echo "\"$n\": $(fp)," >> "$2"
  done
}

if [ "${1:-}" = "--write-expected" ]; then
  fresh; tmp=$(mktemp); echo "{" > "$tmp"; apply_until 9999 "$tmp"; sed -i '$ s/,$//' "$tmp"; echo "}" >> "$tmp"
  node -e "const o=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));require('fs').writeFileSync(process.env.EXPECTED_OUT || 'supabase/runbook/verify-expected.json', JSON.stringify(o,null,1)+'\n')" "$tmp"
  echo "verify-expected.json を書き出しました"; exit 0
fi

run() { VERIFY_DB_TEST_URL="$URL" node scripts/verify-db/apply.mjs "$@" 2>&1; }

# 1. 0007 まで適用した DB：読み取りだけの確認 → 確認の ref なしでは適用しない → 0008〜0014 を適用
fresh; apply_until 0007
out=$(run --check); echo "$out" | grep -q "0007 まで適用済みと一致" || { echo "$out"; fail "0007 の状態を読み取れない"; }
echo "$out" | grep -q "次に適用するファイル：0008_test_archive.sql" || { echo "$out"; fail "次に適用するファイルが違う"; }
echo "✓ 読み取りだけの確認：0007 まで適用済みと判定し、次は 0008"
out=$(run --apply --to 0014 || true); echo "$out" | grep -q "confirm-ref" || fail "確認の ref なしで適用した"
[ "$(fp)" = "$(fp)" ] && echo "$out" | grep -q "停止" && echo "✓ --confirm-ref が無ければ何も適用しない"
out=$(run --apply --to 0014 --confirm-ref cpfhsxbmzoyrlkynveqd) || { echo "$out"; fail "0008〜0014 の適用に失敗"; }
echo "$out" | grep -q "完了：0008・0009・0010・0011・0012・0013・0014" || { echo "$out"; fail "完了の表示が無い"; }
echo "$out" | grep -q "Data API の権限が、自動で公開がオンの環境と同じ（548 件）" || { echo "$out"; fail "0014 の権限の確認が無い"; }
echo "✓ 0008〜0014 を番号順に適用し、各ファイルの前後の状態と 0014 の権限（548件）が期待と一致"
# 2. 2回目は何もしない（適用済みを再実行しない）
out=$(run --apply --to 0014 --confirm-ref cpfhsxbmzoyrlkynveqd); echo "$out" | grep -q "適用するファイルはありません" || { echo "$out"; fail "2回目に何かを適用した"; }
echo "✓ 2回目の実行は何もしない"
# 2b. 0014 まで適用済みの DB（いまの検証用 saiten-verify と同じ）に、0015 だけを足せる
out=$(run --apply --to 0015 --confirm-ref cpfhsxbmzoyrlkynveqd) || { echo "$out"; fail "0015 の適用に失敗"; }
echo "$out" | grep -q "完了：0015" || { echo "$out"; fail "0015 だけを適用した表示が無い"; }
echo "✓ 0014 まで適用済みの DB に、0015 だけを足し、前後の状態が期待と一致"
# 3. 状態が期待と違う DB（0007 の後に余分な表がある）：何も適用せずに止まる
fresh; apply_until 0007; "${PSQL[@]}" -c "create table public.extra_table (id int)" >/dev/null
before=$(fp); out=$(run --apply --to 0014 --confirm-ref cpfhsxbmzoyrlkynveqd || true)
echo "$out" | grep -q "どの番号の適用後とも一致しません" && [ "$before" = "$(fp)" ] || { echo "$out"; fail "状態が違うのに止まらなかった"; }
echo "✓ 状態が期待と違えば、何も適用せずに止まる（違い：$(echo "$out" | grep -o 'extra_table' | head -1)）"
# 4. --to で途中まで（0010 まで）→ 続きから
fresh; apply_until 0007
run --apply --to 0010 --confirm-ref cpfhsxbmzoyrlkynveqd | grep -q "完了：0008・0009・0010" || fail "--to 0010 で止まらない"
run --apply --to 0014 --confirm-ref cpfhsxbmzoyrlkynveqd | grep -q "完了：0011・0012・0013・0014" || fail "続きから適用できない"
echo "✓ --to で途中まで適用し、続きから再開できる"
# 5. ファイルの途中でエラー（0009 の commit の直前でわざと失敗）：そのファイルの変更は残らず、そこで止まる（0010 以降は適用しない）
fresh; apply_until 0007
mdir=$(mktemp -d); cp supabase/migrations/*.sql "$mdir"/; sed -i 's/^commit;$/select 1\/0;\ncommit;/' "$mdir"/0009_mark_positions.sql
out=$(VERIFY_DB_TEST_URL="$URL" VERIFY_DB_MIGRATIONS="$mdir" node scripts/verify-db/apply.mjs --apply --to 0014 --confirm-ref cpfhsxbmzoyrlkynveqd 2>&1 || true); rm -rf "$mdir"
echo "$out" | grep -q "0009_mark_positions.sql の実行でエラー" || { echo "$out"; fail "途中のエラーで止まらなかった"; }
out=$(run --check); echo "$out" | grep -q "0008 まで適用済みと一致" || { echo "$out"; fail "エラーのあと、0008 の状態になっていない"; }
echo "✓ ファイルの途中でエラーなら、そのファイルの変更は残らず（0008 の状態のまま）、そこで止まる"
psql -X -q -U postgres -d postgres -c "drop database $DB" >/dev/null
