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

/* ---------------------------------------------------------------- 3. 前払い（コンビニ・PayPay・銀行振込・暗号資産など） */
-- 月額の自動更新（カード・Apple Pay・Google Pay）に加えて、1・3・6・12か月分をまとめて前払いできる。
-- 支払いの確認（Stripe の通知・暗号資産の決済代行の通知。どちらも署名を確かめる）のあと、サーバーが billing_apply_prepaid で反映する。
alter table public.billing_accounts add column prepaid_until timestamptz;

create table public.billing_prepaid (
  id           uuid primary key,
  school_id    uuid        not null references public.schools(id),
  plan_id      text        not null,
  months       smallint    not null check (months in (1, 3, 6, 12)),
  amount       integer     not null check (amount > 0),
  currency     text        not null default 'jpy' check (currency = 'jpy'),
  method       text        not null check (method in ('stripe', 'crypto')),
  provider     text        not null check (provider in ('stripe', 'nowpayments', 'coinbase')),
  provider_ref text        unique,
  -- 反映する条件（申し込みの時点の料金表の値。後から料金表が変わっても、支払った内容で反映する）
  quota        integer     not null check (quota > 0),
  personal     boolean     not null,
  night        boolean     not null,
  status       text        not null default 'pending' check (status in ('pending', 'applied', 'expired', 'failed', 'refund_pending')),
  created_by   uuid        references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  applied_at   timestamptz
);
create index billing_prepaid_school on public.billing_prepaid(school_id, created_at);
alter table public.billing_prepaid enable row level security;
create policy billing_prepaid_read on public.billing_prepaid for select to authenticated using (school_id = public.current_school_id());
create policy billing_prepaid_insert on public.billing_prepaid for insert to authenticated with check (false);
create policy billing_prepaid_update on public.billing_prepaid for update to authenticated using (false) with check (false);
create policy billing_prepaid_delete on public.billing_prepaid for delete to authenticated using (false);
revoke all on public.billing_prepaid from public, anon, authenticated;
grant select on public.billing_prepaid to authenticated;
grant select, insert, update, delete on public.billing_prepaid to service_role;

-- 支払いを確認した前払いを、契約に反映する（同じ注文を二度反映しない）。
-- 月額の契約中・別のプランの前払いの期間中に届いた支払いは反映せず、返金待ちにする（推測で権限を付けない）
create or replace function public.billing_apply_prepaid(p_order uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.billing_prepaid%rowtype; a public.billing_accounts%rowtype; v_from timestamptz; v_until timestamptz;
begin
  select * into o from public.billing_prepaid where id = p_order for update;
  if not found then raise exception '前払いの注文が見つかりません' using errcode = 'P0001'; end if;
  if o.status = 'applied' then return jsonb_build_object('applied', true, 'again', true); end if;
  if o.status not in ('pending', 'expired') then return jsonb_build_object('applied', false, 'status', o.status); end if;
  insert into public.billing_accounts(school_id) values (o.school_id) on conflict do nothing;
  select * into a from public.billing_accounts where school_id = o.school_id for update;
  if a.subscription_id is not null or (a.prepaid_until is not null and a.prepaid_until > now() and a.plan_id <> o.plan_id) then
    update public.billing_prepaid set status = 'refund_pending' where id = o.id;
    return jsonb_build_object('applied', false, 'status', 'refund_pending');
  end if;
  v_from := greatest(now(), coalesce(a.prepaid_until, now()));
  v_until := v_from + make_interval(months => o.months);
  if a.prepaid_until is not null and a.prepaid_until > now() then
    -- 同じプランの前払いの期間中：期限だけ延ばす（いまの月の枠はそのまま）
    update public.billing_accounts set prepaid_until = v_until where school_id = a.school_id;
  else
    update public.billing_accounts set plan_id = o.plan_id, status = 'active', quota = o.quota, personal = o.personal, night = o.night,
      prepaid_until = v_until, period_start = now(), period_end = least(now() + interval '1 month', v_until)
      where school_id = a.school_id;
  end if;
  update public.billing_prepaid set status = 'applied', applied_at = now() where id = o.id;
  insert into public.audit_logs (school_id, action, target_table, target_id, detail)
  values (o.school_id, 'billing.prepaid', 'billing_prepaid', o.id,
          jsonb_build_object('plan', o.plan_id, 'months', o.months, 'amount', o.amount, 'provider', o.provider, 'until', v_until));
  return jsonb_build_object('applied', true, 'until', v_until);
end $$;
revoke all on function public.billing_apply_prepaid(uuid) from public, anon, authenticated;
grant execute on function public.billing_apply_prepaid(uuid) to service_role;

-- 採点の受付（0017）に、前払いの月ごとの枠の更新と期限切れを加える（ほかの規則は 0017 と同じ）
create or replace function public.billing_reserve() returns trigger language plpgsql security definer set search_path=public as $$
declare a public.billing_accounts%rowtype; n integer; sub public.submissions%rowtype;
begin
 if not (select enabled from public.billing_config where id=true) then return new; end if;
 if not new.billing_enforced then
   if current_setting('role',true) not in ('service_role','app_owner','postgres') then raise exception '課金確認を省略できません'; end if;
   return new;
 end if;
 select * into sub from public.submissions where id=new.submission_id and school_id=new.school_id and deleted_at is null;
 if not found then raise exception '答案が見つかりません'; end if;
 if coalesce(cardinality(sub.image_paths),0)>2 or exists(select 1 from unnest(sub.image_paths) p where lower(p) like '%%.pdf')
 or (select count(*) from public.questions where test_id=sub.test_id)>20 then
   raise exception 'この料金枠は2ページ・20問までです。PDFは画像に分けて取り込んでください。';
 end if;
 insert into public.billing_accounts(school_id) values(new.school_id) on conflict do nothing;
 select * into a from public.billing_accounts where school_id=new.school_id for update;
 if a.status='free' and a.period_end<=now() then
  update public.billing_accounts set period_start=date_trunc('month',now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo',
   period_end=(date_trunc('month',now() at time zone 'Asia/Tokyo')+interval '1 month') at time zone 'Asia/Tokyo' where school_id=a.school_id returning * into a;
 end if;
 -- ver6（0019）：前払いの契約。月ごとの枠の期間を前払いの期限まで1か月ずつ進め、期限を過ぎたら無料プランに戻す
 if a.subscription_id is null and a.prepaid_until is not null and a.period_end<=now() then
  if a.prepaid_until>now() then
   while a.period_end<=now() loop
    a.period_start := a.period_end;
    a.period_end := least(a.period_end + interval '1 month', a.prepaid_until);
   end loop;
   update public.billing_accounts set period_start=a.period_start, period_end=a.period_end where school_id=a.school_id returning * into a;
  else
   update public.billing_accounts set plan_id='free', status='free', quota=20, personal=true, night=false, prepaid_until=null,
    period_start=date_trunc('month',now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo',
    period_end=(date_trunc('month',now() at time zone 'Asia/Tokyo')+interval '1 month') at time zone 'Asia/Tokyo'
    where school_id=a.school_id returning * into a;
  end if;
 end if;
 if a.status not in ('active','free') or a.period_end<=now() then raise exception '契約の支払いを確認してください'; end if;
 select count(*) into n from public.billing_usage where school_id=a.school_id and period_start=a.period_start and status in('reserved','done');
 if n>=a.quota then raise exception '月間採点上限に達しました'; end if;
 if a.personal and new.mode='opus' and a.status='free' then raise exception '無料プランは3モデル併用のみです'; end if;
 if a.personal and new.mode='opus' and not new.opus_charge_accepted then raise exception 'Opus単独の追加55円への同意が必要です'; end if;
 insert into public.billing_usage(id,school_id,submission_id,period_start,amount)
 values(new.id,new.school_id,new.submission_id,a.period_start,case when a.personal and new.mode='opus' then 55 else 0 end);
 if a.personal and new.mode='opus' then insert into public.billing_orders(id,school_id) values(new.id,new.school_id); end if;
 if a.night or (a.personal and new.mode='opus') then
 insert into public.night_queue(id,school_id,night,due_at) values(new.id,new.school_id,a.night,
 case when a.night and extract(hour from now() at time zone 'Asia/Tokyo') between 6 and 21 then
 (date_trunc('day',now() at time zone 'Asia/Tokyo')+interval '22 hours') at time zone 'Asia/Tokyo' else now() end);
 end if;
 return new;
end $$;


commit;
