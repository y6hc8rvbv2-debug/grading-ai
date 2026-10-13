-- 既存の契約の照合（読み取りだけ。Supabase の SQL Editor で実行できる）。何も書き換えない。
-- 0017 を適用していない DB では「billing_accounts が無い」と出る（＝アプリの決済の契約はまだ1件も無い）。
-- 結果の見方：
--   1. 表の有無：0017（料金・採点枠）・0018（確認待ち）が適用済みか
--   2. プラン別の件数：plan_id が現在の16コース・free・legacy-… 以外なら「料金表に無いプラン」
--   3. 契約ID のある学校：Stripe の契約（subscription）と照合する（npm run billing:audit、または Stripe の画面）
--   4. 以前の学校の契約（schools.plan）：Stripe とは別の、決済を入れる前の区分（free・school・board）
select 'billing_accounts の表' as what, (to_regclass('public.billing_accounts') is not null)::text as value
union all
select '確認待ちの列（0018）', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'billing_accounts' and column_name = 'review_price_id')::text
union all
select 'schools.plan = ' || plan, count(*)::text from public.schools group by plan;

-- 0017 を適用済みのときだけ、続けて次を実行する
-- select plan_id, status, count(*) as schools, count(subscription_id) as with_subscription
--   from public.billing_accounts group by plan_id, status order by 1, 2;
-- select school_id, plan_id, status, subscription_id, period_end
--   from public.billing_accounts
--  where plan_id not in ('free','personal-mini','personal-light','personal-standard','personal-pro',
--                        'personal-mini-night','personal-light-night','personal-standard-night','personal-pro-night',
--                        'school-mini','school-light','school-standard','school-upper',
--                        'school-mini-night','school-light-night','school-standard-night','school-upper-night')
--     or subscription_id is not null;
