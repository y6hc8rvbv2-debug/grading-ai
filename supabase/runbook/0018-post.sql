-- 0018 適用後の確認（読み取りだけ。SELECT 1つ）。7〜10 は適用前の 7〜10 と同じ値になること
select no, item, value, expected, case when expected like '（%' then null else value = expected end as ok from (values
 (1, 'billing_accounts に確認待ちの列4つがある',
     (select count(*) from information_schema.columns where table_schema='public' and table_name='billing_accounts'
       and column_name in ('review_subscription_id','review_price_id','review_reason','review_at'))::text, '4'),
 (2, '4列の型（review_at/review_price_id/review_reason/review_subscription_id）',
     (select string_agg(data_type, '/' order by column_name) from information_schema.columns where table_schema='public' and table_name='billing_accounts'
       and column_name in ('review_subscription_id','review_price_id','review_reason','review_at')), 'timestamp with time zone/text/text/text'),
 (3, '4列とも空にでき、既定値なし（空にできる列の数/既定値のある列の数）',
     (select count(*) filter (where is_nullable='YES')::text || '/' || count(*) filter (where column_default is not null)::text
       from information_schema.columns where table_schema='public' and table_name='billing_accounts'
       and column_name in ('review_subscription_id','review_price_id','review_reason','review_at')), '4/0'),
 (4, '既存の契約で確認待ちの値が入っている行は0件',
     (select count(*) from public.billing_accounts
       where review_subscription_id is not null or review_price_id is not null or review_reason is not null or review_at is not null)::text, '0'),
 (5, 'review_price_id の説明（コメント）がある',
     (col_description('public.billing_accounts'::regclass,
       (select attnum from pg_attribute where attrelid='public.billing_accounts'::regclass and attname='review_price_id')) is not null)::text, 'true'),
 (6, '権限・RLS は変わらない（select/update/anon/service_role・RLS・ポリシー数・課金の有効）',
     has_table_privilege('authenticated','public.billing_accounts','select')::text || '/' || has_table_privilege('authenticated','public.billing_accounts','update')::text
     || '/' || has_table_privilege('anon','public.billing_accounts','select')::text || '/' || has_table_privilege('service_role','public.billing_accounts','update')::text
     || '・' || (select relrowsecurity::text from pg_class where oid='public.billing_accounts'::regclass)
     || '・' || (select count(*) from pg_policies where schemaname='public' and tablename='billing_accounts')::text
     || '・' || (select coalesce(string_agg(enabled::text, ','), 'なし') from public.billing_config),
     'true/false/false/true・true・4・false'),
 (7, '件数：契約（billing_accounts）', (select count(*) from public.billing_accounts)::text, '（事前と同じ）'),
 (8, '契約の内容のハッシュ（0018 で足した列4つを除く）',
     (select md5(coalesce(string_agg(md5((to_jsonb(a) - 'review_subscription_id' - 'review_price_id' - 'review_reason' - 'review_at')::text), ',' order by school_id), ''))
       from public.billing_accounts a), '（事前と同じ）'),
 (9, '件数：採点枠・注文・夜間予約（usage/orders/night_queue）',
     (select count(*) from public.billing_usage)::text || '/' || (select count(*) from public.billing_orders)::text || '/' || (select count(*) from public.night_queue)::text, '（事前と同じ）'),
 (10, '学校のプラン（schools.plan）のハッシュ',
     (select md5(coalesce(string_agg(id::text || ':' || coalesce(to_jsonb(s)->>'plan',''), ',' order by id), '')) from public.schools s), '（事前と同じ）')
) as t(no, item, value, expected)
order by no;
