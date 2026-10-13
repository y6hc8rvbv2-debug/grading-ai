-- 0016 適用前の確認（読み取りだけ。SELECT 1つ）。結果は件数・有無・ハッシュだけ（学校名・氏名・メール・ID は出さない）
select no, item, value, expected, case when expected like '（%' then null else value = expected end as ok from (values
 (1, '0015 適用済み（schools.review_copy_enabled 列）',
     (select count(*) from information_schema.columns where table_schema='public' and table_name='schools' and column_name='review_copy_enabled')::text, '1'),
 (2, '0016 未適用（prepare_account_deletion 関数が無い）',
     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='prepare_account_deletion')::text, '0'),
 (3, '0016 未適用（purge_submissions 関数が無い）',
     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='purge_submissions')::text, '0'),
 (4, 'intake_scans.created_by は空にできない（NO）',
     (select is_nullable from information_schema.columns where table_schema='public' and table_name='intake_scans' and column_name='created_by'), 'NO'),
 (5, 'result_releases.released_by は空にできない（NO）',
     (select is_nullable from information_schema.columns where table_schema='public' and table_name='result_releases' and column_name='released_by'), 'NO'),
 (6, '外部キー intake_scans_created_by_fkey の削除時（a=何もしない）',
     (select confdeltype::text from pg_constraint where conname='intake_scans_created_by_fkey' and conrelid='public.intake_scans'::regclass), 'a'),
 (7, '外部キー result_releases_released_by_fkey の削除時（a=何もしない）',
     (select confdeltype::text from pg_constraint where conname='result_releases_released_by_fkey' and conrelid='public.result_releases'::regclass), 'a'),
 (8, 'result_releases_enrich は 0012 の版（返却者だけを空にする場合の処理が無い）',
     (select (position('old.released_by is not null' in prosrc) = 0)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='result_releases_enrich'), 'true'),
 (9, '返却内容の補完のトリガーが付いている',
     (select count(*) from pg_trigger where tgrelid='public.result_releases'::regclass and tgname='result_releases_enrich' and not tgisinternal)::text, '1'),
 (10, '件数：返却（result_releases）', (select count(*) from public.result_releases)::text, '（事後と同じ）'),
 (11, '件数：取り込み（intake_scans）', (select count(*) from public.intake_scans)::text, '（事後と同じ）'),
 (12, '件数：答案（削除済みを除く）', (select count(*) from public.submissions where deleted_at is null)::text, '（事後と同じ）'),
 (13, '返却内容・版のハッシュ', (select md5(coalesce(string_agg(md5(payload::text) || version::text, ',' order by id), '')) from public.result_releases), '（事後と同じ）')
) as t(no, item, value, expected)
order by no;
