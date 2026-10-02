-- ============================================================================
-- 0008_test_archive.sql : 不要なテストの削除と、答案・成績があるテストのアーカイブ
--
-- 0001 では submissions.test_id が on delete cascade のため、テストを消すと答案と成績まで消えてしまう。
-- これを防ぐため、
--   - 答案（論理削除済みを含む）が1件でもあるテストは DELETE できないようにする（トリガー）
--   - 画面の「削除」は remove_test() を呼ぶ。答案が無ければ削除、あれば archived_at を付けてアーカイブする
--     （テスト一覧・新規採点の選択肢から隠すだけで、答案・成績・分析はそのまま残る）
--   - restore_test() でアーカイブから戻せる
-- どちらも学校の管理者だけが実行でき、RLS により自校のテストにしか効かない。
-- 既存のテスト・答案・成績は変更しない（列は空のまま追加する）。
-- ============================================================================

alter table public.tests add column archived_at timestamptz;

-- 答案があるテストの削除を止める。学校ごと削除するときの連鎖（トリガーの入れ子）は止めない
create or replace function public.tests_protect_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if exists (select 1 from public.submissions s where s.test_id = old.id) then
    raise exception '答案・成績があるテストは削除できません。アーカイブしてください'
      using errcode = '23503';
  end if;
  return old;
end $$;

create trigger tests_protect_delete
  before delete on public.tests
  for each row execute function public.tests_protect_delete();

-- 削除（答案が無いとき）またはアーカイブ（答案があるとき）。結果を 'deleted' / 'archived' で返す
create or replace function public.remove_test(p_test_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_test public.tests%rowtype;
  v_subs integer;
  v_result text;
begin
  if not public.current_role_is('admin') then
    raise exception 'テストを削除できるのは学校の管理者だけです' using errcode = '42501';
  end if;
  select * into v_test from public.tests where id = p_test_id for update;
  if not found then
    raise exception 'テストが見つかりません（削除済みか、他校のテストです）' using errcode = 'P0002';
  end if;
  select count(*) into v_subs from public.submissions where test_id = p_test_id;

  if v_subs > 0 then
    update public.tests set archived_at = coalesce(archived_at, now()) where id = p_test_id;
    v_result := 'archived';
  else
    delete from public.tests where id = p_test_id;
    v_result := 'deleted';
  end if;

  insert into public.audit_logs (school_id, actor_id, action, target_table, target_id, detail)
  values (v_test.school_id, auth.uid(), 'test.' || v_result, 'tests', p_test_id,
          jsonb_build_object('name', v_test.name, 'submissions', v_subs));
  return v_result;
end;
$$;

-- アーカイブから戻す
create or replace function public.restore_test(p_test_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_test public.tests%rowtype;
begin
  if not public.current_role_is('admin') then
    raise exception 'テストを戻せるのは学校の管理者だけです' using errcode = '42501';
  end if;
  update public.tests set archived_at = null where id = p_test_id returning * into v_test;
  if not found then
    raise exception 'テストが見つかりません（削除済みか、他校のテストです）' using errcode = 'P0002';
  end if;
  insert into public.audit_logs (school_id, actor_id, action, target_table, target_id, detail)
  values (v_test.school_id, auth.uid(), 'test.restore', 'tests', p_test_id, jsonb_build_object('name', v_test.name));
end;
$$;

revoke execute on function public.remove_test(uuid) from public, anon;
revoke execute on function public.restore_test(uuid) from public, anon;
grant  execute on function public.remove_test(uuid) to authenticated, service_role;
grant  execute on function public.restore_test(uuid) to authenticated, service_role;
