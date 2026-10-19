-- 時短採点・本人限定返却。0001〜0009適用後。既存成績の書き換えなし。
begin;
create table public.intake_scans (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 created_by uuid not null references auth.users(id), input_sha text not null,
 model text, usage jsonb, cost_usd numeric(12,6),
 status text not null default 'running' check(status in ('running','done','failed')), result jsonb,
 unique(school_id,input_sha)
);
alter table public.intake_scans enable row level security;
create policy intake_owner on public.intake_scans for all to authenticated
 using(school_id=public.current_school_id() and created_by=auth.uid() and (public.current_role_is('admin') or public.current_role_is('teacher')))
 with check(school_id=public.current_school_id() and created_by=auth.uid() and (public.current_role_is('admin') or public.current_role_is('teacher')));

create table public.student_accounts (
 student_id uuid primary key references public.students(id) on delete cascade,
 user_id uuid not null unique references auth.users(id) on delete cascade,
 school_id uuid not null references public.schools(id)
);
alter table public.student_accounts enable row level security;
create policy student_accounts_read on public.student_accounts for select to authenticated
 using(user_id=auth.uid() or (school_id=public.current_school_id() and (public.current_role_is('admin') or public.current_role_is('teacher'))));

create table public.result_releases (
 id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.submissions(id),
 student_id uuid not null references public.students(id), school_id uuid not null references public.schools(id),
 payload jsonb not null, image_paths text[] not null, released_by uuid not null references auth.users(id),
 released_at timestamptz not null default now(), unique(submission_id)
);
alter table public.result_releases enable row level security;
create policy releases_read on public.result_releases for select to authenticated
 using(exists(select 1 from public.student_accounts a where a.student_id=result_releases.student_id and a.user_id=auth.uid())
 or (school_id=public.current_school_id() and (public.current_role_is('admin') or public.current_role_is('teacher'))));
create policy released_images_read on storage.objects for select to authenticated using(
 bucket_id='answer-sheets' and exists(select 1 from public.result_releases r join public.student_accounts a on a.student_id=r.student_id
 where a.user_id=auth.uid() and storage.objects.name=any(r.image_paths)));

create function public.bind_student_account(p_student uuid,p_email text) returns void
language plpgsql security definer set search_path=public as $$
declare v_school uuid; v_user uuid;
begin
 if not public.current_role_is('admin') then raise exception '管理者だけが配信先を登録できます'; end if;
 select school_id into v_school from public.students where id=p_student and school_id=public.current_school_id();
 if v_school is null then raise exception '生徒が見つかりません'; end if;
 select id into v_user from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
 if v_user is null or exists(select 1 from public.profiles where id=v_user) then
 raise exception '本人確認済みの生徒アカウントが必要です（教職員アカウントは使用できません）'; end if;
 -- 既存の返却先は勝手に切り替えない
 if exists(select 1 from public.student_accounts where student_id=p_student and user_id<>v_user) then
 raise exception '配信先は登録済みです。管理者が本人対応を確認して変更してください'; end if;
 insert into public.student_accounts values(p_student,v_user,v_school) on conflict(student_id) do nothing;
end $$;

create function public.publish_class_results(p_test uuid,p_class uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare v_school uuid; v_n integer;
begin
 if not (public.current_role_is('admin') or public.current_role_is('teacher')) then raise exception '教職員だけが返却できます'; end if;
 v_school:=public.current_school_id();
 if not exists(select 1 from public.tests where id=p_test and school_id=v_school)
 or not exists(select 1 from public.classes where id=p_class and school_id=v_school) then raise exception '対象が見つかりません'; end if;
 perform 1 from public.submissions where test_id=p_test and class_id=p_class and school_id=v_school for update;
 perform 1 from public.submission_items where submission_id in(select id from public.submissions where test_id=p_test and class_id=p_class) for update;
 if not exists(select 1 from public.students where class_id=p_class) then raise exception '名簿がありません'; end if;
 if exists(select 1 from public.students st left join public.submissions s on s.student_id=st.id and s.test_id=p_test and s.deleted_at is null
 left join public.student_accounts a on a.student_id=st.id where st.class_id=p_class and
 (s.id is null or s.reviewed_at is null or s.status in ('uploaded','processing') or a.user_id is null
 or exists(select 1 from public.grading_jobs j where j.submission_id=s.id and j.status='running')
 or (select count(*) from public.submission_items i where i.submission_id=s.id)<>(select count(*) from public.questions q where q.test_id=p_test)
 or exists(select 1 from public.submission_items i where i.submission_id=s.id and (i.need_review or (i.mark='-' and not i.is_blank))))) then
 raise exception '未提出・未採点・未確認・配信先未登録の生徒がいます。全員分を確認してください'; end if;
 insert into public.result_releases(submission_id,student_id,school_id,payload,image_paths,released_by)
 select s.id,s.student_id,s.school_id,jsonb_build_object('test',(select name from public.tests where id=p_test),'total',s.total_score,'maxScore',(select sum(points) from public.questions where test_id=p_test),
 'positions',coalesce((select jsonb_agg(jsonb_build_object('qno',m.qno,'page',m.page,'x',m.x,'y',m.y)) from public.mark_positions m where m.submission_id=s.id),'[]'::jsonb),
 'items',(select jsonb_agg(jsonb_build_object('qno',i.qno,'label',q.label,'big',q.big,'type',q.qtype,'mark',i.mark,'earned',i.earned,'points',q.points,'comment',i.comment,'bbox',i.bbox) order by i.qno)
 from public.submission_items i join public.questions q on q.id=i.question_id where i.submission_id=s.id)),s.image_paths,auth.uid()
 from public.submissions s where s.test_id=p_test and s.class_id=p_class and s.school_id=v_school and s.deleted_at is null
 on conflict(submission_id) do update set payload=excluded.payload,image_paths=excluded.image_paths,released_by=excluded.released_by,released_at=now()
 where result_releases.payload is distinct from excluded.payload or result_releases.image_paths is distinct from excluded.image_paths;
 get diagnostics v_n=row_count;
 insert into public.audit_logs(school_id,actor_id,action,target_table,target_id,detail)
 values(v_school,auth.uid(),'results.publish','tests',p_test,jsonb_build_object('class',p_class,'count',v_n));
 return v_n;
end $$;
-- 確認後に得点・コメントを変更したら、再確認を必須にする。
create function public.invalidate_result_review() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and not new.need_review and
 (to_jsonb(new)-'need_review'-'updated_at')=(to_jsonb(old)-'need_review'-'updated_at') then return new; end if;
 update public.submissions set reviewed_at=null,reviewed_by=null where id=coalesce(new.submission_id,old.submission_id);
 return coalesce(new,old);
end $$;
create trigger invalidate_result_review after insert or update or delete on public.submission_items
 for each row execute function public.invalidate_result_review();
revoke all on function public.bind_student_account(uuid,text), public.publish_class_results(uuid,uuid) from public,anon;
grant execute on function public.bind_student_account(uuid,text), public.publish_class_results(uuid,uuid) to authenticated;
commit;
