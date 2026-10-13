-- 0013 見回り（ブラウザが来なくても通話をサーバーが切る）の検証。tutor_test.sql の後に実行する。
--   学校C：管理者 …01、生徒 …22 の配信先 …03。返却 test.rel52（tutor_test.sql で作成）
create or replace function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;
reset role;
select set_config('test.rel52', (select id::text from public.result_releases where submission_id = 'cccccccc-0000-0000-0000-000000000052'), false);
update public.tutor_consents set revoked_at = null where student_id = 'cccccccc-0000-0000-0000-000000000022';
update public.tutor_sessions set status = 'ended', ended_at = now() where status = 'active';
-- tutor_test.sql で記録した通話（切っていない）は、ここでは対象にしない
delete from public.tutor_call_secrets;
-- 進行中の会話（通話IDと資格情報つき）を作る。started は何分前に始めたか、seen は最後の生存確認が何秒前か
create or replace function pg_temp.live(p_started_min integer, p_seen_sec integer, p_call text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.tutor_sessions (school_id, student_id, user_id, release_id, qno, mode, started_at, last_seen_at, call_id, hangup_status)
  values ('cccccccc-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000022', 'cccccccc-0000-0000-0000-000000000003',
          current_setting('test.rel52')::uuid, 1, 'voice', now() - make_interval(mins => p_started_min), now() - make_interval(secs => p_seen_sec), p_call, 'pending')
  returning id into v;
  insert into public.tutor_call_secrets (session_id, school_id, ciphertext, delete_after)
  values (v, 'cccccccc-0000-0000-0000-000000000000', 'v1.cipher-' || p_call, now() + interval '40 minutes');
  return v;
end $$;

-- 1. 資格情報は、生徒・先生・管理者のだれも読めない。本人の会話の分だけ、関数で暗号文を受け取れる
select set_config('test.a', pg_temp.live(0, 0, 'rtc_a')::text, false);
set role authenticated;
select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
do $$ declare denied boolean := false; begin
  begin perform 1 from public.tutor_call_secrets; exception when insufficient_privilege then denied := true; end;
  assert denied, '生徒は資格情報の表を読めない';
  assert public.tutor_call_secret(current_setting('test.a')::uuid) = 'v1.cipher-rtc_a', '本人の会話の暗号文は関数で受け取れる（サーバーが通話を切るため）';
  denied := false;
  begin perform public.tutor_sweep_due(false, 90, 50); exception when insufficient_privilege then denied := true; end;
  assert denied, '生徒は見回りを呼べない';
  assert public.tutor_sweeper_status() is null, '生徒には見回りの状態を返さない';
end $$;
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
do $$ declare denied boolean := false; begin
  begin perform 1 from public.tutor_call_secrets; exception when insufficient_privilege then denied := true; end;
  assert denied, '管理者も資格情報の表を読めない';
  assert public.tutor_call_secret(current_setting('test.a')::uuid) is null, '管理者は生徒の会話の暗号文を受け取れない';
  denied := false;
  begin perform public.tutor_sweep_record(current_setting('test.a')::uuid, true, ''); exception when insufficient_privilege then denied := true; end;
  assert denied, '管理者も見回りの記録を書けない';
end $$;

-- 2. 生存確認が途絶えた会話（ブラウザの強制終了・通信断）を見回りが終わらせ、通話を切る対象として返す
reset role;
update public.tutor_sessions set last_seen_at = now() - interval '120 seconds' where id = current_setting('test.a')::uuid;
set role service_role;
do $$ declare r record; n integer := 0; begin
  for r in select * from public.tutor_sweep_due(false, 90, 50) loop
    n := n + 1;
    assert r.session_id = current_setting('test.a')::uuid and r.call_id = 'rtc_a' and r.ciphertext = 'v1.cipher-rtc_a' and r.end_reason = 'no_heartbeat';
  end loop;
  assert n = 1, '生存確認が90秒来ない会話を終わらせ、通話を切る対象として返す';
  assert (select status from public.tutor_sessions where id = current_setting('test.a')::uuid) = 'ended';
  assert (select count(*) from public.tutor_sweep_due(false, 90, 50)) = 0, '取り出し中（予約中）の通話は、もう一度は返さない（二重に切らない）';
  -- 失敗 → 間隔をあけて再試行
  assert public.tutor_sweep_record(current_setting('test.a')::uuid, false, 'HTTP 500') = 'failed';
  assert (select hangup_status || '/' || hangup_attempts || '/' || hangup_error from public.tutor_sessions where id = current_setting('test.a')::uuid) = 'failed/1/HTTP 500', '失敗と理由・回数を記録';
  assert (select next_attempt_at > now() + interval '5 seconds' from public.tutor_call_secrets where session_id = current_setting('test.a')::uuid), '次の試行は間隔をあける';
  assert (select count(*) from public.tutor_sweep_due(false, 90, 50)) = 0, '間隔のあいだは試さない';
end $$;
reset role;
update public.tutor_call_secrets set next_attempt_at = now() - interval '1 second' where session_id = current_setting('test.a')::uuid;
set role service_role;
do $$ begin
  assert (select count(*) from public.tutor_sweep_due(false, 90, 50)) = 1, '間隔が過ぎたら再試行する';
  assert public.tutor_sweep_record(current_setting('test.a')::uuid, true, '') = 'done';
  assert (select hangup_status from public.tutor_sessions where id = current_setting('test.a')::uuid) = 'done', '切れたら done';
  assert (select count(*) from public.tutor_call_secrets where session_id = current_setting('test.a')::uuid) = 0, '切れたら資格情報をすぐ消す';
  assert (select count(*) from public.audit_logs where target_id = current_setting('test.a')::uuid and action in ('tutor.hangup_failed', 'tutor.hangup_done')) = 2, '失敗・成功を監査ログに残す';
end $$;

-- 3. 1回の上限・学校/クラスでの停止・同意の撤回・緊急停止でも、見回りが終わらせる（生存確認は届いていても）
reset role;
select set_config('test.t', pg_temp.live(11, 0, 'rtc_t')::text, false);
set role service_role;
do $$ begin
  assert (select end_reason from public.tutor_sweep_due(false, 90, 50)) = 'time_limit', '1回の上限（10分）を過ぎたら time_limit';
end $$;
reset role;
select set_config('test.d', pg_temp.live(0, 0, 'rtc_d')::text, false);
update public.classes set tutor_enabled = false where id = 'cccccccc-0000-0000-0000-000000000011';
set role service_role;
do $$ begin assert (select end_reason from public.tutor_sweep_due(false, 90, 50)) = 'disabled', 'クラスで無効にされたら disabled'; end $$;
reset role;
update public.classes set tutor_enabled = true where id = 'cccccccc-0000-0000-0000-000000000011';
select set_config('test.c', pg_temp.live(0, 0, 'rtc_c')::text, false);
update public.tutor_consents set revoked_at = now() where student_id = 'cccccccc-0000-0000-0000-000000000022';
set role service_role;
do $$ begin assert (select end_reason from public.tutor_sweep_due(false, 90, 50)) = 'no_consent', '同意を撤回したら no_consent'; end $$;
reset role;
update public.tutor_consents set revoked_at = null where student_id = 'cccccccc-0000-0000-0000-000000000022';
select set_config('test.f', pg_temp.live(0, 0, 'rtc_f')::text, false);
set role service_role;
do $$ begin
  assert (select count(*) from public.tutor_sweep_due(false, 90, 50)) = 0, '問題のない会話は続ける';
  assert (select end_reason from public.tutor_sweep_due(true, 90, 50)) = 'feature_off', '緊急停止（TUTOR_FEATURE=off）なら feature_off';
end $$;

-- 4. 保持の上限を過ぎたら、切れなくても資格情報を消して gave_up（いつまでもキーを残さない）
reset role;
update public.tutor_call_secrets set delete_after = now() - interval '1 second', claimed_until = null, next_attempt_at = now() - interval '1 second'
 where session_id = current_setting('test.t')::uuid;
set role service_role;
do $$ begin
  assert public.tutor_sweep_record(current_setting('test.t')::uuid, false, 'HTTP 500') = 'gave_up';
  assert (select count(*) from public.tutor_call_secrets where session_id = current_setting('test.t')::uuid) = 0, '保持の上限を過ぎたら資格情報を消す';
  assert (select hangup_status from public.tutor_sessions where id = current_setting('test.t')::uuid) = 'gave_up';
end $$;
-- 結果を書けずに残った資格情報も、上限から10分過ぎたら見回りが消す
reset role;
update public.tutor_call_secrets set delete_after = now() - interval '11 minutes' where session_id = current_setting('test.d')::uuid;
set role service_role;
do $$ begin
  perform public.tutor_sweep_due(false, 90, 50);
  assert (select count(*) from public.tutor_call_secrets where session_id = current_setting('test.d')::uuid) = 0, '取り残された資格情報も消す';
  assert (select hangup_status from public.tutor_sessions where id = current_setting('test.d')::uuid) = 'gave_up';
end $$;

-- 5. 見回りが動いているか（止まっていればアプリは会話を始めない）と、管理者向けの件数
set role authenticated;
select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
do $$ begin assert public.tutor_sweeper_ok(), '直近に見回りが動いていれば ok'; end $$;
reset role;
update public.tutor_sweeper set last_run_at = now() - interval '4 minutes';
set role authenticated;
select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
do $$ begin assert not public.tutor_sweeper_ok(), '見回りが3分以上止まっていれば、会話を始めない'; end $$;
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
do $$ begin
  assert (public.tutor_sweeper_status()->>'gave_up')::int = 2, '管理者は期限までに切れなかった件数を見られる';
end $$;
reset role;
