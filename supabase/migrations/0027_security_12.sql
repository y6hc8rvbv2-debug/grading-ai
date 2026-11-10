-- ============================================================================
-- 0027_security_12.sql : セキュリティの12項目の点検（2026-11-10。docs/SECURITY-12.md）で見つけた不足を埋める。0026 の後に適用する
--
--   1. 管理者は二段階認証が必須（項目1）：二段階認証を設定していない管理者は、2段階目まで済んだログイン（aal2）でないと
--      学校のデータを読めない・変えられない（0022 の mfa_satisfied を広げる）。画面はログインのあとに設定へ案内する。
--      緊急時は security_settings.require_admin_mfa を false にすると、0022 と同じ動き（設定した人だけ必須）に戻る
--   2. 自由に書ける文字の長さの上限（項目4）：コメント・設問・名簿のメモなど。既存の行は確かめない（not valid）。新しい書き込みだけ
--   3. 記録（項目9）：教職員の役割・所属の変更、二段階認証の設定・解除を監査ログに残す（メールアドレスなどの個人情報は書かない）
-- ============================================================================
begin;

-- ---------------------------------------------------------------- 1. 管理者の二段階認証
create table public.security_settings (
  id boolean primary key default true check (id),
  require_admin_mfa boolean not null default true
);
insert into public.security_settings values (true, true);
alter table public.security_settings enable row level security;
revoke all on public.security_settings from public, anon, authenticated;
grant select, update on public.security_settings to service_role;

create or replace function public.mfa_satisfied()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or (
        -- 二段階認証を設定していない人は、1段階目のままでよい。ただし管理者は必須（security_settings）
        not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified')
        and not (
          coalesce((select require_admin_mfa from public.security_settings where id), true)
          and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
      )
$$;
revoke all on function public.mfa_satisfied() from public;
grant execute on function public.mfa_satisfied() to anon, authenticated, service_role;

-- 画面向け：自分は二段階認証の設定が必要か（管理者で、まだ設定していない）
create function public.my_mfa_required() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select require_admin_mfa from public.security_settings where id), true)
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
     and not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified')
$$;
revoke all on function public.my_mfa_required() from public, anon;
grant execute on function public.my_mfa_required() to authenticated;

-- ---------------------------------------------------------------- 2. 文字の長さの上限（既存の行は確かめない）
alter table public.submission_items
  add constraint submission_items_comment_len check (char_length(coalesce(comment, '')) <= 2000) not valid,
  add constraint submission_items_detected_len check (char_length(coalesce(detected, '')) <= 4000) not valid,
  add constraint submission_items_reason_len check (char_length(coalesce(reason, '')) <= 2000) not valid;
alter table public.questions
  add constraint questions_label_len check (char_length(coalesce(label, '')) <= 200) not valid,
  add constraint questions_text_len check (char_length(coalesce(correct, '')) <= 10000 and char_length(coalesce(model_answer, '')) <= 10000
                                          and char_length(coalesce(prompt_text, '')) <= 10000 and char_length(coalesce(unit, '')) <= 200) not valid;
alter table public.tests
  add constraint tests_text_len check (char_length(coalesce(name, '')) <= 200 and char_length(coalesce(subject, '')) <= 100
                                      and char_length(coalesce(term, '')) <= 100 and char_length(coalesce(test_no, '')) <= 100) not valid;
alter table public.classes
  add constraint classes_text_len check (char_length(coalesce(name, '')) <= 100 and char_length(coalesce(label, '')) <= 100
                                        and char_length(coalesce(teacher_label, '')) <= 100) not valid;
alter table public.students
  add constraint students_text_len check (char_length(coalesce(note, '')) <= 1000 and char_length(coalesce(exam_no, '')) <= 50
                                         and char_length(coalesce(anon_id, '')) <= 50 and char_length(coalesce(initials, '')) <= 20) not valid;
alter table public.profiles
  add constraint profiles_display_name_len check (char_length(coalesce(display_name, '')) <= 100) not valid;
alter table public.schools
  add constraint schools_name_len check (char_length(coalesce(name, '')) <= 200) not valid;

-- ---------------------------------------------------------------- 3. 記録：役割・所属の変更、二段階認証の設定・解除
create or replace function public.sync_profile_from_app_meta()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid; r text; old_p public.profiles%rowtype;
begin
  sid := nullif(new.raw_app_meta_data ->> 'school_id', '')::uuid;
  r := nullif(new.raw_app_meta_data ->> 'role', '');
  select * into old_p from public.profiles where id = new.id;
  if sid is null then
    update public.profiles set role = 'viewer' where id = new.id;
  else
    update public.profiles
       set school_id = sid,
           role = coalesce(r, 'teacher')::public.user_role
     where id = new.id;
  end if;
  -- 0027：役割・所属が変わったら監査ログに残す（前と後の役割だけ。メールアドレスは書かない）
  if found and old_p.id is not null and (old_p.role::text is distinct from coalesce(r, case when sid is null then 'viewer' else 'teacher' end)
                                          or old_p.school_id is distinct from coalesce(sid, old_p.school_id)) then
    insert into public.audit_logs (school_id, action, target_table, target_id, detail)
    values (coalesce(old_p.school_id, sid), 'staff.role_change', 'profiles', new.id,
            jsonb_build_object('from', old_p.role, 'to', coalesce(r, case when sid is null then 'viewer' else 'teacher' end), 'school_changed', old_p.school_id is distinct from coalesce(sid, old_p.school_id)));
  end if;
  return new;
end $$;
revoke all on function public.sync_profile_from_app_meta() from public, anon, authenticated;

create function public.audit_mfa_change() returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := coalesce(new.user_id, old.user_id); sid uuid;
begin
  select school_id into sid from public.profiles where id = uid;
  if sid is null then return coalesce(new, old); end if;   -- 生徒・未所属は記録しない
  if tg_op = 'DELETE' and old.status::text = 'verified' then
    insert into public.audit_logs (school_id, action, target_table, target_id, detail) values (sid, 'staff.mfa_removed', 'profiles', uid, '{}'::jsonb);
  elsif tg_op = 'UPDATE' and new.status::text = 'verified' and old.status::text is distinct from 'verified' then
    insert into public.audit_logs (school_id, action, target_table, target_id, detail) values (sid, 'staff.mfa_enabled', 'profiles', uid, '{}'::jsonb);
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.audit_mfa_change() from public, anon, authenticated;
-- 認証の表（auth.mfa_factors）にトリガーを作れない環境（権限の制限）では、記録だけを省く（ほかの変更は適用する）
do $$
begin
  create trigger audit_mfa_change after update or delete on auth.mfa_factors for each row execute function public.audit_mfa_change();
exception when insufficient_privilege then
  raise notice '二段階認証の変更の記録（auth.mfa_factors のトリガー）は、権限が無いため作りませんでした';
end $$;

commit;
