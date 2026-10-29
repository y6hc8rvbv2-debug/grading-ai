-- ============================================================================
-- 0024_tenant_integrity.sql : 他校の ID・他校の画像を指す書き込みを断る（2026-10-29。docs/APPSTORE-PRECHECK.md）。0023 の後に適用する
--
--   これまで（CLAUDE.md の未解決 5）：外部キーは「行がある」ことしか確かめないため、学校Aの教職員が
--   学校Bの test_id・question_id や、学校Bのフォルダの画像のパスを、自校の答案に書き込めた。
--   返却の関数（security definer）はその答案を元に返却内容を作るので、学校Bの問題文・正答・答案の画像が
--   学校Aの生徒アカウントから見えるおそれがあった（相手の ID を知っている必要はある）。
--   ここでは、書き込みのたびに「指している行の学校＝この行の学校」「画像のパスは自校のフォルダ」を確かめる。
--   既存の行は変えない（新しい書き込み・更新だけを確かめる）。正しい使い方（自校の中の参照）は今までどおり通る。
--
--   あわせて：
--   ・返却された画像を生徒が読む規則（released_images_read）に、画像のパスが返却した学校のフォルダであることを足す
--   ・答案の画像の保存先（answer-sheets）の許可形式に application/octet-stream を足す（暗号化した写真の形式。
--     検証用の DB では 2026-10-28 に画面から足してあり、ここではそれを記録として残す。すでにあれば何もしない）
-- ============================================================================
begin;

-- 指している行（TG_ARGV に「列名, 表名」の組を並べる）の学校が、この行の学校と同じかを確かめる
create or replace function public.tenant_refs_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(new);
  i int;
  v text;
  t text;
  s uuid;
begin
  if r->>'school_id' is null then return new; end if;
  for i in 0 .. tg_nargs - 1 by 2 loop
    v := r->>tg_argv[i];
    continue when v is null;
    select format_type(a.atttypid, a.atttypmod) into t
      from pg_attribute a where a.attrelid = ('public.' || quote_ident(tg_argv[i + 1]))::regclass and a.attname = 'id';
    execute format('select school_id from public.%I where id = $1::%s', tg_argv[i + 1], t) into s using v;
    -- 見つからない行は外部キーが断る。学校が違えば断る
    if s is not null and s <> (r->>'school_id')::uuid then
      raise exception '他の学校のデータは指定できません（%）', tg_argv[i] using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

-- 画像のパスの列（TG_ARGV[0]）が、すべてこの行の学校のフォルダ（{school_id}/…）かを確かめる
create or replace function public.tenant_paths_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(new);
begin
  if r->>'school_id' is null or jsonb_typeof(r->tg_argv[0]) is distinct from 'array' then return new; end if;
  if exists (select 1 from jsonb_array_elements_text(r->tg_argv[0]) p
              where left(p, 37) <> (r->>'school_id') || '/' or p ~ '(^|/)\.\.?(/|$)' or p like '%//%') then
    raise exception '他の学校の画像は指定できません（%）', tg_argv[0] using errcode = '42501';
  end if;
  return new;
end $$;

-- 採点結果の設問は、その答案のテストの設問に限る
create or replace function public.submission_item_question_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.question_id is not null and not exists (
       select 1 from public.questions q join public.submissions s on s.test_id = q.test_id
        where q.id = new.question_id and s.id = new.submission_id) then
    raise exception 'この答案のテストに無い設問は指定できません' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tenant_refs_check(), public.tenant_paths_check(), public.submission_item_question_check() from public, anon;
grant execute on function public.tenant_refs_check(), public.tenant_paths_check(), public.submission_item_question_check() to authenticated, service_role;

-- 表ごとに、学校をまたいではいけない参照を並べる（列名, 指す表）
create trigger tenant_refs before insert or update on public.submissions
  for each row execute function public.tenant_refs_check('test_id', 'tests', 'student_id', 'students', 'class_id', 'classes');
create trigger tenant_paths before insert or update of image_paths, school_id on public.submissions
  for each row execute function public.tenant_paths_check('image_paths');
create trigger tenant_refs before insert or update on public.submission_items
  for each row execute function public.tenant_refs_check('submission_id', 'submissions', 'question_id', 'questions');
create trigger tenant_question before insert or update of question_id, submission_id on public.submission_items
  for each row execute function public.submission_item_question_check();
create trigger tenant_refs before insert or update on public.questions
  for each row execute function public.tenant_refs_check('test_id', 'tests');
create trigger tenant_paths before insert or update of answer_key_paths, school_id on public.tests
  for each row execute function public.tenant_paths_check('answer_key_paths');
create trigger tenant_refs before insert or update on public.rubrics
  for each row execute function public.tenant_refs_check('test_id', 'tests');
create trigger tenant_refs before insert or update on public.model_answer_sets
  for each row execute function public.tenant_refs_check('test_id', 'tests');
create trigger tenant_refs before insert or update on public.students
  for each row execute function public.tenant_refs_check('class_id', 'classes');
create trigger tenant_refs before insert or update on public.submission_links
  for each row execute function public.tenant_refs_check('test_id', 'tests', 'class_id', 'classes');
create trigger tenant_refs before insert or update on public.mark_positions
  for each row execute function public.tenant_refs_check('submission_id', 'submissions');
create trigger tenant_refs before insert or update on public.grading_jobs
  for each row execute function public.tenant_refs_check('submission_id', 'submissions');
create trigger tenant_refs before insert or update on public.grading_stages
  for each row execute function public.tenant_refs_check('job_id', 'grading_jobs', 'submission_id', 'submissions');
create trigger tenant_refs before insert or update on public.link_uploads
  for each row execute function public.tenant_refs_check('link_id', 'submission_links', 'student_id', 'students', 'submission_id', 'submissions');
create trigger tenant_refs before insert or update on public.test_imports
  for each row execute function public.tenant_refs_check('test_id', 'tests');
create trigger tenant_refs before insert or update on public.result_releases
  for each row execute function public.tenant_refs_check('submission_id', 'submissions', 'student_id', 'students');
create trigger tenant_paths before insert or update of image_paths, school_id on public.result_releases
  for each row execute function public.tenant_paths_check('image_paths');
create trigger tenant_refs before insert or update on public.result_release_history
  for each row execute function public.tenant_refs_check('release_id', 'result_releases', 'student_id', 'students', 'submission_id', 'submissions');
create trigger tenant_refs before insert or update on public.student_inbox
  for each row execute function public.tenant_refs_check('release_id', 'result_releases', 'student_id', 'students');
create trigger tenant_refs before insert or update on public.student_accounts
  for each row execute function public.tenant_refs_check('student_id', 'students');
create trigger tenant_refs before insert or update on public.student_account_invites
  for each row execute function public.tenant_refs_check('student_id', 'students');
create trigger tenant_refs before insert or update on public.tutor_consents
  for each row execute function public.tenant_refs_check('student_id', 'students');
create trigger tenant_refs before insert or update on public.tutor_credentials
  for each row execute function public.tenant_refs_check('student_id', 'students');
create trigger tenant_refs before insert or update on public.tutor_progress
  for each row execute function public.tenant_refs_check('release_id', 'result_releases', 'student_id', 'students');
create trigger tenant_refs before insert or update on public.tutor_reflections
  for each row execute function public.tenant_refs_check('release_id', 'result_releases', 'student_id', 'students');
create trigger tenant_refs before insert or update on public.tutor_sessions
  for each row execute function public.tenant_refs_check('release_id', 'result_releases', 'student_id', 'students');
create trigger tenant_refs before insert or update on public.tutor_transcripts
  for each row execute function public.tenant_refs_check('session_id', 'tutor_sessions', 'student_id', 'students');
create trigger tenant_refs before insert or update on public.tutor_call_secrets
  for each row execute function public.tenant_refs_check('session_id', 'tutor_sessions');
create trigger tenant_refs before insert or update on public.model_compare_results
  for each row execute function public.tenant_refs_check('run_id', 'model_compare_runs');

-- 返却された画像：返却した学校のフォルダの画像だけ（返却内容の画像のパスが他校を指していても読ませない）
drop policy if exists released_images_read on storage.objects;
create policy released_images_read on storage.objects for select to authenticated using (
  bucket_id = 'answer-sheets' and exists (
    select 1 from public.result_releases r join public.student_accounts a on a.student_id = r.student_id and a.school_id = r.school_id
     where a.user_id = auth.uid() and storage.objects.name = any (r.image_paths)
       and left(storage.objects.name, 37) = r.school_id::text || '/'));

-- 暗号化した写真の形式を、答案の画像の保存先で受け付ける（許可形式を決めていない＝null の場合は、何も変えない）
update storage.buckets
   set allowed_mime_types = allowed_mime_types || array['application/octet-stream']
 where id = 'answer-sheets' and allowed_mime_types is not null
   and not ('application/octet-stream' = any (allowed_mime_types));

commit;
