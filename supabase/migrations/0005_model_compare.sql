-- ============================================================================
-- 0005_model_compare.sql : 採点モデルの比較試験（管理者専用）の記録
--
-- 管理者が「モデル比較試験」画面で、1枚の答案画像を Haiku / Sonnet / Opus に
-- 1回ずつ採点させた結果を残す。答案・成績（submissions / submission_items）とは別の表で、
-- 分析ビューにも入らない。答案画像そのものは保存しない（画像の sha256 だけを残す）。
--
--   - 見られるのは、試験を実行した管理者本人だけ（同じ学校の他の管理者・教員にも見えない）
--   - 二重実行の防止
--       * 1人の管理者が同時に実行できる試験は1つだけ（実行中の試験の一意索引）
--       * 同じ画面操作の再送は request_id で同じ試験として扱う
--       * 1つの試験で、同じモデルは1回しか呼べない（pending → calling は1度だけ。トリガーで戻せない）
-- ============================================================================

-- 途中で失敗したら何も変わらないよう、1つのトランザクションで実行する（docs/DB-RUNBOOK.md）
begin;

create table public.model_compare_runs (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  created_by    uuid not null references auth.users(id) on delete cascade,
  request_id    uuid not null unique,
  status        text not null default 'running' check (status in ('running', 'done', 'failed')),
  image_name    text not null default '' check (char_length(image_name) <= 200),
  image_sha256  text not null check (image_sha256 ~ '^[0-9a-f]{64}$'),
  image_bytes   integer not null check (image_bytes > 0),
  settings      jsonb not null default '{}'::jsonb,
  note          text not null default '',
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index model_compare_runs_owner_idx on public.model_compare_runs(created_by, created_at desc);
-- 1人の管理者が同時に実行できる試験は1つだけ
create unique index model_compare_one_running on public.model_compare_runs(created_by) where status = 'running';

create table public.model_compare_results (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  created_by    uuid not null references auth.users(id) on delete cascade,
  run_id        uuid not null references public.model_compare_runs(id) on delete cascade,
  position      smallint not null,
  display_name  text not null,
  model_id      text,
  status        text not null check (status in ('pending', 'calling', 'done', 'error', 'unavailable')),
  started_at    timestamptz,
  finished_at   timestamptz,
  elapsed_ms    integer,
  served_model  text,
  stop_reason   text,
  usage         jsonb,
  cost_usd      numeric(12, 6),
  items         jsonb,
  raw           jsonb,
  judge         jsonb,
  error         text,
  input_fingerprint text,
  unique (run_id, display_name)
);
create index model_compare_results_run_idx on public.model_compare_results(run_id, position);

-- ---------------------------------------------------------------------------- 状態の遷移
-- 試験:   running → done / failed（終わった試験は変えられない）
-- モデル: pending → calling → done / error、unavailable は最初から終わり
--         呼び出し済み（calling 以降）を pending に戻せないので、同じモデルを2回呼べない
create or replace function public.model_compare_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'model_compare_runs' then
    if new.school_id <> old.school_id or new.created_by <> old.created_by
       or new.request_id <> old.request_id or new.image_sha256 <> old.image_sha256 then
      raise exception '比較試験の記録の所属・画像は変更できません' using errcode = '22023';
    end if;
    if old.status <> 'running' and new.status <> old.status then
      raise exception '終わった比較試験の状態は変更できません' using errcode = '22023';
    end if;
  else
    if new.school_id <> old.school_id or new.created_by <> old.created_by or new.run_id <> old.run_id
       or new.display_name <> old.display_name or new.model_id is distinct from old.model_id then
      raise exception '比較試験のモデルは変更できません' using errcode = '22023';
    end if;
    if old.status in ('done', 'error', 'unavailable') then
      raise exception '結果が確定したモデルは変更できません' using errcode = '22023';
    end if;
    if old.status = 'pending' and new.status not in ('pending', 'calling') then
      raise exception 'まだ呼び出していないモデルの結果は保存できません' using errcode = '22023';
    end if;
    if old.status = 'pending' and new.status = 'calling' and not exists (
         select 1 from public.model_compare_runs r where r.id = new.run_id and r.status = 'running') then
      raise exception '終わった比較試験のモデルは呼び出せません' using errcode = '22023';
    end if;
    if old.status = 'calling' and new.status not in ('calling', 'done', 'error') then
      raise exception '呼び出し済みのモデルは、もう一度呼び出せません' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create trigger model_compare_runs_guard
  before update on public.model_compare_runs
  for each row execute function public.model_compare_guard();
create trigger model_compare_results_guard
  before update on public.model_compare_results
  for each row execute function public.model_compare_guard();

-- ---------------------------------------------------------------------------- RLS
-- 自校の管理者で、かつ試験を実行した本人の行だけ。
alter table public.model_compare_runs    enable row level security;
alter table public.model_compare_results enable row level security;

create policy model_compare_runs_select on public.model_compare_runs
  for select to authenticated
  using (school_id = public.current_school_id() and created_by = auth.uid() and public.current_role_is('admin'));
create policy model_compare_runs_insert on public.model_compare_runs
  for insert to authenticated
  with check (school_id = public.current_school_id() and created_by = auth.uid() and public.current_role_is('admin'));
create policy model_compare_runs_update on public.model_compare_runs
  for update to authenticated
  using (school_id = public.current_school_id() and created_by = auth.uid() and public.current_role_is('admin'))
  with check (school_id = public.current_school_id() and created_by = auth.uid());
create policy model_compare_runs_delete on public.model_compare_runs
  for delete to authenticated
  using (school_id = public.current_school_id() and created_by = auth.uid() and public.current_role_is('admin'));

create policy model_compare_results_select on public.model_compare_results
  for select to authenticated
  using (school_id = public.current_school_id() and created_by = auth.uid() and public.current_role_is('admin'));
create policy model_compare_results_insert on public.model_compare_results
  for insert to authenticated
  with check (
    school_id = public.current_school_id() and created_by = auth.uid() and public.current_role_is('admin')
    and exists (select 1 from public.model_compare_runs r
                 where r.id = run_id and r.created_by = auth.uid() and r.status = 'running')
  );
create policy model_compare_results_update on public.model_compare_results
  for update to authenticated
  using (school_id = public.current_school_id() and created_by = auth.uid() and public.current_role_is('admin'))
  with check (school_id = public.current_school_id() and created_by = auth.uid());
create policy model_compare_results_delete on public.model_compare_results
  for delete to authenticated
  using (school_id = public.current_school_id() and created_by = auth.uid() and public.current_role_is('admin'));

commit;
