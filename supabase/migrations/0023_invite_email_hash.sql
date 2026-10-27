-- ============================================================================
-- 0023_invite_email_hash.sql : 生徒への招待のメールアドレスを、戻せない形（ハッシュ）だけで持つ（2026-10-27。docs/SECURITY-REVIEW.md）。0022 の後に適用する
--
--   student_account_invites.email（平文）をやめ、email_hash（SHA-256。小文字にそろえてから）だけを保存する。
--   招待の表が漏れても、メールアドレスそのものは分からない。生徒の照合は、ログインした本人のアドレスのハッシュと比べる。
--   既存の招待は、この適用の中でハッシュに置き換える（平文は残さない）。呼び方（bind_student_account など）は変えない。
-- ============================================================================
begin;

-- メールアドレスのハッシュ（用途の印を付けてから SHA-256。小文字・前後の空白を除いてそろえる）
create or replace function public.invite_email_hash(p_email text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(digest('tsaiten-invite-v1:' || lower(trim(coalesce(p_email, ''))), 'sha256'), 'hex')
$$;
revoke all on function public.invite_email_hash(text) from public, anon;
grant execute on function public.invite_email_hash(text) to authenticated, service_role;

alter table public.student_account_invites add column email_hash text;
update public.student_account_invites set email_hash = public.invite_email_hash(email);
alter table public.student_account_invites alter column email_hash set not null;
alter table public.student_account_invites add constraint student_account_invites_email_hash_check check (email_hash ~ '^[0-9a-f]{64}$');
-- 平文の列を消す（その列の一意制約・索引・形の検査も一緒に消える）
alter table public.student_account_invites drop column email;
alter table public.student_account_invites add constraint student_account_invites_student_hash_key unique (student_id, email_hash);
create index student_account_invites_hash_idx on public.student_account_invites (email_hash) where accepted_at is null;

-- 本人の（確認済みの）メールアドレスのハッシュ
create or replace function public.my_email_hash()
returns text language sql stable security definer set search_path = public, extensions as $$
  select public.invite_email_hash(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null
$$;
revoke all on function public.my_email_hash() from public, anon, authenticated;

create or replace function public.bind_student_account(p_student uuid, p_email text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_school uuid; v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.current_role_is('admin') then raise exception '管理者だけが配信先を登録できます'; end if;
  select school_id into v_school from public.students where id = p_student and school_id = public.current_school_id();
  if v_school is null then raise exception '生徒が見つかりません'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+$' then raise exception 'メールアドレスの形が正しくありません'; end if;
  if exists (select 1 from public.student_accounts a join auth.users u on u.id = a.user_id
              where a.student_id = p_student and lower(u.email) <> v_email) then
    raise exception '配信先は登録済みです。管理者が本人対応を確認して変更してください';
  end if;
  insert into public.student_account_invites (school_id, student_id, email_hash) values (v_school, p_student, public.invite_email_hash(v_email))
  on conflict (student_id, email_hash) do update set created_at = now(), created_by = auth.uid();
  insert into public.audit_logs (school_id, action, target_table, target_id, detail)
  values (v_school, 'student.invite', 'students', p_student, jsonb_build_object('email_domain', split_part(v_email, '@', 2)));
end $$;
revoke all on function public.bind_student_account(uuid, text) from public, anon;
grant execute on function public.bind_student_account(uuid, text) to authenticated, service_role;

create or replace function public.my_student_invites()
returns table (id uuid, school_name text, class_label text, number smallint, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select i.id, s.name, c.label, st.number, i.created_at
    from public.student_account_invites i
    join public.students st on st.id = i.student_id and st.school_id = i.school_id
    join public.classes c on c.id = st.class_id
    join public.schools s on s.id = i.school_id
   where i.accepted_at is null
     and i.email_hash = public.my_email_hash()
     and not exists (select 1 from public.profiles p where p.id = auth.uid())
     and not exists (select 1 from public.student_accounts a where a.student_id = i.student_id)
   order by i.created_at desc
$$;
revoke all on function public.my_student_invites() from public, anon;
grant execute on function public.my_student_invites() to authenticated;

create or replace function public.accept_student_invite(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare i public.student_account_invites%rowtype; v_hash text := public.my_email_hash();
begin
  if v_hash is null then raise exception 'メールアドレスの確認が済んだ生徒アカウントでログインしてください'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then raise exception '教職員のアカウントでは承認できません'; end if;
  select * into i from public.student_account_invites where id = p_id and email_hash = v_hash and accepted_at is null for update;
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

create or replace function public.decline_student_invite(p_id uuid) returns void
language sql security definer set search_path = public, extensions as $$
  delete from public.student_account_invites where id = p_id and accepted_at is null and email_hash = public.my_email_hash()
$$;
revoke all on function public.decline_student_invite(uuid) from public, anon;
grant execute on function public.decline_student_invite(uuid) to authenticated;

commit;
