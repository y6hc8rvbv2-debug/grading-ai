-- 0010適用後。確認済みの答案1件だけを本人専用ページへ返却する。
-- 既存成績・配信先・一斉配信関数は変更しない。SQL適用だけでは返却しない。
begin;
create or replace function public.publish_submission_result(p_submission uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare v_school uuid; v_sub public.submissions%rowtype; v_n integer;
begin
 if not (public.current_role_is('admin') or public.current_role_is('teacher')) then
   raise exception '教職員だけが返却できます';
 end if;
 v_school:=public.current_school_id();
 select * into v_sub from public.submissions
 where id=p_submission and school_id=v_school and deleted_at is null for update;
 if not found then raise exception '答案が見つかりません'; end if;
 perform 1 from public.submission_items where submission_id=p_submission for update;
 if not exists(select 1 from public.student_accounts where student_id=v_sub.student_id and school_id=v_school) then
   raise exception 'この生徒の配信先を先に登録してください';
 end if;
 if v_sub.reviewed_at is null or v_sub.status in ('uploaded','processing')
 or exists(select 1 from public.grading_jobs where submission_id=p_submission and status='running')
 or not exists(select 1 from public.questions where test_id=v_sub.test_id)
 or exists(select 1 from public.questions q where q.test_id=v_sub.test_id and not exists(
   select 1 from public.submission_items i where i.submission_id=p_submission and i.question_id=q.id and i.qno=q.no))
 or (select count(*) from public.submission_items where submission_id=p_submission)<>
    (select count(*) from public.questions where test_id=v_sub.test_id)
 or exists(select 1 from public.submission_items where submission_id=p_submission and (need_review or (mark='-' and not is_blank))) then
   raise exception 'この生徒の採点と全設問の確認を完了してください';
 end if;
 insert into public.result_releases(submission_id,student_id,school_id,payload,image_paths,released_by)
 select s.id,s.student_id,s.school_id,jsonb_build_object('test',(select name from public.tests where id=v_sub.test_id),'total',s.total_score,'maxScore',(select sum(points) from public.questions where test_id=v_sub.test_id),
 'positions',coalesce((select jsonb_agg(jsonb_build_object('qno',m.qno,'page',m.page,'x',m.x,'y',m.y)) from public.mark_positions m where m.submission_id=s.id),'[]'::jsonb),
 'items',(select jsonb_agg(jsonb_build_object('qno',i.qno,'label',q.label,'big',q.big,'type',q.qtype,'mark',i.mark,'earned',i.earned,'points',q.points,'comment',i.comment,'bbox',i.bbox) order by i.qno)
 from public.submission_items i join public.questions q on q.id=i.question_id where i.submission_id=s.id)),s.image_paths,auth.uid()
 from public.submissions s where s.id=p_submission and s.school_id=v_school and s.deleted_at is null
 on conflict(submission_id) do update set payload=excluded.payload,image_paths=excluded.image_paths,released_by=excluded.released_by,released_at=now()
 where result_releases.payload is distinct from excluded.payload or result_releases.image_paths is distinct from excluded.image_paths;
 get diagnostics v_n=row_count;
 insert into public.audit_logs(school_id,actor_id,action,target_table,target_id,detail)
 values(v_school,auth.uid(),'results.publish_one','submissions',p_submission,jsonb_build_object('student',v_sub.student_id,'count',v_n));
 return v_n;
end $$;
revoke all on function public.publish_submission_result(uuid) from public,anon;
grant execute on function public.publish_submission_result(uuid) to authenticated;
commit;
