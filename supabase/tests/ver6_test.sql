-- ============================================================================
-- ver6（0019）の検証：AIエンジンの設定・生徒のタブレット/スマホからの提出・前払い。rls_test.sql の後に流す
--   学校A: 管理者 admin_a / 教員 teacher_a ・ 学校B: 教員 teacher_b（rls_test.sql の準備を使う）
-- ============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;

-- 提出のテスト用の生徒（rls_test.sql の生徒1番は、先生がすでに答案を取り込み済み）
insert into public.students (id, school_id, class_id, number, exam_no, anon_id) values
  ('aaaaaaaa-0000-0000-0000-0000000001d9', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000c1', 9, '2A09', '生徒009');

-- ---------------------------------------------------------------- 1. AIエンジンの設定
set role authenticated;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');   -- 教員（管理者ではない）
do $$ begin
  begin
    insert into public.ai_settings (school_id, model_top) values ('aaaaaaaa-0000-0000-0000-000000000000', 'claude-opus-5-5');
    raise exception 'FAIL: 教員が AIエンジンを変えられた';
  exception when insufficient_privilege or check_violation then null;
    when others then if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000a');   -- 管理者
insert into public.ai_settings (school_id, model_top, concurrency) values ('aaaaaaaa-0000-0000-0000-000000000000', 'claude-opus-5-5', 10);
do $$ begin
  begin
    update public.ai_settings set model_fast = 'gpt-5' where school_id = 'aaaaaaaa-0000-0000-0000-000000000000';
    raise exception 'FAIL: claude 以外のモデルIDが保存できた';
  exception when check_violation then null; end;
  begin
    update public.ai_settings set concurrency = 99 where school_id = 'aaaaaaaa-0000-0000-0000-000000000000';
    raise exception 'FAIL: 同時に採点する数が上限を超えた';
  exception when check_violation then null; end;
end $$;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');
do $$ begin
  assert (select concurrency from public.ai_settings where school_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 10, '同じ学校の教員は設定を読める';
end $$;
select pg_temp.login('bbbbbbbb-0000-0000-0000-00000000000b');
do $$ begin
  assert not exists (select 1 from public.ai_settings), '他校の AIエンジンの設定は見えない';
end $$;

-- ---------------------------------------------------------------- 2. 提出リンク
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');
insert into public.submission_links (id, school_id, test_id, class_id, token, max_uploads, pages_max, expires_at) values
  ('aaaaaaaa-0000-0000-0000-0000000001a1', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 'tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 3, 2, now() + interval '1 hour'),
  ('aaaaaaaa-0000-0000-0000-0000000001a2', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 'tok_expiredexpiredexpiredexpired', 3, 2, now() - interval '1 minute');
do $$ begin
  begin
    perform public.submit_link_claim('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-0000000001d9', 1::smallint);
    raise exception 'FAIL: 教員のセッションから提出の関数を直接呼べた';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set role service_role;
do $$
declare r jsonb; v_info jsonb; ok boolean;
begin
  v_info := public.submit_link_info('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert v_info->>'test' = '期末' and jsonb_array_length(v_info->'students') >= 1, 'リンクの案内にテスト名と出席番号の一覧が出る';
  assert not (v_info::text like '%生徒001%') and not (v_info::text like '%2A01%'), '案内に匿名ID・受験番号を出さない（出席番号だけ）';
  assert public.submit_link_info('tok_expiredexpiredexpiredexpired') is null, '期限切れのリンクは案内しない';
  assert public.submit_link_info('short') is null, '短いトークンは案内しない';

  -- 期限切れ・別クラスの生徒・ページ数の超過は受け付けない
  ok := false; begin perform public.submit_link_claim('tok_expiredexpiredexpiredexpired', 'aaaaaaaa-0000-0000-0000-0000000001d9', 1::smallint); exception when sqlstate 'P0001' then ok := true; end;
  assert ok, '期限切れのリンクで提出できない';
  ok := false; begin perform public.submit_link_claim('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbb-0000-0000-0000-0000000000d1', 1::smallint); exception when sqlstate 'P0001' then ok := true; end;
  assert ok, '他校・別クラスの生徒としては提出できない';
  ok := false; begin perform public.submit_link_claim('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-0000000001d9', 3::smallint); exception when sqlstate 'P0001' then ok := true; end;
  assert ok, 'リンクのページ数の上限を超えて提出できない';

  -- 先生がすでに取り込んだ答案（生徒1番）は上書きしない
  ok := false; begin perform public.submit_link_claim('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-0000000000d1', 1::smallint); exception when sqlstate 'P0001' then ok := true; end;
  assert ok, '先生が取り込んだ答案は生徒が上書きできない';

  -- 受け付け → 画像を結び付ける
  r := public.submit_link_claim('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-0000000001d9', 2::smallint);
  assert (select status from public.submissions where id = (r->>'submission_id')::uuid) = 'uploaded', '提出は AI採点待ちになる';
  assert (select source from public.submissions where id = (r->>'submission_id')::uuid) = 'mobile', '取り込み方法は生徒の端末';
  ok := false; begin perform public.submit_link_finish((r->>'upload_id')::uuid, array['bbbbbbbb-0000-0000-0000-000000000000/x/y/1.jpg']); exception when sqlstate 'P0001' then ok := true; end;
  assert ok, '他校の保存先は結び付けない';
  perform public.submit_link_finish((r->>'upload_id')::uuid, array['aaaaaaaa-0000-0000-0000-000000000000/e1/s/1.jpg', 'aaaaaaaa-0000-0000-0000-000000000000/e1/s/2.jpg']);
  assert (select cardinality(image_paths) from public.submissions where id = (r->>'submission_id')::uuid) = 2, '画像が答案に結び付く';
  assert (select status from public.link_uploads where id = (r->>'upload_id')::uuid) = 'done', '記録が完了になる';

  -- 生徒の出し直し（採点前）は受け付ける
  r := public.submit_link_claim('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-0000000001d9', 1::smallint);
  assert (select cardinality(image_paths) from public.submissions where id = (r->>'submission_id')::uuid) = 0, '出し直しは前の画像を外す';
  perform public.submit_link_finish((r->>'upload_id')::uuid, array['aaaaaaaa-0000-0000-0000-000000000000/e1/s/1.jpg']);

  -- 採点が始まった答案は上書きしない
  update public.submissions set status = 'processing' where id = (r->>'submission_id')::uuid;
  ok := false; begin perform public.submit_link_claim('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-0000000001d9', 1::smallint); exception when sqlstate 'P0001' then ok := true; end;
  assert ok, '採点が始まった答案は生徒が上書きできない';
  update public.submissions set status = 'uploaded' where id = (r->>'submission_id')::uuid;

  -- 回数の上限（3回）
  ok := false; begin perform public.submit_link_claim('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-0000000001d9', 1::smallint); exception when sqlstate 'P0001' then ok := true; end;
  assert not ok, '3回目までは受け付ける';
  ok := false; begin perform public.submit_link_claim('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-0000000001d9', 1::smallint); exception when sqlstate 'P0001' then ok := true; end;
  assert ok, '回数の上限を超えて提出できない';
end $$;
reset role;

-- 取り消したリンクは使えない・届いた記録は同じ学校の教員だけが見える
set role authenticated;
select pg_temp.login('aaaaaaaa-0000-0000-0000-00000000000b');
update public.submission_links set revoked_at = now() where id = 'aaaaaaaa-0000-0000-0000-0000000001a1';
do $$ begin
  assert (select count(*) from public.link_uploads) = 3, '同じ学校の教員は届いた記録を見られる';
  begin
    delete from public.link_uploads;
    assert (select count(*) from public.link_uploads) = 3, '教員は届いた記録を消せない';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.login('bbbbbbbb-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from public.link_uploads) = 0, '他校の届いた記録は見えない';
end $$;
reset role;
set role service_role;
do $$ begin
  assert public.submit_link_info('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') is null, '取り消したリンクは案内しない';
end $$;
reset role;
