-- ============================================================================
-- 0012_voice_tutor.sql : 返却の版・受信箱と、チャッピー先生（生徒本人の契約で使う音声復習）
-- 0011 適用後。既存の成績・返却・配信先は変更しない（列は既定値付きで追加し、機能は既定で無効）。
--
-- 返却
--   - result_releases に version を足し、返却内容（payload）が変わったときだけ版を上げる。
--     同じ内容の返し直し（ボタンの二度押し・通信の再送）は版も通知も増えない。
--   - 返却のたびに result_release_history（教職員だけが見る履歴）と student_inbox（生徒の受信箱）に1件ずつ。
--     受信箱は (release_id, version) で一意なので、同じ版の通知は二重にならない。
--   - 返却内容に、生徒の解答（読み取り結果）・問題文（先生が入力した場合）を加え、
--     模範解答・正答は tests.release_model_answer が真のときだけ加える（返却時点の設定で固定）。
--
-- チャッピー先生（AI 利用料は生徒本人または保護者が AI 提供元と直接契約して支払う）
--   - schools.tutor_enabled・classes.tutor_enabled の両方が真のときだけ使える（既定は無効）
--   - tutor_consents      外部 AI へ送る内容・会話の保存・先生への共有の同意（撤回できる）
--   - tutor_credentials   本人の API キーの暗号文（暗号鍵は DB に置かない。サーバーの環境変数）。
--                         本人以外（教職員・管理者を含む）は読めない
--   - tutor_sessions      会話の記録（時間・使用量のみ。会話の中身は入れない）。同時に1つ・1時間の開始回数・1日の合計時間を制限
--   - tutor_progress      問題ごとの復習の状態。生徒が付けられるのは自己申告まで（「理解確認済み」は先生だけ）
--   - tutor_reflections   本人の振り返り（外部の ChatGPT で復習した結果など）。先生への共有は同意したときだけ
--   - tutor_transcripts   会話の文字起こし。同意したときだけ保存し、先生への共有も同意したときだけ
-- 生徒の操作は、生徒の ID をクライアントから受け取らず、auth.uid() から決める（current_student_id）。
-- ============================================================================
begin;

/* ---------------------------------------------------------------- 設定 */
alter table public.schools
  add column tutor_enabled         boolean  not null default false,
  add column tutor_session_minutes smallint not null default 10 check (tutor_session_minutes between 1 and 60),
  add column tutor_daily_minutes   smallint not null default 30 check (tutor_daily_minutes between 1 and 240);
alter table public.classes   add column tutor_enabled boolean not null default false;
alter table public.questions add column prompt_text text not null default '' check (length(prompt_text) <= 2000);
alter table public.tests     add column release_model_answer boolean not null default false;

/* ---------------------------------------------------------------- 本人の判定 */
-- ログイン中の利用者に紐づく生徒（配信先として登録済みのとき）。無ければ null
create or replace function public.current_student_id()
returns uuid language sql stable security definer set search_path = public as $$
  select student_id from public.student_accounts where user_id = auth.uid()
$$;
revoke all on function public.current_student_id() from public, anon;
grant execute on function public.current_student_id() to authenticated;

-- ログイン中の生徒の学校（生徒は students 表を読めないので、関数で決める）
create or replace function public.current_student_school()
returns uuid language sql stable security definer set search_path = public as $$
  select school_id from public.student_accounts where user_id = auth.uid()
$$;
revoke all on function public.current_student_school() from public, anon;
grant execute on function public.current_student_school() to authenticated;

-- 教職員（担当の学校）か
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_is('admin') or public.current_role_is('teacher')
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

/* ---------------------------------------------------------------- 返却の版・履歴・受信箱 */
alter table public.result_releases add column version integer not null default 1;

create table public.result_release_history (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  release_id    uuid not null references public.result_releases(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  version       integer not null,
  payload       jsonb not null,
  released_by   uuid references auth.users(id) on delete set null,
  released_at   timestamptz not null default now(),
  unique (release_id, version)
);
alter table public.result_release_history enable row level security;
create policy release_history_select on public.result_release_history for select to authenticated
  using (school_id = public.current_school_id() and public.is_staff());
create policy release_history_insert on public.result_release_history for insert to authenticated with check (false);
create policy release_history_update on public.result_release_history for update to authenticated using (false);
create policy release_history_delete on public.result_release_history for delete to authenticated using (false);

create table public.student_inbox (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  release_id  uuid not null references public.result_releases(id) on delete cascade,
  version     integer not null,
  kind        text not null check (kind in ('returned', 'updated')),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  unique (release_id, version)
);
create index student_inbox_student_idx on public.student_inbox(student_id, created_at desc);
alter table public.student_inbox enable row level security;
create policy inbox_select on public.student_inbox for select to authenticated
  using (student_id = public.current_student_id() or (school_id = public.current_school_id() and public.is_staff()));
create policy inbox_insert on public.student_inbox for insert to authenticated with check (false);
-- 既読にするのは本人だけ（既読の時刻以外は変えられない：mark_inbox_read を使う）
create policy inbox_update on public.student_inbox for update to authenticated using (false);
create policy inbox_delete on public.student_inbox for delete to authenticated using (false);

create or replace function public.mark_inbox_read(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.student_inbox set read_at = coalesce(read_at, now())
   where id = p_id and student_id = public.current_student_id();
end $$;
revoke all on function public.mark_inbox_read(uuid) from public, anon;
grant execute on function public.mark_inbox_read(uuid) to authenticated;

-- 返却内容に、生徒の解答・問題文・（公開する場合だけ）正答と模範解答を加える。
-- 内容が変わらない返し直しは更新しない（版も通知も増えない）
create or replace function public.result_releases_enrich()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_test uuid; v_show boolean; v_items jsonb; v_grade int; v_subject text;
begin
  select s.test_id into v_test from public.submissions s where s.id = new.submission_id;
  select coalesce(t.release_model_answer, false), t.grade, t.subject into v_show, v_grade, v_subject from public.tests t where t.id = v_test;
  select coalesce(jsonb_agg(
           e.item
           || jsonb_build_object('detected', coalesce(i.detected, ''), 'prompt', coalesce(q.prompt_text, ''))
           || case when v_show then jsonb_build_object('correct', coalesce(q.correct, ''), 'model', coalesce(q.model_answer, ''))
                   else jsonb_build_object('correct', '', 'model', '') end
           order by (e.item->>'qno')::int), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(coalesce(new.payload->'items', '[]'::jsonb)) as e(item)
    left join public.submission_items i on i.submission_id = new.submission_id and i.qno = (e.item->>'qno')::int
    left join public.questions q on q.test_id = v_test and q.no = (e.item->>'qno')::int;
  new.payload := new.payload || jsonb_build_object('items', v_items, 'showModelAnswer', v_show, 'grade', v_grade, 'subject', coalesce(v_subject, ''));
  if tg_op = 'UPDATE' then
    if new.payload = old.payload and new.image_paths = old.image_paths then
      return null;                     -- 同じ内容の返し直しは何もしない
    end if;
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger result_releases_enrich
  before insert or update on public.result_releases
  for each row execute function public.result_releases_enrich();

create or replace function public.result_releases_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.result_release_history (school_id, release_id, submission_id, student_id, version, payload, released_by, released_at)
  values (new.school_id, new.id, new.submission_id, new.student_id, new.version, new.payload, new.released_by, new.released_at)
  on conflict (release_id, version) do nothing;
  insert into public.student_inbox (school_id, student_id, release_id, version, kind)
  values (new.school_id, new.student_id, new.id, new.version, case when new.version = 1 then 'returned' else 'updated' end)
  on conflict (release_id, version) do nothing;
  return null;
end $$;
create trigger result_releases_after
  after insert or update on public.result_releases
  for each row execute function public.result_releases_after();

-- 既に返却済みのもの（0012 より前）は、版1として履歴と受信箱に載せる
insert into public.result_release_history (school_id, release_id, submission_id, student_id, version, payload, released_by, released_at)
select school_id, id, submission_id, student_id, version, payload, released_by, released_at from public.result_releases
on conflict do nothing;
insert into public.student_inbox (school_id, student_id, release_id, version, kind, created_at)
select school_id, student_id, id, version, 'returned', released_at from public.result_releases
on conflict do nothing;

/* ---------------------------------------------------------------- 同意 */
create table public.tutor_consents (
  student_id         uuid primary key references public.students(id) on delete cascade,
  school_id          uuid not null references public.schools(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  payer              text not null check (payer in ('self', 'guardian')),
  terms_confirmed    boolean not null check (terms_confirmed),
  send_answer        boolean not null default true,
  send_comment       boolean not null default true,
  save_transcript    boolean not null default false,
  share_with_teacher boolean not null default false,
  agreed_at          timestamptz not null default now(),
  revoked_at         timestamptz
);
alter table public.tutor_consents enable row level security;
create policy consents_select on public.tutor_consents for select to authenticated
  using (student_id = public.current_student_id() or (school_id = public.current_school_id() and public.is_staff()));
create policy consents_insert on public.tutor_consents for insert to authenticated
  with check (student_id = public.current_student_id() and user_id = auth.uid()
              and school_id = public.current_student_school());
create policy consents_update on public.tutor_consents for update to authenticated
  using (student_id = public.current_student_id())
  with check (student_id = public.current_student_id() and user_id = auth.uid()
              and school_id = public.current_student_school());
create policy consents_delete on public.tutor_consents for delete to authenticated
  using (student_id = public.current_student_id());

/* ---------------------------------------------------------------- 本人の API キー（暗号文） */
create table public.tutor_credentials (
  student_id  uuid primary key references public.students(id) on delete cascade,
  school_id   uuid not null references public.schools(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider    text not null default 'openai' check (provider in ('openai')),
  payer       text not null check (payer in ('self', 'guardian')),
  ciphertext  text check (ciphertext is null or length(ciphertext) < 2000),
  key_hint    text not null default '' check (length(key_hint) <= 8),
  model       text not null default '' check (length(model) <= 100),
  status      text not null default 'active' check (status in ('active', 'revoked')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  check (status = 'revoked' or ciphertext is not null)
);
alter table public.tutor_credentials enable row level security;
-- 本人だけ。教職員・管理者の読み取りポリシーは作らない（管理者画面からキーを見られない）
create policy credentials_select on public.tutor_credentials for select to authenticated
  using (student_id = public.current_student_id() and user_id = auth.uid());
create policy credentials_insert on public.tutor_credentials for insert to authenticated
  with check (student_id = public.current_student_id() and user_id = auth.uid()
              and school_id = public.current_student_school());
create policy credentials_update on public.tutor_credentials for update to authenticated
  using (student_id = public.current_student_id() and user_id = auth.uid())
  with check (student_id = public.current_student_id() and user_id = auth.uid()
              and school_id = public.current_student_school());
create policy credentials_delete on public.tutor_credentials for delete to authenticated
  using (student_id = public.current_student_id() and user_id = auth.uid());

/* ---------------------------------------------------------------- 会話の記録・制限 */
create table public.tutor_sessions (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  release_id  uuid not null references public.result_releases(id) on delete cascade,
  qno         integer not null,
  mode        text not null check (mode in ('voice', 'text')),
  model       text not null default '',
  status      text not null default 'active' check (status in ('active', 'ended')),
  started_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at    timestamptz,
  end_reason  text not null default '',
  seconds     integer not null default 0 check (seconds >= 0),
  usage       jsonb not null default '{}'::jsonb
);
create index tutor_sessions_student_idx on public.tutor_sessions(student_id, started_at desc);
-- 同じ生徒が同時に使える会話は1つだけ
create unique index tutor_sessions_one_active on public.tutor_sessions(student_id) where status = 'active';
alter table public.tutor_sessions enable row level security;
create policy tutor_sessions_select on public.tutor_sessions for select to authenticated
  using (student_id = public.current_student_id() or (school_id = public.current_school_id() and public.is_staff()));
create policy tutor_sessions_insert on public.tutor_sessions for insert to authenticated with check (false);
create policy tutor_sessions_update on public.tutor_sessions for update to authenticated using (false);
create policy tutor_sessions_delete on public.tutor_sessions for delete to authenticated using (false);

-- 会話を始める。本人の返却済みの設問か・機能が有効か・同意があるか・制限内かを確かめ、会話の記録を作る。
-- 戻り値：{ id, max_seconds }。断る理由は例外の文（tutor_*）で返す
create or replace function public.start_tutor_session(p_release uuid, p_qno integer, p_mode text, p_model text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_student uuid := public.current_student_id();
  v_rel public.result_releases%rowtype;
  v_school public.schools%rowtype;
  v_class_ok boolean;
  v_used integer;
  v_id uuid;
begin
  if v_student is null then raise exception 'tutor_not_student' using errcode = '42501'; end if;
  select * into v_rel from public.result_releases where id = p_release and student_id = v_student;
  if not found then raise exception 'tutor_not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from jsonb_array_elements(v_rel.payload->'items') e where (e->>'qno')::int = p_qno) then
    raise exception 'tutor_not_found' using errcode = 'P0002';
  end if;
  select * into v_school from public.schools where id = v_rel.school_id;
  select c.tutor_enabled into v_class_ok from public.students st join public.classes c on c.id = st.class_id where st.id = v_student;
  if not v_school.tutor_enabled or not coalesce(v_class_ok, false) then raise exception 'tutor_disabled' using errcode = '42501'; end if;
  if not exists (select 1 from public.tutor_consents where student_id = v_student and revoked_at is null) then
    raise exception 'tutor_no_consent' using errcode = '42501';
  end if;
  if p_mode not in ('voice', 'text') then raise exception 'tutor_bad_request'; end if;

  -- 応答の止まった会話（90秒）は終わらせる
  update public.tutor_sessions set status = 'ended', ended_at = now(), end_reason = 'timeout'
   where student_id = v_student and status = 'active' and last_seen_at < now() - interval '90 seconds';
  if exists (select 1 from public.tutor_sessions where student_id = v_student and status = 'active') then
    raise exception 'tutor_busy' using errcode = '55P03';
  end if;
  if (select count(*) from public.tutor_sessions where student_id = v_student and started_at > now() - interval '1 hour') >= 6 then
    raise exception 'tutor_too_many' using errcode = '54000';
  end if;
  select coalesce(sum(seconds), 0) into v_used from public.tutor_sessions
   where student_id = v_student and started_at > date_trunc('day', now());
  if v_used >= v_school.tutor_daily_minutes * 60 then raise exception 'tutor_daily_limit' using errcode = '54000'; end if;

  insert into public.tutor_sessions (school_id, student_id, user_id, release_id, qno, mode, model)
  values (v_rel.school_id, v_student, auth.uid(), p_release, p_qno, p_mode, left(coalesce(p_model, ''), 100))
  returning id into v_id;
  insert into public.audit_logs (school_id, actor_id, action, target_table, target_id, detail)
  values (v_rel.school_id, null, 'tutor.session_start', 'tutor_sessions', v_id,
          jsonb_build_object('actor', 'student', 'student', v_student, 'qno', p_qno, 'mode', p_mode));
  return jsonb_build_object('id', v_id,
    'max_seconds', least(v_school.tutor_session_minutes * 60, v_school.tutor_daily_minutes * 60 - v_used));
end $$;

-- 会話中の生存確認。時間の上限を超えたら終わらせ、false を返す（画面は会話を止める）
create or replace function public.heartbeat_tutor_session(p_id uuid, p_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v public.tutor_sessions%rowtype; v_max integer;
begin
  select * into v from public.tutor_sessions where id = p_id and student_id = public.current_student_id() for update;
  if not found or v.status <> 'active' then return false; end if;
  select tutor_session_minutes * 60 into v_max from public.schools where id = v.school_id;
  -- 経過時間はサーバーの時計でも確かめる（画面が少なく申告しても上限で止める）
  update public.tutor_sessions
     set seconds = greatest(v.seconds, least(coalesce(p_seconds, 0), extract(epoch from now() - v.started_at)::int)),
         last_seen_at = now()
   where id = p_id;
  if extract(epoch from now() - v.started_at) >= v_max then
    update public.tutor_sessions set status = 'ended', ended_at = now(), end_reason = 'time_limit',
           seconds = greatest(seconds, v_max) where id = p_id;
    return false;
  end if;
  return true;
end $$;

-- 会話を終える（何度呼んでもよい）
create or replace function public.end_tutor_session(p_id uuid, p_reason text, p_seconds integer, p_usage jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v public.tutor_sessions%rowtype;
begin
  select * into v from public.tutor_sessions where id = p_id and student_id = public.current_student_id() for update;
  if not found then return; end if;
  update public.tutor_sessions
     set status = 'ended',
         ended_at = coalesce(ended_at, now()),
         end_reason = case when status = 'active' then left(coalesce(p_reason, ''), 40) else end_reason end,
         seconds = greatest(seconds, least(coalesce(p_seconds, 0), extract(epoch from coalesce(ended_at, now()) - started_at)::int)),
         usage = case when jsonb_typeof(p_usage) = 'object' and length(p_usage::text) < 4000 then p_usage else usage end
   where id = p_id;
  if v.status = 'active' then
    insert into public.audit_logs (school_id, actor_id, action, target_table, target_id, detail)
    values (v.school_id, null, 'tutor.session_end', 'tutor_sessions', p_id,
            jsonb_build_object('actor', 'student', 'student', v.student_id, 'reason', left(coalesce(p_reason, ''), 40)));
  end if;
end $$;

revoke all on function public.start_tutor_session(uuid, integer, text, text) from public, anon;
revoke all on function public.heartbeat_tutor_session(uuid, integer) from public, anon;
revoke all on function public.end_tutor_session(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.start_tutor_session(uuid, integer, text, text) to authenticated;
grant execute on function public.heartbeat_tutor_session(uuid, integer) to authenticated;
grant execute on function public.end_tutor_session(uuid, text, integer, jsonb) to authenticated;

/* ---------------------------------------------------------------- 復習の状態 */
create table public.tutor_progress (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  release_id  uuid not null references public.result_releases(id) on delete cascade,
  qno         integer not null,
  state       text not null check (state in ('untouched', 'reviewing', 'self_understood', 'verified', 'ask_teacher')),
  source      text not null check (source in ('self', 'external_self', 'teacher')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null default auth.uid(),
  unique (release_id, qno),
  -- 「理解確認済み」は先生が確認したときだけ（生徒の自己申告や AI の会話だけでは付けない）
  check ((state = 'verified') = (source = 'teacher'))
);
alter table public.tutor_progress enable row level security;
create policy progress_select on public.tutor_progress for select to authenticated
  using (student_id = public.current_student_id() or (school_id = public.current_school_id() and public.is_staff()));
create policy progress_insert on public.tutor_progress for insert to authenticated
  with check (
    (student_id = public.current_student_id() and source in ('self', 'external_self')
      and exists (select 1 from public.result_releases r where r.id = release_id and r.student_id = tutor_progress.student_id and r.school_id = tutor_progress.school_id))
    or (school_id = public.current_school_id() and public.is_staff() and source = 'teacher'
      and exists (select 1 from public.result_releases r where r.id = release_id and r.student_id = tutor_progress.student_id and r.school_id = tutor_progress.school_id)));
-- 先生が「理解確認済み」にした行は、生徒は変えられない
create policy progress_update on public.tutor_progress for update to authenticated
  using ((student_id = public.current_student_id() and source <> 'teacher') or (school_id = public.current_school_id() and public.is_staff()))
  with check (
    (student_id = public.current_student_id() and source in ('self', 'external_self'))
    or (school_id = public.current_school_id() and public.is_staff()));
create policy progress_delete on public.tutor_progress for delete to authenticated
  using ((student_id = public.current_student_id() and source <> 'teacher') or (school_id = public.current_school_id() and public.is_staff()));

/* ---------------------------------------------------------------- 振り返り・文字起こし（本人の同意で先生と共有） */
create or replace function public.tutor_shared_with_teacher(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select share_with_teacher and revoked_at is null from public.tutor_consents where student_id = p_student), false)
$$;
revoke all on function public.tutor_shared_with_teacher(uuid) from public, anon;
grant execute on function public.tutor_shared_with_teacher(uuid) to authenticated;

create table public.tutor_reflections (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  release_id  uuid not null references public.result_releases(id) on delete cascade,
  qno         integer not null,
  source      text not null check (source in ('app', 'external_chatgpt')),
  note        text not null check (length(note) between 1 and 1000),
  created_at  timestamptz not null default now()
);
alter table public.tutor_reflections enable row level security;
create policy reflections_select on public.tutor_reflections for select to authenticated
  using (student_id = public.current_student_id()
         or (school_id = public.current_school_id() and public.is_staff() and public.tutor_shared_with_teacher(student_id)));
create policy reflections_insert on public.tutor_reflections for insert to authenticated
  with check (student_id = public.current_student_id()
              and exists (select 1 from public.result_releases r where r.id = release_id and r.student_id = tutor_reflections.student_id and r.school_id = tutor_reflections.school_id));
create policy reflections_update on public.tutor_reflections for update to authenticated
  using (student_id = public.current_student_id()) with check (student_id = public.current_student_id());
create policy reflections_delete on public.tutor_reflections for delete to authenticated
  using (student_id = public.current_student_id());

create table public.tutor_transcripts (
  session_id  uuid primary key references public.tutor_sessions(id) on delete cascade,
  school_id   uuid not null references public.schools(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  body        text not null check (length(body) <= 20000),
  created_at  timestamptz not null default now()
);
alter table public.tutor_transcripts enable row level security;
create policy transcripts_select on public.tutor_transcripts for select to authenticated
  using (student_id = public.current_student_id()
         or (school_id = public.current_school_id() and public.is_staff() and public.tutor_shared_with_teacher(student_id)));
-- 保存は本人が「会話を保存する」に同意しているときだけ
create policy transcripts_insert on public.tutor_transcripts for insert to authenticated
  with check (student_id = public.current_student_id()
              and exists (select 1 from public.tutor_sessions s where s.id = session_id and s.student_id = tutor_transcripts.student_id and s.school_id = tutor_transcripts.school_id)
              and exists (select 1 from public.tutor_consents c where c.student_id = tutor_transcripts.student_id and c.save_transcript and c.revoked_at is null));
create policy transcripts_update on public.tutor_transcripts for update to authenticated using (false);
create policy transcripts_delete on public.tutor_transcripts for delete to authenticated
  using (student_id = public.current_student_id());

-- 同意を撤回したら、保存した文字起こしを消す（振り返り・復習の状態は本人が別に消せる）
create or replace function public.tutor_consent_revoked()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE') or (new.revoked_at is not null and old.revoked_at is null) or (not new.save_transcript and old.save_transcript) then
    delete from public.tutor_transcripts where student_id = old.student_id;
  end if;
  return coalesce(new, old);
end $$;
create trigger tutor_consent_revoked after update or delete on public.tutor_consents
  for each row execute function public.tutor_consent_revoked();

/* ---------------------------------------------------------------- 教職員：設定の変更（管理者） */
create or replace function public.set_tutor_settings(p_enabled boolean, p_session_minutes integer, p_daily_minutes integer, p_class_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.current_school_id();
begin
  if not public.current_role_is('admin') then raise exception 'チャッピー先生の設定を変えられるのは学校の管理者だけです' using errcode = '42501'; end if;
  update public.schools set tutor_enabled = p_enabled,
         tutor_session_minutes = coalesce(p_session_minutes, tutor_session_minutes),
         tutor_daily_minutes = coalesce(p_daily_minutes, tutor_daily_minutes)
   where id = v_school;
  update public.classes set tutor_enabled = (id = any(coalesce(p_class_ids, '{}'))) where school_id = v_school;
  insert into public.audit_logs (school_id, actor_id, action, target_table, target_id, detail)
  values (v_school, auth.uid(), 'tutor.settings', 'schools', v_school,
          jsonb_build_object('enabled', p_enabled, 'classes', coalesce(array_length(p_class_ids, 1), 0)));
end $$;
revoke all on function public.set_tutor_settings(boolean, integer, integer, uuid[]) from public, anon;
grant execute on function public.set_tutor_settings(boolean, integer, integer, uuid[]) to authenticated;

/* ---------------------------------------------------------------- 生徒の画面用：使えるか・今日の利用時間 */
create or replace function public.tutor_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_student uuid := public.current_student_id(); v_school public.schools%rowtype; v_class boolean; v_used integer;
begin
  if v_student is null then return jsonb_build_object('student', false); end if;
  select sc.* into v_school from public.students st join public.schools sc on sc.id = st.school_id where st.id = v_student;
  select c.tutor_enabled into v_class from public.students st join public.classes c on c.id = st.class_id where st.id = v_student;
  select coalesce(sum(seconds), 0) into v_used from public.tutor_sessions where student_id = v_student and started_at > date_trunc('day', now());
  return jsonb_build_object('student', true,
    'enabled', v_school.tutor_enabled and coalesce(v_class, false),
    'session_minutes', v_school.tutor_session_minutes, 'daily_minutes', v_school.tutor_daily_minutes,
    'used_seconds_today', v_used);
end $$;
revoke all on function public.tutor_status() from public, anon;
grant execute on function public.tutor_status() to authenticated;

-- 生徒の操作を監査ログに残す（決まった操作名だけ。秘密・会話の中身は入れない）
create or replace function public.tutor_log(p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare v_student uuid := public.current_student_id();
begin
  if v_student is null then raise exception 'tutor_not_student' using errcode = '42501'; end if;
  if p_action not in ('key_attempt', 'key_saved', 'key_deleted', 'key_failed', 'consent_given', 'consent_revoked', 'data_deleted') then
    raise exception 'tutor_bad_request';
  end if;
  -- キーの登録・確認は10分に5回まで（総当たり・使いすぎを防ぐ）
  if p_action = 'key_attempt' and (select count(*) from public.audit_logs
       where action = 'tutor.key_attempt' and target_id = v_student and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'tutor_too_many' using errcode = '54000';
  end if;
  insert into public.audit_logs (school_id, actor_id, action, target_table, target_id, detail)
  values (public.current_student_school(), null, 'tutor.' || p_action, 'students', v_student, jsonb_build_object('actor', 'student'));
end $$;
revoke all on function public.tutor_log(text) from public, anon;
grant execute on function public.tutor_log(text) to authenticated;

commit;
