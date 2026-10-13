-- 0017 料金・採点枠の検証（サーバーと同じ役割＝service_role で、採点の開始→確定・失敗→枠の戻し→返金待ちまで）。
-- account_deletion_test.sql の後に実行する。学校F（ffffffff-…）：管理者 …01、先生 …04
--   tests/db/billing.mjs（PGlite）は台帳の規則だけを見る。ここでは本物の PostgreSQL で、
--   採点の確定（finish_grading_job → save_ai_grading → 合計点のトリガー・監査ログ）とアカウントの削除・課金の停止との組み合わせを見る
create or replace function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;
create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', false);
$$;
reset role;
insert into public.schools(id, name, code) values ('ffffffff-0000-0000-0000-000000000000', '料金の確認校', 'BILL-F');
insert into auth.users(id, email, raw_app_meta_data) values
  ('ffffffff-0000-0000-0000-000000000001', 'admin_f@example.com', '{"school_id":"ffffffff-0000-0000-0000-000000000000","role":"admin"}'),
  ('ffffffff-0000-0000-0000-000000000004', 'teacher_f@example.com', '{"school_id":"ffffffff-0000-0000-0000-000000000000","role":"teacher"}');
insert into public.classes(id, school_id, grade, name, school_year) values ('ffffffff-0000-0000-0000-000000000011', 'ffffffff-0000-0000-0000-000000000000', 1, 'F', 2026);
insert into public.students(id, school_id, class_id, number, exam_no, anon_id) values
  ('ffffffff-0000-0000-0000-000000000021', 'ffffffff-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000011', 1, 'F1', 'F1');
insert into public.tests(id, school_id, name, subject, grade) values ('ffffffff-0000-0000-0000-000000000031', 'ffffffff-0000-0000-0000-000000000000', '料金の確認', '数学', 1);
insert into public.questions(school_id, test_id, no, label, qtype, points) values ('ffffffff-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000031', 1, '1', 'calc', 10);
insert into public.submissions(id, school_id, test_id, class_id, student_id, image_paths, status, progress) values
  ('ffffffff-0000-0000-0000-000000000041', 'ffffffff-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000031',
   'ffffffff-0000-0000-0000-000000000011', 'ffffffff-0000-0000-0000-000000000021',
   array['ffffffff-0000-0000-0000-000000000000/t/s/1.jpg'], 'uploaded', 0);

-- 課金が無効（既定）のあいだは、以前と同じく先生のセッションで採点の記録を作れる（課金の台帳には何も残らない）
set role authenticated;
select pg_temp.login('ffffffff-0000-0000-0000-000000000004');
insert into public.grading_jobs(school_id, submission_id, created_by, request_id, mode)
values ('ffffffff-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000041', 'ffffffff-0000-0000-0000-000000000004',
        'ffffffff-0000-0000-0000-0000000000a0', 'cascade');
select public.fail_grading_job((select id from public.grading_jobs where request_id = 'ffffffff-0000-0000-0000-0000000000a0'), 'テスト');
reset role;
do $$ begin
  assert not exists (select 1 from public.billing_usage where school_id = 'ffffffff-0000-0000-0000-000000000000'), '無効のあいだは枠を数えない';
  assert (select status from public.grading_jobs where request_id = 'ffffffff-0000-0000-0000-0000000000a0') = 'failed';
end $$;

update public.billing_config set enabled = true where id = true;

-- 1. 有効にすると、先生のセッションから直接は採点の記録を作れない（サーバーの billing_start_job だけ）
set role authenticated;
select pg_temp.login('ffffffff-0000-0000-0000-000000000004');
do $$ begin
  assert not has_function_privilege('authenticated', 'public.billing_start_job(uuid,uuid,uuid,uuid,text,boolean,boolean)', 'execute'), '先生は枠の確保を直接呼べない';
  begin
    insert into public.grading_jobs(school_id, submission_id, created_by, request_id, mode, billing_enforced)
    values ('ffffffff-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000041', 'ffffffff-0000-0000-0000-000000000004',
            'ffffffff-0000-0000-0000-0000000000a1', 'cascade', false);
    raise exception 'TEST: bypass inserted';
  exception when raise_exception then
    if sqlerrm like 'TEST:%' then raise; end if;
    assert sqlerrm like '%課金確認を省略できません%', sqlerrm;
  end;
end $$;

-- 2. サーバー（service_role）が枠を確保して採点し、確定する。合計点・状態・枠が正しく残る
set role service_role;
select pg_temp.as_server();
select public.billing_start_job('ffffffff-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000004',
  'ffffffff-0000-0000-0000-000000000041', 'ffffffff-0000-0000-0000-0000000000b1', 'cascade', true, false);
-- 通信の再送（同じ requestId）は同じ記録を返し、枠を増やさない
select public.billing_start_job('ffffffff-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000004',
  'ffffffff-0000-0000-0000-000000000041', 'ffffffff-0000-0000-0000-0000000000b1', 'cascade', true, false);
insert into public.grading_stages(school_id, job_id, submission_id, stage, position, model_id, status)
select school_id, id, submission_id, 'haiku', 1, 'model-fixture', 'calling' from public.grading_jobs where request_id = 'ffffffff-0000-0000-0000-0000000000b1';
update public.grading_stages set status = 'done', finished_at = now()
 where job_id = (select id from public.grading_jobs where request_id = 'ffffffff-0000-0000-0000-0000000000b1');
select public.finish_grading_job((select id from public.grading_jobs where request_id = 'ffffffff-0000-0000-0000-0000000000b1'),
  'haiku', '{}'::jsonb, '[{"qno":1,"mark":"○","earned":10,"confidence":0.99,"answer":"5"}]'::jsonb, false, '{}'::jsonb);
reset role;
do $$ begin
  assert (select count(*) from public.billing_usage where school_id = 'ffffffff-0000-0000-0000-000000000000') = 1, '再送しても1枠';
  assert (select status from public.billing_usage where school_id = 'ffffffff-0000-0000-0000-000000000000') = 'done', '確定した採点は使用済み';
  assert (select total_score from public.submissions where id = 'ffffffff-0000-0000-0000-000000000041') = 10, 'サーバーの役割でも合計点が入る';
  assert (select status from public.submissions where id = 'ffffffff-0000-0000-0000-000000000041') in ('done', 'review');
end $$;

-- 3. 失敗した採点は枠を戻す。上限に達したら新しい採点を断る
update public.billing_accounts set quota = 2 where school_id = 'ffffffff-0000-0000-0000-000000000000';
set role service_role;
select pg_temp.as_server();
select public.billing_start_job('ffffffff-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000004',
  'ffffffff-0000-0000-0000-000000000041', 'ffffffff-0000-0000-0000-0000000000b2', 'cascade', true, false);
select public.fail_grading_job((select id from public.grading_jobs where request_id = 'ffffffff-0000-0000-0000-0000000000b2'), 'テストの失敗');
select public.billing_start_job('ffffffff-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000004',
  'ffffffff-0000-0000-0000-000000000041', 'ffffffff-0000-0000-0000-0000000000b3', 'cascade', true, false);
do $$ begin
  begin
    perform public.billing_start_job('ffffffff-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000004',
      'ffffffff-0000-0000-0000-000000000041', 'ffffffff-0000-0000-0000-0000000000b4', 'cascade', true, false);
    raise exception 'TEST: over quota';
  exception when raise_exception then
    if sqlerrm like 'TEST:%' then raise; end if;
    assert sqlerrm like '%月間採点上限%' or sqlerrm like '%進行中%' or sqlerrm like '%duplicate%', sqlerrm;
  end;
end $$;
select public.fail_grading_job((select id from public.grading_jobs where request_id = 'ffffffff-0000-0000-0000-0000000000b3'), 'テストの失敗');
reset role;
do $$ begin
  assert (select count(*) from public.billing_usage where school_id = 'ffffffff-0000-0000-0000-000000000000' and status in ('reserved','done')) = 1, '失敗した2回は枠に数えない';
  assert (select status from public.submissions where id = 'ffffffff-0000-0000-0000-000000000041') in ('done', 'review'), '失敗しても前の採点結果に戻る';
end $$;

-- 4. 個人・塾の Opus 単独：同意なしは断る／支払い前は実行しない／支払い後の失敗は返金待ち
update public.billing_accounts set status = 'active', plan_id = 'personal-mini', quota = 100 where school_id = 'ffffffff-0000-0000-0000-000000000000';
set role service_role;
select pg_temp.as_server();
do $$ begin
  begin
    perform public.billing_start_job('ffffffff-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000004',
      'ffffffff-0000-0000-0000-000000000041', 'ffffffff-0000-0000-0000-0000000000c0', 'opus', true, false);
    raise exception 'TEST: opus without consent';
  exception when raise_exception then
    if sqlerrm like 'TEST:%' then raise; end if;
    assert sqlerrm like '%追加55円への同意%', sqlerrm;
  end;
end $$;
select public.billing_start_job('ffffffff-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000004',
  'ffffffff-0000-0000-0000-000000000041', 'ffffffff-0000-0000-0000-0000000000c1', 'opus', true, true);
do $$ begin
  assert (select count(*) from public.billing_claim_queue()) = 0, '支払い前は実行しない';
end $$;
update public.billing_orders set status = 'paid', payment_intent = 'pi_fixture_f'
 where id = (select id from public.grading_jobs where request_id = 'ffffffff-0000-0000-0000-0000000000c1');
do $$ begin
  assert (select count(*) from public.billing_claim_queue()) = 1, '支払い後に1回だけ取り出す';
end $$;
select public.fail_grading_job((select id from public.grading_jobs where request_id = 'ffffffff-0000-0000-0000-0000000000c1'), 'テストの失敗');
reset role;
do $$ begin
  assert (select status from public.billing_orders where payment_intent = 'pi_fixture_f') = 'refund_pending', '支払い済みの失敗は返金待ち';
  assert (select status from public.billing_usage where id = (select id from public.grading_jobs where request_id = 'ffffffff-0000-0000-0000-0000000000c1')) = 'failed', '枠も戻る';
end $$;

-- 5. 先生は課金対象の採点記録・台帳を書き換えられない
set role authenticated;
select pg_temp.login('ffffffff-0000-0000-0000-000000000001');
do $$ begin
  begin
    update public.grading_jobs set error = 'x' where request_id = 'ffffffff-0000-0000-0000-0000000000b1';
    raise exception 'TEST: teacher updated billed job';
  exception when raise_exception then
    if sqlerrm like 'TEST:%' then raise; end if;
    assert sqlerrm like '%サーバーだけ%', sqlerrm;
  end;
  begin
    update public.billing_orders set status = 'paid';
    raise exception 'TEST: teacher marked paid';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.billing_accounts set quota = 100000;
    raise exception 'TEST: teacher raised quota';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 6. 課金が有効でも、採点したことのある先生はアカウントを削除できる（採点の記録の作成者だけが空になる）
select pg_temp.login('ffffffff-0000-0000-0000-000000000004');
select public.prepare_account_deletion();
reset role;
delete from auth.users where id = 'ffffffff-0000-0000-0000-000000000004';
do $$ begin
  assert (select count(*) from public.grading_jobs where school_id = 'ffffffff-0000-0000-0000-000000000000' and created_by is null) >= 4, '作成者だけが空になる';
  assert (select count(*) from public.billing_usage where school_id = 'ffffffff-0000-0000-0000-000000000000' and status = 'done') = 1, '台帳は変わらない';
  assert (select status from public.billing_orders where payment_intent = 'pi_fixture_f') = 'refund_pending', '返金待ちは残る';
end $$;

-- 7. 確認待ちの記録（0018）は、先生のセッションからは書き換えられない
set role authenticated;
select pg_temp.login('ffffffff-0000-0000-0000-000000000001');
do $$ begin
  begin
    update public.billing_accounts set review_price_id = null, review_at = null;
    raise exception 'TEST: teacher cleared review';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

update public.billing_config set enabled = false where id = true;
select 'OK: billing_test（課金の無効/有効・サーバーでの採点の確定・失敗の枠戻し・Opus の支払い前は実行しない・返金待ち・先生は台帳を変えられない・アカウントの削除）' as result;
