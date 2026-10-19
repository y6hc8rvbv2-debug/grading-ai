-- 0018 適用前の確認（読み取りだけ。SELECT 1つ）。結果は件数・有無・ハッシュだけ（学校名・契約ID・料金ID は出さない）
select no, item, value, expected, case when expected like '（%' then null else value = expected end as ok from (values
 (1, '0017 適用済み（料金の表6つがある）',
     (select count(*) from information_schema.tables where table_schema='public'
       and table_name in ('billing_config','billing_worker_state','billing_accounts','billing_usage','billing_orders','night_queue'))::text, '6'),
 (2, '0018 未適用（billing_accounts に確認待ちの列4つが無い）',
     (select count(*) from information_schema.columns where table_schema='public' and table_name='billing_accounts'
       and column_name in ('review_subscription_id','review_price_id','review_reason','review_at'))::text, '0'),
 (3, '課金は無効のまま（billing_config.enabled）',
     (select coalesce(string_agg(enabled::text, ','), 'なし') from public.billing_config), 'false'),
 (4, 'billing_accounts で RLS が有効',
     (select relrowsecurity::text from pg_class where oid='public.billing_accounts'::regclass), 'true'),
 (5, 'billing_accounts の RLS ポリシー4つ',
     (select count(*) from pg_policies where schemaname='public' and tablename='billing_accounts')::text, '4'),
 (6, '表の権限：ログイン済みは読めるが書けない・未ログインは読めない・サーバーは更新できる（select/update/anon/service_role）',
     has_table_privilege('authenticated','public.billing_accounts','select')::text || '/' || has_table_privilege('authenticated','public.billing_accounts','update')::text
     || '/' || has_table_privilege('anon','public.billing_accounts','select')::text || '/' || has_table_privilege('service_role','public.billing_accounts','update')::text,
     'true/false/false/true'),
 (7, '件数：契約（billing_accounts）', (select count(*) from public.billing_accounts)::text, '（事後と同じ）'),
 (8, '契約の内容のハッシュ（0018 で足す列4つを除く）',
     (select md5(coalesce(string_agg(md5((to_jsonb(a) - 'review_subscription_id' - 'review_price_id' - 'review_reason' - 'review_at')::text), ',' order by school_id), ''))
       from public.billing_accounts a), '（事後と同じ）'),
 (9, '件数：採点枠・注文・夜間予約（usage/orders/night_queue）',
     (select count(*) from public.billing_usage)::text || '/' || (select count(*) from public.billing_orders)::text || '/' || (select count(*) from public.night_queue)::text, '（事後と同じ）'),
 (10, '学校のプラン（schools.plan）のハッシュ',
     (select md5(coalesce(string_agg(id::text || ':' || coalesce(to_jsonb(s)->>'plan',''), ',' order by id), '')) from public.schools s), '（事後と同じ）')
) as t(no, item, value, expected)
order by no;
