-- ============================================================================
-- 本番 DB の確認（読み取り専用）：適用済みのマイグレーションと、データの件数・合計
--   適用の前と後に1回ずつ実行し、結果を保存して比べる（docs/DB-RUNBOOK.md）
--   read only のトランザクションなので、何も書き換えない
-- ============================================================================
begin transaction read only;

-- 1. どのマイグレーションまで適用済みか（各ファイルで最初に作られるものがあるかで判定）
select m.no as "番号", m.what as "目印", m.applied as "適用済み"
from (values
  ('0001', 'schools 表',                       to_regclass('public.schools') is not null),
  ('0002', 'submission_links 表',              to_regclass('public.submission_links') is not null),
  ('0003', 'v_qtype_mastery ビュー',           to_regclass('public.v_qtype_mastery') is not null),
  ('0004', 'save_ai_grading 関数',             exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_ai_grading')),
  ('0005', 'model_compare_runs 表',            to_regclass('public.model_compare_runs') is not null),
  ('0006', 'grading_jobs 表',                  to_regclass('public.grading_jobs') is not null),
  ('0007', 'test_imports 表',                  to_regclass('public.test_imports') is not null),
  ('0008', 'tests.archived_at 列',             exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tests' and column_name = 'archived_at')),
  ('0009', 'mark_positions 表',                to_regclass('public.mark_positions') is not null),
  ('0010', 'result_releases 表',               to_regclass('public.result_releases') is not null),
  ('0011', 'publish_submission_result 関数',   exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'publish_submission_result')),
  ('0012', 'tutor_sessions 表',                to_regclass('public.tutor_sessions') is not null),
  ('0013', 'tutor_call_secrets 表',            to_regclass('public.tutor_call_secrets') is not null),
  -- 0014 は権限だけを付ける。「自動で公開」がオンの環境では 0014 の前から true になる（それで正しい）
  ('0014', 'authenticated が grading_jobs を読める権限', to_regclass('public.grading_jobs') is not null and has_table_privilege('authenticated', 'public.grading_jobs', 'SELECT')),
  ('0015', 'schools.review_copy_enabled 列',  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'schools' and column_name = 'review_copy_enabled')),
  ('0016', 'prepare_account_deletion 関数',     exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'prepare_account_deletion'))
) as m(no, what, applied)
order by 1;

-- 2. 既存データの件数と合計（適用の前後で同じであること。0004〜0013 は既存の行を消さない・書き換えない）
select '学校' as "表", count(*) as "件数", null::numeric as "合計" from public.schools
union all select '教職員', count(*), null from public.profiles
union all select 'クラス', count(*), null from public.classes
union all select '生徒', count(*), null from public.students
union all select 'テスト', count(*), null from public.tests
union all select '設問', count(*), sum(points) from public.questions
union all select '採点基準', count(*), null from public.rubrics
union all select '答案', count(*), sum(total_score) from public.submissions
union all select '答案の設問', count(*), sum(earned) from public.submission_items
union all select '監査ログ', count(*), null from public.audit_logs;

-- 3. 行レベルセキュリティ（RLS）が有効で、ポリシーがそろっているか（新しい表も含む）
select c.relname as "表", c.relrowsecurity as "RLS 有効", count(p.polname) as "ポリシー数"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_policy p on p.polrelid = c.oid
where c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relrowsecurity, c.relname;

rollback;
