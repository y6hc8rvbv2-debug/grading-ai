-- 0016 適用後の確認（読み取りだけ。SELECT 1つ）。10〜13 は適用前の結果と同じ値になること
select no, item, value, expected, case when expected like '（%' then null else value = expected end as ok from (values
 (1, 'prepare_account_deletion 関数がある（security definer）',
     (select string_agg(prosecdef::text, ',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='prepare_account_deletion'), 'true'),
 (2, 'prepare_account_deletion：ログイン済みは実行できる・未ログインはできない',
     has_function_privilege('authenticated','public.prepare_account_deletion()','execute')::text || '/' || has_function_privilege('anon','public.prepare_account_deletion()','execute')::text, 'true/false'),
 (3, 'purge_submissions：サーバーだけ実行できる（service_role/authenticated/anon）',
     has_function_privilege('service_role','public.purge_submissions(uuid[])','execute')::text || '/' || has_function_privilege('authenticated','public.purge_submissions(uuid[])','execute')::text
     || '/' || has_function_privilege('anon','public.purge_submissions(uuid[])','execute')::text, 'true/false/false'),
 (4, 'intake_scans.created_by は空にできる（YES）',
     (select is_nullable from information_schema.columns where table_schema='public' and table_name='intake_scans' and column_name='created_by'), 'YES'),
 (5, 'result_releases.released_by は空にできる（YES）',
     (select is_nullable from information_schema.columns where table_schema='public' and table_name='result_releases' and column_name='released_by'), 'YES'),
 (6, '外部キー intake_scans_created_by_fkey の削除時（n=空にする）・参照先',
     (select confdeltype::text || ' ' || confrelid::regclass::text from pg_constraint where conname='intake_scans_created_by_fkey' and conrelid='public.intake_scans'::regclass), 'n auth.users'),
 (7, '外部キー result_releases_released_by_fkey の削除時（n=空にする）・参照先',
     (select confdeltype::text || ' ' || confrelid::regclass::text from pg_constraint where conname='result_releases_released_by_fkey' and conrelid='public.result_releases'::regclass), 'n auth.users'),
 (8, 'result_releases_enrich は 0016 の版（返却者だけを空にする更新では内容を変えない）',
     (select (position('old.released_by is not null' in prosrc) > 0)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='result_releases_enrich'), 'true'),
 (9, '返却内容の補完のトリガーが付いている',
     (select count(*) from pg_trigger where tgrelid='public.result_releases'::regclass and tgname='result_releases_enrich' and not tgisinternal)::text, '1'),
 (10, '件数：返却（result_releases）', (select count(*) from public.result_releases)::text, '（事前と同じ）'),
 (11, '件数：取り込み（intake_scans）', (select count(*) from public.intake_scans)::text, '（事前と同じ）'),
 (12, '件数：答案（削除済みを除く）', (select count(*) from public.submissions where deleted_at is null)::text, '（事前と同じ）'),
 (13, '返却内容・版のハッシュ', (select md5(coalesce(string_agg(md5(payload::text) || version::text, ',' order by id), '')) from public.result_releases), '（事前と同じ）')
) as t(no, item, value, expected)
order by no;
