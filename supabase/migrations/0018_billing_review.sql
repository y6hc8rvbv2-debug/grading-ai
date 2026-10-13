-- 0018_billing_review.sql：料金表に無い料金ID の契約を「確認待ち」として記録する（0017 の後に適用する）。
-- Stripe から届いた契約の料金ID が、現在の16コースにも確認済みの旧プランの対応表（STRIPE_LEGACY_PLANS_JSON）にも無いとき、
-- アプリは有料の権限を推測で付けず、いまの権限（プラン・上限・状態）も変えずに、ここに記録して管理者に知らせる。
-- 既存の行・列は変えない（列を足すだけ。既定は null）。書き込みはサーバー（service_role）だけ（0017 のポリシーのまま）。
begin;

alter table public.billing_accounts
  add column review_subscription_id text,
  add column review_price_id text,
  add column review_reason text,
  add column review_at timestamptz;

comment on column public.billing_accounts.review_price_id is '料金表に無い料金ID（確認待ち）。対応表に入れて「契約を再確認」すると反映し、空に戻す';

-- 列の権限は表の権限（0017：authenticated は select、service_role は全部）に従う。明示しておく
grant select on public.billing_accounts to authenticated;
grant select, insert, update, delete on public.billing_accounts to service_role;

commit;
