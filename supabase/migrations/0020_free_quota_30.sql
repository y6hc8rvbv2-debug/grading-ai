-- ============================================================================
-- 0020_free_quota_30.sql : 無料プランを「月30答案まで・3モデル併用で採点」にする（0019 の後に適用する）
--
--   1. billing_accounts.quota の既定を 20 → 30（新しく作られる無料の契約）
--   2. いまの無料プランの契約（plan_id='free'・status='free'・quota=20）を 30 にする。有料・確認待ちの契約は変えない
--   3. billing_reserve（採点の受付）を置き換える。0019 からの変更は2点だけ：
--      - 前払いの期限切れで無料プランに戻すときの上限を 30 にする
--      - 無料プランの Opus単独を、個人・塾だけでなく学校でも断る（3モデル併用だけ）
--
-- 数え方は変えない：1答案＝生徒1人分の答案の採点1回（再採点も1回・失敗は数えない）。
-- ============================================================================
begin;

alter table public.billing_accounts alter column quota set default 30;

update public.billing_accounts set quota = 30
 where plan_id = 'free' and status = 'free' and quota = 20;

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
   update public.billing_accounts set plan_id='free', status='free', quota=30, personal=true, night=false, prepaid_until=null,
    period_start=date_trunc('month',now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo',
    period_end=(date_trunc('month',now() at time zone 'Asia/Tokyo')+interval '1 month') at time zone 'Asia/Tokyo'
    where school_id=a.school_id returning * into a;
  end if;
 end if;
 if a.status not in ('active','free') or a.period_end<=now() then raise exception '契約の支払いを確認してください'; end if;
 select count(*) into n from public.billing_usage where school_id=a.school_id and period_start=a.period_start and status in('reserved','done');
 if n>=a.quota then raise exception '月間採点上限に達しました'; end if;
 -- 0020：無料プランは学校・個人とも3モデル併用だけ（以前は個人・塾だけを確かめていた）
 if new.mode='opus' and a.status='free' then raise exception '無料プランは3モデル併用のみです'; end if;
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
