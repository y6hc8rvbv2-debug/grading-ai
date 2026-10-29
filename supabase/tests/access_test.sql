-- ============================================================================
-- アクセス制限の点検（2026-10-29。docs/APPSTORE-PRECHECK.md 1）。全マイグレーションの後、隔離した DB だけで流す
--   架空の学校X・学校Y、教職員、生徒アカウント2人で、次を確かめる（RLS は外さない・service_role で迂回しない）
--   1. 学校Xの教職員は、学校Yの答案・採点結果・設問・名簿・返却・画像を読めない・変えられない・消せない・返却できない
--   2. 学校Xの教職員が、学校Yの ID・画像のパスを自校の答案に書き込んで返却し、学校Yの内容を引き出すことができない（0024）
--   3. 生徒Aは生徒Bの返却・画像・受信箱を読めない。生徒は教職員用の表（答案・採点結果・名簿）を読めない・書けない
--   4. 未ログイン（anon）は、どの表・画像も読めず、返却などの関数も呼べない
-- ============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;
-- 例外を期待する SQL を実行し、例外にならなければ止める
create or replace function pg_temp.must_fail(label text, q text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then return; end;
  raise exception 'FAIL: %', label;
end $$;

set role app_owner;
-- ---------------------------------------------------------------- 準備（架空のデータ）
insert into public.schools (id, name, code) values
  ('11111111-0000-0000-0000-000000000000', '点検用X校（架空）', 'AX'),
  ('22222222-0000-0000-0000-000000000000', '点検用Y校（架空）', 'AY');
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  ('11111111-0000-0000-0000-0000000000a1', 'x-admin@access.example', now(), '{"school_id":"11111111-0000-0000-0000-000000000000","role":"admin"}'),
  ('11111111-0000-0000-0000-0000000000a2', 'x-teacher@access.example', now(), '{"school_id":"11111111-0000-0000-0000-000000000000","role":"teacher"}'),
  ('22222222-0000-0000-0000-0000000000a2', 'y-teacher@access.example', now(), '{"school_id":"22222222-0000-0000-0000-000000000000","role":"teacher"}'),
  ('11111111-0000-0000-0000-0000000000b1', 'x-stu1@access.example', now(), '{}'),
  ('11111111-0000-0000-0000-0000000000b2', 'x-stu2@access.example', now(), '{}'),
  ('22222222-0000-0000-0000-0000000000b1', 'y-stu1@access.example', now(), '{}');
insert into public.classes (id, school_id, grade, name, school_year) values
  ('11111111-0000-0000-0000-0000000000c1', '11111111-0000-0000-0000-000000000000', 1, 'X1', 2026),
  ('22222222-0000-0000-0000-0000000000c1', '22222222-0000-0000-0000-000000000000', 1, 'Y1', 2026);
insert into public.students (id, school_id, class_id, number, exam_no, anon_id) values
  ('11111111-0000-0000-0000-0000000000d1', '11111111-0000-0000-0000-000000000000', '11111111-0000-0000-0000-0000000000c1', 1, 'X01', 'X01'),
  ('11111111-0000-0000-0000-0000000000d2', '11111111-0000-0000-0000-000000000000', '11111111-0000-0000-0000-0000000000c1', 2, 'X02', 'X02'),
  ('22222222-0000-0000-0000-0000000000d1', '22222222-0000-0000-0000-000000000000', '22222222-0000-0000-0000-0000000000c1', 1, 'Y01', 'Y01');
insert into public.student_accounts (student_id, user_id, school_id) values
  ('11111111-0000-0000-0000-0000000000d1', '11111111-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-000000000000'),
  ('11111111-0000-0000-0000-0000000000d2', '11111111-0000-0000-0000-0000000000b2', '11111111-0000-0000-0000-000000000000'),
  ('22222222-0000-0000-0000-0000000000d1', '22222222-0000-0000-0000-0000000000b1', '22222222-0000-0000-0000-000000000000');
insert into public.tests (id, school_id, name, subject, grade, max_score, release_model_answer) values
  ('11111111-0000-0000-0000-0000000000e1', '11111111-0000-0000-0000-000000000000', 'X小テスト', '数学', 1, 10, true),
  ('22222222-0000-0000-0000-0000000000e1', '22222222-0000-0000-0000-000000000000', 'Y秘密テスト', '数学', 1, 10, true);
insert into public.questions (id, school_id, test_id, no, label, qtype, unit, points, correct, model_answer, prompt_text) values
  ('11111111-0000-0000-0000-0000000000f1', '11111111-0000-0000-0000-000000000000', '11111111-0000-0000-0000-0000000000e1', 1, '1', 'calc', '', 10, '5', 'X の正答', 'X の問題'),
  ('22222222-0000-0000-0000-0000000000f1', '22222222-0000-0000-0000-000000000000', '22222222-0000-0000-0000-0000000000e1', 1, '1', 'calc', '', 10, 'Y-SECRET', 'Y の模範解答（秘密）', 'Y の問題（秘密）');
insert into public.submissions (id, school_id, test_id, student_id, class_id, status, progress, image_paths) values
  ('11111111-0000-0000-0000-000000000051', '11111111-0000-0000-0000-000000000000', '11111111-0000-0000-0000-0000000000e1', '11111111-0000-0000-0000-0000000000d1', '11111111-0000-0000-0000-0000000000c1', 'done', 100, array['11111111-0000-0000-0000-000000000000/e1/51/1.jpg']),
  ('11111111-0000-0000-0000-000000000052', '11111111-0000-0000-0000-000000000000', '11111111-0000-0000-0000-0000000000e1', '11111111-0000-0000-0000-0000000000d2', '11111111-0000-0000-0000-0000000000c1', 'done', 100, array['11111111-0000-0000-0000-000000000000/e1/52/1.jpg']),
  ('22222222-0000-0000-0000-000000000051', '22222222-0000-0000-0000-000000000000', '22222222-0000-0000-0000-0000000000e1', '22222222-0000-0000-0000-0000000000d1', '22222222-0000-0000-0000-0000000000c1', 'done', 100, array['22222222-0000-0000-0000-000000000000/e1/51/1.jpg']);
insert into public.submission_items (school_id, submission_id, question_id, qno, mark, earned, need_review) values
  ('11111111-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000051', '11111111-0000-0000-0000-0000000000f1', 1, '○', 10, false),
  ('11111111-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000052', '11111111-0000-0000-0000-0000000000f1', 1, '×', 0, false),
  ('22222222-0000-0000-0000-000000000000', '22222222-0000-0000-0000-000000000051', '22222222-0000-0000-0000-0000000000f1', 1, '○', 10, false);
insert into storage.objects (bucket_id, name) values
  ('answer-sheets', '11111111-0000-0000-0000-000000000000/e1/51/1.jpg'),
  ('answer-sheets', '11111111-0000-0000-0000-000000000000/e1/52/1.jpg'),
  ('answer-sheets', '22222222-0000-0000-0000-000000000000/e1/51/1.jpg');

-- 両校で確認 → 返却（生徒ごとの受信箱ができる）
set role authenticated;
select pg_temp.login('22222222-0000-0000-0000-0000000000a2');
select public.mark_submission_reviewed('22222222-0000-0000-0000-000000000051');
select public.publish_submission_result('22222222-0000-0000-0000-000000000051');
select pg_temp.login('11111111-0000-0000-0000-0000000000a2');
select public.mark_submission_reviewed('11111111-0000-0000-0000-000000000051');
select public.mark_submission_reviewed('11111111-0000-0000-0000-000000000052');
select public.publish_submission_result('11111111-0000-0000-0000-000000000051');
select public.publish_submission_result('11111111-0000-0000-0000-000000000052');

-- ---------------------------------------------------------------- 1. 学校Xの教職員から学校Yへ
do $$ declare n int; t text; begin
  foreach t in array array['submissions','submission_items','questions','tests','students','classes','result_releases','student_inbox','student_accounts','mark_positions','grading_jobs','audit_logs'] loop
    execute format('select count(*) from public.%I where school_id = %L', t, '22222222-0000-0000-0000-000000000000') into n;
    if n <> 0 then raise exception 'FAIL: 学校Xの先生に学校Yの % が見える（%件）', t, n; end if;
  end loop;
  assert (select count(*) from storage.objects where name like '22222222-%') = 0, 'FAIL: 学校Xの先生に学校Yの画像が見える';
  assert (select count(*) from storage.objects where name like '11111111-%') = 2, '学校Xの先生は自校の画像を読める';
  update public.submission_items set earned = 0 where school_id = '22222222-0000-0000-0000-000000000000'; get diagnostics n = row_count;
  assert n = 0, 'FAIL: 学校Yの点数を書き換えられた';
  update public.submissions set status = 'review' where school_id = '22222222-0000-0000-0000-000000000000'; get diagnostics n = row_count;
  assert n = 0, 'FAIL: 学校Yの答案を書き換えられた';
  delete from public.submissions where school_id = '22222222-0000-0000-0000-000000000000'; get diagnostics n = row_count;
  assert n = 0, 'FAIL: 学校Yの答案を消せた';
  update storage.objects set name = name where name like '22222222-%'; get diagnostics n = row_count;
  assert n = 0, 'FAIL: 学校Yの画像を書き換えられた';
end $$;
select pg_temp.must_fail('学校Yのフォルダに画像を置けた',
  $q$insert into storage.objects (bucket_id, name) values ('answer-sheets', '22222222-0000-0000-0000-000000000000/e1/51/2.jpg')$q$);
select pg_temp.must_fail('学校Yの答案を返却できた', $q$select public.publish_submission_result('22222222-0000-0000-0000-000000000051')$q$);
select pg_temp.must_fail('学校Yのクラスを一斉返却できた',
  $q$select public.publish_class_results('22222222-0000-0000-0000-0000000000e1', '22222222-0000-0000-0000-0000000000c1')$q$);
select pg_temp.must_fail('学校Yの答案を確認済みにできた', $q$select public.mark_submission_reviewed('22222222-0000-0000-0000-000000000051')$q$);
select pg_temp.must_fail('学校Yのテストを削除できた', $q$select public.remove_test('22222222-0000-0000-0000-0000000000e1')$q$);
select pg_temp.must_fail('学校Yの生徒を招待できた', $q$select public.bind_student_account('22222222-0000-0000-0000-0000000000d1', 'x-stu1@access.example')$q$);
select pg_temp.must_fail('学校Yに答案を作れた',
  $q$insert into public.submissions (school_id, test_id, student_id, class_id) values ('22222222-0000-0000-0000-000000000000', '22222222-0000-0000-0000-0000000000e1', '22222222-0000-0000-0000-0000000000d1', '22222222-0000-0000-0000-0000000000c1')$q$);

-- ---------------------------------------------------------------- 2. 他校の ID・画像のパスを自校の行に書き込む（0024 で断る）
select pg_temp.must_fail('自校の答案に学校Yの画像のパスを書けた',
  $q$update public.submissions set image_paths = array['22222222-0000-0000-0000-000000000000/e1/51/1.jpg'] where id = '11111111-0000-0000-0000-000000000051'$q$);
select pg_temp.must_fail('画像のパスに .. を書けた',
  $q$update public.submissions set image_paths = array['11111111-0000-0000-0000-000000000000/../22222222-0000-0000-0000-000000000000/e1/51/1.jpg'] where id = '11111111-0000-0000-0000-000000000051'$q$);
select pg_temp.must_fail('自校の答案を学校Yのテストに付け替えられた',
  $q$update public.submissions set test_id = '22222222-0000-0000-0000-0000000000e1' where id = '11111111-0000-0000-0000-000000000051'$q$);
select pg_temp.must_fail('学校Yの生徒の答案を自校に作れた',
  $q$insert into public.submissions (school_id, test_id, student_id, class_id) values ('11111111-0000-0000-0000-000000000000', '11111111-0000-0000-0000-0000000000e1', '22222222-0000-0000-0000-0000000000d1', '11111111-0000-0000-0000-0000000000c1')$q$);
select pg_temp.must_fail('自校の採点結果に学校Yの設問を付けられた',
  $q$update public.submission_items set question_id = '22222222-0000-0000-0000-0000000000f1' where submission_id = '11111111-0000-0000-0000-000000000051'$q$);
select pg_temp.must_fail('自校のテストに学校Yの資料のパスを書けた',
  $q$update public.tests set answer_key_paths = array['22222222-0000-0000-0000-000000000000/imports/r/1.jpg'] where id = '11111111-0000-0000-0000-0000000000e1'$q$);
select pg_temp.must_fail('学校Yのテストに設問を足せた',
  $q$insert into public.questions (school_id, test_id, no, label, qtype, points) values ('11111111-0000-0000-0000-000000000000', '22222222-0000-0000-0000-0000000000e1', 9, '9', 'calc', 1)$q$);
select pg_temp.must_fail('学校Yのクラスに自校の生徒を入れられた',
  $q$update public.students set class_id = '22222222-0000-0000-0000-0000000000c1' where id = '11111111-0000-0000-0000-0000000000d2'$q$);
select pg_temp.must_fail('学校Yのテストで提出リンクを作れた',
  $q$insert into public.submission_links (school_id, test_id, class_id, token, max_uploads, pages_max, expires_at) values ('11111111-0000-0000-0000-000000000000', '22222222-0000-0000-0000-0000000000e1', '11111111-0000-0000-0000-0000000000c1', 'tok_accessaccessaccessaccessacce', 3, 2, now() + interval '1 hour')$q$);
select pg_temp.must_fail('自校の答案に学校Yの赤ペンの位置を付けられた',
  $q$insert into public.mark_positions (school_id, submission_id, qno, page, x, y) values ('11111111-0000-0000-0000-000000000000', '22222222-0000-0000-0000-000000000051', 1, 1, 0.5, 0.5)$q$);
-- 自校の中の正しい書き込みは今までどおり通る
do $$ declare n int; begin
  update public.submissions set image_paths = array['11111111-0000-0000-0000-000000000000/e1/51/1.jpg', '11111111-0000-0000-0000-000000000000/e1/51/2.jpg']
   where id = '11111111-0000-0000-0000-000000000051'; get diagnostics n = row_count;
  assert n = 1, 'FAIL: 自校の画像のパスを保存できなくなった';
  update public.submissions set image_paths = array['11111111-0000-0000-0000-000000000000/e1/51/1.jpg'] where id = '11111111-0000-0000-0000-000000000051';
  insert into public.mark_positions (school_id, submission_id, qno, page, x, y) values ('11111111-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000051', 1, 1, 0.5, 0.5);
  delete from public.mark_positions where submission_id = '11111111-0000-0000-0000-000000000051';
end $$;
-- 返却の記録（関数が作る）も、他校の画像・生徒を指せない（関数の外から作られた場合の守り）
reset role;
set role app_owner;
select pg_temp.must_fail('返却の記録に学校Yの画像のパスを書けた',
  $q$update public.result_releases set image_paths = array['22222222-0000-0000-0000-000000000000/e1/51/1.jpg'] where submission_id = '11111111-0000-0000-0000-000000000051'$q$);
-- 生徒の付け替え：内容が同じ更新は既存のトリガーが取り消し、内容も変えると 0024 が断る。どちらでも学校Yの生徒は指せない
do $$ begin
  begin
    update public.result_releases set student_id = '22222222-0000-0000-0000-0000000000d1' where submission_id = '11111111-0000-0000-0000-000000000051';
    update public.result_releases set student_id = '22222222-0000-0000-0000-0000000000d1', payload = payload || '{"x":1}' where submission_id = '11111111-0000-0000-0000-000000000051';
  exception when insufficient_privilege then null; end;
  assert (select student_id from public.result_releases where submission_id = '11111111-0000-0000-0000-000000000051') = '11111111-0000-0000-0000-0000000000d1',
    'FAIL: 返却の記録で学校Yの生徒を指せた';
end $$;

-- ---------------------------------------------------------------- 3. 生徒どうし・生徒と教職員の表
set role authenticated;
select pg_temp.login('11111111-0000-0000-0000-0000000000b1');
do $$ declare n int; begin
  assert (select count(*) from public.result_releases) = 1, 'FAIL: 生徒1に自分以外の返却が見える（または自分のが見えない）';
  assert (select student_id from public.result_releases) = '11111111-0000-0000-0000-0000000000d1', 'FAIL: 生徒1に別人の返却が見える';
  assert (select count(*) from public.student_inbox) = 1, 'FAIL: 生徒1の受信箱に別人の分がある';
  assert (select count(*) from storage.objects) = 1, 'FAIL: 生徒1に自分以外の画像が見える';
  assert (select name from storage.objects) = '11111111-0000-0000-0000-000000000000/e1/51/1.jpg', 'FAIL: 生徒1に別人の画像が見える';
  assert (select payload::text not like '%Y の%' and payload::text not like '%Y-SECRET%' from public.result_releases), 'FAIL: 学校Yの問題文・正答が混ざった';
  assert (select count(*) from public.submissions) = 0, 'FAIL: 生徒に答案の表が見える';
  assert (select count(*) from public.submission_items) = 0, 'FAIL: 生徒に採点結果の表が見える';
  assert (select count(*) from public.students) = 0, 'FAIL: 生徒に名簿が見える';
  assert (select count(*) from public.tests) = 0, 'FAIL: 生徒にテストの表が見える';
  assert (select count(*) from public.questions) = 0, 'FAIL: 生徒に設問（正答）の表が見える';
  update public.result_releases set payload = '{}'::jsonb; get diagnostics n = row_count;
  assert n = 0, 'FAIL: 生徒が返却内容を書き換えられた';
  update public.submission_items set earned = 10; get diagnostics n = row_count;
  assert n = 0, 'FAIL: 生徒が点数を書き換えられた';
end $$;
select pg_temp.must_fail('生徒が返却できた', $q$select public.publish_submission_result('11111111-0000-0000-0000-000000000052')$q$);
select pg_temp.must_fail('生徒が画像を置けた',
  $q$insert into storage.objects (bucket_id, name) values ('answer-sheets', '11111111-0000-0000-0000-000000000000/e1/51/9.jpg')$q$);
select pg_temp.login('11111111-0000-0000-0000-0000000000b2');
do $$ begin
  assert (select count(*) from public.result_releases) = 1 and (select student_id from public.result_releases) = '11111111-0000-0000-0000-0000000000d2', 'FAIL: 生徒2の返却';
  assert (select name from storage.objects) = '11111111-0000-0000-0000-000000000000/e1/52/1.jpg', 'FAIL: 生徒2に別人の画像が見える';
end $$;
select pg_temp.login('22222222-0000-0000-0000-0000000000b1');
do $$ begin
  assert (select count(*) from public.result_releases) = 1 and (select school_id from public.result_releases) = '22222222-0000-0000-0000-000000000000', 'FAIL: 学校Yの生徒に学校Xの返却が見える';
  assert (select count(*) from storage.objects where name like '11111111-%') = 0, 'FAIL: 学校Yの生徒に学校Xの画像が見える';
end $$;
-- 教職員のアカウントではない一般の登録者（学校に所属しない）は何も見えない
select pg_temp.login('eeeeeeee-0000-0000-0000-00000000000e');
do $$ begin
  assert (select count(*) from public.result_releases) = 0 and (select count(*) from storage.objects) = 0 and (select count(*) from public.submissions) = 0,
    'FAIL: 学校に所属しない登録者に何かが見える';
end $$;
reset role;

-- ---------------------------------------------------------------- 4. 未ログイン（anon）
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare n int; t text; begin
  foreach t in array array['submissions','submission_items','questions','tests','students','classes','result_releases','student_inbox','student_accounts','schools','profiles'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      if n <> 0 then raise exception 'FAIL: 未ログインで % が見える（%件）', t, n; end if;
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    select count(*) into n from storage.objects;
    if n <> 0 then raise exception 'FAIL: 未ログインで画像が見える'; end if;
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.must_fail('未ログインで返却できた', $q$select public.publish_submission_result('11111111-0000-0000-0000-000000000051')$q$);
select pg_temp.must_fail('未ログインで確認済みにできた', $q$select public.mark_submission_reviewed('11111111-0000-0000-0000-000000000051')$q$);
select pg_temp.must_fail('未ログインで提出リンクの受付を呼べた', $q$select public.submit_link_claim('tok_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', '11111111-0000-0000-0000-0000000000d1', 1::smallint, false)$q$);
select pg_temp.must_fail('未ログインで画像を置けた',
  $q$insert into storage.objects (bucket_id, name) values ('answer-sheets', '11111111-0000-0000-0000-000000000000/e1/51/8.jpg')$q$);
reset role;
\echo ' OK: access_test（学校間・生徒間・未ログイン・他校の ID と画像のパスの書き込み）'
