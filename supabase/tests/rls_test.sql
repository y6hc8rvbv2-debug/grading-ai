-- ============================================================================
-- RLS とトリガーの検証。失敗すると例外で止まる（run.sh が非ゼロで終わる）。
--
-- 登場人物
--   学校A: 管理者 admin_a / 教員 teacher_a
--   学校B: 教員 teacher_b
-- ============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- JWT を模してログイン状態を切り替えるヘルパ
create or replace function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;

-- ---------------------------------------------------------------- 準備（RLS を越える管理操作）
insert into public.schools (id, name, code) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '学校A', 'A'),
  ('bbbbbbbb-0000-0000-0000-000000000000', '学校B', 'B');

-- 教職員の作成は招待（service_role）経由。所属と役割は app_metadata に入れる。
insert into auth.users (id, email, raw_app_meta_data) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'admin_a@example.com',
     '{"school_id":"aaaaaaaa-0000-0000-0000-000000000000","role":"admin"}'),
  ('aaaaaaaa-0000-0000-0000-00000000000b', 'teacher_a@example.com',
     '{"school_id":"aaaaaaaa-0000-0000-0000-000000000000"}'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'teacher_b@example.com',
     '{"school_id":"bbbbbbbb-0000-0000-0000-000000000000"}');

do $$
begin
  assert (select count(*) from public.profiles) = 3, 'app_metadata から profiles が3件作られること';
  assert (select role from public.profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 'admin',
    'app_metadata の role が反映されること';
end $$;

-- 【権限昇格】一般のサインアップ（user_metadata はブラウザから自由に書ける）で
-- 他校への所属や管理者権限を名乗れないこと
insert into auth.users (id, email, raw_user_meta_data) values
  ('eeeeeeee-0000-0000-0000-00000000000e', 'attacker@example.com',
     '{"school_id":"aaaaaaaa-0000-0000-0000-000000000000","role":"admin"}');
do $$
begin
  assert not exists (select 1 from public.profiles where id = 'eeeeeeee-0000-0000-0000-00000000000e'),
    'user_metadata だけでは profiles が作られないこと（誰でも他校の管理者になれてしまう）';
end $$;

-- 両校にクラス・生徒・テスト・設問を1件ずつ
insert into public.classes (id, school_id, grade, name, school_year) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000000', 2, 'A', 2026),
  ('bbbbbbbb-0000-0000-0000-0000000000c1', 'bbbbbbbb-0000-0000-0000-000000000000', 2, 'A', 2026);
insert into public.students (id, school_id, class_id, number, exam_no, anon_id) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 1, '2A01', '生徒001'),
  ('bbbbbbbb-0000-0000-0000-0000000000d1', 'bbbbbbbb-0000-0000-0000-000000000000',
   'bbbbbbbb-0000-0000-0000-0000000000c1', 1, '2A01', '生徒001');
insert into public.tests (id, school_id, name, subject, grade, max_score) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000000', '期末', '数学', 2, 10),
  ('bbbbbbbb-0000-0000-0000-0000000000e1', 'bbbbbbbb-0000-0000-0000-000000000000', '期末', '数学', 2, 10);
insert into public.questions (id, school_id, test_id, no, label, qtype, unit, points) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-0000000000e1', 1, '大問1-(1)', 'calc', '一次関数', 5),
  ('aaaaaaaa-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-0000000000e1', 2, '大問1-(2)', 'long', '一次関数', 5);

-- 学校Bにも監査ログを1件（他校から覗けないことの確認用）
insert into public.audit_logs (school_id, action) values ('bbbbbbbb-0000-0000-0000-000000000000', 'seed');

-- 【ルーブリック】学校の既定値（test_id が null）は1校1件まで
insert into public.rubrics (school_id) values ('aaaaaaaa-0000-0000-0000-000000000000');
do $$
begin
  begin
    insert into public.rubrics (school_id) values ('aaaaaaaa-0000-0000-0000-000000000000');
    raise exception 'FAIL: 学校の既定ルーブリックが2件作れてしまう';
  exception when unique_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------- 教員Aとして操作
set role authenticated;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');

do $$
begin
  assert (select count(*) from public.schools)  = 1, '自校だけ見えること（schools）';
  assert (select count(*) from public.students) = 1, '自校だけ見えること（students）';
  assert (select count(*) from public.tests)    = 1, '自校だけ見えること（tests）';
  assert (select count(*) from public.profiles) = 2, '自校の教職員だけ見えること';
end $$;

-- 他校の school_id では書き込めない
do $$
begin
  begin
    insert into public.classes (school_id, grade, name, school_year)
    values ('bbbbbbbb-0000-0000-0000-000000000000', 3, 'Z', 2026);
    raise exception 'FAIL: 他校にクラスを作れてしまう';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 採点結果を保存すると合計点と status がトリガーで決まる
insert into public.submissions (id, school_id, test_id, student_id, class_id, status) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000d1',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 'done');
insert into public.submission_items (school_id, submission_id, question_id, qno, mark, earned, need_review) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000a1',
   'aaaaaaaa-0000-0000-0000-0000000000f1', 1, '○', 5, false),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000a1',
   'aaaaaaaa-0000-0000-0000-0000000000f2', 2, '△', 2, true);
do $$
declare
  s record;
begin
  select total_score, status into s from public.submissions
   where id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  assert s.total_score = 7, format('合計点がトリガーで 7 になること（実際: %s）', s.total_score);
  assert s.status = 'review', format('要確認があれば status=review（実際: %s）', s.status);
end $$;

update public.submission_items set need_review = false, earned = 4
 where submission_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' and qno = 2;
do $$
declare
  s record;
begin
  select total_score, status into s from public.submissions
   where id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  assert s.total_score = 9 and s.status = 'done', '確認が済めば 9点・done に戻ること';
end $$;

-- 分析ビューが自校分だけ集計できる
do $$
begin
  assert (select rate from public.v_unit_mastery where unit = '一次関数') = 90.0, '単元別定着度 = 90%';
  assert (select count(*) from public.v_question_stats) = 2, '設問別正答率 = 2行';
end $$;

-- 【監査ログ】教員が追記でき、ハッシュ連鎖が張られること
insert into public.audit_logs (school_id, actor_id, action, target_table, target_id, detail) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000000b',
   'grade.edit', 'submission_items', 'aaaaaaaa-0000-0000-0000-0000000000a1', '{"qno":2}'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000000b',
   'submission.review', 'submissions', 'aaaaaaaa-0000-0000-0000-0000000000a1', '{}');
do $$
begin
  assert (select count(*) from public.audit_logs where hash is not null) = 2, '監査ログにハッシュが付くこと';
  assert not exists (select 1 from public.verify_audit_chain('aaaaaaaa-0000-0000-0000-000000000000') where not ok),
    '監査ログの連鎖が切れていないこと';
end $$;

-- 監査ログの実行者を他人に偽れない
do $$
begin
  begin
    insert into public.audit_logs (school_id, actor_id, action)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000000a', 'grade.edit');
    raise exception 'FAIL: 監査ログに管理者のふりをして書き込めてしまう';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 監査ログは書き換え・削除できない
do $$
begin
  begin
    update public.audit_logs set action = 'tampered';
    raise exception 'FAIL: 監査ログを書き換えられてしまう';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.audit_logs;
    raise exception 'FAIL: 監査ログを削除できてしまう';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 他校の監査ログは検証関数からも見えない
do $$
begin
  assert not exists (select 1 from public.verify_audit_chain('bbbbbbbb-0000-0000-0000-000000000000')),
    '他校の監査ログを覗けないこと';
end $$;

-- 【権限昇格】教員が自分の role を admin に書き換えられないこと
do $$
begin
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
  exception when insufficient_privilege then null;
  end;
  assert (select role from public.profiles where id = auth.uid()) = 'teacher',
    '教員が自分を管理者に昇格できてしまう';
end $$;
-- 表示名と UI 言語は自分で変えられる
update public.profiles set display_name = 'T.K', ui_lang = 'en' where id = auth.uid();
do $$
begin
  assert (select ui_lang from public.profiles where id = auth.uid()) = 'en', '表示名・言語は自分で変更できること';
end $$;

-- 【削除】教員は削除できない（管理者のみ）
delete from public.students;
do $$
begin
  assert (select count(*) from public.students) = 1, '教員は生徒を削除できないこと';
end $$;

-- 【Storage】自校フォルダにだけ置ける
insert into storage.objects (bucket_id, name)
values ('answer-sheets', 'aaaaaaaa-0000-0000-0000-000000000000/t/s/1.jpg');
do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('answer-sheets', 'bbbbbbbb-0000-0000-0000-000000000000/t/s/1.jpg');
    raise exception 'FAIL: 他校のフォルダに答案画像を置けてしまう';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 【提出リンク】発行・延長・削除ができる
insert into public.submission_links (id, school_id, test_id, class_id, token) values
  ('aaaaaaaa-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'tok-a');
update public.submission_links set expires_at = now() + interval '7 days'
 where id = 'aaaaaaaa-0000-0000-0000-0000000000b1';
do $$
begin
  assert (select expires_at > now() + interval '6 days' from public.submission_links), '提出リンクの期限を延長できること';
end $$;

-- ---------------------------------------------------------------- 教員Bとして操作
select pg_temp.login('bbbbbbbb-0000-0000-0000-00000000000b');
do $$
begin
  assert (select count(*) from public.submissions)      = 0, '他校の答案が見えないこと';
  assert (select count(*) from public.submission_items) = 0, '他校の採点結果が見えないこと';
  assert (select count(*) from public.v_unit_mastery)   = 0, '他校の分析が見えないこと';
  assert not exists (select 1 from public.audit_logs where school_id <> 'bbbbbbbb-0000-0000-0000-000000000000'), '他校の監査ログが見えないこと';
  assert (select count(*) from storage.objects)         = 0, '他校の答案画像が見えないこと';
  assert (select count(*) from public.submission_links) = 0, '他校の提出リンクが見えないこと';
end $$;

-- ---------------------------------------------------------------- 未ログイン（anon）
reset role;
set role anon;
select set_config('request.jwt.claims', '', false);
do $$
begin
  assert (select count(*) from public.schools) = 0, '未ログインでは何も見えないこと';
  begin
    perform public.purge_expired_submissions();
    raise exception 'FAIL: 未ログインで自動削除を実行できてしまう';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 管理者専用の関数を教員も呼べないこと
reset role;
set role authenticated;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');
do $$
begin
  begin
    perform public.purge_expired_submissions();
    raise exception 'FAIL: 教員が全校の自動削除を実行できてしまう';
  exception when insufficient_privilege then null;
  end;
end $$;

-- service_role（サーバー側の定期実行）は実行できる
reset role;
set role service_role;
select public.purge_expired_submissions();
reset role;
