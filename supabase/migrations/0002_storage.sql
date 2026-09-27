-- ============================================================================
-- 0002_storage.sql : 答案画像の保管（非公開バケット）
--
-- パス規約  {school_id}/{test_id}/{submission_id}/{page}.jpg
-- 先頭フォルダを school_id にすることで、RLS と同じ境界を Storage にも引く。
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'answer-sheets',
  'answer-sheets',
  false,                                   -- 公開しない。参照は署名付きURLのみ。
  20971520,                                -- 1ファイル20MBまで
  array['image/jpeg','image/png','image/heic','image/heif','application/pdf']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 自校のフォルダ配下だけを読み書きできる
create policy "answer_sheets_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'answer-sheets'
    and (storage.foldername(name))[1] = public.current_school_id()::text
  );

create policy "answer_sheets_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'answer-sheets'
    and (storage.foldername(name))[1] = public.current_school_id()::text
  );

create policy "answer_sheets_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'answer-sheets'
    and (storage.foldername(name))[1] = public.current_school_id()::text
  );

-- 削除は管理者のみ（保存期間による自動削除はサーバ側の service_role で行う）
create policy "answer_sheets_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'answer-sheets'
    and (storage.foldername(name))[1] = public.current_school_id()::text
    and public.current_role_is('admin')
  );

-- 生徒がモバイルから提出するときの一時トークン。
-- 生徒はログインしないため、提出リンクごとに短命のレコードを発行し、
-- Edge Function（service_role）が検証してアップロードを代行する。
create table public.submission_links (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid        not null references public.schools(id) on delete cascade,
  test_id      uuid        not null references public.tests(id) on delete cascade,
  class_id     uuid        not null references public.classes(id) on delete cascade,
  token        text        not null unique,
  expires_at   timestamptz not null default now() + interval '72 hours',
  max_uploads  smallint    not null default 60,
  used_count   smallint    not null default 0,
  created_by   uuid        references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index submission_links_token_idx on public.submission_links(token);

alter table public.submission_links enable row level security;

create policy submission_links_select on public.submission_links
  for select to authenticated
  using (school_id = public.current_school_id());
create policy submission_links_insert on public.submission_links
  for insert to authenticated
  with check (school_id = public.current_school_id());
create policy submission_links_delete on public.submission_links
  for delete to authenticated
  using (school_id = public.current_school_id());
