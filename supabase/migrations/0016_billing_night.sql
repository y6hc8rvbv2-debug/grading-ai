-- 契約・請求と採点受付の台帳。既存の答案・成績・schools.planは書き換えない。
begin;
create table public.billing_config (id boolean primary key default true check(id), enabled boolean not null default false);
insert into public.billing_config values(true,false);
alter table public.billing_config enable row level security;
revoke all on public.billing_config from public,anon,authenticated;
grant select,update on public.billing_config to service_role;
create table public.billing_worker_state(id boolean primary key default true check(id), last_seen timestamptz);
insert into public.billing_worker_state values(true,null);
alter table public.billing_worker_state enable row level security;
revoke all on public.billing_worker_state from public,anon,authenticated;
grant select,update on public.billing_worker_state to service_role;
create table public.billing_accounts (
 school_id uuid primary key references public.schools(id),
 customer_id text unique, subscription_id text unique, checkout_plan text, checkout_session_id text, checkout_started_at timestamptz,
 plan_id text not null default 'free', status text not null default 'free',
 quota integer not null default 20 check(quota>=0), personal boolean not null default true,
 night boolean not null default false,
 period_start timestamptz not null default (date_trunc('month',now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'),
 period_end timestamptz not null default ((date_trunc('month',now() at time zone 'Asia/Tokyo')+interval '1 month') at time zone 'Asia/Tokyo'),
 check(period_end>period_start)
);
create table public.billing_usage (
 id uuid primary key, school_id uuid not null references public.schools(id),
 submission_id uuid not null, period_start timestamptz not null,
 status text not null default 'reserved' check(status in('reserved','done','failed')),
 amount integer not null default 0 check(amount in(0,55)),
 created_at timestamptz not null default now()
);
-- 1回の採点（再採点も1回）で1枠。台帳を消して枠を戻せない。
create index billing_usage_period on public.billing_usage(school_id,period_start,status);
create table public.billing_orders (
 id uuid primary key, school_id uuid not null references public.schools(id),
 checkout_id text unique, payment_intent text unique,
 status text not null default 'pending' check(status in('pending','paid','refund_pending','refunded','expired')),
 amount integer not null default 55 check(amount=55),
 created_at timestamptz not null default now()
);
create table public.night_queue (
 id uuid primary key, school_id uuid not null references public.schools(id),
 night boolean not null, due_at timestamptz not null, lease_until timestamptz,
 attempts integer not null default 0, status text not null default 'queued' check(status in('queued','done','failed')),
 created_at timestamptz not null default now()
);
alter table public.grading_jobs add column billing_enforced boolean not null default false;
alter table public.grading_jobs add column opus_charge_accepted boolean not null default false;
-- DBへの直接INSERTでは新しい課金経路を回避できない。サービス専用関数だけが無効にできる。
alter table public.grading_jobs alter column billing_enforced set default true;

do $$ declare t text; begin
 foreach t in array array['billing_accounts','billing_usage','billing_orders','night_queue'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy %I_read on public.%I for select to authenticated using(school_id=public.current_school_id())',t,t);
 -- 書込みポリシーは明示的なfalse。クライアントから契約・支払済み・枠を書換えられない。
 execute format('create policy %I_insert on public.%I for insert to authenticated with check(false)',t,t);
 execute format('create policy %I_update on public.%I for update to authenticated using(false) with check(false)',t,t);
 execute format('create policy %I_delete on public.%I for delete to authenticated using(false)',t,t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;

create function public.billing_reserve() returns trigger language plpgsql security definer set search_path=public as $$
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
create trigger billing_reserve before insert on public.grading_jobs for each row execute function public.billing_reserve();

create function public.billing_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.billing_enforced and (select enabled from public.billing_config where id=true) and current_setting('role',true) not in ('service_role','app_owner','postgres') then raise exception '課金対象の採点記録はサーバーだけが更新できます'; end if;
 if new.billing_enforced is distinct from old.billing_enforced or new.opus_charge_accepted is distinct from old.opus_charge_accepted then raise exception '採点の課金条件は変更できません'; end if;
 return new;
end $$;
create trigger billing_guard before update on public.grading_jobs for each row execute function public.billing_guard();
create function public.billing_protect_job_delete() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.billing_enforced and (select enabled from public.billing_config where id=true) then raise exception '課金対象の採点記録は削除できません'; end if;
 return old;
end $$;
create trigger billing_protect_job_delete before delete on public.grading_jobs for each row execute function public.billing_protect_job_delete();
create function public.billing_protect_stage() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (select enabled from public.billing_config where id=true) and exists(select 1 from grading_jobs where id=coalesce(new.job_id,old.job_id) and billing_enforced)
 and current_setting('role',true) not in('service_role','app_owner','postgres') then raise exception '課金対象のモデル実行記録はサーバーだけが更新できます'; end if;
 return coalesce(new,old);
end $$;
create trigger billing_protect_stage before insert or update or delete on public.grading_stages for each row execute function public.billing_protect_stage();

create function public.billing_complete() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.billing_enforced and new.status<>old.status and new.status in('done','failed') then
 update public.billing_usage set status=new.status where id=new.id;
 update public.night_queue set status=new.status where id=new.id;
 if new.status='failed' then
  update public.billing_orders set status=case when status='paid' then 'refund_pending' else 'expired' end where id=new.id and status in('pending','paid');
 end if;
 end if;
 return new;
end $$;
create trigger billing_complete after update on public.grading_jobs for each row execute function public.billing_complete();

-- 呼出しはサーバーのみ。既存コードの採点エンジンは保持し、トランザクションで枠を確保。
create function public.billing_start_job(p_school uuid,p_user uuid,p_submission uuid,p_request uuid,p_mode text,p_enforced boolean,p_consent boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
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
 insert into public.grading_jobs(school_id,submission_id,created_by,request_id,mode,prev_status,prev_progress,billing_enforced,opus_charge_accepted)
 values(p_school,p_submission,p_user,p_request,p_mode,s.status,s.progress,p_enforced,p_consent) returning * into j;
 if exists(select 1 from public.night_queue where id=j.id) then update public.submissions set status='processing',progress=0 where id=p_submission; end if;
 return to_jsonb(j);
end $$;
create function public.billing_is_enabled() returns boolean language sql security definer set search_path=public as $$
 select enabled from public.billing_config where id=true;
$$;
revoke all on function public.billing_is_enabled() from public,anon;
grant execute on function public.billing_is_enabled() to authenticated,service_role;
create function public.billing_claim_queue() returns setof public.night_queue language sql security definer set search_path=public as $$
 update public.night_queue q set lease_until=now()+interval '6 minutes',attempts=attempts+1
 where id in(select nq.id from public.night_queue nq
 join public.grading_jobs j on j.id=nq.id and j.status='running'
 left join public.billing_orders o on o.id=nq.id
 where nq.status='queued' and nq.due_at<=now() and (nq.lease_until is null or nq.lease_until<now())
 and (o.id is null or o.status='paid')
 and (not nq.night or extract(hour from now() at time zone 'Asia/Tokyo')>=22 or extract(hour from now() at time zone 'Asia/Tokyo')<6)
 order by nq.due_at limit 1 for update of nq skip locked)
 returning q.*;
$$;
revoke all on function public.billing_start_job(uuid,uuid,uuid,uuid,text,boolean,boolean),public.billing_claim_queue(),public.billing_reserve(),public.billing_complete(),public.billing_guard(),public.billing_protect_job_delete(),public.billing_protect_stage() from public,anon,authenticated;
grant execute on function public.billing_start_job(uuid,uuid,uuid,uuid,text,boolean,boolean),public.billing_claim_queue() to service_role;

create function public.billing_worker_ping(p_url text) returns bigint language plpgsql security definer set search_path=public,extensions as $$
declare secret text; bypass text; headers jsonb;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='billing_worker_secret';
 if secret is null then raise exception 'Vaultのbilling_worker_secretを設定してください'; end if;
 select decrypted_secret into bypass from vault.decrypted_secrets where name='vercel_protection_bypass';
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret);
 if bypass is not null then headers:=headers||jsonb_build_object('x-vercel-protection-bypass',bypass); end if;
 return net.http_post(url:=p_url,body:='{}'::jsonb,headers:=headers,timeout_milliseconds:=50000);
end $$;
revoke all on function public.billing_worker_ping(text) from public,anon,authenticated;
commit;
