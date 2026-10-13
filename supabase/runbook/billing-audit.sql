-- 既存の契約の照合（読み取りだけ。Supabase の SQL Editor に貼り付けて実行する）。何も書き換えない。
-- 0001〜0015 だけの DB（0016〜0018 が未適用）でも実行できる（無い表・列は参照しない）。
-- 結果に出すのは件数・適用の有無・プランの区分名だけ。学校名・氏名・メールアドレス・ID・キーは出さない。
--   billing_accounts（0017）の契約は、表があるときだけ、表を名前で参照しない方法（query_to_xml）で件数を数える
with
has_ba as (select to_regclass('public.billing_accounts') is not null as yes),
has_review as (
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'billing_accounts' and column_name = 'review_price_id') as yes),
known(plan_id) as (values
  ('free'),('personal-mini'),('personal-light'),('personal-standard'),('personal-pro'),
  ('personal-mini-night'),('personal-light-night'),('personal-standard-night'),('personal-pro-night'),
  ('school-mini'),('school-light'),('school-standard'),('school-upper'),
  ('school-mini-night'),('school-light-night'),('school-standard-night'),('school-upper-night')),
-- billing_accounts の件数（表が無ければ 0 行）。プランの区分ごとに数えるだけで、行の中身は出さない
ba as (
  select (xpath('/row/plan_id/text()', r))[1]::text as plan_id,
         (xpath('/row/status/text()', r))[1]::text as status,
         coalesce((xpath('/row/n/text()', r))[1]::text, '0')::int as n,
         coalesce((xpath('/row/subs/text()', r))[1]::text, '0')::int as subs
    from has_ba,
         lateral unnest(xpath('/table/row', case when has_ba.yes then query_to_xml(
           'select plan_id, status, count(*) as n, count(subscription_id) as subs from public.billing_accounts group by plan_id, status',
           false, false, '') else '<table/>'::xml end)) as r
)
select 1 as no, '0016 アカウントの削除（prepare_account_deletion 関数）' as what,
       case when exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                          where s.nspname = 'public' and p.proname = 'prepare_account_deletion') then '適用済み' else '未適用' end as value
union all select 2, '0017 料金・採点枠（billing_accounts 表）', case when (select yes from has_ba) then '適用済み' else '未適用（アプリの決済の契約はまだ無い）' end
union all select 3, '0018 確認待ち（review_price_id 列）', case when (select yes from has_review) then '適用済み' else '未適用' end
union all select 4, '以前の学校の区分 schools.plan = ' || coalesce(plan, '（空）'), count(*)::text || '校' from public.schools group by plan
union all select 5, '決済の契約 ' || plan_id || '・' || status
                    || case when plan_id in (select plan_id from known) then '' when plan_id like 'legacy-%' then '（旧プラン）' else '（料金表に無いプラン）' end,
                 n::text || '校（Stripe の契約ID あり ' || subs::text || '）' from ba
union all select 6, '決済の契約の合計', coalesce(sum(n), 0)::text || '校（Stripe の契約ID あり ' || coalesce(sum(subs), 0)::text || '）' from ba
order by 1, 2;
