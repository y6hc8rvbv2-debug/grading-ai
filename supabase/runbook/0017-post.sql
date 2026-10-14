-- 0017 適用後の確認（読み取りだけ。SELECT 1つ）。14〜20 は適用前の結果と同じ値になること
select no, item, value, expected, case when expected like '（%' then null else value = expected end as ok from (values
 (1, '料金の表6つがある',
     (select count(*) from information_schema.tables where table_schema='public'
       and table_name in ('billing_config','billing_worker_state','billing_accounts','billing_usage','billing_orders','night_queue'))::text, '6'),
 (2, '料金の表6つすべてで RLS が有効',
     (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity
       and c.relname in ('billing_config','billing_worker_state','billing_accounts','billing_usage','billing_orders','night_queue'))::text, '6'),
 (3, '課金は無効のまま（billing_config.enabled）',
     (select coalesce(string_agg(enabled::text, ','), 'なし') from public.billing_config), 'false'),
 (4, 'billing_worker_state は1行',
     (select count(*) from public.billing_worker_state)::text, '1'),
 (5, '契約・枠・注文・夜間予約の行は0件（accounts/usage/orders/night_queue）',
     (select count(*) from public.billing_accounts)::text || '/' || (select count(*) from public.billing_usage)::text
     || '/' || (select count(*) from public.billing_orders)::text || '/' || (select count(*) from public.night_queue)::text, '0/0/0/0'),
 (6, 'grading_jobs の列の既定値（billing_enforced/opus_charge_accepted）',
     (select string_agg(coalesce(column_default,'なし'), '/' order by column_name) from information_schema.columns
       where table_schema='public' and table_name='grading_jobs' and column_name in ('billing_enforced','opus_charge_accepted')), 'true/false'),
 (7, '既存の採点の記録は課金の対象外のまま（billing_enforced=true の件数）',
     (select count(*) from public.grading_jobs where billing_enforced)::text, '0'),
 (8, 'grading_jobs のトリガー4つ・grading_stages のトリガー1つ',
     (select count(*) from pg_trigger where tgrelid='public.grading_jobs'::regclass and not tgisinternal
       and tgname in ('billing_reserve','billing_guard','billing_protect_job_delete','billing_complete'))::text || '/'
     || (select count(*) from pg_trigger where tgrelid='public.grading_stages'::regclass and not tgisinternal and tgname='billing_protect_stage')::text, '4/1'),
 (9, 'billing_ の関数9つ（うち security definer の数）',
     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'billing\_%')::text || '/'
     || (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'billing\_%' and p.prosecdef)::text, '9/9'),
 (10, 'サーバー専用の関数：ログイン済み・未ログインは実行できない（実行できる数）',
     (select count(*) from (values ('public.billing_start_job(uuid,uuid,uuid,uuid,text,boolean,boolean)'),('public.billing_claim_queue()'),
       ('public.billing_worker_ping(text)'),('public.billing_reserve()'),('public.billing_guard()'),('public.billing_protect_job_delete()'),
       ('public.billing_protect_stage()'),('public.billing_complete()')) f(sig), (values ('authenticated'),('anon')) r(role)
       where has_function_privilege(r.role, f.sig, 'execute'))::text, '0'),
 (11, 'billing_start_job・billing_claim_queue はサーバー（service_role）が実行できる',
     has_function_privilege('service_role','public.billing_start_job(uuid,uuid,uuid,uuid,text,boolean,boolean)','execute')::text || '/'
     || has_function_privilege('service_role','public.billing_claim_queue()','execute')::text, 'true/true'),
 (12, 'billing_is_enabled：ログイン済みは実行できる・未ログインはできない',
     has_function_privilege('authenticated','public.billing_is_enabled()','execute')::text || '/' || has_function_privilege('anon','public.billing_is_enabled()','execute')::text, 'true/false'),
 (13, '表の権限：ログイン済みは契約を読めるが書けない・設定は読めない・未ログインは読めない（select/insert/config/anon）',
     has_table_privilege('authenticated','public.billing_accounts','select')::text || '/' || has_table_privilege('authenticated','public.billing_accounts','insert')::text
     || '/' || has_table_privilege('authenticated','public.billing_config','select')::text || '/' || has_table_privilege('anon','public.billing_accounts','select')::text,
     'true/false/false/false'),
 (14, '件数：学校（schools）', (select count(*) from public.schools)::text, '（事前と同じ）'),
 (15, '件数：答案（削除済みを除く）', (select count(*) from public.submissions where deleted_at is null)::text, '（事前と同じ）'),
 (16, '件数：採点の記録（grading_jobs）', (select count(*) from public.grading_jobs)::text, '（事前と同じ）'),
 (17, '件数：モデル実行の記録（grading_stages）', (select count(*) from public.grading_stages)::text, '（事前と同じ）'),
 (18, '学校のプラン（schools.plan）のハッシュ',
     (select md5(coalesce(string_agg(id::text || ':' || coalesce(to_jsonb(s)->>'plan',''), ',' order by id), '')) from public.schools s), '（事前と同じ）'),
 (19, '答案の状態・進み具合のハッシュ',
     (select md5(coalesce(string_agg(id::text || ':' || status::text || ':' || coalesce(progress::text,''), ',' order by id), '')) from public.submissions), '（事前と同じ）'),
 (20, '採点の記録のハッシュ（0017 で足した列2つを除く）',
     (select md5(coalesce(string_agg(md5((to_jsonb(j) - 'billing_enforced' - 'opus_charge_accepted')::text), ',' order by id), '')) from public.grading_jobs j), '（事前と同じ）'),
 (21, '0017 で作った契約・課金の行への RLS ポリシー（4表×4つ）',
     (select count(*) from pg_policies where schemaname='public' and tablename in ('billing_accounts','billing_usage','billing_orders','night_queue'))::text, '16')
) as t(no, item, value, expected)
order by no;
