-- 0016 本人によるアカウントの削除の検証。review_copy_test.sql の後に実行する。
--   学校C（cccccccc-…）：管理者 …01（この学校の唯一の管理者）、先生 …04、生徒アカウント …02（生徒 …21）・…03（生徒 …22）
--   auth.users の削除は、本番ではサーバーが Supabase Auth の管理 API で行う。ここでは同じ削除を SQL で再現する
create or replace function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;
reset role;
do $$ begin
  assert not has_function_privilege('anon', 'public.prepare_account_deletion()', 'execute'), '未ログインは呼べない';
  assert has_function_privilege('authenticated', 'public.prepare_account_deletion()', 'execute');
end $$;

-- 先生 …04 が生徒 …22 の答案を返却した状態にする（返却者が残っていると、以前は削除できなかった）
reset role;
-- （準備だけ）返却者を差し替える。同じ内容の更新は result_releases_enrich が何もしないので、一時的に外して書き換える
alter table public.result_releases disable trigger result_releases_enrich;
update public.result_releases set released_by = 'cccccccc-0000-0000-0000-000000000004'
 where submission_id = 'cccccccc-0000-0000-0000-000000000052';
alter table public.result_releases enable trigger result_releases_enrich;
create temp table before_release as
  select id, payload, version, released_at, image_paths from public.result_releases where submission_id = 'cccccccc-0000-0000-0000-000000000052';
grant select on before_release to authenticated;
-- 返却のあとで先生が答案を直した（未確認）。アカウントを消しても、この内容が生徒に出てはいけない
update public.submission_items set comment = '未確認の修正（生徒に出してはいけない）'
 where submission_id = 'cccccccc-0000-0000-0000-000000000052';

-- 1. 唯一の管理者は削除できない
set role authenticated;
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
do $$ begin
  begin
    perform public.prepare_account_deletion();
    raise exception 'TEST: last admin prepared';
  exception when raise_exception then
    if sqlerrm like 'TEST:%' then raise; end if;
    assert sqlerrm like '%最後の管理者%', sqlerrm;
  end;
end $$;

-- 2. 先生の削除：返却者を空にし、返却内容・版・受信箱は変えない
select pg_temp.login('cccccccc-0000-0000-0000-000000000004');
do $$ begin
  assert public.prepare_account_deletion() = '{"role": "teacher"}'::jsonb, '先生として準備できる';
end $$;
reset role;
do $$
declare b record; a record;
begin
  select * into b from before_release;
  select id, payload, version, released_at, image_paths, released_by into a from public.result_releases where id = b.id;
  assert a.released_by is null, '返却者が空になる';
  assert a.payload = b.payload and a.version = b.version and a.released_at = b.released_at and a.image_paths = b.image_paths,
    '返却内容・版・返却日時は変わらない（未確認の修正を生徒に出さない）';
  assert a.payload::text not like '%未確認の修正%', '未確認の修正は返却内容に入らない';
  assert (select count(*) from public.student_inbox where release_id = b.id) = (select max(version) from public.student_inbox where release_id = b.id), '受信箱は増えない';
end $$;
-- 管理 API と同じく auth.users を削除する。プロフィールは消え、学校の記録（答案・返却・監査ログ）は残る
delete from auth.users where id = 'cccccccc-0000-0000-0000-000000000004';
do $$ begin
  assert not exists (select 1 from public.profiles where id = 'cccccccc-0000-0000-0000-000000000004'), 'プロフィールは消える';
  assert exists (select 1 from public.result_releases where submission_id = 'cccccccc-0000-0000-0000-000000000052'), '返却した内容は学校の記録として残る';
  assert exists (select 1 from public.audit_logs where action = 'account.delete' and detail->>'role' = 'teacher'), '削除は監査ログに残る（だれかは残さない）';
end $$;

-- 3. 生徒の削除：配信先の登録・本人の自己申告と振り返りは消え、先生の「理解確認済み」と返却内容は残る
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
insert into public.tutor_progress(school_id, student_id, release_id, qno, state, source)
select school_id, student_id, id, 77, 'self_understood', 'external_self' from public.result_releases where student_id = 'cccccccc-0000-0000-0000-000000000021' limit 1;
insert into public.tutor_progress(school_id, student_id, release_id, qno, state, source)
select school_id, student_id, id, 78, 'verified', 'teacher' from public.result_releases where student_id = 'cccccccc-0000-0000-0000-000000000021' limit 1;
set role authenticated;
select pg_temp.login('cccccccc-0000-0000-0000-000000000002');
do $$ begin
  assert public.prepare_account_deletion() = '{"role": "student"}'::jsonb, '生徒として準備できる';
end $$;
reset role;
delete from auth.users where id = 'cccccccc-0000-0000-0000-000000000002';
do $$ begin
  assert not exists (select 1 from public.student_accounts where user_id = 'cccccccc-0000-0000-0000-000000000002'), '配信先の登録は消える';
  assert not exists (select 1 from public.tutor_progress where student_id = 'cccccccc-0000-0000-0000-000000000021' and source <> 'teacher'), '本人の自己申告は消える';
  assert exists (select 1 from public.tutor_progress where student_id = 'cccccccc-0000-0000-0000-000000000021' and source = 'teacher'), '先生の確認は学校の記録として残る';
  assert exists (select 1 from public.result_releases where student_id = 'cccccccc-0000-0000-0000-000000000021'), '返却した内容は残る（学校の記録。氏名は持たない）';
  assert exists (select 1 from public.students where id = 'cccccccc-0000-0000-0000-000000000021'), '名簿の行は残る';
end $$;

-- 4. ログインしていなければ呼べない
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
do $$ begin
  begin
    perform public.prepare_account_deletion();
    raise exception 'TEST: no user prepared';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 5. 保存期間の削除：画像を消し終えた答案（指定したもの）のうち、期限を過ぎたものだけを削除済みにする
insert into public.schools(id, name, code, retention) values ('dddddddd-0000-0000-0000-000000000000', '保存期間の確認校', 'RET-1', '30');
insert into public.classes(id, school_id, grade, name, school_year) values ('dddddddd-0000-0000-0000-000000000011', 'dddddddd-0000-0000-0000-000000000000', 1, 'R', 2026);
insert into public.students(id, school_id, class_id, number, exam_no, anon_id) values ('dddddddd-0000-0000-0000-000000000021', 'dddddddd-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000011', 1, 'R01', 'R01');
insert into public.tests(id, school_id, name, subject, grade, max_score) values
 ('dddddddd-0000-0000-0000-000000000031', 'dddddddd-0000-0000-0000-000000000000', 'R1', '数学', 1, 10),
 ('dddddddd-0000-0000-0000-000000000032', 'dddddddd-0000-0000-0000-000000000000', 'R2', '数学', 1, 10);
insert into public.submissions(id, school_id, test_id, student_id, class_id, status, progress, image_paths, uploaded_at) values
 ('dddddddd-0000-0000-0000-000000000051', 'dddddddd-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000031', 'dddddddd-0000-0000-0000-000000000021', 'dddddddd-0000-0000-0000-000000000011', 'uploaded', 0, array['d/old.jpg'], now() - interval '40 days'),
 ('dddddddd-0000-0000-0000-000000000052', 'dddddddd-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000032', 'dddddddd-0000-0000-0000-000000000021', 'dddddddd-0000-0000-0000-000000000011', 'uploaded', 0, array['d/new.jpg'], now() - interval '10 days');
do $$ begin
  assert not has_function_privilege('authenticated', 'public.purge_submissions(uuid[])', 'execute'), '先生・生徒は呼べない';
  assert not has_function_privilege('anon', 'public.purge_submissions(uuid[])', 'execute');
  assert has_function_privilege('service_role', 'public.purge_submissions(uuid[])', 'execute');
end $$;
set role service_role;
do $$ begin
  assert public.purge_submissions(array['dddddddd-0000-0000-0000-000000000051', 'dddddddd-0000-0000-0000-000000000052']::uuid[]) = 1, '期限を過ぎた1件だけ';
  assert public.purge_submissions(array['dddddddd-0000-0000-0000-000000000051']::uuid[]) = 0, '2回目は何もしない';
end $$;
reset role;
do $$ begin
  assert (select deleted_at is not null and image_paths = '{}' from public.submissions where id = 'dddddddd-0000-0000-0000-000000000051'), '期限切れは削除済み・画像の参照を空に';
  assert (select deleted_at is null and image_paths = array['d/new.jpg'] from public.submissions where id = 'dddddddd-0000-0000-0000-000000000052'), '期限前は変えない';
end $$;
select 'OK: account_deletion_test（最後の管理者は不可・先生と生徒の削除・返却内容は変えない・学校の記録は残る・保存期間の削除）' as result;
