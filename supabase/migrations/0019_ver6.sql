-- ============================================================================
-- 0019_ver6.sql : テスト採点ver6 の追加分（0018 の後に適用する）
--
--   1. ai_settings      … 学校ごとの AIエンジン（段階ごとのモデル）と同時に採点する枚数
--   2. submission_links … 生徒のタブレット・スマホから答案を提出するリンク（0002 の表に列を足す）
--      link_uploads     … リンクから届いた提出の記録（だれが・いつ・どの答案）
--   3. billing_prepaid  … 前払い（コンビニ・PayPay・暗号資産など）で買った利用期間
--
-- 既存の行は変えない（列は既定値つきで追加）。新しい表には school_id と RLS の4種のポリシー、明示的な GRANT を付ける。
-- ============================================================================
begin;

/* ---------------------------------------------------------------- 1. AIエンジン */
create table public.ai_settings (
  school_id     uuid primary key references public.schools(id) on delete cascade,
  -- 段階ごとのモデルID（null は環境変数・既定値に従う）
  model_fast     text check (model_fast is null or model_fast ~ '^claude-[a-z0-9-]{2,60}$'),
  model_standard text check (model_standard is null or model_standard ~ '^claude-[a-z0-9-]{2,60}$'),
  model_top      text check (model_top is null or model_top ~ '^claude-[a-z0-9-]{2,60}$'),
  -- 同時に採点する答案の数（ブラウザが使う。1〜16）
  concurrency   smallint not null default 8 check (concurrency between 1 and 16),
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now()
);
alter table public.ai_settings enable row level security;
-- 読むのは同じ学校の教職員。変えるのは管理者だけ
create policy ai_settings_select on public.ai_settings for select to authenticated
  using (school_id = public.current_school_id());
create policy ai_settings_insert on public.ai_settings for insert to authenticated
  with check (school_id = public.current_school_id() and public.current_role_is('admin'));
create policy ai_settings_update on public.ai_settings for update to authenticated
  using (school_id = public.current_school_id() and public.current_role_is('admin'))
  with check (school_id = public.current_school_id() and public.current_role_is('admin'));
create policy ai_settings_delete on public.ai_settings for delete to authenticated
  using (school_id = public.current_school_id() and public.current_role_is('admin'));
revoke all on public.ai_settings from public, anon;
grant select, insert, update, delete on public.ai_settings to authenticated;
grant select, insert, update, delete on public.ai_settings to service_role;

commit;
