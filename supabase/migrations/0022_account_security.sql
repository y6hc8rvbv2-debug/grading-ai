-- ============================================================================
-- 0022_account_security.sql : アカウントの守りを強くする（2026-10-22。docs/SECURITY-REVIEW.md の「先生の判断が必要」だった項目）。0021 の後に適用する
--
--   1. 二段階認証（MFA）：二段階認証を設定した人は、2段階目（認証アプリの6桁）まで済ませたログインでないと
--      学校のデータを読み書きできない（current_school_id・current_role_is が null/false を返す）。設定していない人は今までどおり
--   2. 生徒アカウントの結び付けは、生徒の承認が要る：管理者の「配信先の登録」は招待になり、生徒が自分の画面で承認したときに結び付く。
--      招待するときにメールアドレスが登録済みかどうかを答えない（アカウントの有無を探れないようにする）
--   3. 教職員の役割・所属を app_metadata（サーバーだけが書ける）で変えたら、profiles にも反映する（辞めた管理者の権限が残らない）
--
-- 既存の行は変えない（結び付け済みの生徒・既存の教職員の役割はそのまま）。
-- ============================================================================
begin;

-- ---------------------------------------------------------------- 1. 二段階認証
-- 二段階認証を設定済み（verified の要素がある）なら、2段階目まで済んだログイン（JWT の aal = aal2）だけを認める
create or replace function public.mfa_satisfied()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified')
      or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;
revoke all on function public.mfa_satisfied() from public;
grant execute on function public.mfa_satisfied() to anon, authenticated, service_role;

create or replace function public.current_school_id()
returns uuid language sql stable security definer set search_path = public as $$
  select school_id from public.profiles where id = auth.uid() and public.mfa_satisfied()
$$;

create or replace function public.current_role_is(target public.user_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = target) and public.mfa_satisfied()
$$;

-- ---------------------------------------------------------------- 2. 生徒アカウントの招待と承認
create table public.student_account_invites (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  email       text not null check (email = lower(email) and char_length(email) between 3 and 320),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  unique (student_id, email)
);
create index student_account_invites_email_idx on public.student_account_invites (email) where accepted_at is null;
alter table public.student_account_invites enable row level security;
create policy student_account_invites_select on public.student_account_invites for select to authenticated
  using (school_id = public.current_school_id() and public.current_role_is('admin'));
create policy student_account_invites_insert on public.student_account_invites for insert to authenticated
  with check (school_id = public.current_school_id() and public.current_role_is('admin'));
create policy student_account_invites_update on public.student_account_invites for update to authenticated
  using (school_id = public.current_school_id() and public.current_role_is('admin'))
  with check (school_id = public.current_school_id() and public.current_role_is('admin'));
create policy student_account_invites_delete on public.student_account_invites for delete to authenticated
  using (school_id = public.current_school_id() and public.current_role_is('admin'));
grant select, insert, update, delete on public.student_account_invites to authenticated;
grant all on public.student_account_invites to service_role;

-- 管理者の「配信先の登録」：招待を作るだけ。メールアドレスが登録済みかどうかは答えない（同じ呼び方のまま）
create or replace function public.bind_student_account(p_student uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid; v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.current_role_is('admin') then raise exception '管理者だけが配信先を登録できます'; end if;
  select school_id into v_school from public.students where id = p_student and school_id = public.current_school_id();
  if v_school is null then raise exception '生徒が見つかりません'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+$' then raise exception 'メールアドレスの形が正しくありません'; end if;
  -- 既存の返却先は勝手に切り替えない（0010 と同じ）
  if exists (select 1 from public.student_accounts a join auth.users u on u.id = a.user_id
              where a.student_id = p_student and lower(u.email) <> v_email) then
    raise exception '配信先は登録済みです。管理者が本人対応を確認して変更してください';
  end if;
  insert into public.student_account_invites (school_id, student_id, email) values (v_school, p_student, v_email)
  on conflict (student_id, email) do update set created_at = now(), created_by = auth.uid();
  insert into public.audit_logs (school_id, action, target_table, target_id, detail)
  values (v_school, 'student.invite', 'students', p_student, jsonb_build_object('email_domain', split_part(v_email, '@', 2)));
end $$;
revoke all on function public.bind_student_account(uuid, text) from public, anon;
grant execute on function public.bind_student_account(uuid, text) to authenticated, service_role;

-- 生徒：自分あての招待（本人確認済みのメールアドレスに届いたもの）。氏名は持たないので、学校・クラス・出席番号を見せる
create or replace function public.my_student_invites()
returns table (id uuid, school_name text, class_label text, number smallint, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, s.name, c.label, st.number, i.created_at
    from public.student_account_invites i
    join public.students st on st.id = i.student_id and st.school_id = i.school_id
    join public.classes c on c.id = st.class_id
    join public.schools s on s.id = i.school_id
   where i.accepted_at is null
     and i.email = (select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null)
     and not exists (select 1 from public.profiles p where p.id = auth.uid())
     and not exists (select 1 from public.student_accounts a where a.student_id = i.student_id)
   order by i.created_at desc
$$;
revoke all on function public.my_student_invites() from public, anon;
grant execute on function public.my_student_invites() to authenticated;

-- 生徒：招待を承認すると、その出席番号の返却先になる（教職員のアカウント・別の人が登録済みの番号は不可）
create or replace function public.accept_student_invite(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.student_account_invites%rowtype; v_email text;
begin
  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'メールアドレスの確認が済んだ生徒アカウントでログインしてください'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then raise exception '教職員のアカウントでは承認できません'; end if;
  select * into i from public.student_account_invites where id = p_id and email = v_email and accepted_at is null for update;
  if not found then raise exception 'この招待は見つかりません（取り消されたか、承認済みです）'; end if;
  if exists (select 1 from public.student_accounts where student_id = i.student_id and user_id <> auth.uid()) then
    raise exception 'この出席番号には、別のアカウントが登録済みです。先生に伝えてください';
  end if;
  if exists (select 1 from public.student_accounts where user_id = auth.uid() and student_id <> i.student_id) then
    raise exception 'このアカウントは、別の出席番号に登録済みです。先生に伝えてください';
  end if;
  insert into public.student_accounts (student_id, user_id, school_id) values (i.student_id, auth.uid(), i.school_id)
  on conflict (student_id) do nothing;
  update public.student_account_invites set accepted_at = now() where id = i.id;
end $$;
revoke all on function public.accept_student_invite(uuid) from public, anon;
grant execute on function public.accept_student_invite(uuid) to authenticated;

-- 生徒：心当たりのない招待を断る
create or replace function public.decline_student_invite(p_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.student_account_invites
   where id = p_id and accepted_at is null
     and email = (select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null)
$$;
revoke all on function public.decline_student_invite(uuid) from public, anon;
grant execute on function public.decline_student_invite(uuid) to authenticated;

-- ---------------------------------------------------------------- 3. app_metadata の変更を profiles に反映
-- 役割・所属は app_metadata（service_role だけが書ける）で決める。変えたら profiles も合わせる。
-- 所属を外したときは閲覧だけ（viewer）に下げる（記録の参照を残すため行は消さない。完全に止めるときはユーザーを削除する）
create or replace function public.sync_profile_from_app_meta()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid; r text;
begin
  sid := nullif(new.raw_app_meta_data ->> 'school_id', '')::uuid;
  r := nullif(new.raw_app_meta_data ->> 'role', '');
  if sid is null then
    update public.profiles set role = 'viewer' where id = new.id;
  else
    update public.profiles
       set school_id = sid,
           role = coalesce(r, 'teacher')::public.user_role
     where id = new.id;
  end if;
  return new;
end $$;
revoke all on function public.sync_profile_from_app_meta() from public, anon, authenticated;

create trigger on_auth_user_app_meta_sync
  after update of raw_app_meta_data on auth.users
  for each row
  when (old.raw_app_meta_data is distinct from new.raw_app_meta_data)
  execute function public.sync_profile_from_app_meta();

commit;
