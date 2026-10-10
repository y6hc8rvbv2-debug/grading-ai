-- 0015 「本人の ChatGPT で復習」（B方式）の設定の検証。tutor_sweep_test.sql の後に実行する。
--   学校C（cccccccc-…）：管理者 …01、生徒アカウント …02（生徒 …21）・…03（生徒 …22）、クラス …11
create or replace function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;
set role app_owner;
-- 先生（教職員）を1人足す（app_metadata で所属と役割を付ける＝handle_new_user が profiles を作る）
insert into auth.users(id, email, email_confirmed_at, raw_app_meta_data) values
 ('cccccccc-0000-0000-0000-000000000004', 'wfteacher@example.test', now(), '{"school_id":"cccccccc-0000-0000-0000-000000000000","role":"teacher"}');
-- アプリ内の会話（0012）の設定を、B方式とは別の値にしておく（B方式の操作で変わらないことを確かめる）
update public.schools set tutor_enabled = true where id = 'cccccccc-0000-0000-0000-000000000000';
update public.classes set tutor_enabled = false where id = 'cccccccc-0000-0000-0000-000000000011';

do $$ begin
  assert not (select review_copy_enabled from public.schools where id = 'cccccccc-0000-0000-0000-000000000000'), '学校の既定は無効';
  assert not (select review_copy_enabled from public.classes where id = 'cccccccc-0000-0000-0000-000000000011'), 'クラスの既定は無効';
  assert not has_function_privilege('anon', 'public.review_copy_status()', 'execute'), '未ログインは状態を聞けない';
  assert not has_function_privilege('anon', 'public.set_review_copy_settings(boolean,uuid[])', 'execute'), '未ログインは設定を変えられない';
end $$;

set role authenticated;
-- 生徒：既定では使えない
select pg_temp.login('cccccccc-0000-0000-0000-000000000002');
do $$ begin
  assert public.review_copy_status() = '{"student": true, "enabled": false}'::jsonb, '既定では生徒に表示しない';
  -- 生徒は設定を変えられない
  begin
    perform public.set_review_copy_settings(true, array['cccccccc-0000-0000-0000-000000000011'::uuid]);
    raise exception 'TEST: student changed settings';
  exception when insufficient_privilege then null; end;
  -- 生徒は学校・クラスの表を直接書き換えられない（RLS）
  update public.schools set review_copy_enabled = true;
  update public.classes set review_copy_enabled = true;
end $$;
reset role;
do $$ begin
  assert not (select review_copy_enabled from public.schools where id = 'cccccccc-0000-0000-0000-000000000000'), '生徒の操作で学校の設定が変わらない';
  assert not (select review_copy_enabled from public.classes where id = 'cccccccc-0000-0000-0000-000000000011'), '生徒の操作でクラスの設定が変わらない';
end $$;

-- 先生が有効にする（学校とクラス）。アプリ内の会話の設定（tutor_enabled）は変わらない
set role authenticated;
select pg_temp.login('cccccccc-0000-0000-0000-000000000004');
select public.set_review_copy_settings(true, array['cccccccc-0000-0000-0000-000000000011'::uuid]);
select pg_temp.login('cccccccc-0000-0000-0000-000000000002');
do $$ begin
  assert public.review_copy_status() = '{"student": true, "enabled": true}'::jsonb, '学校とクラスで有効なら生徒に表示する';
end $$;
-- 学校だけ有効でクラスが無効なら使えない（管理者がクラスを外す）
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
select public.set_review_copy_settings(true, '{}');
select pg_temp.login('cccccccc-0000-0000-0000-000000000002');
do $$ begin assert (public.review_copy_status()->>'enabled')::boolean = false, 'クラスが無効なら表示しない'; end $$;
-- クラスだけ有効で学校が無効でも使えない
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
select public.set_review_copy_settings(false, array['cccccccc-0000-0000-0000-000000000011'::uuid]);
select pg_temp.login('cccccccc-0000-0000-0000-000000000002');
do $$ begin assert (public.review_copy_status()->>'enabled')::boolean = false, '学校が無効なら表示しない'; end $$;
-- 生徒でない利用者（教職員）は student=false
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
do $$ begin assert public.review_copy_status() = '{"student": false, "enabled": false}'::jsonb, '教職員は生徒として扱わない'; end $$;
-- 最後は有効にしておく（下のアクセス拒否の確認と、アプリ内の会話の設定の確認のため）
select public.set_review_copy_settings(true, array['cccccccc-0000-0000-0000-000000000011'::uuid]);

-- 他の生徒の答案（返却内容・画像）は読めない
select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
do $$ begin
  assert (select count(*) from public.result_releases where student_id = 'cccccccc-0000-0000-0000-000000000021') = 0, '別の生徒の返却内容は読めない';
  assert (select count(*) from public.result_releases where student_id = 'cccccccc-0000-0000-0000-000000000022') >= 1, '自分の返却内容は読める';
  assert (select count(*) from public.student_inbox where student_id = 'cccccccc-0000-0000-0000-000000000021') = 0, '別の生徒の受信箱は読めない';
  assert (select count(*) from public.tutor_progress where student_id = 'cccccccc-0000-0000-0000-000000000021') = 0, '別の生徒の復習の状態は読めない';
end $$;
-- 生徒の自己申告は「先生の確認済み」にできない（区別を保つ）
do $$
declare v_rel uuid;
begin
  select id into v_rel from public.result_releases where student_id = 'cccccccc-0000-0000-0000-000000000022' limit 1;
  -- 自己申告で「理解確認済み」にはできない
  begin
    insert into public.tutor_progress(school_id, student_id, release_id, qno, state, source)
    values ('cccccccc-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000022', v_rel, 99, 'verified', 'external_self');
    raise exception 'TEST: student self-verified';
  exception when check_violation or insufficient_privilege then null; end;
  -- 「理解できた」は自己申告として残る
  insert into public.tutor_progress(school_id, student_id, release_id, qno, state, source)
  values ('cccccccc-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000022', v_rel, 99, 'self_understood', 'external_self');
  assert (select source from public.tutor_progress where release_id = v_rel and qno = 99) = 'external_self', '自己申告として残る';
  -- 生徒が自分の行を「先生の確認」に書き換えることはできない
  begin
    update public.tutor_progress set state = 'verified', source = 'teacher' where release_id = v_rel and qno = 99;
    raise exception 'TEST: student became teacher';
  exception when check_violation or insufficient_privilege then null; end;
  -- 先生が確認済みにした行（tutor_test.sql で付けたもの）は、生徒が上書きできない
  if exists (select 1 from public.tutor_progress where release_id = v_rel and qno = 1 and source = 'teacher') then
    begin
      insert into public.tutor_progress(school_id, student_id, release_id, qno, state, source)
      values ('cccccccc-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000022', v_rel, 1, 'self_understood', 'external_self')
      on conflict (release_id, qno) do update set state = excluded.state, source = excluded.source;
      raise exception 'TEST: student overwrote teacher check';
    exception when insufficient_privilege then null; end;
  end if;
end $$;

reset role;
do $$ begin
  assert (select tutor_enabled from public.schools where id = 'cccccccc-0000-0000-0000-000000000000'), 'B方式の操作でアプリ内の会話の学校設定が変わらない';
  assert not (select tutor_enabled from public.classes where id = 'cccccccc-0000-0000-0000-000000000011'), 'B方式の操作でアプリ内の会話のクラス設定が有効にならない';
  assert (select count(*) from public.audit_logs where action = 'review_copy.settings') = 4, '設定の変更は監査ログに残る';
end $$;
select 'OK: review_copy_test（B方式の設定・既定は無効・生徒は変更不可・他の生徒は読めない・自己申告の区別）' as result;
