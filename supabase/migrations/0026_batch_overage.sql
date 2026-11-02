-- ============================================================================
-- 0026_batch_overage.sql : 夜間の Batch 採点・学校の Opus単独の追加料金・上限を超えた分の従量課金（2026-11-02 ユーザーの指示。0025 の後に適用する）
--
--   1. 料金（billing_config に置き、画面・規約は lib/subscription-plans.ts の同じ値を表示する）
--      - 上限を超えた分：個人・塾 22円（税込）／学校 20円（税別）・1答案
--      - 学校の Opus単独：50円（税別）・1答案（個人・塾は今までどおり 55円（税込）をその場で支払う）
--   2. 従量課金は「管理者が有効にした有料の月額契約」だけ（無料・前払いは今までどおり上限で止まる）。
--      管理者が月の上限額（円）を決め、先生は上限に達したときに警告と単価を見て同意してから採点する（grading_jobs.overage_accepted）。
--      採点が終わったものだけを請求する（失敗は請求しない）。請求はサーバーが Stripe の次回の請求に加える（billing_usage.charge_status）
--   3. 夜間の Batch 採点：AI の要求をまとめて送る記録（ai_batches）と、段階ごとの batch_id（grading_stages.batch_id）
-- ============================================================================
begin;

alter table public.billing_config
  add column overage_personal_yen integer not null default 22 check (overage_personal_yen between 0 and 1000),
  add column overage_school_yen integer not null default 20 check (overage_school_yen between 0 and 1000),
  add column school_opus_yen integer not null default 50 check (school_opus_yen between 0 and 1000);

alter table public.billing_accounts
  add column overage_enabled boolean not null default false,
  add column overage_cap_yen integer not null default 0 check (overage_cap_yen between 0 and 10000000),
  add column overage_updated_by uuid references auth.users(id) on delete set null,
  add column overage_updated_at timestamptz;

alter table public.billing_usage
  add column kind text not null default 'quota' check (kind in ('quota', 'overage')),
  add column overage_yen integer not null default 0 check (overage_yen >= 0),
  add column opus_yen integer not null default 0 check (opus_yen >= 0),
  add column charge_status text not null default 'none' check (charge_status in ('none', 'pending', 'synced', 'void')),
  add column stripe_items text[];

alter table public.grading_jobs add column overage_accepted boolean not null default false;

-- 採点が終われば請求待ち、失敗したら請求しない（台帳の状態は billing_complete が grading_jobs から写す）
create or replace function public.billing_usage_charge() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'done' and new.overage_yen + new.opus_yen > 0 and new.charge_status = 'none' then new.charge_status := 'pending'; end if;
    if new.status = 'failed' and new.charge_status in ('none', 'pending') then new.charge_status := 'void'; end if;
  end if;
  return new;
end $$;
create trigger billing_usage_charge before update on public.billing_usage for each row execute function public.billing_usage_charge();

-- 同意の印は、採点の記録を作ったあとに書き換えられない（0017 の billing_guard と同じ考え）
create or replace function public.billing_guard_overage() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.overage_accepted is distinct from old.overage_accepted then raise exception '採点の課金条件は変更できません'; end if;
  return new;
end $$;
create trigger billing_guard_overage before update on public.grading_jobs for each row execute function public.billing_guard_overage();

create or replace function public.billing_reserve() returns trigger language plpgsql security definer set search_path=public as $$
declare a public.billing_accounts%rowtype; n integer; sub public.submissions%rowtype; cfg public.billing_config%rowtype; over_yen integer := 0; opus_yen integer := 0; spent integer;
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
   update public.billing_accounts set plan_id='free', status='free', quota=10, personal=true, night=false, prepaid_until=null,
    period_start=date_trunc('month',now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo',
    period_end=(date_trunc('month',now() at time zone 'Asia/Tokyo')+interval '1 month') at time zone 'Asia/Tokyo'
    where school_id=a.school_id returning * into a;
  end if;
 end if;
 if a.status not in ('active','free') or a.period_end<=now() then raise exception '契約の支払いを確認してください'; end if;
 select count(*) into n from public.billing_usage where school_id=a.school_id and period_start=a.period_start and status in('reserved','done');
 select * into cfg from public.billing_config where id=true;
 -- 0020：無料プランは学校・個人とも3モデル併用だけ（0025 でも変えない）
 if new.mode='opus' and a.status='free' then raise exception '無料プランは3モデル併用のみです'; end if;
 -- 0026：上限を超えた分の従量課金。管理者が有効にした有料の月額契約だけ。先生の同意（overage_accepted）と、月の上限額を確かめる
 if n>=a.quota then
  if a.status='free' or a.subscription_id is null then
   raise exception '月間採点上限に達しました' using detail = case when a.status='free' then 'quota_free' else 'quota_prepaid' end;
  end if;
  if not a.overage_enabled then raise exception '月間採点上限に達しました' using detail = 'quota_overage_off'; end if;
  over_yen := case when a.personal then cfg.overage_personal_yen else cfg.overage_school_yen end;
  select coalesce(sum(overage_yen),0) into spent from public.billing_usage
   where school_id=a.school_id and period_start=a.period_start and status in('reserved','done');
  if spent + over_yen > a.overage_cap_yen then raise exception '従量課金の月の上限額に達しました' using detail = 'overage_cap'; end if;
  if not new.overage_accepted then raise exception '上限を超えた分の従量課金への同意が必要です' using detail = 'overage_consent'; end if;
 end if;
 if a.personal and new.mode='opus' and not new.opus_charge_accepted then raise exception 'Opus単独の追加55円への同意が必要です' using detail = 'opus_consent'; end if;
 -- 0026：学校の Opus単独は1答案ごとに追加料金（税別）。翌月の請求に加算する（採点に失敗したら請求しない）
 if not a.personal and new.mode='opus' then
  if not new.opus_charge_accepted then raise exception 'Opus単独の追加料金への同意が必要です' using detail = 'school_opus_consent'; end if;
  opus_yen := cfg.school_opus_yen;
 end if;
 insert into public.billing_usage(id,school_id,submission_id,period_start,amount,kind,overage_yen,opus_yen)
 values(new.id,new.school_id,new.submission_id,a.period_start,case when a.personal and new.mode='opus' then 55 else 0 end,
  case when over_yen>0 then 'overage' else 'quota' end, over_yen, opus_yen);
 if a.personal and new.mode='opus' then insert into public.billing_orders(id,school_id) values(new.id,new.school_id); end if;
 if a.night or (a.personal and new.mode='opus') then
 insert into public.night_queue(id,school_id,night,due_at) values(new.id,new.school_id,a.night,
 case when a.night and extract(hour from now() at time zone 'Asia/Tokyo') between 6 and 21 then
 (date_trunc('day',now() at time zone 'Asia/Tokyo')+interval '22 hours') at time zone 'Asia/Tokyo' else now() end);
 end if;
 return new;
end $$;


-- 0017 の billing_start_job に、従量課金の同意（p_overage）を足す（呼び方の重複を避けるため、古い形は消す）
drop function public.billing_start_job(uuid, uuid, uuid, uuid, text, boolean, boolean);
create function public.billing_start_job(p_school uuid, p_user uuid, p_submission uuid, p_request uuid, p_mode text, p_enforced boolean, p_consent boolean, p_overage boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.grading_jobs%rowtype; s public.submissions%rowtype;
begin
 if not exists(select 1 from public.profiles where id=p_user and school_id=p_school and role in('admin','teacher')) then raise exception '採点する権限がありません'; end if;
 select * into s from public.submissions where id=p_submission and school_id=p_school and deleted_at is null for update;
 if not found then raise exception '答案が見つかりません'; end if;
 select * into j from public.grading_jobs where request_id=p_request;
 if found then
  if j.school_id<>p_school or j.submission_id<>p_submission or j.created_by<>p_user or j.mode<>p_mode then raise exception '採点の要求が一致しません'; end if;
  return to_jsonb(j);
 end if;
 insert into public.grading_jobs(school_id,submission_id,created_by,request_id,mode,prev_status,prev_progress,billing_enforced,opus_charge_accepted,overage_accepted)
 values(p_school,p_submission,p_user,p_request,p_mode,s.status,s.progress,p_enforced,p_consent,coalesce(p_overage,false)) returning * into j;
 if exists(select 1 from public.night_queue where id=j.id) then update public.submissions set status='processing',progress=0 where id=p_submission; end if;
 return to_jsonb(j);
end $$;
revoke all on function public.billing_start_job(uuid, uuid, uuid, uuid, text, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.billing_start_job(uuid, uuid, uuid, uuid, text, boolean, boolean, boolean) to service_role;

-- 管理者が従量課金を設定する（有効・月の上限額）。先生・生徒は変えられない。監査ログに残す
create function public.set_overage_settings(p_enabled boolean, p_cap_yen integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.current_school_id(); a public.billing_accounts%rowtype;
begin
  if not public.current_role_is('admin') then raise exception '従量課金の設定は管理者だけが変えられます'; end if;
  if p_cap_yen is null or p_cap_yen < 0 or p_cap_yen > 10000000 then raise exception '月の上限額は0円〜1,000万円で指定してください'; end if;
  if p_enabled and p_cap_yen < 100 then raise exception '従量課金を有効にするときは、月の上限額を100円以上にしてください'; end if;
  insert into public.billing_accounts(school_id) values (v_school) on conflict do nothing;
  select * into a from public.billing_accounts where school_id = v_school for update;
  if p_enabled and (a.status <> 'active' or a.subscription_id is null) then
    raise exception '従量課金は、有料の月額契約で使えます（無料・前払いでは使えません）';
  end if;
  update public.billing_accounts set overage_enabled = p_enabled, overage_cap_yen = p_cap_yen,
    overage_updated_by = auth.uid(), overage_updated_at = now() where school_id = v_school returning * into a;
  insert into public.audit_logs (school_id, actor_id, action, target_table, detail)
  values (v_school, auth.uid(), 'billing.overage', 'billing_accounts', jsonb_build_object('enabled', p_enabled, 'cap_yen', p_cap_yen));
  return jsonb_build_object('enabled', a.overage_enabled, 'cap_yen', a.overage_cap_yen);
end $$;
revoke all on function public.set_overage_settings(boolean, integer) from public, anon;
grant execute on function public.set_overage_settings(boolean, integer) to authenticated;

-- 料金（画面の表示用。誰でも読める値だけ）
create function public.billing_prices() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('overage_personal_yen', overage_personal_yen, 'overage_school_yen', overage_school_yen, 'school_opus_yen', school_opus_yen)
    from public.billing_config where id = true
$$;
revoke all on function public.billing_prices() from public, anon;
grant execute on function public.billing_prices() to authenticated, service_role;

-- 夜間の Batch 採点（サーバーの service_role だけが読み書きする）
create table public.ai_batches (
  id uuid primary key default gen_random_uuid(),
  provider_batch_id text unique,
  status text not null default 'submitting' check (status in ('submitting', 'in_progress', 'ended', 'failed')),
  request_count integer not null default 0,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  error text
);
alter table public.ai_batches enable row level security;
revoke all on public.ai_batches from public, anon, authenticated;
grant select, insert, update on public.ai_batches to service_role;

alter table public.grading_stages add column batch_id uuid references public.ai_batches(id) on delete set null;
create index grading_stages_batch_idx on public.grading_stages (batch_id) where batch_id is not null;

-- 夜間の答案の取り出し：Batch の結果で上の段階に回った答案は、朝6時を過ぎても続きを送れるようにする（翌晩まで待たせない）
create or replace function public.billing_claim_queue() returns setof public.night_queue language sql security definer set search_path=public as $$
 update public.night_queue q set lease_until=now()+interval '6 minutes',attempts=attempts+1
 where id in(select nq.id from public.night_queue nq
 join public.grading_jobs j on j.id=nq.id and j.status='running'
 left join public.billing_orders o on o.id=nq.id
 where nq.status='queued' and nq.due_at<=now() and (nq.lease_until is null or nq.lease_until<now())
 and (o.id is null or o.status='paid')
 and (not nq.night or extract(hour from now() at time zone 'Asia/Tokyo')>=22 or extract(hour from now() at time zone 'Asia/Tokyo')<6
      or exists(select 1 from public.grading_stages s where s.job_id=nq.id))
 order by nq.due_at limit 1 for update of nq skip locked)
 returning q.*;
$$;
revoke all on function public.billing_claim_queue() from public, anon, authenticated;
grant execute on function public.billing_claim_queue() to service_role;

revoke all on function public.billing_usage_charge(), public.billing_guard_overage() from public, anon, authenticated;

commit;
