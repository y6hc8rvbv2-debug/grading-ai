-- 既存rls_test.sqlの後に、隔離DBだけで実行する。
set role app_owner;
insert into public.schools(id,name,code) values('cccccccc-0000-0000-0000-000000000000','Workflow','WF');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
('cccccccc-0000-0000-0000-000000000001','wfadmin@example.test',now(),'{"school_id":"cccccccc-0000-0000-0000-000000000000","role":"admin"}'),
('cccccccc-0000-0000-0000-000000000002','wfstudent@example.test',now(),'{}'),
('cccccccc-0000-0000-0000-000000000003','otherstudent@example.test',now(),'{}');
insert into public.classes(id,school_id,grade,name,school_year) values('cccccccc-0000-0000-0000-000000000011','cccccccc-0000-0000-0000-000000000000',2,'WF',2026);
insert into public.students(id,school_id,class_id,number,exam_no,anon_id) values('cccccccc-0000-0000-0000-000000000021','cccccccc-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000011',1,'WF01','WF01');
insert into public.tests(id,school_id,name,subject,grade,max_score) values('cccccccc-0000-0000-0000-000000000031','cccccccc-0000-0000-0000-000000000000','WF','数学',2,100);
insert into public.questions(id,school_id,test_id,no,label,qtype,unit,points) values('cccccccc-0000-0000-0000-000000000041','cccccccc-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000031',1,'1','calc','',100);
insert into public.submissions(id,school_id,test_id,student_id,class_id,status,progress,image_paths) values('cccccccc-0000-0000-0000-000000000051','cccccccc-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000031','cccccccc-0000-0000-0000-000000000021','cccccccc-0000-0000-0000-000000000011','done',100,array['cccccccc-0000-0000-0000-000000000000/test.jpg']);
insert into public.submission_items(school_id,submission_id,question_id,qno,mark,earned,need_review) values('cccccccc-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000051','cccccccc-0000-0000-0000-000000000041',1,'○',100,false);
insert into storage.objects(bucket_id,name) values('answer-sheets','cccccccc-0000-0000-0000-000000000000/test.jpg');
set role authenticated;
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
select public.bind_student_account('cccccccc-0000-0000-0000-000000000021','wfstudent@example.test');
do $$ begin
 begin
 perform public.publish_class_results('cccccccc-0000-0000-0000-000000000031','cccccccc-0000-0000-0000-000000000011');
 raise exception 'TEST: unreviewed publish accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise; end if; end;
 assert (select count(*) from public.result_releases)=0,'未確認では配信されない';
end $$;
select public.mark_submission_reviewed('cccccccc-0000-0000-0000-000000000051');
do $$ begin
 assert public.publish_class_results('cccccccc-0000-0000-0000-000000000031','cccccccc-0000-0000-0000-000000000011')=1;
 assert public.publish_class_results('cccccccc-0000-0000-0000-000000000031','cccccccc-0000-0000-0000-000000000011')=0,'二重配信しない';
 update public.submission_items set comment='教師修正' where submission_id='cccccccc-0000-0000-0000-000000000051';
 assert (select reviewed_at is null from public.submissions where id='cccccccc-0000-0000-0000-000000000051'),'編集で確認が外れる';
 assert (select payload->'items'->0->>'comment' from public.result_releases)='','配信済み内容は勝手に変わらない';
 begin
 perform public.bind_student_account('cccccccc-0000-0000-0000-000000000021','otherstudent@example.test');
 raise exception 'TEST: recipient rebound';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise; end if; end;
end $$;
select pg_temp.login('cccccccc-0000-0000-0000-000000000002');
do $$ begin
 assert (select count(*) from public.result_releases)=1,'本人は返却結果を読める';
 assert (select count(*) from public.submissions)=0,'生徒は学校の答案テーブルを読めない';
 assert (select count(*) from storage.objects where name='cccccccc-0000-0000-0000-000000000000/test.jpg')=1,'本人は返却画像だけ読める';
 begin
 perform public.publish_class_results('cccccccc-0000-0000-0000-000000000031','cccccccc-0000-0000-0000-000000000011');
 raise exception 'TEST: student published';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise; end if; end;
 begin
 update public.result_releases set payload='{}';
 assert not found,'生徒は結果を書き換えられない';
 exception when insufficient_privilege then null; end;
end $$;
select pg_temp.login('cccccccc-0000-0000-0000-000000000003');
do $$ begin
 assert (select count(*) from public.result_releases)=0,'別の生徒には見えない';
 assert (select count(*) from storage.objects where name='cccccccc-0000-0000-0000-000000000000/test.jpg')=0,'別の生徒は画像も読めない';
end $$;
select pg_temp.login('bbbbbbbb-0000-0000-0000-00000000000b');
do $$ begin
 assert (select count(*) from public.result_releases)=0,'他校教員には見えない';
 begin
 perform public.publish_class_results('cccccccc-0000-0000-0000-000000000031','cccccccc-0000-0000-0000-000000000011');
 raise exception 'TEST: cross-school publish';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise; end if; end;
end $$;
reset role;
-- 個別返却：他の生徒が未提出でも、対象の確認条件は緩めない。
set role app_owner;
insert into public.students(id,school_id,class_id,number,exam_no,anon_id) values
('cccccccc-0000-0000-0000-000000000022','cccccccc-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000011',2,'WF02','WF02');
set role authenticated;
select pg_temp.login('cccccccc-0000-0000-0000-000000000001');
do $$ begin
 begin
 perform public.publish_submission_result('cccccccc-0000-0000-0000-000000000051');
 raise exception 'TEST: unreviewed individual accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise; end if; end;
end $$;
select public.mark_submission_reviewed('cccccccc-0000-0000-0000-000000000051');
do $$ begin
 assert public.publish_submission_result('cccccccc-0000-0000-0000-000000000051')=1,'未提出の別生徒がいても個別返却';
 assert public.publish_submission_result('cccccccc-0000-0000-0000-000000000051')=0,'同一内容の再返却は更新しない';
 assert (select count(*) from public.result_releases)=1,'別生徒へは返却しない';
 assert (select payload->'items'->0->>'comment' from public.result_releases)='教師修正';
 begin
 perform public.publish_class_results('cccccccc-0000-0000-0000-000000000031','cccccccc-0000-0000-0000-000000000011');
 raise exception 'TEST: incomplete class accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise; end if; end;
end $$;
select pg_temp.login('cccccccc-0000-0000-0000-000000000002');
do $$ begin
 assert (select count(*) from public.result_releases)=1;
 begin
 perform public.publish_submission_result('cccccccc-0000-0000-0000-000000000051');
 raise exception 'TEST: student individual publish';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise; end if; end;
end $$;
select pg_temp.login('bbbbbbbb-0000-0000-0000-00000000000b');
do $$ begin
 begin
 perform public.publish_submission_result('cccccccc-0000-0000-0000-000000000051');
 raise exception 'TEST: other school individual publish';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise; end if; end;
end $$;
reset role;
-- 配信先未登録・要確認・設問欠落・削除済みを拒否し、既存返却を保つ。
set role app_owner;
do $$
declare mode integer; rejected boolean;
begin
 for mode in 1..4 loop
  begin
   if mode=1 then delete from public.student_accounts where student_id='cccccccc-0000-0000-0000-000000000021';
   elsif mode=2 then update public.submission_items set need_review=true where submission_id='cccccccc-0000-0000-0000-000000000051';
   elsif mode=3 then delete from public.submission_items where submission_id='cccccccc-0000-0000-0000-000000000051';
   else update public.submissions set deleted_at=now() where id='cccccccc-0000-0000-0000-000000000051'; end if;
   update public.submissions set reviewed_at=now() where id='cccccccc-0000-0000-0000-000000000051';
   perform pg_temp.login('cccccccc-0000-0000-0000-000000000001');
   rejected:=false;
   begin perform public.publish_submission_result('cccccccc-0000-0000-0000-000000000051');
   exception when raise_exception then rejected:=true; end;
   assert rejected,'unsafe individual release accepted';
   assert (select count(*) from public.result_releases)=1;
   raise exception using errcode='ZX001',message='rollback fixture';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
end $$;
reset role;
