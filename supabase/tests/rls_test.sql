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

-- ---------------------------------------------------------------- 0003: 状態の自動判定
-- アプリの保存手順（saveGrading）どおりに流す：processing・progress=100 で保存 → 設問を追加
insert into public.students (id, school_id, class_id, number, exam_no, anon_id) values
  ('aaaaaaaa-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 2, '2A02', '生徒002'),
  ('aaaaaaaa-0000-0000-0000-0000000000d3', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 3, '2A03', '生徒003'),
  ('aaaaaaaa-0000-0000-0000-0000000000d4', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 4, '2A04', '生徒004');

-- (1) 要確認なし → done
insert into public.submissions (id, school_id, test_id, student_id, class_id, status, progress) values
  ('aaaaaaaa-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000d2',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 'processing', 100);
insert into public.submission_items (school_id, submission_id, question_id, qno, mark, earned, reason) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000a2',
   'aaaaaaaa-0000-0000-0000-0000000000f1', 1, '×', 0, '符号ミス'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000a2',
   'aaaaaaaa-0000-0000-0000-0000000000f2', 2, '○', 5, '');
do $$
begin
  assert (select status from public.submissions where id = 'aaaaaaaa-0000-0000-0000-0000000000a2') = 'done',
    '採点完了（progress=100）なら採点中のまま残らず done になること';
end $$;

-- (2) 画質注意 → 確認するまで quality のまま。確認済みにすると done
insert into public.submissions (id, school_id, test_id, student_id, class_id, status, progress) values
  ('aaaaaaaa-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000d3',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 'quality', 100);
insert into public.submission_items (school_id, submission_id, question_id, qno, mark, earned, need_review) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000a3',
   'aaaaaaaa-0000-0000-0000-0000000000f1', 1, '○', 5, true),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000a3',
   'aaaaaaaa-0000-0000-0000-0000000000f2', 2, '○', 5, false);
do $$
begin
  assert (select status from public.submissions where id = 'aaaaaaaa-0000-0000-0000-0000000000a3') = 'quality',
    '画質注意は確認前は quality のままであること';
end $$;
select public.mark_submission_reviewed('aaaaaaaa-0000-0000-0000-0000000000a3');
do $$
declare
  s record;
begin
  select status, reviewed_by, total_score into s from public.submissions
   where id = 'aaaaaaaa-0000-0000-0000-0000000000a3';
  assert s.status = 'done', format('確認済みにすると done になること（実際: %s）', s.status);
  assert s.reviewed_by = auth.uid(), '確認した教員が記録されること';
  assert s.total_score = 10, '合計点は変わらないこと';
  assert not exists (select 1 from public.submission_items
                      where submission_id = 'aaaaaaaa-0000-0000-0000-0000000000a3' and need_review),
    '確認済みにすると要確認の印が外れること';
end $$;

-- (3) 白紙答案は分析ビューに入らない
insert into public.submissions (id, school_id, test_id, student_id, class_id, status, progress, is_blank) values
  ('aaaaaaaa-0000-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000d4',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 'blank', 100, true);
insert into public.submission_items (school_id, submission_id, question_id, qno, mark, earned, is_blank) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000a4',
   'aaaaaaaa-0000-0000-0000-0000000000f1', 1, '-', 0, true);
do $$
begin
  assert (select status from public.submissions where id = 'aaaaaaaa-0000-0000-0000-0000000000a4') = 'blank',
    '白紙は blank のままであること';
  -- a1: 5+4 / a2: 0+5 / a3: 5+5 → 24 / 30 = 80.0%（白紙の 0 点は含めない）
  assert (select rate from public.v_unit_mastery where unit = '一次関数') = 80.0,
    format('単元別定着度に白紙答案を含めないこと（実際: %s）',
           (select rate from public.v_unit_mastery where unit = '一次関数'));
  assert (select n from public.v_question_stats where qno = 1) = 3, '設問別正答率に白紙答案を含めないこと';
  assert (select correct_rate from public.v_question_stats_by_class
           where qno = 1 and class_id = 'aaaaaaaa-0000-0000-0000-0000000000c1') = 66.7,
    'クラス別の設問正答率 = 2/3';
  assert (select rate from public.v_qtype_mastery where qtype = 'long') = 93.3,
    format('設問形式別の得点率（実際: %s）', (select rate from public.v_qtype_mastery where qtype = 'long'));
  assert (select n from public.v_mistake_reasons where reason = '符号ミス') = 1, 'ミス傾向が集計されること';
end $$;

-- ---------------------------------------------------------------- 0004: AI採点の保存
insert into public.students (id, school_id, class_id, number, exam_no, anon_id) values
  ('aaaaaaaa-0000-0000-0000-0000000000d5', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 5, '2A05', '生徒005');
-- 画像だけ保存された答案（AI採点待ち）
insert into public.submissions (id, school_id, test_id, student_id, class_id, status, progress) values
  ('aaaaaaaa-0000-0000-0000-0000000000a5', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000d5',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 'uploaded', 0);

select public.save_ai_grading(
  'aaaaaaaa-0000-0000-0000-0000000000a5',
  '{"ok": true, "scores": {"blur": 90}, "issues": [], "fixes": [], "avg": 90}',
  '[{"qno":1,"detected":"5","confidence":0.97,"mark":"○","earned":99,"is_blank":false,"need_review":false,"reason":"","comment":"よくできました","bbox":{"page":1,"x":0.1,"y":0.2,"w":0.3,"h":0.1}},
    {"qno":2,"detected":"","confidence":0.5,"mark":"×","earned":0,"is_blank":false,"need_review":false,"reason":"符号ミス","comment":""},
    {"qno":99,"detected":"x","confidence":1,"mark":"○","earned":3,"is_blank":false,"need_review":false,"reason":"","comment":""}]'
);
do $$
declare
  s record;
begin
  select status, progress, total_score, is_blank into s from public.submissions
   where id = 'aaaaaaaa-0000-0000-0000-0000000000a5';
  assert s.total_score = 5, format('得点は配点（5点）で頭打ちになること（実際: %s）', s.total_score);
  assert s.status = 'done' and s.progress = 100, format('AI採点後は done・progress 100（実際: %s/%s）', s.status, s.progress);
  assert (select count(*) from public.submission_items where submission_id = 'aaaaaaaa-0000-0000-0000-0000000000a5') = 2,
    'テストに無い設問番号（99）は保存しないこと';
  assert (select question_id from public.submission_items
           where submission_id = 'aaaaaaaa-0000-0000-0000-0000000000a5' and qno = 1) = 'aaaaaaaa-0000-0000-0000-0000000000f1',
    '設問ID は DB 側で設問番号から決まること';
  assert (select bbox->>'page' from public.submission_items
           where submission_id = 'aaaaaaaa-0000-0000-0000-0000000000a5' and qno = 1) = '1',
    '赤ペンの座標（bbox）が保存されること';
end $$;

-- 画質不良なら quality のまま（確認するまで）
select public.save_ai_grading(
  'aaaaaaaa-0000-0000-0000-0000000000a5',
  '{"ok": false, "scores": {"blur": 30}, "issues": [{"k":"ぼやけ","msg":"撮り直してください"}], "fixes": [], "avg": 30}',
  '[{"qno":1,"detected":"5","confidence":0.9,"mark":"○","earned":5,"is_blank":false,"need_review":false,"reason":"","comment":""}]'
);
do $$
begin
  assert (select status from public.submissions where id = 'aaaaaaaa-0000-0000-0000-0000000000a5') = 'quality',
    '画質不良なら status = quality';
end $$;

-- 全設問が無記入なら白紙
select public.save_ai_grading(
  'aaaaaaaa-0000-0000-0000-0000000000a5',
  '{"ok": true}',
  '[{"qno":1,"detected":"","confidence":0.99,"mark":"-","earned":0,"is_blank":true,"need_review":false,"reason":"無記入","comment":""},
    {"qno":2,"detected":"","confidence":0.99,"mark":"-","earned":0,"is_blank":true,"need_review":false,"reason":"無記入","comment":""}]'
);
do $$
declare
  s record;
begin
  select status, is_blank, total_score into s from public.submissions where id = 'aaaaaaaa-0000-0000-0000-0000000000a5';
  assert s.status = 'blank' and s.is_blank and s.total_score = 0, format('全問無記入なら白紙（実際: %s）', s.status);
end $$;

-- 一致する設問が1つも無い結果は保存しない（答案は元のまま）
do $$
begin
  begin
    perform public.save_ai_grading('aaaaaaaa-0000-0000-0000-0000000000a5', '{"ok": true}',
      '[{"qno":77,"detected":"","confidence":1,"mark":"○","earned":1,"is_blank":false,"need_review":false,"reason":"","comment":""}]');
    raise exception 'FAIL: 設問番号が合わない結果を保存できてしまう';
  exception when invalid_parameter_value then null;
  end;
  assert (select status from public.submissions where id = 'aaaaaaaa-0000-0000-0000-0000000000a5') = 'blank',
    '失敗したときは答案が元のまま（ロールバック）であること';
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
  assert (select count(*) from public.students) = 5, '教員は生徒を削除できないこと';
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

-- 他校の答案に AI採点の結果を書き込めない
do $$
begin
  begin
    perform public.save_ai_grading('aaaaaaaa-0000-0000-0000-0000000000a5', '{"ok": true}',
      '[{"qno":1,"detected":"x","confidence":1,"mark":"○","earned":5,"is_blank":false,"need_review":false,"reason":"","comment":""}]');
    raise exception 'FAIL: 他校の答案に AI採点の結果を書き込めてしまう';
  exception when no_data_found then null;
  end;
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

-- ============================================================================
-- 0005 モデル比較試験：実行した管理者本人だけ・二重実行の防止
-- ============================================================================
reset role;
insert into auth.users (id, email, raw_app_meta_data) values
  ('aaaaaaaa-0000-0000-0000-0000000000a2', 'admin_a2@example.com',
     '{"school_id":"aaaaaaaa-0000-0000-0000-000000000000","role":"admin"}');

set role authenticated;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000a');
insert into public.model_compare_runs (id, school_id, created_by, request_id, image_name, image_sha256, image_bytes)
values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000',
        'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-1111-0000-0000-000000000001',
        'answer.png', repeat('a', 64), 1234);
insert into public.model_compare_results (school_id, created_by, run_id, position, display_name, model_id, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001', 1, 'Claude Haiku 4.5', 'claude-haiku-x', 'pending'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001', 2, 'Claude Sonnet 5.5', null, 'unavailable');

do $$
declare n int;
begin
  -- 同じ管理者が同時に2つ目の試験を始められない
  begin
    insert into public.model_compare_runs (school_id, created_by, request_id, image_sha256, image_bytes)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000000a',
            gen_random_uuid(), repeat('b', 64), 1);
    raise exception 'FAIL: 実行中の比較試験があるのに、2つ目を始められてしまう';
  exception when unique_violation then null;
  end;
  -- 同じモデルの呼び出しは1回だけ（pending → calling は1度、戻せない）
  update public.model_compare_results set status = 'calling', started_at = now()
   where run_id = 'cccccccc-0000-0000-0000-000000000001' and display_name = 'Claude Haiku 4.5' and status = 'pending';
  get diagnostics n = row_count;
  assert n = 1, '最初の呼び出しは受け付けること';
  update public.model_compare_results set status = 'calling'
   where run_id = 'cccccccc-0000-0000-0000-000000000001' and display_name = 'Claude Haiku 4.5' and status = 'pending';
  get diagnostics n = row_count;
  assert n = 0, '2回目の呼び出しは受け付けないこと';
  begin
    update public.model_compare_results set status = 'pending'
     where run_id = 'cccccccc-0000-0000-0000-000000000001' and display_name = 'Claude Haiku 4.5';
    raise exception 'FAIL: 呼び出し済みのモデルを未実行に戻せてしまう';
  exception when invalid_parameter_value then null;
  end;
  update public.model_compare_results set status = 'done', finished_at = now()
   where run_id = 'cccccccc-0000-0000-0000-000000000001' and display_name = 'Claude Haiku 4.5';
  begin
    update public.model_compare_results set status = 'calling'
     where run_id = 'cccccccc-0000-0000-0000-000000000001' and display_name = 'Claude Haiku 4.5';
    raise exception 'FAIL: 結果が確定したモデルを呼び直せてしまう';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.model_compare_results set status = 'calling'
     where run_id = 'cccccccc-0000-0000-0000-000000000001' and display_name = 'Claude Sonnet 5.5';
    raise exception 'FAIL: 利用不可のモデルを呼び出せてしまう';
  exception when invalid_parameter_value then null;
  end;
  -- 試験を終えたら、状態は戻せず、次の試験を始められる
  update public.model_compare_runs set status = 'done', finished_at = now() where id = 'cccccccc-0000-0000-0000-000000000001';
  begin
    update public.model_compare_runs set status = 'running' where id = 'cccccccc-0000-0000-0000-000000000001';
    raise exception 'FAIL: 終わった比較試験を実行中に戻せてしまう';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- 同じ学校の別の管理者・教員・他校には見えず、書き込めない
select pg_temp.login('aaaaaaaa-0000-0000-0000-0000000000a2');
do $$
begin
  assert (select count(*) from public.model_compare_runs) = 0, '別の管理者には比較試験が見えないこと';
  assert (select count(*) from public.model_compare_results) = 0, '別の管理者には比較結果が見えないこと';
  delete from public.model_compare_runs where id = 'cccccccc-0000-0000-0000-000000000001';
end $$;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');
do $$
begin
  assert (select count(*) from public.model_compare_runs) = 0, '教員には比較試験が見えないこと';
  begin
    insert into public.model_compare_runs (school_id, created_by, request_id, image_sha256, image_bytes)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000000b',
            gen_random_uuid(), repeat('c', 64), 1);
    raise exception 'FAIL: 教員が比較試験を作れてしまう';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.login('bbbbbbbb-0000-0000-0000-00000000000b');
do $$
begin
  assert (select count(*) from public.model_compare_runs) = 0, '他校には比較試験が見えないこと';
end $$;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000a');
do $$
begin
  assert (select count(*) from public.model_compare_runs) = 1, '別の管理者の削除は効いていないこと';
  -- 本人は記録を削除できる（モデルの結果も一緒に消える）
  delete from public.model_compare_runs where id = 'cccccccc-0000-0000-0000-000000000001';
  assert (select count(*) from public.model_compare_results) = 0, '試験を消すとモデルの結果も消えること';
end $$;
reset role;

-- ============================================================================
-- 0006 採点方式と AI採点の記録：二重実行の防止・途中失敗で成績を壊さない・他校から見えない
-- ============================================================================
set role authenticated;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');   -- 学校Aの教員
do $$
declare
  v_sub   uuid := 'aaaaaaaa-0000-0000-0000-0000000000a5';
  v_total integer;
  v_items jsonb;
  v_status public.submission_status;
begin
  select total_score, status into v_total, v_status from public.submissions where id = v_sub;

  -- 1回目の採点を始める（採点前の状態を覚えておく）
  insert into public.grading_jobs (id, school_id, submission_id, created_by, request_id, mode, prev_status, prev_progress)
  values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', v_sub,
          'aaaaaaaa-0000-0000-0000-00000000000b', 'dddddddd-1111-0000-0000-000000000001', 'cascade', v_status, 100);
  update public.submissions set status = 'processing', progress = 30 where id = v_sub;

  -- 同じ答案で2つ目の採点は始められない
  begin
    insert into public.grading_jobs (school_id, submission_id, created_by, request_id, mode)
    values ('aaaaaaaa-0000-0000-0000-000000000000', v_sub, 'aaaaaaaa-0000-0000-0000-00000000000b', gen_random_uuid(), 'opus');
    raise exception 'FAIL: 同じ答案で同時に2つのAI採点を始められてしまう';
  exception when unique_violation then null;
  end;

  -- 同じ段階は1回しか呼べない
  insert into public.grading_stages (school_id, job_id, submission_id, stage, position, model_id)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000001', v_sub, 'haiku', 1, 'claude-haiku-4-5');
  begin
    insert into public.grading_stages (school_id, job_id, submission_id, stage, position, model_id)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000001', v_sub, 'haiku', 1, 'claude-haiku-4-5');
    raise exception 'FAIL: 同じ段階を二重に呼び出せてしまう';
  exception when unique_violation then null;
  end;
  update public.grading_stages set status = 'done', escalate = true, cost_usd = 0.01,
         reasons = '[{"code":"missing","qno":2,"msg":"回答の欠落"}]'
   where job_id = 'dddddddd-0000-0000-0000-000000000001' and stage = 'haiku';
  begin
    update public.grading_stages set status = 'calling'
     where job_id = 'dddddddd-0000-0000-0000-000000000001' and stage = 'haiku';
    raise exception 'FAIL: 結果が確定した段階を呼び直せてしまう';
  exception when invalid_parameter_value then null;
  end;
  insert into public.grading_stages (school_id, job_id, submission_id, stage, position, model_id, status, cost_usd)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000001', v_sub, 'sonnet', 2, 'claude-sonnet-5-5', 'calling', null);
  update public.grading_stages set status = 'done', cost_usd = 0.02
   where job_id = 'dddddddd-0000-0000-0000-000000000001' and stage = 'sonnet';

  -- 確定：保存と記録が同時に行われる
  perform public.finish_grading_job('dddddddd-0000-0000-0000-000000000001', 'sonnet', '{"ok": true}',
    '[{"qno":1,"detected":"5","confidence":0.9,"mark":"○","earned":5,"is_blank":false,"need_review":false,"reason":"","comment":""},
      {"qno":2,"detected":"説明","confidence":0.9,"mark":"×","earned":0,"is_blank":false,"need_review":true,"reason":"","comment":""}]',
    true, '{"reasons":[]}');
  assert (select grading_mode from public.submissions where id = v_sub) = 'cascade', '採点方式が答案に記録されること';
  assert (select grading_stage from public.submissions where id = v_sub) = 'sonnet', '確定した段階が答案に記録されること';
  assert (select total_score from public.submissions where id = v_sub) = 5, '確定した採点結果が保存されること';
  assert (select status from public.grading_jobs where id = 'dddddddd-0000-0000-0000-000000000001') = 'done', '採点の記録が確定すること';
  assert (select total_cost_usd from public.grading_jobs where id = 'dddddddd-0000-0000-0000-000000000001') = 0.03, '各段階の費用の合計を記録すること';
  begin
    perform public.finish_grading_job('dddddddd-0000-0000-0000-000000000001', 'sonnet', '{"ok": true}', '[]', false, '{}');
    raise exception 'FAIL: 確定済みの採点をもう一度保存できてしまう';
  exception when sqlstate '55000' then null;
  end;

  -- 途中失敗：既存の成績を壊さず、状態を採点前に戻す
  select total_score, status into v_total, v_status from public.submissions where id = v_sub;
  select jsonb_agg(to_jsonb(i) - 'updated_at' order by qno) into v_items from public.submission_items i where submission_id = v_sub;
  insert into public.grading_jobs (id, school_id, submission_id, created_by, request_id, mode, prev_status, prev_progress)
  values ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000000', v_sub,
          'aaaaaaaa-0000-0000-0000-00000000000b', 'dddddddd-1111-0000-0000-000000000002', 'cascade', v_status, 100);
  update public.submissions set status = 'processing', progress = 30 where id = v_sub;
  insert into public.grading_stages (school_id, job_id, submission_id, stage, position, model_id)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000002', v_sub, 'haiku', 1, 'claude-haiku-4-5');
  perform public.fail_grading_job('dddddddd-0000-0000-0000-000000000002', 'Sonnet の呼び出しに失敗');
  assert (select status from public.submissions where id = v_sub) = v_status, '失敗したら答案の状態を採点前に戻すこと';
  assert (select total_score from public.submissions where id = v_sub) = v_total, '失敗しても合計点は変わらないこと';
  assert (select jsonb_agg(to_jsonb(i) - 'updated_at' order by qno) from public.submission_items i where submission_id = v_sub) = v_items,
    '失敗しても設問ごとの採点結果は変わらないこと';
  assert (select status from public.grading_stages where job_id = 'dddddddd-0000-0000-0000-000000000002') = 'error',
    '呼び出し中だった段階は失敗として記録すること';
  begin
    perform public.finish_grading_job('dddddddd-0000-0000-0000-000000000002', 'haiku', '{"ok": true}', '[]', false, '{}');
    raise exception 'FAIL: 失敗した採点の結果を後から保存できてしまう';
  exception when sqlstate '55000' then null;
  end;

  -- 教員は記録を消せない（管理者だけ）
  delete from public.grading_jobs where id = 'dddddddd-0000-0000-0000-000000000001';
  assert (select count(*) from public.grading_jobs where id = 'dddddddd-0000-0000-0000-000000000001') = 1, '教員はAI採点の記録を削除できないこと';
end $$;

-- 時間切れの採点は、答案の状態を戻して終わらせる
insert into public.grading_jobs (id, school_id, submission_id, created_by, request_id, mode, prev_status, prev_progress)
values ('dddddddd-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000a5',
        'aaaaaaaa-0000-0000-0000-00000000000b', 'dddddddd-1111-0000-0000-000000000003', 'opus',
        (select status from public.submissions where id = 'aaaaaaaa-0000-0000-0000-0000000000a5'), 100);
update public.submissions set status = 'processing', progress = 30 where id = 'aaaaaaaa-0000-0000-0000-0000000000a5';
reset role;
alter table public.grading_jobs disable trigger grading_jobs_guard;
update public.grading_jobs set updated_at = now() - interval '30 minutes' where id = 'dddddddd-0000-0000-0000-000000000003';
alter table public.grading_jobs enable trigger grading_jobs_guard;
set role authenticated;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');
do $$
begin
  assert public.expire_stale_grading_jobs('aaaaaaaa-0000-0000-0000-0000000000a5') = 1, '時間切れの採点を1件終わらせること';
  assert (select status from public.grading_jobs where id = 'dddddddd-0000-0000-0000-000000000003') = 'failed', '時間切れは失敗として記録すること';
  assert (select status from public.submissions where id = 'aaaaaaaa-0000-0000-0000-0000000000a5') <> 'processing', '時間切れの答案は採点中のまま残らないこと';
end $$;

-- 他校からは見えず、採点も始められない
select pg_temp.login('bbbbbbbb-0000-0000-0000-00000000000b');
do $$
begin
  assert (select count(*) from public.grading_jobs) = 0, '他校のAI採点の記録は見えないこと';
  assert (select count(*) from public.grading_stages) = 0, '他校のAI採点の段階は見えないこと';
  begin
    insert into public.grading_jobs (school_id, submission_id, created_by, request_id, mode)
    values ('bbbbbbbb-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000a5',
            'bbbbbbbb-0000-0000-0000-00000000000b', gen_random_uuid(), 'opus');
    raise exception 'FAIL: 他校の答案のAI採点を始められてしまう';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.finish_grading_job('dddddddd-0000-0000-0000-000000000001', 'opus', '{"ok": true}', '[]', false, '{}');
    raise exception 'FAIL: 他校のAI採点を確定できてしまう';
  exception when no_data_found then null;
  end;
end $$;
reset role;

-- ============================================================================
-- 0007 模範解答からの自動作成：同じ資料の重複実行を防ぐ・他校から見えない・既存データを変えない
-- ============================================================================
set role authenticated;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');
do $$
begin
  assert (select count(*) from public.tests where answer_key_paths is not null) = 0, '既存のテストの列は空のまま（変更しない）';
  assert (select count(*) from public.questions where figure is not null) = 0, '既存の設問の列は空のまま（変更しない）';

  insert into public.test_imports (id, school_id, created_by, request_id, input_sha)
  values ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000',
          'aaaaaaaa-0000-0000-0000-00000000000b', 'eeeeeeee-1111-0000-0000-000000000001', repeat('a', 64));
  begin
    insert into public.test_imports (school_id, created_by, request_id, input_sha)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000000b', gen_random_uuid(), repeat('a', 64));
    raise exception 'FAIL: 同じ資料の読み取りを同時に2つ始められてしまう';
  exception when unique_violation then null;
  end;
  update public.test_imports set status = 'done', result = '{"questions":[]}' where id = 'eeeeeeee-0000-0000-0000-000000000001';
  begin
    update public.test_imports set result = '{"questions":[1]}' where id = 'eeeeeeee-0000-0000-0000-000000000001';
    raise exception 'FAIL: 終わった読み取りの結果を書き換えられてしまう';
  exception when invalid_parameter_value then null;
  end;
  -- 登録したテストとの紐づけは後から付けられる
  update public.test_imports set test_id = 'aaaaaaaa-0000-0000-0000-0000000000e1' where id = 'eeeeeeee-0000-0000-0000-000000000001';
  -- 終わった後は、同じ資料で次の読み取りを始められる
  insert into public.test_imports (school_id, created_by, request_id, input_sha)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000000b', gen_random_uuid(), repeat('a', 64));
  begin
    insert into public.test_imports (school_id, created_by, request_id, input_sha)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000000a', gen_random_uuid(), repeat('b', 64));
    raise exception 'FAIL: 他人を実行者として記録できてしまう';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.login('bbbbbbbb-0000-0000-0000-00000000000b');
do $$
begin
  assert (select count(*) from public.test_imports) = 0, '他校の読み取りの記録は見えないこと';
end $$;
reset role;

-- ============================================================================
-- 0008 テストの削除・アーカイブ：答案・成績を連鎖削除しない・管理者だけ・他校は不可
-- ============================================================================
reset role;
insert into public.tests (id, school_id, name, subject, grade, max_score) values
  ('aaaaaaaa-0000-0000-0000-0000000000e9', 'aaaaaaaa-0000-0000-0000-000000000000', '誤って登録した模擬テスト', '数学', 2, 4);
insert into public.questions (school_id, test_id, no, label, qtype, points) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000e9', 1, '大問1-(1)', 'calc', 4);

set role authenticated;
-- 他校の管理者・教員は削除できない
select pg_temp.login('bbbbbbbb-0000-0000-0000-00000000000b');
do $$
begin
  begin
    perform public.remove_test('aaaaaaaa-0000-0000-0000-0000000000e9');
    raise exception 'FAIL: 他校の教員がテストを削除できてしまう';
  exception when insufficient_privilege then null;
  end;
  delete from public.tests where id = 'aaaaaaaa-0000-0000-0000-0000000000e9';
end $$;
-- 同じ学校の教員も削除できない（管理者だけ）
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');
do $$
begin
  begin
    perform public.remove_test('aaaaaaaa-0000-0000-0000-0000000000e9');
    raise exception 'FAIL: 教員がテストを削除できてしまう';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.tests where id = 'aaaaaaaa-0000-0000-0000-0000000000e9') = 1, '他校・教員の操作でテストが消えていないこと';
end $$;

select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000a');   -- 学校Aの管理者
do $$
declare
  v_subs integer; v_items integer;
begin
  -- 他校のテストは見つからない
  begin
    perform public.remove_test('bbbbbbbb-0000-0000-0000-0000000000e1');
    raise exception 'FAIL: 他校のテストを削除できてしまう';
  exception when no_data_found then null;
  end;
  -- 答案の無いテストは削除する（設問も一緒に消える）
  assert public.remove_test('aaaaaaaa-0000-0000-0000-0000000000e9') = 'deleted', '答案の無いテストは削除する';
  assert (select count(*) from public.tests where id = 'aaaaaaaa-0000-0000-0000-0000000000e9') = 0, 'テストが消えること';
  assert (select count(*) from public.questions where test_id = 'aaaaaaaa-0000-0000-0000-0000000000e9') = 0, '設問も消えること';

  -- 答案があるテストはアーカイブにして、答案・成績を残す
  select count(*) into v_subs from public.submissions where test_id = 'aaaaaaaa-0000-0000-0000-0000000000e1';
  select count(*) into v_items from public.submission_items i join public.submissions s on s.id = i.submission_id
   where s.test_id = 'aaaaaaaa-0000-0000-0000-0000000000e1';
  assert v_subs > 0, '（前提）答案があるテスト';
  assert public.remove_test('aaaaaaaa-0000-0000-0000-0000000000e1') = 'archived', '答案があるテストはアーカイブする';
  assert (select archived_at is not null from public.tests where id = 'aaaaaaaa-0000-0000-0000-0000000000e1'), 'アーカイブの印が付くこと';
  assert (select count(*) from public.submissions where test_id = 'aaaaaaaa-0000-0000-0000-0000000000e1') = v_subs, '答案は残ること';
  assert (select count(*) from public.submission_items i join public.submissions s on s.id = i.submission_id
           where s.test_id = 'aaaaaaaa-0000-0000-0000-0000000000e1') = v_items, '成績は残ること';
  -- 直接 DELETE しても、答案があるテストは消せない
  begin
    delete from public.tests where id = 'aaaaaaaa-0000-0000-0000-0000000000e1';
    raise exception 'FAIL: 答案があるテストを直接削除できてしまう';
  exception when foreign_key_violation then null;
  end;
  perform public.restore_test('aaaaaaaa-0000-0000-0000-0000000000e1');
  assert (select archived_at is null from public.tests where id = 'aaaaaaaa-0000-0000-0000-0000000000e1'), 'アーカイブから戻せること';
  assert (select count(*) from public.audit_logs where action in ('test.deleted', 'test.archived', 'test.restore')) = 3, '削除・アーカイブ・復元を監査ログに残すこと';
end $$;
reset role;

-- ============================================================================
-- 0009 赤ペンの位置：判定・得点・状態を変えない・他校の答案には付けられない・元に戻せる
-- ============================================================================
reset role;
set role authenticated;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');   -- 学校Aの教員
do $$
declare
  v_before text; v_after text; v_sub_before text; v_sub_after text;
begin
  select string_agg(concat_ws('|', qno, mark, earned, need_review, comment, reason), ',' order by qno) into v_before
    from public.submission_items where submission_id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  select concat_ws('|', total_score, status, edited, reviewed_by) into v_sub_before
    from public.submissions where id = 'aaaaaaaa-0000-0000-0000-0000000000a1';

  -- 学校は答案から決まる（指定しなくてよい）
  insert into public.mark_positions (submission_id, qno, page, x, y)
    values ('aaaaaaaa-0000-0000-0000-0000000000a1', 1, 1, 0.92, 0.10);
  assert (select school_id from public.mark_positions where submission_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' and qno = 1)
         = 'aaaaaaaa-0000-0000-0000-000000000000', '学校は答案から決まること';
  assert (select updated_by from public.mark_positions where qno = 1) = 'aaaaaaaa-0000-0000-0000-00000000000b', '動かした先生を記録すること';
  -- 同じ設問は上書き（upsert）。右の余白（x > 1）にも置ける
  insert into public.mark_positions (submission_id, qno, page, x, y)
    values ('aaaaaaaa-0000-0000-0000-0000000000a1', 1, 1, 1.05, 0.12)
    on conflict (submission_id, qno) do update set page = excluded.page, x = excluded.x, y = excluded.y;
  assert (select count(*) from public.mark_positions where submission_id = 'aaaaaaaa-0000-0000-0000-0000000000a1') = 1, '設問ごとに1つだけ保存すること';
  assert (select x from public.mark_positions where qno = 1) = 1.05::real, '上書きできること';
  -- 範囲外は保存しない
  begin
    insert into public.mark_positions (submission_id, qno, page, x, y) values ('aaaaaaaa-0000-0000-0000-0000000000a1', 2, 1, 3, 0.5);
    raise exception 'FAIL: 範囲外の位置を保存できてしまう';
  exception when check_violation then null;
  end;

  -- 判定・得点・コメント・要確認・合計点・状態は変わらない
  select string_agg(concat_ws('|', qno, mark, earned, need_review, comment, reason), ',' order by qno) into v_after
    from public.submission_items where submission_id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  select concat_ws('|', total_score, status, edited, reviewed_by) into v_sub_after
    from public.submissions where id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  assert v_before = v_after, '位置を動かしても採点結果は変わらないこと';
  assert v_sub_before = v_sub_after, '位置を動かしても合計点・状態・修正の印は変わらないこと';
end $$;

-- 他校の先生は見えず、付けられず、消せない
select pg_temp.login('bbbbbbbb-0000-0000-0000-00000000000b');
do $$
begin
  assert (select count(*) from public.mark_positions) = 0, '他校の赤ペンの位置は見えないこと';
  begin
    insert into public.mark_positions (school_id, submission_id, qno, page, x, y)
      values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000a1', 2, 1, 0.5, 0.5);
    raise exception 'FAIL: 他校の答案に位置を保存できてしまう';
  exception when no_data_found then null;
  end;
  delete from public.mark_positions;
end $$;

-- 位置を元に戻す（教員も行える）。答案を取り込み直したら消える
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');
do $$
begin
  assert (select count(*) from public.mark_positions) = 1, '他校の操作で消えていないこと';
  delete from public.mark_positions where submission_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' and qno = 1;
  assert (select count(*) from public.mark_positions) = 0, '位置を元に戻せること';
  insert into public.mark_positions (submission_id, qno, page, x, y) values ('aaaaaaaa-0000-0000-0000-0000000000a1', 1, 1, 0.9, 0.1);
  update public.submissions set progress = progress where id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  assert (select count(*) from public.mark_positions) = 1, '取り込み直し以外の更新では消えないこと';
  update public.submissions set uploaded_at = now() + interval '1 minute' where id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  assert (select count(*) from public.mark_positions) = 0, '答案を取り込み直したら、動かした位置を消すこと';
end $$;
reset role;
