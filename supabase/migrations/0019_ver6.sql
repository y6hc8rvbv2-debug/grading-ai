-- ============================================================================
-- 0019_ver6.sql : テスト採点ver6 の追加分（0018 の後に適用する）
--
--   1. ai_settings      … 学校ごとの AIエンジン（段階ごとのモデル）と同時に採点する枚数
--   2. submission_links … 生徒のタブレット・スマホから答案を提出するリンク（0002 の表に列を足す）
--      link_uploads     … リンクから届いた提出の記録（だれが・いつ・どの答案）
--   3. billing_prepaid  … 前払い（コンビニ・PayPay・暗号資産など）で買った利用期間
--
-- 既存の行は変えない（列は既定値つきで追加）。新しい表には school_id と RLS の4種のポリシー、明示的な GRANT を付ける。
-- ============================================================================
begin;

/* ---------------------------------------------------------------- 1. AIエンジン */
create table public.ai_settings (
  school_id     uuid primary key references public.schools(id) on delete cascade,
  -- 段階ごとのモデルID（null は環境変数・既定値に従う）
  model_fast     text check (model_fast is null or model_fast ~ '^claude-[a-z0-9-]{2,60}$'),
  model_standard text check (model_standard is null or model_standard ~ '^claude-[a-z0-9-]{2,60}$'),
  model_top      text check (model_top is null or model_top ~ '^claude-[a-z0-9-]{2,60}$'),
  -- 同時に採点する答案の数（ブラウザが使う。1〜16）
  concurrency   smallint not null default 8 check (concurrency between 1 and 16),
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now()
);
alter table public.ai_settings enable row level security;
-- 読むのは同じ学校の教職員。変えるのは管理者だけ
create policy ai_settings_select on public.ai_settings for select to authenticated
  using (school_id = public.current_school_id());
create policy ai_settings_insert on public.ai_settings for insert to authenticated
  with check (school_id = public.current_school_id() and public.current_role_is('admin'));
create policy ai_settings_update on public.ai_settings for update to authenticated
  using (school_id = public.current_school_id() and public.current_role_is('admin'))
  with check (school_id = public.current_school_id() and public.current_role_is('admin'));
create policy ai_settings_delete on public.ai_settings for delete to authenticated
  using (school_id = public.current_school_id() and public.current_role_is('admin'));
revoke all on public.ai_settings from public, anon;
grant select, insert, update, delete on public.ai_settings to authenticated;
grant select, insert, update, delete on public.ai_settings to service_role;

/* ---------------------------------------------------------------- 2. 生徒のタブレット・スマホからの提出 */
-- 0002 の submission_links（トークン・期限・上限）に、取り消しと1人分のページ数の上限を足す
alter table public.submission_links add column revoked_at timestamptz;
alter table public.submission_links add column pages_max smallint not null default 10 check (pages_max between 1 and 10);
alter table public.submission_links add column note text not null default '' check (char_length(note) <= 100);
-- トークンは推測できない長さ（32文字）をブラウザが crypto.getRandomValues で作る。提出の受付（submit_link_claim）は24文字未満のトークンを受け付けない

-- リンクから届いた提出の記録（だれの答案を・何ページ・いつ）。書き込みはサーバー（service_role）の関数だけ
create table public.link_uploads (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid        not null references public.schools(id) on delete cascade,
  link_id       uuid        not null references public.submission_links(id) on delete cascade,
  student_id    uuid        not null references public.students(id) on delete cascade,
  submission_id uuid        not null references public.submissions(id) on delete cascade,
  pages         smallint    not null default 1 check (pages between 1 and 10),
  -- 本人がログインした生徒アカウントで出したか（false は出席番号の自己申告）
  verified      boolean     not null default false,
  status        text        not null default 'receiving' check (status in ('receiving','done','failed')),
  created_at    timestamptz not null default now()
);
create index link_uploads_link_idx on public.link_uploads(link_id, created_at);
alter table public.link_uploads enable row level security;
create policy link_uploads_select on public.link_uploads for select to authenticated
  using (school_id = public.current_school_id() and (public.current_role_is('admin') or public.current_role_is('teacher')));
create policy link_uploads_insert on public.link_uploads for insert to authenticated with check (false);
create policy link_uploads_update on public.link_uploads for update to authenticated using (false) with check (false);
create policy link_uploads_delete on public.link_uploads for delete to authenticated using (false);
revoke all on public.link_uploads from public, anon, authenticated;
grant select on public.link_uploads to authenticated;
grant select, insert, update, delete on public.link_uploads to service_role;

-- リンクの案内（生徒の画面に出す。トークンが正しく、期限内・取り消されていないときだけ）
create or replace function public.submit_link_info(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'link_id', l.id, 'test', t.name, 'subject', t.subject, 'class', c.label, 'expires_at', l.expires_at,
    'pages_max', l.pages_max, 'note', l.note, 'left', greatest(l.max_uploads - l.used_count, 0),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'number', s.number) order by s.number)
                            from public.students s where s.class_id = l.class_id), '[]'::jsonb))
    from public.submission_links l
    join public.tests t on t.id = l.test_id and t.school_id = l.school_id
    join public.classes c on c.id = l.class_id and c.school_id = l.school_id
   where l.token = p_token and char_length(p_token) >= 24 and l.revoked_at is null and l.expires_at > now()
$$;

-- 提出を受け付ける（1つのトランザクションで：リンクの確認 → 答案の行 → 回数 → 記録）。
-- 先生がすでに取り込んだ答案・採点が始まった答案は上書きしない
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

-- 画像を保存し終えたら答案に結び付ける（失敗したら記録を failed にする）
create or replace function public.submit_link_finish(p_upload uuid, p_paths text[])
returns void language plpgsql security definer set search_path = public as $$
declare u public.link_uploads%rowtype;
begin
  select * into u from public.link_uploads where id = p_upload for update;
  if not found or u.status <> 'receiving' then raise exception '提出の記録が見つかりません' using errcode = 'P0001'; end if;
  if p_paths is null or cardinality(p_paths) = 0 then
    update public.link_uploads set status = 'failed' where id = p_upload;
    return;
  end if;
  if exists (select 1 from unnest(p_paths) p where split_part(p, '/', 1) <> u.school_id::text) then
    raise exception '保存先が正しくありません' using errcode = 'P0001';
  end if;
  update public.submissions set image_paths = p_paths, pages = cardinality(p_paths) where id = u.submission_id;
  update public.link_uploads set status = 'done' where id = p_upload;
end $$;

revoke all on function public.submit_link_info(text) from public, anon, authenticated;
revoke all on function public.submit_link_claim(text, uuid, smallint, boolean) from public, anon, authenticated;
revoke all on function public.submit_link_finish(uuid, text[]) from public, anon, authenticated;
grant execute on function public.submit_link_info(text) to service_role;
grant execute on function public.submit_link_claim(text, uuid, smallint, boolean) to service_role;
grant execute on function public.submit_link_finish(uuid, text[]) to service_role;

commit;
