-- ============================================================================
-- 0007_test_import.sql : 模範解答・配点表からテストを自動作成する
--
-- 「テスト管理 → テストを追加 → 模範解答・配点表から自動入力」で使う。
--
--   tests.answer_key_paths
--       登録したテストの模範解答・問題用紙・配点表の画像（Storage のパス）。作図の模範図などを後から参照する
--       （生徒の答案は保存しない。登録時に削除する）
--   questions.figure
--       作図問題の模範図の位置 { path, page, x, y, w, h }（模範解答の画像に対する割合）
--   test_imports
--       AI による読み取り1回分。request_id で同じ操作の再送を見分け、input_sha（資料の内容）で
--       同じ資料の読み取りを重複実行しない（実行中は1つだけ・終わった結果は再利用する）
--
-- 既存のテスト・設問・答案・成績は変更しない（列は空のまま追加する）。
-- ============================================================================

-- 途中で失敗したら何も変わらないよう、1つのトランザクションで実行する（docs/DB-RUNBOOK.md）
begin;

alter table public.tests add column answer_key_paths text[];
alter table public.questions add column figure jsonb;

create table public.test_imports (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  created_by    uuid references public.profiles(id) on delete set null,
  request_id    uuid not null unique,
  input_sha     text not null check (input_sha ~ '^[0-9a-f]{64}$'),
  files         jsonb not null default '[]'::jsonb,
  status        text not null default 'running' check (status in ('running', 'done', 'failed')),
  model         text,
  result        jsonb,
  usage         jsonb,
  cost_usd      numeric(12, 6),
  error         text,
  test_id       uuid references public.tests(id) on delete set null,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index test_imports_input_idx on public.test_imports(school_id, input_sha, created_at desc);
-- 同じ資料の読み取りを同時に2つ動かさない
create unique index test_imports_one_running on public.test_imports(school_id, input_sha) where status = 'running';

-- 状態の遷移：running → done / failed。終わった読み取りの結果は変えられない（登録したテストとの紐づけだけ後から付けられる）
create or replace function public.test_imports_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.school_id <> old.school_id or new.request_id <> old.request_id or new.input_sha <> old.input_sha then
    raise exception '読み取りの記録の対象は変更できません' using errcode = '22023';
  end if;
  if old.status <> 'running' and (new.status <> old.status or new.result is distinct from old.result) then
    raise exception '終わった読み取りの結果は変更できません' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger test_imports_guard
  before update on public.test_imports
  for each row execute function public.test_imports_guard();

alter table public.test_imports enable row level security;

create policy test_imports_select on public.test_imports
  for select to authenticated
  using (school_id = public.current_school_id());
create policy test_imports_insert on public.test_imports
  for insert to authenticated
  with check (school_id = public.current_school_id() and created_by = auth.uid());
create policy test_imports_update on public.test_imports
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());
create policy test_imports_delete on public.test_imports
  for delete to authenticated
  using (school_id = public.current_school_id() and public.current_role_is('admin'));

commit;
