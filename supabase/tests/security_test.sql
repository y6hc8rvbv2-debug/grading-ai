-- ============================================================================
-- 0021（セキュリティの強化）の検証。rls_test.sql・ver6_test.sql の後に流す
--   1. 閲覧専用の役割（viewer）は成績・名簿・答案の画像を書き換えられない。先生は今までどおり書き換えられる
--   2. 本人確認済み（ログインして出した）答案を、ログインしていない提出で上書きできない
-- ============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;

insert into auth.users (id, email, raw_app_meta_data) values
  ('aaaaaaaa-0000-0000-0000-00000000000e', 'viewer_a@example.com', '{"school_id":"aaaaaaaa-0000-0000-0000-000000000000","role":"viewer"}');
insert into public.students (id, school_id, class_id, number, exam_no, anon_id) values
  ('aaaaaaaa-0000-0000-0000-0000000001d8', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000c1', 8, '2A08', '生徒008');

-- ---------------------------------------------------------------- 1. 閲覧専用の役割
set role authenticated;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000e');
do $$ declare before numeric; n int; begin
  assert (select count(*) from public.submission_items) > 0, 'viewer は同じ学校の成績を読める';
  select earned into before from public.submission_items order by id limit 1;
  update public.submission_items set earned = earned + 1;   -- RLS で対象が0行になる（エラーにはならない）
  get diagnostics n = row_count;
  assert n = 0, 'FAIL: viewer が成績を書き換えられた';
  assert (select earned from public.submission_items order by id limit 1) = before, 'FAIL: viewer の更新で点数が変わった';
  begin
    insert into public.classes (school_id, grade, name, school_year) values ('aaaaaaaa-0000-0000-0000-000000000000', 1, 'Z', 2026);
    raise exception 'FAIL: viewer がクラスを作れた';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name) values ('answer-sheets', 'aaaaaaaa-0000-0000-0000-000000000000/x/y/1.jpg');
    raise exception 'FAIL: viewer が答案の画像を保存できた';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.submission_links (school_id, test_id, class_id, token, max_uploads, pages_max, expires_at) values
      ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000c1',
       'tok_viewerviewerviewerviewerview', 3, 2, now() + interval '1 hour');
    raise exception 'FAIL: viewer が提出リンクを作れた';
  exception when insufficient_privilege then null; end;
end $$;
-- 先生は今までどおり書き換えられる
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');
do $$ declare n int; begin
  update public.submission_items set comment = coalesce(comment, '') where school_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  assert n > 0, 'FAIL: 先生が成績を更新できなくなった';
end $$;
insert into public.submission_links (id, school_id, test_id, class_id, token, max_uploads, pages_max, expires_at) values
  ('aaaaaaaa-0000-0000-0000-0000000001a9', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 'tok_securitysecuritysecuritysecu', 10, 2, now() + interval '1 hour');
reset role;

-- ---------------------------------------------------------------- 2. 本人確認済みの答案の上書き
set role service_role;
do $$ declare ok boolean; begin
  perform public.submit_link_claim('tok_securitysecuritysecuritysecu', 'aaaaaaaa-0000-0000-0000-0000000001d8', 1::smallint, true);   -- 本人がログインして提出
  ok := false;
  begin perform public.submit_link_claim('tok_securitysecuritysecuritysecu', 'aaaaaaaa-0000-0000-0000-0000000001d8', 1::smallint, false);
  exception when sqlstate 'P0001' then ok := sqlerrm like '%ログインして提出済み%'; end;
  assert ok, 'FAIL: 本人確認済みの答案を、ログインしていない提出で上書きできた';
  perform public.submit_link_claim('tok_securitysecuritysecuritysecu', 'aaaaaaaa-0000-0000-0000-0000000001d8', 2::smallint, true);   -- 本人の出し直しは通る
  assert (select pages from public.submissions where student_id = 'aaaaaaaa-0000-0000-0000-0000000001d8') = 2, '本人はログインして出し直せる';
end $$;
reset role;
\echo ' OK: security_test（閲覧専用の役割は書き換えられない・先生は今までどおり・本人確認済みの答案は上書きされない）'
