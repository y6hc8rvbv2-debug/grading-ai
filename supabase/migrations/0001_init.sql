-- ============================================================================
-- テスト採点ver.3 — Supabase スキーマ
-- 0001_init.sql : テナント / マスタ / 採点データ / 監査ログ + RLS
--
-- 設計方針
--   1. 生徒の実名カラムを作らない。出席番号・受験番号・匿名ID・イニシャルのみ。
--   2. すべての業務テーブルに school_id を持たせ、RLS で他校のデータを遮断する。
--   3. 採点結果は正規化して保存し、弱点分析を SQL 側で集計できるようにする。
--   4. 監査ログは追記専用（UPDATE / DELETE のポリシーを与えない）＋ハッシュ連鎖。
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. テナントとユーザー
-- ----------------------------------------------------------------------------
create table public.schools (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  code          text        not null unique,          -- 学校コード（複合機連携にも使用）
  region        text        not null default 'jp',    -- データ保存リージョン jp / eu
  retention     text        not null default 'year'   -- 30 / 180 / year / manual
                  check (retention in ('30','180','year','manual')),
  plan          text        not null default 'free'
                  check (plan in ('free','school','board')),
  created_at    timestamptz not null default now()
);

create type public.user_role as enum ('admin','teacher','board','viewer');

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  school_id     uuid        not null references public.schools(id) on delete cascade,
  role          public.user_role not null default 'teacher',
  display_name  text        not null default '',      -- 教職員の表示名（生徒名は保持しない）
  ui_lang       text        not null default 'ja',
  created_at    timestamptz not null default now()
);
create index profiles_school_idx on public.profiles(school_id);

-- 自分の school_id を返すヘルパ。RLS のポリシー内から再帰せずに参照するため
-- security definer にして profiles の RLS をバイパスする。
create or replace function public.current_school_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select school_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_role_is(target public.user_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = target)
$$;

-- 新規サインアップ時に profiles を自動作成する。
-- school_id は招待メタデータ（raw_user_meta_data->>'school_id'）から受け取る。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
begin
  sid := nullif(new.raw_user_meta_data->>'school_id','')::uuid;

  -- 招待メタデータに school_id が無い場合は profiles を作らない。
  -- profiles が無いユーザーは current_school_id() が null になり、
  -- RLS によりどのデータにもアクセスできない（安全側に倒す）。
  if sid is null then
    return new;
  end if;

  insert into public.profiles (id, school_id, role, display_name)
  values (
    new.id,
    sid,
    coalesce(nullif(new.raw_user_meta_data->>'role',''), 'teacher')::public.user_role,
    coalesce(new.raw_user_meta_data->>'display_name','')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2. マスタ（クラス / 生徒 / テスト / 設問 / 採点基準）
-- ----------------------------------------------------------------------------
create table public.classes (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid        not null references public.schools(id) on delete cascade,
  grade         smallint    not null,
  name          text        not null,                 -- 「A」「B」など
  label         text        generated always as (grade::text || '年' || name || '組') stored,
  teacher_label text        not null default '',      -- 「担任 T.K」イニシャル表記
  school_year   smallint    not null,
  created_at    timestamptz not null default now(),
  unique (school_id, school_year, grade, name)
);
create index classes_school_idx on public.classes(school_id);

-- 生徒テーブル。氏名カラムは意図的に存在しない。
create table public.students (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid        not null references public.schools(id) on delete cascade,
  class_id      uuid        not null references public.classes(id) on delete cascade,
  number        smallint    not null,                 -- 出席番号
  exam_no       text        not null,                 -- 受験番号
  anon_id       text        not null,                 -- 匿名ID（生徒001）
  initials      text        not null default '',      -- T.K
  support       boolean     not null default false,   -- 特別支援の配慮対象
  note          text        not null default '',      -- 配慮事項（実名を書かない運用）
  created_at    timestamptz not null default now(),
  unique (class_id, number)
  -- 実名カラムは意図的に定義しない。note は配慮事項の記述欄で、
  -- 氏名を書かない運用をアプリ側の入力バリデーションで担保する。
);
create index students_school_idx on public.students(school_id);
create index students_class_idx  on public.students(class_id);

create table public.tests (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid        not null references public.schools(id) on delete cascade,
  name          text        not null,
  subject       text        not null,
  grade         smallint    not null,
  term          text        not null default '',
  exam_date     date,
  test_no       text        not null default '',
  units         text[]      not null default '{}',
  max_score     smallint    not null default 0,
  answer_lang   text        not null default 'ja',    -- 答案の言語（UI言語とは独立）
  created_by    uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index tests_school_idx on public.tests(school_id);

create type public.question_type as enum ('calc','choice','fill','short','long','graph');

create table public.questions (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid        not null references public.schools(id) on delete cascade,
  test_id       uuid        not null references public.tests(id) on delete cascade,
  no            smallint    not null,
  big           smallint    not null default 1,
  label         text        not null,                 -- 大問1-(1)
  qtype         public.question_type not null,
  unit          text        not null default '',
  points        smallint    not null,
  difficulty    text        not null default '標準',
  correct       text        not null default '',
  model_answer  text        not null default '',
  keywords      text[]      not null default '{}',
  unique (test_id, no)
);
create index questions_test_idx on public.questions(test_id);

create table public.rubrics (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid    not null references public.schools(id) on delete cascade,
  test_id           uuid    references public.tests(id) on delete cascade,  -- null = 学校の既定値
  match_rate        smallint not null default 70,
  partial_step      smallint not null default 3,
  review_threshold  smallint not null default 72,
  allow_kana        boolean not null default true,
  allow_spell       boolean not null default true,
  unit_partial      boolean not null default true,
  work_partial      boolean not null default true,
  case_sensitive    boolean not null default false,
  outside_box       boolean not null default true,
  require_teacher   boolean not null default true,
  auto_model        boolean not null default true,
  strict_quality    boolean not null default false,
  praise_full       boolean not null default true,
  updated_at        timestamptz not null default now(),
  unique (school_id, test_id)
);

-- ----------------------------------------------------------------------------
-- 3. 採点データ
-- ----------------------------------------------------------------------------
create type public.submission_status as enum
  ('uploaded','processing','done','review','quality','blank');

create type public.upload_source as enum
  ('camera','mobile','mfp','file','pdf');

create table public.submissions (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid        not null references public.schools(id) on delete cascade,
  test_id       uuid        not null references public.tests(id) on delete cascade,
  student_id    uuid        not null references public.students(id) on delete cascade,
  class_id      uuid        not null references public.classes(id) on delete cascade,
  source        public.upload_source not null default 'camera',
  status        public.submission_status not null default 'uploaded',
  pages         smallint    not null default 1,
  total_score   smallint    not null default 0,
  progress      smallint    not null default 0,
  quality       jsonb       not null default '{}'::jsonb,   -- scores / issues / fixes
  image_paths   text[]      not null default '{}',          -- Storage 上の原本パス
  is_blank      boolean     not null default false,
  edited        boolean     not null default false,
  reviewed_by   uuid        references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  uploaded_at   timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (test_id, student_id)
);
create index submissions_school_idx  on public.submissions(school_id);
create index submissions_test_idx    on public.submissions(test_id);
create index submissions_student_idx on public.submissions(student_id);
create index submissions_status_idx  on public.submissions(school_id, status);

create type public.mark_type as enum ('○','△','×','-');

create table public.submission_items (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid        not null references public.schools(id) on delete cascade,
  submission_id uuid        not null references public.submissions(id) on delete cascade,
  question_id   uuid        not null references public.questions(id) on delete cascade,
  qno           smallint    not null,
  detected      text        not null default '',
  confidence    numeric(4,3) not null default 0,
  mark          public.mark_type not null default '-',
  earned        smallint    not null default 0,
  is_blank      boolean     not null default false,
  need_review   boolean     not null default false,
  reason        text        not null default '',
  comment       text        not null default '',
  bbox          jsonb,                                  -- 赤ペンを重ねる座標
  ai_raw        jsonb,                                  -- API の生レスポンス
  updated_at    timestamptz not null default now(),
  unique (submission_id, qno)
);
create index items_submission_idx on public.submission_items(submission_id);
create index items_review_idx     on public.submission_items(school_id, need_review)
  where need_review;

create table public.model_answer_sets (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid        not null references public.schools(id) on delete cascade,
  test_id       uuid        not null references public.tests(id) on delete cascade,
  generated_by  uuid        references public.profiles(id) on delete set null,
  payload       jsonb       not null,                   -- 設問ごとの解答・解説・キーワード
  created_at    timestamptz not null default now()
);
create index model_sets_test_idx on public.model_answer_sets(test_id);

-- 合計点は明細から自動計算する
create or replace function public.recalc_submission_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
begin
  sid := coalesce(new.submission_id, old.submission_id);
  update public.submissions s
     set total_score = coalesce((
           select sum(i.earned) from public.submission_items i where i.submission_id = sid
         ), 0),
         status = case
           when s.is_blank then 'blank'::public.submission_status
           when exists (select 1 from public.submission_items i
                         where i.submission_id = sid and i.need_review)
             then 'review'::public.submission_status
           when s.status in ('uploaded','processing') then s.status
           else 'done'::public.submission_status
         end
   where s.id = sid;
  return null;
end;
$$;

create trigger items_recalc
  after insert or update or delete on public.submission_items
  for each row execute function public.recalc_submission_total();

-- ----------------------------------------------------------------------------
-- 4. 監査ログ（追記専用・ハッシュ連鎖）
-- ----------------------------------------------------------------------------
create table public.audit_logs (
  id            bigserial primary key,
  school_id     uuid        not null references public.schools(id) on delete cascade,
  actor_id      uuid        references public.profiles(id) on delete set null,
  action        text        not null,                  -- grade.edit / submission.review など
  target_table  text        not null default '',
  target_id     uuid,
  detail        jsonb       not null default '{}'::jsonb,
  prev_hash     text,
  hash          text,
  created_at    timestamptz not null default now()
);
create index audit_school_idx on public.audit_logs(school_id, created_at desc);

create or replace function public.audit_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  last_hash text;
begin
  select a.hash into last_hash
    from public.audit_logs a
   where a.school_id = new.school_id
   order by a.id desc
   limit 1;

  new.prev_hash := last_hash;
  new.hash := encode(
    digest(
      coalesce(last_hash,'') || new.school_id::text || coalesce(new.actor_id::text,'') ||
      new.action || coalesce(new.target_id::text,'') || new.detail::text ||
      extract(epoch from now())::text,
      'sha256'
    ), 'hex');
  return new;
end;
$$;

create trigger audit_chain_before
  before insert on public.audit_logs
  for each row execute function public.audit_chain();

-- 改ざん検知：連鎖が途切れていないかを確認する
create or replace function public.verify_audit_chain(p_school_id uuid)
returns table (id bigint, ok boolean)
language sql
stable
security definer
set search_path = public
as $$
  select a.id,
         a.prev_hash is not distinct from lag(a.hash) over (order by a.id)
    from public.audit_logs a
   where a.school_id = p_school_id
   order by a.id;
$$;

-- ----------------------------------------------------------------------------
-- 5. 分析用ビュー（弱点分析をSQL側で集計）
-- ----------------------------------------------------------------------------
create or replace view public.v_unit_mastery
with (security_invoker = true) as
select
  s.school_id,
  s.test_id,
  s.class_id,
  q.unit,
  count(*)                                        as item_count,
  sum(i.earned)                                   as earned,
  sum(q.points)                                   as points,
  round(100.0 * sum(i.earned) / nullif(sum(q.points),0), 1) as rate
from public.submission_items i
join public.submissions s on s.id = i.submission_id
join public.questions   q on q.id = i.question_id
where s.deleted_at is null and s.status not in ('processing','uploaded')
group by s.school_id, s.test_id, s.class_id, q.unit;

create or replace view public.v_question_stats
with (security_invoker = true) as
select
  s.school_id,
  s.test_id,
  q.id as question_id,
  q.label,
  q.unit,
  count(*)                                                as n,
  count(*) filter (where i.mark = '○')                    as correct_n,
  round(100.0 * count(*) filter (where i.mark = '○') / count(*), 1) as correct_rate,
  round(100.0 * sum(i.earned) / nullif(sum(q.points),0), 1)         as score_rate
from public.submission_items i
join public.submissions s on s.id = i.submission_id
join public.questions   q on q.id = i.question_id
where s.deleted_at is null and s.status not in ('processing','uploaded')
group by s.school_id, s.test_id, q.id, q.label, q.unit;

-- ----------------------------------------------------------------------------
-- 6. RLS
-- ----------------------------------------------------------------------------
alter table public.schools           enable row level security;
alter table public.profiles          enable row level security;
alter table public.classes           enable row level security;
alter table public.students          enable row level security;
alter table public.tests             enable row level security;
alter table public.questions         enable row level security;
alter table public.rubrics           enable row level security;
alter table public.submissions       enable row level security;
alter table public.submission_items  enable row level security;
alter table public.model_answer_sets enable row level security;
alter table public.audit_logs        enable row level security;

-- 学校：自校のみ読める。更新は管理者のみ。
create policy schools_select on public.schools
  for select to authenticated
  using (id = public.current_school_id());
create policy schools_update on public.schools
  for update to authenticated
  using (id = public.current_school_id() and public.current_role_is('admin'))
  with check (id = public.current_school_id());

-- プロフィール：同一校のメンバーを参照できる。自分の行だけ更新できる。
create policy profiles_select on public.profiles
  for select to authenticated
  using (school_id = public.current_school_id());
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and school_id = public.current_school_id());

-- マスタと採点データ：同一校なら読み書きできる（教職員アカウント前提）
do $$
declare
  t text;
begin
  foreach t in array array[
    'classes','students','tests','questions','rubrics',
    'submissions','submission_items','model_answer_sets'
  ]
  loop
    execute format(
      'create policy %1$I_select on public.%1$I for select to authenticated '
      'using (school_id = public.current_school_id())', t);

    execute format(
      'create policy %1$I_insert on public.%1$I for insert to authenticated '
      'with check (school_id = public.current_school_id())', t);

    execute format(
      'create policy %1$I_update on public.%1$I for update to authenticated '
      'using (school_id = public.current_school_id()) '
      'with check (school_id = public.current_school_id())', t);

    execute format(
      'create policy %1$I_delete on public.%1$I for delete to authenticated '
      'using (school_id = public.current_school_id() '
      'and public.current_role_is(''admin''))', t);
  end loop;
end $$;

-- 監査ログ：追記と参照のみ。UPDATE / DELETE のポリシーは意図的に作らない。
create policy audit_select on public.audit_logs
  for select to authenticated
  using (school_id = public.current_school_id());
create policy audit_insert on public.audit_logs
  for insert to authenticated
  with check (school_id = public.current_school_id());

revoke update, delete on public.audit_logs from authenticated;

-- ----------------------------------------------------------------------------
-- 7. 保存期間にもとづく自動削除（pg_cron で日次実行する想定）
-- ----------------------------------------------------------------------------
create or replace function public.purge_expired_submissions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
begin
  with target as (
    select s.id
      from public.submissions s
      join public.schools sc on sc.id = s.school_id
     where sc.retention <> 'manual'
       and s.uploaded_at < now() - (
         case sc.retention
           when '30'  then interval '30 days'
           when '180' then interval '180 days'
           else            interval '15 months'
         end)
  )
  update public.submissions s
     set deleted_at = now(), image_paths = '{}'
    from target t
   where s.id = t.id and s.deleted_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;
