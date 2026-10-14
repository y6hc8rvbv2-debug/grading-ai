-- 0017 適用前の確認（読み取りだけ。SELECT 1つ）。結果は件数・有無・ハッシュだけ（学校名・氏名・メール・ID は出さない）
select no, item, value, expected, case when expected like '（%' then null else value = expected end as ok from (values
 (1, '0016 適用済み（prepare_account_deletion 関数がある）',
     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='prepare_account_deletion')::text, '1'),
 (2, '0017 未適用（料金の表6つが無い）',
     (select count(*) from information_schema.tables where table_schema='public'
       and table_name in ('billing_config','billing_worker_state','billing_accounts','billing_usage','billing_orders','night_queue'))::text, '0'),
 (3, '0017 未適用（billing_ で始まる関数が無い）',
     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'billing\_%')::text, '0'),
 (4, '0017 未適用（grading_jobs に課金の列2つが無い）',
     (select count(*) from information_schema.columns where table_schema='public' and table_name='grading_jobs'
       and column_name in ('billing_enforced','opus_charge_accepted'))::text, '0'),
 (5, 'grading_jobs に 0017 が使う列8つがある',
     (select count(*) from information_schema.columns where table_schema='public' and table_name='grading_jobs'
       and column_name in ('school_id','submission_id','created_by','request_id','mode','prev_status','prev_progress','status'))::text, '8'),
 (6, 'grading_stages.job_id がある',
     (select count(*) from information_schema.columns where table_schema='public' and table_name='grading_stages' and column_name='job_id')::text, '1'),
 (7, 'current_school_id 関数がある',
     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='current_school_id')::text, '1'),
 (8, 'grading_jobs・grading_stages に billing_ のトリガーが無い',
     (select count(*) from pg_trigger where tgrelid in ('public.grading_jobs'::regclass,'public.grading_stages'::regclass) and tgname like 'billing\_%' and not tgisinternal)::text, '0'),
 (9, '（参考）拡張 supabase_vault・pg_net の有無（夜間採点の呼び出しで使う。0017 の適用には不要）',
     (select coalesce(string_agg(extname, ',' order by extname), 'なし') from pg_extension where extname in ('supabase_vault','pg_net')), '（参考）'),
 (10, '件数：学校（schools）', (select count(*) from public.schools)::text, '（事後と同じ）'),
 (11, '件数：答案（削除済みを除く）', (select count(*) from public.submissions where deleted_at is null)::text, '（事後と同じ）'),
 (12, '件数：採点の記録（grading_jobs）', (select count(*) from public.grading_jobs)::text, '（事後と同じ）'),
 (13, '件数：モデル実行の記録（grading_stages）', (select count(*) from public.grading_stages)::text, '（事後と同じ）'),
 (14, '学校のプラン（schools.plan）のハッシュ',
     (select md5(coalesce(string_agg(id::text || ':' || coalesce(to_jsonb(s)->>'plan',''), ',' order by id), '')) from public.schools s), '（事後と同じ）'),
 (15, '答案の状態・進み具合のハッシュ',
     (select md5(coalesce(string_agg(id::text || ':' || status::text || ':' || coalesce(progress::text,''), ',' order by id), '')) from public.submissions), '（事後と同じ）'),
 (16, '採点の記録のハッシュ（0017 で足す列2つを除く）',
     (select md5(coalesce(string_agg(md5((to_jsonb(j) - 'billing_enforced' - 'opus_charge_accepted')::text), ',' order by id), '')) from public.grading_jobs j), '（事後と同じ）')
) as t(no, item, value, expected)
order by no;
