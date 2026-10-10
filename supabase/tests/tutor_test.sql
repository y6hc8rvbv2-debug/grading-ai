-- 0012 返却の版・受信箱と、チャッピー先生（本人契約の音声復習）の検証。workflow_test.sql の後に実行する。
--   学校C（cccccccc-…）：管理者 …01、本人の生徒アカウント …02（生徒 …21）、別の利用者 …03
create or replace function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;
set role app_owner;
-- 別の生徒（…22）にも配信先（…03）を付け、答案と返却を作る
insert into public.student_accounts values ('cccccccc-0000-0000-0000-000000000022', 'cccccccc-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000000');
insert into public.submissions(id,school_id,test_id,student_id,class_id,status,progress,image_paths) values
 ('cccccccc-0000-0000-0000-000000000052','cccccccc-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000031','cccccccc-0000-0000-0000-000000000022','cccccccc-0000-0000-0000-000000000011','done',100,array['cccccccc-0000-0000-0000-000000000000/test2.jpg']);
insert into public.submission_items(school_id,submission_id,question_id,qno,mark,earned,need_review,detected) values
 ('cccccccc-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000052','cccccccc-0000-0000-0000-000000000041',1,'×',0,false,'x=3');
update public.questions set correct = '2', model_answer = '両辺を2でわる', prompt_text = '2x=4 を解きなさい'
 where id = 'cccccccc-0000-0000-0000-000000000041';

set role authenticated;
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
select public.mark_submission_reviewed('cccccccc-0000-0000-0000-000000000052');
do $$
declare v_rel uuid;
begin
  -- 返却内容：問題文と本人の解答は入り、模範解答・正答は公開設定が無いと入らない
  assert public.publish_submission_result('cccccccc-0000-0000-0000-000000000052') = 1, '返却できる';
  select id into v_rel from public.result_releases where submission_id = 'cccccccc-0000-0000-0000-000000000052';
  assert (select payload->'items'->0->>'prompt' from public.result_releases where id = v_rel) = '2x=4 を解きなさい', '問題文を返却内容に入れる';
  assert (select payload->'items'->0->>'detected' from public.result_releases where id = v_rel) = 'x=3', '本人の解答を返却内容に入れる';
  assert (select payload->'items'->0->>'correct' from public.result_releases where id = v_rel) = '', '公開設定が無ければ正答は入れない';
  assert (select payload->'items'->0->>'model' from public.result_releases where id = v_rel) = '', '公開設定が無ければ模範解答は入れない';
  assert (select version from public.result_releases where id = v_rel) = 1;
  assert (select count(*) from public.student_inbox where release_id = v_rel) = 1, '返却で受信箱に1件';
  -- 同じ内容の返し直しは、版も受信箱も増えない（二重操作・再送）
  assert public.publish_submission_result('cccccccc-0000-0000-0000-000000000052') = 0, '同じ内容は更新しない';
  assert (select count(*) from public.student_inbox where release_id = v_rel) = 1, '二重返却で通知が増えない';
  -- 確認後の修正は再確認が必要。確認して返し直すと版2・受信箱2件・履歴2件
  update public.submission_items set comment = '符号に注意' where submission_id = 'cccccccc-0000-0000-0000-000000000052';
  begin
    perform public.publish_submission_result('cccccccc-0000-0000-0000-000000000052');
    raise exception 'TEST: unreviewed change published';
  exception when raise_exception then if sqlerrm like 'TEST:%' then raise; end if; end;
  assert (select payload->'items'->0->>'comment' from public.result_releases where id = v_rel) = '', '未確認の修正は生徒に出ない';
end $$;
select public.mark_submission_reviewed('cccccccc-0000-0000-0000-000000000052');
-- 正答・模範解答を公開する設定で返し直す
set role app_owner;
update public.tests set release_model_answer = true where id = 'cccccccc-0000-0000-0000-000000000031';
set role authenticated;
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
do $$
declare v_rel uuid;
begin
  select id into v_rel from public.result_releases where submission_id = 'cccccccc-0000-0000-0000-000000000052';
  assert public.publish_submission_result('cccccccc-0000-0000-0000-000000000052') = 1, '確認後は返し直せる';
  assert (select version from public.result_releases where id = v_rel) = 2, '内容が変わったら版を上げる';
  assert (select payload->'items'->0->>'comment' from public.result_releases where id = v_rel) = '符号に注意';
  assert (select payload->'items'->0->>'model' from public.result_releases where id = v_rel) = '両辺を2でわる', '公開設定なら模範解答を入れる';
  assert (select count(*) from public.student_inbox where release_id = v_rel) = 2, '再返却で受信箱に「更新」を1件';
  assert (select kind from public.student_inbox where release_id = v_rel and version = 2) = 'updated';
  assert (select count(*) from public.result_release_history where release_id = v_rel) = 2, '返却の履歴を版ごとに残す';
  -- 管理者・教員は生徒のキーを読めない（行があっても見えない）
  assert (select count(*) from public.tutor_credentials) = 0;
end $$;

-- ---------------------------------------------------------------- 生徒（…03＝生徒…22）として
select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
do $$
declare v_rel uuid; v_other uuid; v jsonb; v2 jsonb; rejected boolean;
begin
  select id into v_rel from public.result_releases where submission_id = 'cccccccc-0000-0000-0000-000000000052';
  assert v_rel is not null, '本人の返却は見える';
  select id into v_other from public.result_releases where submission_id = 'cccccccc-0000-0000-0000-000000000051';
  assert v_other is null, '別の生徒の返却は見えない';
  assert (select count(*) from public.student_inbox) = 2, '受信箱は本人の分だけ';
  assert (select count(*) from public.result_release_history) = 0, '返却の履歴は生徒には見えない';
  perform public.mark_inbox_read((select id from public.student_inbox where version = 1));
  assert (select count(*) from public.student_inbox where read_at is not null) = 1, '既読にできる';

  -- 機能が無効のあいだは会話を始められない
  begin perform public.start_tutor_session(v_rel, 1, 'voice', 'm'); rejected := false;
  exception when others then rejected := sqlerrm = 'tutor_disabled'; end;
  assert rejected, '機能が無効なら断る';
end $$;
-- 管理者が学校とクラスで有効にする（教員はできない）
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');
do $$ begin
  begin perform public.set_tutor_settings(true, 10, 30, array['cccccccc-0000-0000-0000-000000000011']::uuid[]);
    raise exception 'TEST: other school teacher changed settings';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
select public.set_tutor_settings(true, 10, 30, array['cccccccc-0000-0000-0000-000000000011']::uuid[]);

select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
do $$
declare v_rel uuid; v jsonb; rejected boolean; v_items text;
begin
  select id into v_rel from public.result_releases where submission_id = 'cccccccc-0000-0000-0000-000000000052';
  select string_agg(concat_ws('|', mark, earned, comment, need_review), ',') into v_items from public.submission_items;
  -- 同意が無いと始められない
  begin perform public.start_tutor_session(v_rel, 1, 'voice', 'm'); rejected := false;
  exception when others then rejected := sqlerrm = 'tutor_no_consent'; end;
  assert rejected, '同意が無ければ断る';
  insert into public.tutor_consents (student_id, school_id, user_id, payer, terms_confirmed)
  values ('cccccccc-0000-0000-0000-000000000022', 'cccccccc-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000003', 'self', true);
  -- 本人のキー（暗号文）を保存できる。他人の生徒IDでは保存できない
  insert into public.tutor_credentials (student_id, school_id, user_id, payer, ciphertext, key_hint)
  values ('cccccccc-0000-0000-0000-000000000022', 'cccccccc-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000003', 'self', 'v1.cipher', 'abcd');
  begin
    insert into public.tutor_credentials (student_id, school_id, user_id, payer, ciphertext)
    values ('cccccccc-0000-0000-0000-000000000021', 'cccccccc-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000003', 'self', 'x');
    raise exception 'TEST: credential for other student';
  exception when insufficient_privilege then null; end;
  -- 設問が無い・他人の返却では始められない
  begin perform public.start_tutor_session(v_rel, 9, 'voice', 'm'); rejected := false;
  exception when others then rejected := sqlerrm = 'tutor_not_found'; end;
  assert rejected, '返却に無い設問は断る';
  -- 始める → 同時に2つは断る → 終える → 何度終えてもよい
  v := public.start_tutor_session(v_rel, 1, 'voice', 'gpt-realtime-test');
  assert (v->>'max_seconds')::int = 600, '1回の上限（10分）';
  begin perform public.start_tutor_session(v_rel, 1, 'text', 'm'); rejected := false;
  exception when others then rejected := sqlerrm = 'tutor_busy'; end;
  assert rejected, '同時に2つの会話は断る';
  assert public.heartbeat_tutor_session((v->>'id')::uuid, 30) = 'ok', '会話中は続けられる';
  assert public.set_tutor_call((v->>'id')::uuid, 'rtc_test_1', 'v1.secret-ciphertext'), '通話IDと、通話を切る資格情報を記録する';
  assert not public.set_tutor_call((v->>'id')::uuid, 'rtc_test_2', 'v1.secret-ciphertext'), '通話IDは1回だけ記録できる';
  assert (select call_id from public.tutor_sessions where id = (v->>'id')::uuid) = 'rtc_test_1', '通話IDを記録する';
  perform public.end_tutor_session((v->>'id')::uuid, 'user', 45, '{"input_tokens": 10}'::jsonb);
  perform public.end_tutor_session((v->>'id')::uuid, 'again', 999, '{}'::jsonb);
  assert (select status from public.tutor_sessions where id = (v->>'id')::uuid) = 'ended';
  assert (select end_reason from public.tutor_sessions where id = (v->>'id')::uuid) = 'user', '終わった会話の理由は変わらない';
  assert (select seconds from public.tutor_sessions where id = (v->>'id')::uuid) <= 1, '経過時間はサーバーの時計を超えて申告できない';
  assert public.heartbeat_tutor_session((v->>'id')::uuid, 60) = 'ended', '終わった会話は続けられない';
  -- 1時間に6回まで
  for i in 2..6 loop
    v := public.start_tutor_session(v_rel, 1, 'text', 'm');
    perform public.end_tutor_session((v->>'id')::uuid, 'user', 0, '{}'::jsonb);
  end loop;
  begin perform public.start_tutor_session(v_rel, 1, 'voice', 'm'); rejected := false;
  exception when others then rejected := sqlerrm = 'tutor_too_many'; end;
  assert rejected, '1時間の開始回数の上限';
  -- 会話の記録を直接書き換えられない
  update public.tutor_sessions set seconds = 0;
  assert not found, '会話の記録は直接書き換えられない';

  -- 復習の状態：自己申告はできるが「理解確認済み」は付けられない
  insert into public.tutor_progress (school_id, student_id, release_id, qno, state, source)
  values ('cccccccc-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000022', v_rel, 1, 'self_understood', 'self');
  begin
    update public.tutor_progress set state = 'verified', source = 'teacher';
    raise exception 'TEST: student verified';
  exception when insufficient_privilege or check_violation then null; end;
  -- 文字起こしは「保存する」に同意していないと保存できない
  begin
    insert into public.tutor_transcripts (session_id, school_id, student_id, body)
    values ((select id from public.tutor_sessions limit 1), 'cccccccc-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000022', '会話');
    raise exception 'TEST: transcript without consent';
  exception when insufficient_privilege then null; end;
  insert into public.tutor_reflections (school_id, student_id, release_id, qno, source, note)
  values ('cccccccc-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000022', v_rel, 1, 'external_chatgpt', '移項の符号を確かめる');

  -- 復習しても、正式な採点・コメント・要確認は変わらない
  assert (select string_agg(concat_ws('|', mark, earned, comment, need_review), ',') from public.submission_items) is not distinct from v_items;
end $$;

reset role;
select set_config('test.rel52', (select id::text from public.result_releases where submission_id = 'cccccccc-0000-0000-0000-000000000052'), false);
set role authenticated;
-- 別の生徒（…02＝生徒…21）からは、…22 の同意・キー・会話・状態・振り返り・受信箱が見えず、会話も始められない
select pg_temp.login('cccccccc-0000-0000-0000-000000000002');
do $$
declare v_rel uuid; rejected boolean;
begin
  assert (select count(*) from public.tutor_consents) = 0;
  assert (select count(*) from public.tutor_credentials) = 0, '他人のキーは見えない';
  assert (select count(*) from public.tutor_sessions) = 0;
  assert (select count(*) from public.tutor_progress) = 0;
  assert (select count(*) from public.tutor_reflections) = 0;
  assert (select count(*) from public.student_inbox where student_id = 'cccccccc-0000-0000-0000-000000000022') = 0;
  v_rel := current_setting('test.rel52')::uuid;
  begin perform public.start_tutor_session(v_rel, 1, 'voice', 'm'); rejected := false;
  exception when others then rejected := sqlerrm = 'tutor_not_found'; end;
  assert rejected, '他人の返却で会話を始められない';
  update public.tutor_credentials set status = 'revoked';
  assert not found, '他人のキーを失効させられない';
end $$;

-- 管理者：キーは見えない。会話の記録（時間）と復習の状態は見える。振り返りは共有の同意が無いと見えない
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.tutor_credentials) = 0, '管理者は生徒のキーを見られない';
  assert (select count(*) from public.tutor_sessions) = 6, '管理者は会話の記録（時間・回数）を見られる';
  assert (select count(*) from public.tutor_progress) = 1;
  assert (select count(*) from public.tutor_reflections) = 0, '共有の同意が無ければ振り返りは見えない';
  -- 先生は「理解確認済み」にできる
  update public.tutor_progress set state = 'verified', source = 'teacher';
  assert found, '先生は理解確認済みにできる';
end $$;
-- 生存確認で、1回の上限・機能の停止・同意の撤回を見つけたら会話を終え、理由を返す（サーバーが通話を切る）
reset role;
create or replace function pg_temp.fake_session(p_minutes_ago integer) returns uuid language sql as $$
  insert into public.tutor_sessions (school_id, student_id, user_id, release_id, qno, mode, started_at, last_seen_at)
  values ('cccccccc-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000022', 'cccccccc-0000-0000-0000-000000000003',
          current_setting('test.rel52')::uuid, 1, 'voice', now() - make_interval(mins => p_minutes_ago), now())
  returning id
$$;
select set_config('test.s1', pg_temp.fake_session(11)::text, false);
set role authenticated;
select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
do $$ begin
  assert public.heartbeat_tutor_session(current_setting('test.s1')::uuid, 5) = 'time_limit', '1回の上限（10分）を過ぎたら time_limit';
  assert (select status from public.tutor_sessions where id = current_setting('test.s1')::uuid) = 'ended';
end $$;
reset role;
select set_config('test.s2', pg_temp.fake_session(0)::text, false);
update public.classes set tutor_enabled = false where id = 'cccccccc-0000-0000-0000-000000000011';
set role authenticated;
select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
do $$ begin
  assert public.heartbeat_tutor_session(current_setting('test.s2')::uuid, 5) = 'disabled', 'クラスで無効にされたら disabled';
end $$;
reset role;
update public.classes set tutor_enabled = true where id = 'cccccccc-0000-0000-0000-000000000011';
select set_config('test.s3', pg_temp.fake_session(0)::text, false);
update public.tutor_consents set revoked_at = now() where student_id = 'cccccccc-0000-0000-0000-000000000022';
set role authenticated;
select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
do $$ begin
  assert public.heartbeat_tutor_session(current_setting('test.s3')::uuid, 5) = 'no_consent', '同意を撤回したら no_consent';
end $$;
reset role;
update public.tutor_consents set revoked_at = null where student_id = 'cccccccc-0000-0000-0000-000000000022';
set role authenticated;

-- 生徒が共有に同意すると、先生は振り返りを見られる。撤回すると見えなくなる
select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
do $$ begin
  update public.tutor_progress set state = 'reviewing', source = 'self';
  assert not found, '先生が理解確認済みにした状態を、生徒は戻せない';
  delete from public.tutor_progress;
  assert not found, '先生が理解確認済みにした状態を、生徒は消せない';
end $$;
update public.tutor_consents set share_with_teacher = true, save_transcript = true;
insert into public.tutor_transcripts (session_id, school_id, student_id, body)
select id, school_id, student_id, '会話の文字起こし' from public.tutor_sessions limit 1;
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.tutor_reflections) = 1, '共有に同意すれば振り返りが見える';
  assert (select count(*) from public.tutor_transcripts) = 1, '共有に同意すれば文字起こしが見える';
end $$;
select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
update public.tutor_consents set revoked_at = now();
do $$ begin
  assert (select count(*) from public.tutor_transcripts) = 0, '同意を撤回したら文字起こしを消す';
end $$;
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.tutor_reflections) = 0, '撤回したら先生から振り返りが見えなくなる';
end $$;
-- 生徒の画面用の状態と、監査ログ（決まった操作名だけ）
select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
do $$ begin
  assert (public.tutor_status()->>'enabled')::boolean, '有効なら使える';
  assert (public.tutor_status()->>'used_seconds_today')::int >= 0;
  perform public.tutor_log('key_deleted');
  begin perform public.tutor_log('anything'); raise exception 'TEST: arbitrary audit';
  exception when raise_exception then if sqlerrm like 'TEST:%' then raise; end if; end;
end $$;
-- 本人がキーを消す（行ごと削除）
select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
delete from public.tutor_credentials;
do $$ begin assert (select count(*) from public.tutor_credentials) = 0, '本人はキーを削除できる'; end $$;
reset role;
