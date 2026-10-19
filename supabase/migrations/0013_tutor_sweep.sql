-- ============================================================================
-- 0013_tutor_sweep.sql : チャッピー先生の通話を、ブラウザが来なくてもサーバーが終わらせる（見回り）
--
-- 0012 までは、通話を切るきっかけが「ブラウザからの要求」（20秒ごとの生存確認・終了・撤回など）だけだった。
-- ブラウザの強制終了・通信断・生存確認の停止のときは、次の要求が来るまで切れなかった。そこで:
--   1. 通話を作るとき、通話を切るためだけの資格情報（本人のキーをサーバーの暗号鍵で暗号化したもの）を
--      tutor_call_secrets に置く。誰も読めない表（RLS で全拒否）。通話を切り終えたら消す。
--      遅くとも delete_after（作成時の「1回の上限時間＋30分」）を過ぎたら、切れなくても消す（gave_up として記録）
--   2. 定期処理（Supabase の pg_cron → アプリの /api/tutor/sweep。docs/TUTOR-SWEEP.md）が、
--      tutor_sweep_due() で「終わらせるべき会話」を終わらせ、切れていない通話を受け取って切り、
--      tutor_sweep_record() で結果を記録する（失敗は間隔を広げて再試行）
--   3. 見回りが止まっているあいだは、新しい会話を始めない（tutor_sweeper_ok()。アプリが会話の開始前に確かめる）
--
-- 終わらせる理由（tutor_sweep_due）
--   feature_off（緊急停止）/ disabled（学校・クラスで無効）/ no_consent（同意の撤回）/ time_limit（1回の上限）/
--   no_heartbeat（生存確認が p_stale_seconds 秒来ない：ブラウザの強制終了・通信断など）
--
-- 見回りの関数は service_role だけが呼べる（アプリのサーバーの /api/tutor/sweep が使う）。生徒・先生は呼べない。
-- 本番に適用する前の検証環境での手順は docs/DB-RUNBOOK.md。
-- ============================================================================
begin;

/* ---------------------------------------------------------------- 通話を切った記録 */
alter table public.tutor_sessions
  -- none：通話が無い / pending：まだ切っていない / done：切った（または既に終わっていた）/ failed：失敗（再試行する）/ gave_up：期限まで切れなかった
  add column hangup_status   text not null default 'none' check (hangup_status in ('none', 'pending', 'done', 'failed', 'gave_up')),
  add column hangup_attempts smallint not null default 0,
  add column hangup_at       timestamptz,
  add column hangup_error    text check (hangup_error is null or length(hangup_error) <= 200);

/* ---------------------------------------------------------------- 通話を切るための資格情報（誰も読めない） */
create table public.tutor_call_secrets (
  session_id      uuid primary key references public.tutor_sessions(id) on delete cascade,
  school_id       uuid not null references public.schools(id) on delete cascade,
  -- 本人のキーを TUTOR_KEY_ENCRYPTION_KEY で暗号化したもの（追加認証データは会話のID。lib/tutor/crypto.ts）
  ciphertext      text not null check (length(ciphertext) between 10 and 2000),
  created_at      timestamptz not null default now(),
  -- この時刻を過ぎたら、通話を切れなくても消す（保持の上限）
  delete_after    timestamptz not null,
  attempts        smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- 見回りが取り出してから結果を書くまでの予約（二重に処理しない）
  claimed_until   timestamptz
);
alter table public.tutor_call_secrets enable row level security;
-- 生徒・先生・管理者のだれも、画面や API から読めない・書けない（下の security definer の関数だけが扱う）
create policy call_secrets_select on public.tutor_call_secrets for select to authenticated using (false);
create policy call_secrets_insert on public.tutor_call_secrets for insert to authenticated with check (false);
create policy call_secrets_update on public.tutor_call_secrets for update to authenticated using (false);
create policy call_secrets_delete on public.tutor_call_secrets for delete to authenticated using (false);
revoke all on public.tutor_call_secrets from anon, authenticated;

/* ---------------------------------------------------------------- 見回りの最終実行（学校のデータは持たない） */
create table public.tutor_sweeper (
  id          smallint primary key check (id = 1),
  last_run_at timestamptz,
  last_result jsonb not null default '{}'::jsonb
);
insert into public.tutor_sweeper (id) values (1);
alter table public.tutor_sweeper enable row level security;
create policy sweeper_select on public.tutor_sweeper for select to authenticated using (false);
create policy sweeper_insert on public.tutor_sweeper for insert to authenticated with check (false);
create policy sweeper_update on public.tutor_sweeper for update to authenticated using (false);
create policy sweeper_delete on public.tutor_sweeper for delete to authenticated using (false);
revoke all on public.tutor_sweeper from anon, authenticated;

/* ---------------------------------------------------------------- 通話IDと、通話を切るための資格情報を記録する */
-- 0012 の set_tutor_call(uuid, text) を置き換える（資格情報が無いと、見回りが通話を切れないため）
drop function if exists public.set_tutor_call(uuid, text);
create or replace function public.set_tutor_call(p_id uuid, p_call text, p_secret text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v public.tutor_sessions%rowtype; v_minutes integer;
begin
  select * into v from public.tutor_sessions
   where id = p_id and student_id = public.current_student_id() and status = 'active' and call_id is null for update;
  if not found then return false; end if;
  if p_call !~ '^[A-Za-z0-9_-]{1,100}$' or coalesce(length(p_secret), 0) < 10 then raise exception 'tutor_bad_request'; end if;
  select tutor_session_minutes into v_minutes from public.schools where id = v.school_id;
  update public.tutor_sessions set call_id = p_call, hangup_status = 'pending' where id = p_id;
  insert into public.tutor_call_secrets (session_id, school_id, ciphertext, delete_after)
  values (p_id, v.school_id, p_secret, v.started_at + make_interval(mins => v_minutes) + interval '30 minutes');
  return true;
end $$;
revoke all on function public.set_tutor_call(uuid, text, text) from public, anon;
grant execute on function public.set_tutor_call(uuid, text, text) to authenticated;

-- 本人の会話の、通話を切るための資格情報（暗号文）。生徒の要求の中でサーバーが通話を切るときに使う
create or replace function public.tutor_call_secret(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select cs.ciphertext from public.tutor_call_secrets cs join public.tutor_sessions s on s.id = cs.session_id
   where cs.session_id = p_id and s.student_id = public.current_student_id()
$$;
revoke all on function public.tutor_call_secret(uuid) from public, anon;
grant execute on function public.tutor_call_secret(uuid) to authenticated;

/* ---------------------------------------------------------------- 通話を切った結果を記録する（共通） */
create or replace function public.tutor_hangup_result_internal(p_id uuid, p_ok boolean, p_error text, p_by text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.tutor_sessions%rowtype; c public.tutor_call_secrets%rowtype; v_status text;
begin
  select * into v from public.tutor_sessions where id = p_id for update;
  if not found then return 'not_found'; end if;
  select * into c from public.tutor_call_secrets where session_id = p_id for update;
  if p_ok then
    delete from public.tutor_call_secrets where session_id = p_id;
    v_status := 'done';
  elsif c.session_id is null then
    v_status := v.hangup_status;            -- 資格情報が既に無い（切り終えた・期限切れ）
    return v_status;
  elsif now() >= c.delete_after then
    -- 保持の上限を過ぎた：これ以上は試さず、資格情報を消す
    delete from public.tutor_call_secrets where session_id = p_id;
    v_status := 'gave_up';
  else
    -- 間隔を広げて再試行（10秒・20秒・40秒…最大10分）
    update public.tutor_call_secrets
       set attempts = attempts + 1, claimed_until = null,
           next_attempt_at = now() + make_interval(secs => least(600, 10 * power(2, least(attempts, 10))))
     where session_id = p_id;
    v_status := 'failed';
  end if;
  update public.tutor_sessions
     set hangup_status = v_status, hangup_attempts = hangup_attempts + 1,
         hangup_at = case when v_status = 'done' then now() else hangup_at end,
         hangup_error = case when v_status = 'done' then null else left(coalesce(p_error, ''), 200) end
   where id = p_id;
  insert into public.audit_logs (school_id, actor_id, action, target_table, target_id, detail)
  values (v.school_id, null, 'tutor.hangup_' || v_status, 'tutor_sessions', p_id,
          jsonb_build_object('by', p_by, 'attempt', v.hangup_attempts + 1, 'error', left(coalesce(p_error, ''), 200)));
  return v_status;
end $$;
revoke all on function public.tutor_hangup_result_internal(uuid, boolean, text, text) from public, anon, authenticated;

-- 生徒の要求の中で通話を切った結果（本人の会話だけ）
create or replace function public.tutor_hangup_result(p_id uuid, p_ok boolean, p_error text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.tutor_sessions where id = p_id and student_id = public.current_student_id()) then return 'not_found'; end if;
  return public.tutor_hangup_result_internal(p_id, p_ok, p_error, 'request');
end $$;
revoke all on function public.tutor_hangup_result(uuid, boolean, text) from public, anon;
grant execute on function public.tutor_hangup_result(uuid, boolean, text) to authenticated;

/* ---------------------------------------------------------------- 見回り（service_role だけ） */
-- 1. 終わらせるべき会話を終わらせる  2. 切れていない通話を、予約して返す（最大 p_limit 件）
create or replace function public.tutor_sweep_due(p_feature_off boolean, p_stale_seconds integer, p_limit integer)
returns table (session_id uuid, call_id text, ciphertext text, attempts smallint, end_reason text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r record; v_reason text; v_ended integer := 0; v_stale integer := greatest(30, least(coalesce(p_stale_seconds, 90), 600));
begin
  update public.tutor_sweeper set last_run_at = now() where id = 1;

  for r in
    select s.*, sc.tutor_enabled as school_on, sc.tutor_session_minutes as minutes, coalesce(c.tutor_enabled, false) as class_on,
           exists (select 1 from public.tutor_consents tc where tc.student_id = s.student_id and tc.revoked_at is null) as consent_on
      from public.tutor_sessions s
      join public.schools sc on sc.id = s.school_id
      left join public.students st on st.id = s.student_id
      left join public.classes c on c.id = st.class_id
     where s.status = 'active'
     for update of s skip locked
  loop
    v_reason := case
      when p_feature_off then 'feature_off'
      when not r.school_on or not r.class_on then 'disabled'
      when not r.consent_on then 'no_consent'
      when now() >= r.started_at + make_interval(mins => r.minutes) then 'time_limit'
      when r.last_seen_at < now() - make_interval(secs => v_stale) then 'no_heartbeat'
    end;
    continue when v_reason is null;
    update public.tutor_sessions
       set status = 'ended', ended_at = now(), end_reason = v_reason,
           seconds = greatest(seconds, least(extract(epoch from now() - started_at)::int, r.minutes * 60))
     where id = r.id;
    insert into public.audit_logs (school_id, actor_id, action, target_table, target_id, detail)
    values (r.school_id, null, 'tutor.session_end', 'tutor_sessions', r.id,
            jsonb_build_object('actor', 'sweeper', 'student', r.student_id, 'reason', v_reason));
    v_ended := v_ended + 1;
  end loop;

  -- 保持の上限から10分過ぎても残っている資格情報（見回りが結果を書けなかったなど）は、切れなくても消す
  with gone as (
    delete from public.tutor_call_secrets cs where cs.delete_after < now() - interval '10 minutes' returning cs.session_id
  )
  update public.tutor_sessions s set hangup_status = 'gave_up', hangup_error = '保持の上限を過ぎた'
    from gone where s.id = gone.session_id;

  update public.tutor_sweeper set last_result = jsonb_build_object('ended', v_ended, 'at', now()) where id = 1;

  return query
  with picked as (
    select cs.session_id from public.tutor_call_secrets cs join public.tutor_sessions s on s.id = cs.session_id
     where s.status = 'ended' and s.call_id is not null
       and cs.next_attempt_at <= now() and (cs.claimed_until is null or cs.claimed_until < now())
     order by cs.next_attempt_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update of cs skip locked
  ), claimed as (
    update public.tutor_call_secrets cs set claimed_until = now() + interval '2 minutes'
      from picked where cs.session_id = picked.session_id
    returning cs.session_id, cs.ciphertext, cs.attempts
  )
  select c.session_id, s.call_id, c.ciphertext, c.attempts, s.end_reason
    from claimed c join public.tutor_sessions s on s.id = c.session_id;
end $$;
revoke all on function public.tutor_sweep_due(boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.tutor_sweep_due(boolean, integer, integer) to service_role;

create or replace function public.tutor_sweep_record(p_id uuid, p_ok boolean, p_error text)
returns text language sql security definer set search_path = public as $$
  select public.tutor_hangup_result_internal(p_id, p_ok, p_error, 'sweeper')
$$;
revoke all on function public.tutor_sweep_record(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.tutor_sweep_record(uuid, boolean, text) to service_role;

-- 見回りが動いているか（直近3分以内に実行されたか）。アプリは、動いていなければ新しい会話を始めない
create or replace function public.tutor_sweeper_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select last_run_at > now() - interval '3 minutes' from public.tutor_sweeper where id = 1), false)
$$;
revoke all on function public.tutor_sweeper_ok() from public, anon;
grant execute on function public.tutor_sweeper_ok() to authenticated, service_role;

-- 管理者向け：見回りの最終実行と、通話を切れなかった会話の件数（自校の分）
create or replace function public.tutor_sweeper_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_staff() then jsonb_build_object(
    'last_run_at', (select last_run_at from public.tutor_sweeper where id = 1),
    'failed', (select count(*) from public.tutor_sessions where school_id = public.current_school_id() and hangup_status = 'failed'),
    'gave_up', (select count(*) from public.tutor_sessions where school_id = public.current_school_id() and hangup_status = 'gave_up'),
    'pending', (select count(*) from public.tutor_sessions where school_id = public.current_school_id() and status = 'ended' and hangup_status = 'pending'))
  end
$$;
revoke all on function public.tutor_sweeper_status() from public, anon;
grant execute on function public.tutor_sweeper_status() to authenticated;

/* ---------------------------------------------------------------- 定期処理から呼ぶ（pg_cron → pg_net → アプリ） */
-- pg_cron と pg_net を有効にした環境で、cron.schedule から呼ぶ（docs/TUTOR-SWEEP.md）。
-- 秘密（アプリと同じ CRON_SECRET）は Supabase Vault の 'tutor_sweep_secret' に置く（SQL やログに書かない）。
-- Vercel の Preview の保護を越えるときは、Vault の 'vercel_protection_bypass' も使う。
create or replace function public.tutor_sweep_ping(p_url text)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text; v_bypass text; v_headers jsonb;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'tutor_sweep_secret';
  if v_secret is null then raise exception 'Vault に tutor_sweep_secret がありません'; end if;
  select decrypted_secret into v_bypass from vault.decrypted_secrets where name = 'vercel_protection_bypass';
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
  if v_bypass is not null then v_headers := v_headers || jsonb_build_object('x-vercel-protection-bypass', v_bypass); end if;
  return net.http_post(url := p_url, body := '{}'::jsonb, headers := v_headers, timeout_milliseconds := 50000);
end $$;
revoke all on function public.tutor_sweep_ping(text) from public, anon, authenticated;

commit;
