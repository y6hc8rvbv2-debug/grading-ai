-- ============================================================================
-- 0021_security_hardening.sql : セキュリティの強化（2026-10-22 の点検。docs/SECURITY-REVIEW.md）。0020 の後に適用する
--
--   1. 書き込みは教職員（管理者・先生）だけ：役割 viewer（閲覧）・board（教育委員会）が、成績・名簿・答案の画像などを
--      書き換えられた（0001 の共通ポリシーは学校だけを見ていた）。既存のポリシーは変えず、制限ポリシー（restrictive）を足す
--   2. 生徒の端末からの提出（submit_link_claim の置き換え。0019 からの変更は2点だけ）：
--      - 本人確認済みの答案を、ログインしていない提出で上書きしない（同じリンクを持つ別の生徒のなりすまし対策）
--      - 1つのリンクへの1分あたりの提出を120件までにする（大量送信の対策）
--   3. intake_scans に created_at を足す（自動振り分けの1日の上限を数えるため。app/api/intake）
--
-- 既存の行は変えない。管理者・先生の操作、service_role のサーバー処理（課金中の採点・提出の受付）は今までどおり。
-- ============================================================================
begin;

-- 1. 業務の表：挿入・更新は教職員だけ（restrictive は既存の permissive ポリシーと AND で効く）
do $$
declare t text;
begin
  foreach t in array array[
    'classes','students','tests','questions','rubrics','submissions','submission_items','model_answer_sets',
    'submission_links','grading_jobs','grading_stages'
  ]
  loop
    execute format('create policy %1$I_staff_insert on public.%1$I as restrictive for insert to authenticated with check (public.is_staff())', t);
    execute format('create policy %1$I_staff_update on public.%1$I as restrictive for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;

-- 答案の画像（Storage）：保存・上書きは教職員だけ
create policy "answer_sheets_staff_insert" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'answer-sheets' or public.is_staff());
create policy "answer_sheets_staff_update" on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'answer-sheets' or public.is_staff())
  with check (bucket_id <> 'answer-sheets' or public.is_staff());

-- 2. 生徒の端末からの提出
create or replace function public.submit_link_claim(p_token text, p_student uuid, p_pages smallint, p_verified boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.submission_links%rowtype; old public.submissions%rowtype; v_sub uuid; v_up uuid;
begin
  if char_length(coalesce(p_token, '')) < 24 then raise exception 'この提出リンクは使えません。先生に新しいリンクをもらってください' using errcode = 'P0001'; end if;
  select * into l from public.submission_links where token = p_token for update;
  if not found or l.revoked_at is not null then raise exception 'この提出リンクは使えません。先生に新しいリンクをもらってください' using errcode = 'P0001'; end if;
  if l.expires_at <= now() then raise exception '提出の期限を過ぎています。先生に伝えてください' using errcode = 'P0001'; end if;
  if l.used_count >= l.max_uploads then raise exception '提出できる回数の上限に達しました。先生に伝えてください' using errcode = 'P0001'; end if;
  if p_pages < 1 or p_pages > l.pages_max then raise exception '1人分の答案は % ページまでです', l.pages_max using errcode = 'P0001'; end if;
  if not exists (select 1 from public.students where id = p_student and class_id = l.class_id and school_id = l.school_id) then
    raise exception '出席番号を選び直してください' using errcode = 'P0001';
  end if;
  select * into old from public.submissions where test_id = l.test_id and student_id = p_student for update;
  if found and old.deleted_at is null and (old.status <> 'uploaded' or old.source <> 'mobile') then
    raise exception 'この答案はすでに先生が取り込んだか、採点が始まっています。出し直すときは先生に伝えてください' using errcode = 'P0001';
  end if;
  -- 0021：本人確認済み（生徒アカウントでログインして出した）答案を、ログインしていない提出で上書きしない（なりすまし対策）
  if found and old.deleted_at is null and not coalesce(p_verified, false) and exists (
       select 1 from public.link_uploads u where u.submission_id = old.id and u.verified
        and u.created_at = (select max(u2.created_at) from public.link_uploads u2 where u2.submission_id = old.id)) then
    raise exception 'この答案は本人がログインして提出済みです。出し直すときは、自分のアカウントでログインしてから提出してください' using errcode = 'P0001';
  end if;
  -- 0021：1つのリンクへの短時間の大量の提出を断る（1分に120件まで。1クラスの一斉提出は通る）
  if (select count(*) from public.link_uploads u where u.link_id = l.id and u.created_at > now() - interval '1 minute') >= 120 then
    raise exception '短い時間に提出が集中しています。1分ほど待ってから、もう一度提出してください' using errcode = 'P0001';
  end if;
  insert into public.submissions (school_id, test_id, student_id, class_id, source, status, pages, progress, image_paths, uploaded_at, deleted_at)
  values (l.school_id, l.test_id, p_student, l.class_id, 'mobile', 'uploaded', p_pages, 0, '{}', now(), null)
  on conflict (test_id, student_id) do update set source = 'mobile', status = 'uploaded', pages = excluded.pages, progress = 0,
    image_paths = '{}', uploaded_at = now(), deleted_at = null, is_blank = false, edited = false, reviewed_by = null, reviewed_at = null
  returning id into v_sub;
  update public.submission_links set used_count = used_count + 1 where id = l.id;
  insert into public.link_uploads (school_id, link_id, student_id, submission_id, pages, verified)
  values (l.school_id, l.id, p_student, v_sub, p_pages, coalesce(p_verified, false)) returning id into v_up;
  return jsonb_build_object('upload_id', v_up, 'submission_id', v_sub, 'school_id', l.school_id, 'test_id', l.test_id);
end $$;
revoke all on function public.submit_link_claim(text, uuid, smallint, boolean) from public, anon, authenticated;
grant execute on function public.submit_link_claim(text, uuid, smallint, boolean) to service_role;

-- 3. 自動振り分けの記録に作成日時（既存の行は適用した時刻になる）
alter table public.intake_scans add column if not exists created_at timestamptz not null default now();
create index if not exists intake_scans_user_day_idx on public.intake_scans (created_by, created_at);

commit;
