-- ============================================================================
-- 0015_review_copy.sql : 「本人の ChatGPT で復習」（B方式）の有効・無効を、学校とクラスごとに切り替える
--
-- 生徒は、教師確認のあと本人に返却された答案から間違えた問題を選び、復習内容（問題文・本人の解答・判定・
-- 先生のコメント・先生が公開した正答と解説）を確認してコピーし、本人の ChatGPT に貼り付けて復習する。
-- アプリは AI を呼ばない（API キー・暗号鍵・見回りは不要）。会話の内容はアプリに戻らない。
--
--   - schools.review_copy_enabled・classes.review_copy_enabled の両方が真のときだけ生徒に表示する（既定は無効）
--   - アプリ内の音声・文字の会話（0012 の tutor_enabled）とは別の設定。0012 の設定はここでは変えない
--   - 切り替えは教職員（管理者・先生）。監査ログに残す
--   - 生徒の画面は review_copy_status() で、自分の学校・クラスの設定だけを知る（生徒の ID はクライアントから受け取らない）
-- 既存の行は変えない（列は既定値 false で追加）。0014 と同じく権限は明示する。
-- ============================================================================
begin;

alter table public.schools add column review_copy_enabled boolean not null default false;
alter table public.classes add column review_copy_enabled boolean not null default false;

-- 教職員：学校で有効にするか・使えるクラス（指定しなかったクラスは無効にする）
create or replace function public.set_review_copy_settings(p_enabled boolean, p_class_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.current_school_id();
begin
  if v_school is null or not public.is_staff() then
    raise exception 'ChatGPT での復習の設定を変えられるのは、この学校の先生・管理者だけです' using errcode = '42501';
  end if;
  update public.schools set review_copy_enabled = coalesce(p_enabled, false) where id = v_school;
  update public.classes set review_copy_enabled = (id = any(coalesce(p_class_ids, '{}'))) where school_id = v_school;
  insert into public.audit_logs (school_id, actor_id, action, target_table, target_id, detail)
  values (v_school, auth.uid(), 'review_copy.settings', 'schools', v_school,
          jsonb_build_object('enabled', coalesce(p_enabled, false), 'classes', coalesce(array_length(p_class_ids, 1), 0)));
end $$;
revoke all on function public.set_review_copy_settings(boolean, uuid[]) from public, anon;
grant execute on function public.set_review_copy_settings(boolean, uuid[]) to authenticated, service_role;

-- 生徒：自分の学校とクラスで使えるか（配信先に登録された生徒でなければ student=false）
create or replace function public.review_copy_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('student', true, 'enabled', sc.review_copy_enabled and coalesce(c.review_copy_enabled, false))
      from public.students st
      join public.schools sc on sc.id = st.school_id
      left join public.classes c on c.id = st.class_id
     where st.id = public.current_student_id()
  ), jsonb_build_object('student', false, 'enabled', false))
$$;
revoke all on function public.review_copy_status() from public, anon;
grant execute on function public.review_copy_status() to authenticated, service_role;

commit;
