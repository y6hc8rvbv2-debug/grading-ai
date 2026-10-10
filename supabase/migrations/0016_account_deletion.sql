-- ============================================================================
-- 0016_account_deletion.sql : 利用者本人によるアカウントの削除（App Store・Google Play の要件）
--
-- アプリの「アカウントを削除」は、サーバー（app/api/account/delete）が次の順に行う：
--   1. prepare_account_deletion()（本人のセッションで呼ぶ）：削除できるかを確かめ、本人のアカウントを指す参照を外す
--   2. Supabase Auth の管理 API で、本人の auth.users を削除する（profiles・student_accounts などは on delete cascade で消える）
--
-- 消えるもの：ログインのアカウント（メールアドレス・パスワード）、教職員のプロフィール、生徒の配信先の登録、
--             生徒本人の復習の記録（自己申告・振り返り）とアプリ内の会話の記録・キー
-- 残るもの：学校が管理する記録（名簿の番号・答案・採点結果・返却した内容・監査ログ）。氏名は元から持っていない。
--           削除した人が作った・確認した記録は「作成者なし」になる（on delete set null）
-- 学校の最後の管理者は削除できない（ほかの管理者を決めてから）。
--
-- 既存の行は変えない。0010 の2つの外部キー（作成者・返却者）を「削除したら空にする」に変え、
-- 0012 の result_releases_enrich() を、返却者だけを空にする更新では返却内容を変えないように置き換える。
--
-- あわせて、保存期間を過ぎた答案の削除（app/api/retention/purge。1日1回）で使う purge_submissions() を足す。
-- 画像を Storage から消した答案だけを「削除済み」にする（0001 の purge_expired_submissions は対象を自分で選ぶため、
-- 画像を消す前に期限を迎えた答案の画像の参照が先に消え、画像が残り続けることがあった）。
-- ============================================================================
begin;

-- 削除した教職員を指していた行は、作成者・返却者を空にする（これまでは参照が残っていると削除できなかった）
alter table public.intake_scans alter column created_by drop not null;
alter table public.intake_scans drop constraint intake_scans_created_by_fkey;
alter table public.intake_scans add constraint intake_scans_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.result_releases alter column released_by drop not null;
alter table public.result_releases drop constraint result_releases_released_by_fkey;
alter table public.result_releases add constraint result_releases_released_by_fkey
  foreign key (released_by) references auth.users(id) on delete set null;

-- 返却内容の補完（0012）。返却者だけを空にする更新（アカウントの削除）では、返却内容・版・受信箱を変えない
-- （ここで内容を作り直すと、返却後に先生が直した未確認の内容が生徒に出てしまうため）
create or replace function public.result_releases_enrich()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_test uuid; v_show boolean; v_items jsonb; v_grade int; v_subject text;
begin
  if tg_op = 'UPDATE' and new.released_by is null and old.released_by is not null then
    new.payload := old.payload;
    new.image_paths := old.image_paths;
    new.version := old.version;
    new.released_at := old.released_at;
    return new;
  end if;
  select s.test_id into v_test from public.submissions s where s.id = new.submission_id;
  select coalesce(t.release_model_answer, false), t.grade, t.subject into v_show, v_grade, v_subject from public.tests t where t.id = v_test;
  select coalesce(jsonb_agg(
           e.item
           || jsonb_build_object('detected', coalesce(i.detected, ''), 'prompt', coalesce(q.prompt_text, ''))
           || case when v_show then jsonb_build_object('correct', coalesce(q.correct, ''), 'model', coalesce(q.model_answer, ''))
                   else jsonb_build_object('correct', '', 'model', '') end
           order by (e.item->>'qno')::int), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(coalesce(new.payload->'items', '[]'::jsonb)) as e(item)
    left join public.submission_items i on i.submission_id = new.submission_id and i.qno = (e.item->>'qno')::int
    left join public.questions q on q.test_id = v_test and q.no = (e.item->>'qno')::int;
  new.payload := new.payload || jsonb_build_object('items', v_items, 'showModelAnswer', v_show, 'grade', v_grade, 'subject', coalesce(v_subject, ''));
  if tg_op = 'UPDATE' then
    if new.payload = old.payload and new.image_paths = old.image_paths then
      return null;                     -- 同じ内容の返し直しは何もしない
    end if;
    new.version := old.version + 1;
  end if;
  return new;
end $$;

-- 本人のアカウントを削除する前の準備（本人のセッションで呼ぶ。auth.users の削除はサーバーが管理 API で行う）
-- 戻り値：{ role: 'admin' | 'teacher' | 'board' | 'viewer' | 'student' | 'none' }
create or replace function public.prepare_account_deletion()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text; v_school uuid; v_student uuid; v_kind text;
begin
  if v_uid is null then raise exception 'ログインしてください' using errcode = '42501'; end if;
  select role::text, school_id into v_role, v_school from public.profiles where id = v_uid;
  if v_role = 'admin' and not exists (
       select 1 from public.profiles where school_id = v_school and role = 'admin' and id <> v_uid) then
    raise exception 'この学校の最後の管理者は削除できません。先にほかの教職員を管理者にしてください' using errcode = 'P0001';
  end if;
  v_student := public.current_student_id();
  v_kind := coalesce(v_role, case when v_student is not null then 'student' else 'none' end);
  if v_student is not null then
    v_school := coalesce(v_school, public.current_student_school());
    -- 生徒本人の記録（自己申告の復習の状態・振り返り）を消す。先生が付けた「理解確認済み」は学校の記録として残す
    delete from public.tutor_progress where student_id = v_student and source <> 'teacher';
    delete from public.tutor_reflections where student_id = v_student;
  end if;
  -- 本人を指す参照を外す（返却内容は変えない：result_releases_enrich を参照）
  update public.result_releases set released_by = null where released_by = v_uid;
  update public.intake_scans set created_by = null where created_by = v_uid;
  -- 本人が保存した答案画像の「持ち主」を外す（画像は学校の記録として残す。持ち主の列が無い・変えられない環境では何もしない）
  begin
    execute 'update storage.objects set owner = null where owner = $1' using v_uid;
  exception when others then null;
  end;
  if v_school is not null then
    insert into public.audit_logs (school_id, actor_id, action, target_table, target_id, detail)
    values (v_school, null, 'account.delete', 'auth.users', null, jsonb_build_object('role', v_kind));
  end if;
  return jsonb_build_object('role', v_kind);
end $$;
revoke all on function public.prepare_account_deletion() from public, anon;
grant execute on function public.prepare_account_deletion() to authenticated, service_role;

-- 保存期間を過ぎた答案のうち、指定したもの（画像を消し終えたもの）だけを「削除済み」にし、画像の参照を空にする。
-- 期限の規則は purge_expired_submissions（0001）と同じ。期限前・手動の学校・削除済みの答案は変えない。service_role だけ
create or replace function public.purge_submissions(p_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  update public.submissions s
     set deleted_at = now(), image_paths = '{}'
    from public.schools sc
   where s.id = any(coalesce(p_ids, '{}')) and sc.id = s.school_id and s.deleted_at is null
     and sc.retention <> 'manual'
     and s.uploaded_at < now() - (case sc.retention when '30' then interval '30 days' when '180' then interval '180 days' else interval '15 months' end);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_submissions(uuid[]) from public, anon, authenticated;
grant execute on function public.purge_submissions(uuid[]) to service_role;

commit;
