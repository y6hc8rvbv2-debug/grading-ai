-- ============================================================================
-- 0006_grading_modes.sql : 採点方式（Opus単独 / 3モデル併用）と、AI採点の実行記録
--
-- app/api/grade/route.ts が、ログイン中の教員の権限（RLS）で使う。
--
--   submissions.grading_mode / grading_stage
--       最後にAI採点したときの方式（opus = Opus単独、cascade = 3モデル併用）と、結果を確定したモデルの段階
--   grading_jobs
--       「AIで採点する」1回分。request_id で同じ操作の再送を見分け、二重に課金しない。
--       同じ答案で同時に動ける採点は1つだけ（実行中の一意索引）
--   grading_stages
--       採点に使った各段階（haiku / sonnet / opus）。モデルID・採点結果・確認に回した理由・トークン数・概算費用。
--       同じ採点で同じ段階は1回しか呼べない（job_id, stage の一意制約。呼び出し済みを未実行に戻せない）
--   finish_grading_job()
--       採点結果の保存（0004 の save_ai_grading）と、採点方式・記録の確定を1つのトランザクションで行う。
--       途中で失敗したときは何も保存されず、既存の成績はそのまま残る
--   fail_grading_job() / expire_stale_grading_jobs()
--       失敗・中断した採点を終わらせ、答案の状態を採点前に戻す
-- ============================================================================

-- 途中で失敗したら何も変わらないよう、1つのトランザクションで実行する（docs/DB-RUNBOOK.md）
begin;

alter table public.submissions
  add column grading_mode  text check (grading_mode in ('opus', 'cascade')),
  add column grading_stage text check (grading_stage in ('haiku', 'sonnet', 'opus'));

create table public.grading_jobs (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  submission_id   uuid not null references public.submissions(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null,
  request_id      uuid not null unique,
  mode            text not null check (mode in ('opus', 'cascade')),
  status          text not null default 'running' check (status in ('running', 'done', 'failed')),
  prev_status     public.submission_status,
  prev_progress   smallint,
  final_stage     text check (final_stage in ('haiku', 'sonnet', 'opus')),
  needs_review    boolean,
  decision        jsonb not null default '{}'::jsonb,
  total_cost_usd  numeric(12, 6) not null default 0,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create index grading_jobs_submission_idx on public.grading_jobs(submission_id, created_at desc);
-- 同じ答案で同時に動ける採点は1つだけ
create unique index grading_jobs_one_running on public.grading_jobs(submission_id) where status = 'running';

create table public.grading_stages (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  job_id          uuid not null references public.grading_jobs(id) on delete cascade,
  submission_id   uuid not null references public.submissions(id) on delete cascade,
  stage           text not null check (stage in ('haiku', 'sonnet', 'opus')),
  position        smallint not null,
  model_id        text not null,
  status          text not null default 'calling' check (status in ('calling', 'done', 'error')),
  escalate        boolean not null default false,
  reasons         jsonb not null default '[]'::jsonb,
  items           jsonb,
  quality         jsonb,
  served_model    text,
  stop_reason     text,
  usage           jsonb,
  cost_usd        numeric(12, 6),
  elapsed_ms      integer,
  error           text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  unique (job_id, stage)
);
create index grading_stages_job_idx on public.grading_stages(job_id, position);

-- ---------------------------------------------------------------------------- 状態の遷移
-- 採点:   running → done / failed（終わった採点は変えられない）
-- 段階:   calling → done / error（結果が確定した段階は変えられない＝同じ段階を呼び直せない）
create or replace function public.grading_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'grading_jobs' then
    if new.school_id <> old.school_id or new.submission_id <> old.submission_id
       or new.request_id <> old.request_id or new.mode <> old.mode then
      raise exception 'AI採点の記録の対象・方式は変更できません' using errcode = '22023';
    end if;
    if old.status <> 'running' and new.status <> old.status then
      raise exception '終わったAI採点の状態は変更できません' using errcode = '22023';
    end if;
    new.updated_at := now();
  else
    if new.school_id <> old.school_id or new.job_id <> old.job_id or new.stage <> old.stage
       or new.model_id <> old.model_id then
      raise exception 'AI採点の段階の記録は変更できません' using errcode = '22023';
    end if;
    if old.status <> 'calling' then
      raise exception '結果が確定した段階は変更できません（同じモデルを二重に呼ばないため）' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create trigger grading_jobs_guard
  before update on public.grading_jobs
  for each row execute function public.grading_guard();
create trigger grading_stages_guard
  before update on public.grading_stages
  for each row execute function public.grading_guard();

-- 段階の開始・終了で、採点の最終更新時刻を進める（時間切れの判定に使う）
create or replace function public.grading_touch_job()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.grading_jobs set updated_at = now() where id = new.job_id and status = 'running';
  return new;
end $$;

create trigger grading_stages_touch
  after insert or update on public.grading_stages
  for each row execute function public.grading_touch_job();

-- ---------------------------------------------------------------------------- RLS
-- 同じ学校の教職員が読み書きできる（AI採点と同じ範囲）。削除は管理者だけ。
alter table public.grading_jobs   enable row level security;
alter table public.grading_stages enable row level security;

create policy grading_jobs_select on public.grading_jobs
  for select to authenticated
  using (school_id = public.current_school_id());
create policy grading_jobs_insert on public.grading_jobs
  for insert to authenticated
  with check (
    school_id = public.current_school_id() and created_by = auth.uid()
    and exists (select 1 from public.submissions s
                 where s.id = submission_id and s.school_id = public.current_school_id())
  );
create policy grading_jobs_update on public.grading_jobs
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());
create policy grading_jobs_delete on public.grading_jobs
  for delete to authenticated
  using (school_id = public.current_school_id() and public.current_role_is('admin'));

create policy grading_stages_select on public.grading_stages
  for select to authenticated
  using (school_id = public.current_school_id());
create policy grading_stages_insert on public.grading_stages
  for insert to authenticated
  with check (
    school_id = public.current_school_id()
    and exists (select 1 from public.grading_jobs j
                 where j.id = job_id and j.submission_id = grading_stages.submission_id
                   and j.school_id = public.current_school_id() and j.status = 'running')
  );
create policy grading_stages_update on public.grading_stages
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());
create policy grading_stages_delete on public.grading_stages
  for delete to authenticated
  using (school_id = public.current_school_id() and public.current_role_is('admin'));

-- ---------------------------------------------------------------------------- 採点の確定
-- 保存（0004 の save_ai_grading）と記録の確定を1つのトランザクションで行う。
-- 採点が実行中でなければ（中断済み・確定済み）何もしない。
create or replace function public.finish_grading_job(
  p_job_id       uuid,
  p_stage        text,
  p_quality      jsonb,
  p_items        jsonb,
  p_needs_review boolean,
  p_decision     jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_job public.grading_jobs%rowtype;
begin
  select * into v_job from public.grading_jobs where id = p_job_id for update;
  if not found then
    raise exception 'AI採点の記録が見つかりません' using errcode = 'P0002';
  end if;
  if v_job.status <> 'running' then
    raise exception 'このAI採点はすでに終わっています（中断または確定済み）' using errcode = '55000';
  end if;

  perform public.save_ai_grading(v_job.submission_id, p_quality, p_items);

  update public.submissions
     set grading_mode = v_job.mode, grading_stage = p_stage
   where id = v_job.submission_id;

  update public.grading_jobs
     set status = 'done', final_stage = p_stage, needs_review = p_needs_review,
         decision = coalesce(p_decision, '{}'::jsonb), finished_at = now(),
         total_cost_usd = coalesce((select sum(coalesce(cost_usd, 0)) from public.grading_stages where job_id = p_job_id), 0)
   where id = p_job_id;
end;
$$;

-- 採点を失敗として終え、答案の状態を採点前に戻す（採点中の表示のまま残っている場合だけ）
create or replace function public.fail_grading_job(p_job_id uuid, p_error text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_job public.grading_jobs%rowtype;
begin
  select * into v_job from public.grading_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'running' then
    return;
  end if;
  update public.grading_stages
     set status = 'error', finished_at = now(),
         error = coalesce(error, '採点が中断されたため、結果を記録できませんでした')
   where job_id = p_job_id and status = 'calling';
  update public.grading_jobs
     set status = 'failed', error = left(coalesce(p_error, ''), 500), finished_at = now(),
         total_cost_usd = coalesce((select sum(coalesce(cost_usd, 0)) from public.grading_stages where job_id = p_job_id), 0)
   where id = p_job_id;
  update public.submissions
     set status = coalesce(v_job.prev_status, status), progress = coalesce(v_job.prev_progress, progress)
   where id = v_job.submission_id and status = 'processing';
end;
$$;

-- 画面を閉じた・関数が時間切れになったなどで残った「実行中」を終わらせる（この答案の分だけ）
create or replace function public.expire_stale_grading_jobs(p_submission_id uuid, p_minutes integer default 10)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_n  integer := 0;
begin
  for v_id in
    select id from public.grading_jobs
     where submission_id = p_submission_id and status = 'running'
       and updated_at < now() - make_interval(mins => greatest(p_minutes, 1))
  loop
    perform public.fail_grading_job(v_id, '時間切れ（画面を閉じた、または通信が途切れた）');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.finish_grading_job(uuid, text, jsonb, jsonb, boolean, jsonb) from public, anon;
revoke execute on function public.fail_grading_job(uuid, text) from public, anon;
revoke execute on function public.expire_stale_grading_jobs(uuid, integer) from public, anon;
grant  execute on function public.finish_grading_job(uuid, text, jsonb, jsonb, boolean, jsonb) to authenticated, service_role;
grant  execute on function public.fail_grading_job(uuid, text) to authenticated, service_role;
grant  execute on function public.expire_stale_grading_jobs(uuid, integer) to authenticated, service_role;

commit;
