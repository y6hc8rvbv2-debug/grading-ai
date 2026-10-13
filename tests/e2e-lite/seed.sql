-- tests/e2e-lite の初期データ（架空。実名は持たない）。全マイグレーションの後に postgres で流す。
--   学校 eeee…00「ライト検証中学校」、管理者 …01、生徒アカウント …02（生徒A …21）・…03（生徒B …22）、クラス …11
--   テスト1 …31：正答・解説を公開しない／テスト2 …32：公開する
create or replace function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;
insert into public.schools(id, name, code) values ('eeeeeeee-0000-0000-0000-000000000000', 'ライト検証中学校', 'LITE-1');
insert into auth.users(id, email, email_confirmed_at, raw_app_meta_data) values
 ('eeeeeeee-0000-0000-0000-000000000001', 'admin@lite.example', now(), '{"school_id":"eeeeeeee-0000-0000-0000-000000000000","role":"admin"}'),
 ('eeeeeeee-0000-0000-0000-000000000002', 'stu-a@lite.example', now(), '{}'),
 ('eeeeeeee-0000-0000-0000-000000000003', 'stu-b@lite.example', now(), '{}');
insert into public.classes(id, school_id, grade, name, school_year) values ('eeeeeeee-0000-0000-0000-000000000011', 'eeeeeeee-0000-0000-0000-000000000000', 2, 'ライト組', 2026);
insert into public.students(id, school_id, class_id, number, exam_no, anon_id) values
 ('eeeeeeee-0000-0000-0000-000000000021', 'eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000011', 7, 'LT07', '生徒A07'),
 ('eeeeeeee-0000-0000-0000-000000000022', 'eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000011', 8, 'LT08', '生徒B08');
insert into public.tests(id, school_id, name, subject, grade, max_score, release_model_answer) values
 ('eeeeeeee-0000-0000-0000-000000000031', 'eeeeeeee-0000-0000-0000-000000000000', '一学期ライトテスト', '数学', 2, 10, false),
 ('eeeeeeee-0000-0000-0000-000000000032', 'eeeeeeee-0000-0000-0000-000000000000', '二学期ライトテスト', '数学', 2, 5, true);
insert into public.questions(id, school_id, test_id, no, label, qtype, unit, points, correct, model_answer, prompt_text) values
 ('eeeeeeee-0000-0000-0000-000000000041', 'eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000031', 1, '大問1-(1)', 'calc', '', 5, '7', '3+4=7', '3+4 を計算しなさい'),
 ('eeeeeeee-0000-0000-0000-000000000042', 'eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000031', 2, '大問1-(2)', 'calc', '', 5, 'HIDDEN-ANSWER-4a', 'HIDDEN-EXPLANATION-符号', '-4a+6b-12 を計算しなさい'),
 ('eeeeeeee-0000-0000-0000-000000000043', 'eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000032', 1, '大問2', 'calc', '', 5, 'x=2', '両辺を2でわる', '2x=4 を解きなさい');
insert into public.submissions(id, school_id, test_id, student_id, class_id, status, progress, image_paths) values
 ('eeeeeeee-0000-0000-0000-000000000051', 'eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000031', 'eeeeeeee-0000-0000-0000-000000000021', 'eeeeeeee-0000-0000-0000-000000000011', 'done', 100, array['eeeeeeee-0000-0000-0000-000000000000/t1/a/1.jpg']),
 ('eeeeeeee-0000-0000-0000-000000000052', 'eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000032', 'eeeeeeee-0000-0000-0000-000000000021', 'eeeeeeee-0000-0000-0000-000000000011', 'done', 100, array['eeeeeeee-0000-0000-0000-000000000000/t2/a/1.jpg']),
 ('eeeeeeee-0000-0000-0000-000000000053', 'eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000031', 'eeeeeeee-0000-0000-0000-000000000022', 'eeeeeeee-0000-0000-0000-000000000011', 'done', 100, array['eeeeeeee-0000-0000-0000-000000000000/t1/b/1.jpg']);
insert into public.submission_items(school_id, submission_id, question_id, qno, mark, earned, need_review, detected, comment) values
 ('eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000051', 'eeeeeeee-0000-0000-0000-000000000041', 1, '○', 5, false, '7', ''),
 ('eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000051', 'eeeeeeee-0000-0000-0000-000000000042', 2, '×', 0, false, '-4a-6b+12', 'かっこの前のマイナスに注意'),
 ('eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000052', 'eeeeeeee-0000-0000-0000-000000000043', 1, '×', 0, false, 'x=8', '両辺に同じ操作をしよう'),
 ('eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000053', 'eeeeeeee-0000-0000-0000-000000000041', 1, '×', 0, false, '12', 'B-ONLY-COMMENT'),
 ('eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000053', 'eeeeeeee-0000-0000-0000-000000000042', 2, '○', 5, false, '4a-6b+12', '');
insert into storage.buckets(id, name) values ('answer-sheets', 'answer-sheets') on conflict do nothing;

-- 先生の操作（本物の関数で）：配信先の登録 → 教師確認 → 本人だけに返却
set role authenticated;
select pg_temp.login('eeeeeeee-0000-0000-0000-000000000001');
select public.bind_student_account('eeeeeeee-0000-0000-0000-000000000021', 'stu-a@lite.example');
select public.bind_student_account('eeeeeeee-0000-0000-0000-000000000022', 'stu-b@lite.example');
select public.mark_submission_reviewed(id) from public.submissions where school_id = 'eeeeeeee-0000-0000-0000-000000000000' order by id;
select public.publish_submission_result(id) from public.submissions where school_id = 'eeeeeeee-0000-0000-0000-000000000000' order by id;
reset role;
-- 返却の版が1つずつ・正答の公開はテスト2だけ（DB の返却内容の時点で確認）
do $$ begin
  assert (select count(*) from public.result_releases) = 3, '3件返却';
  assert (select payload->'items'->1->>'correct' from public.result_releases where submission_id = 'eeeeeeee-0000-0000-0000-000000000051') = '', '未公開の正答は返却内容に入らない';
  assert (select payload->'items'->0->>'correct' from public.result_releases where submission_id = 'eeeeeeee-0000-0000-0000-000000000052') = 'x=2', '公開した正答は入る';
  assert not (select review_copy_enabled from public.schools where id = 'eeeeeeee-0000-0000-0000-000000000000'), 'B方式は既定で無効';
end $$;
