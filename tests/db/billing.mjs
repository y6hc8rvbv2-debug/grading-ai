// 本物のDB・決済に接続しない。全マイグレーションを適用したPostgreSQLで台帳を検証。
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite({ extensions: { pgcrypto } });
let checks=0;
const scalar=async sql=>(await db.query(sql)).rows[0].v;
const ok=async (sql,expected)=>{assert.equal(await scalar(sql),expected);checks++;};
const deny=async sql=>{await assert.rejects(db.exec(sql));checks++;};
try {
  await db.exec(fs.readFileSync('supabase/tests/00_supabase_shim.sql','utf8'));
  await db.exec('set role app_owner');
  for(const file of fs.readdirSync('supabase/migrations').sort()) await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await db.exec(`
    insert into schools(id,name,code) values('eeeeeeee-0000-0000-0000-000000000000','Billing test','BILL');
    insert into auth.users(id,email,raw_app_meta_data) values('eeeeeeee-0000-0000-0000-000000000001','billing@example.test','{"school_id":"eeeeeeee-0000-0000-0000-000000000000","role":"admin"}');
    insert into classes(id,school_id,grade,name,school_year) values('eeeeeeee-0000-0000-0000-000000000002','eeeeeeee-0000-0000-0000-000000000000',1,'A',2026);
    insert into students(id,school_id,class_id,number,exam_no,anon_id) values('eeeeeeee-0000-0000-0000-000000000003','eeeeeeee-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000002',1,'B1','B1');
    insert into tests(id,school_id,name,subject,grade) values('eeeeeeee-0000-0000-0000-000000000004','eeeeeeee-0000-0000-0000-000000000000','Test','数学',1);
    insert into questions(school_id,test_id,no,label,qtype,points) values('eeeeeeee-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000004',1,'1','calc',10);
    insert into submissions(id,school_id,test_id,class_id,student_id,image_paths) values('eeeeeeee-0000-0000-0000-000000000005','eeeeeeee-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000004','eeeeeeee-0000-0000-0000-000000000002','eeeeeeee-0000-0000-0000-000000000003',array['eeeeeeee-0000-0000-0000-000000000000/test.jpg']);
    update billing_config set enabled=true;
  `);
  const start=(req,mode='cascade',consent=false)=>`select billing_start_job('eeeeeeee-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000005','eeeeeeee-0000-0000-0000-${String(req).padStart(12,'0')}','${mode}',true,${consent})`;
  await db.exec(start(10));await db.exec(start(10));
  await ok('select count(*)::int as v from billing_usage',1);
  await ok("select plan_id||'/'||status||'/'||quota as v from billing_accounts",'free/free/10'); // 0025：無料プランは月10答案
  await db.exec("update grading_jobs set status='failed'");
  await ok("select count(*)::int as v from billing_usage where status='reserved'",0);
  await deny(start(11,'opus',true)); // 無料のOpus拒否
  await db.exec("update billing_accounts set status='active',plan_id='personal-mini',quota=1");
  await deny(start(11,'opus',false));
  await db.exec(start(11,'opus',true));
  await ok('select count(*)::int as v from billing_orders',1);
  await ok("select count(*)::int as v from billing_claim_queue()",0); // 未払いを実行しない
  await db.exec("update billing_orders set status='paid',payment_intent='pi_fixture'");
  await ok("select count(*)::int as v from billing_claim_queue()",1);
  await ok("select count(*)::int as v from billing_claim_queue()",0); // リースによる重複防止
  await deny(start(12)); // 枠が予約されている
  await db.exec("update grading_jobs set status='failed' where status='running'");
  await ok("select status as v from billing_orders",'refund_pending');
  await db.exec(start(12));
  await db.exec("update grading_jobs set status='done' where status='running'");
  await deny(start(13)); // 確定済み枠も上限に含む
  await db.exec("update billing_accounts set period_start=period_start+interval '1 month',period_end=period_end+interval '1 month'");
  await db.exec(start(14));
  await ok("select count(*)::int as v from billing_usage where status='reserved'",1); // 更新期間の枠
  await db.exec("set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"eeeeeeee-0000-0000-0000-000000000001\",\"role\":\"authenticated\"}',false)");
  await deny("update billing_accounts set quota=100000");
  await deny("update billing_orders set status='paid'");
  await deny("select billing_claim_queue()");
  await deny("update grading_jobs set billing_enforced=false");
  await deny("update grading_jobs set status='failed' where status='running'");
  await deny("delete from grading_jobs where status='running'");
  await db.exec('set role app_owner');
  await db.exec("update grading_jobs set status='failed' where status='running'");
  await db.exec("update submissions set image_paths=array['eeeeeeee-0000-0000-0000-000000000000/a.jpg','eeeeeeee-0000-0000-0000-000000000000/b.jpg','eeeeeeee-0000-0000-0000-000000000000/c.jpg']");
  await deny(start(15));
  await db.exec("update submissions set image_paths=array['eeeeeeee-0000-0000-0000-000000000000/answer.pdf']");
  await deny(start(16));
  await db.exec("update submissions set image_paths=array['eeeeeeee-0000-0000-0000-000000000000/answer.jpg']; update billing_accounts set status='payment_pending'");
  await deny(start(17));
  await db.exec("update billing_accounts set status='free',quota=10,period_start=now()-interval '2 months',period_end=now()-interval '1 month'");
  await db.exec(start(18));
  await ok("select (period_end>now()) as v from billing_accounts",true);
  // ---------------------------------------------------------------- ver6（0019）：前払い
  await db.exec("update grading_jobs set status='failed' where status='running'");
  await db.exec(`insert into billing_prepaid(id,school_id,plan_id,months,amount,method,provider,provider_ref,quota,personal,night)
    values('eeeeeeee-0000-0000-0000-0000000000a1','eeeeeeee-0000-0000-0000-000000000000','personal-light',3,8250,'stripe','stripe','cs_fixture_1',200,true,false)`);
  await ok("select (billing_apply_prepaid('eeeeeeee-0000-0000-0000-0000000000a1')->>'applied')::boolean as v",true);
  await ok("select plan_id||'/'||status||'/'||quota as v from billing_accounts",'personal-light/active/200');
  await ok("select (prepaid_until between now()+interval '89 days' and now()+interval '93 days') as v from billing_accounts",true); // 3か月分
  await ok("select (billing_apply_prepaid('eeeeeeee-0000-0000-0000-0000000000a1')->>'again')::boolean as v",true); // 二度反映しない
  await ok("select (prepaid_until < now()+interval '93 days') as v from billing_accounts",true);
  // 同じプランの追加の前払いは期限を延ばす。別のプランは期間中は反映せず返金待ち
  await db.exec(`insert into billing_prepaid(id,school_id,plan_id,months,amount,method,provider,provider_ref,quota,personal,night) values
    ('eeeeeeee-0000-0000-0000-0000000000a2','eeeeeeee-0000-0000-0000-000000000000','personal-light',1,2750,'crypto','nowpayments','np_fixture',200,true,false),
    ('eeeeeeee-0000-0000-0000-0000000000a3','eeeeeeee-0000-0000-0000-000000000000','personal-pro',1,12100,'crypto','coinbase','cb_fixture',1000,true,false)`);
  await db.exec("select billing_apply_prepaid('eeeeeeee-0000-0000-0000-0000000000a2')");
  await ok("select (prepaid_until > now()+interval '115 days') as v from billing_accounts",true);
  await ok("select billing_apply_prepaid('eeeeeeee-0000-0000-0000-0000000000a3')->>'status' as v",'refund_pending');
  await ok("select plan_id as v from billing_accounts",'personal-light');
  // 月が替わったら、前払いの期限まで枠の期間を進めて採点を受け付ける
  await db.exec("update billing_accounts set period_start=now()-interval '40 days',period_end=now()-interval '10 days'");
  await db.exec(start(19));
  await ok("select (period_end>now() and period_end<=prepaid_until) as v from billing_accounts",true);
  // 期限を過ぎたら無料プランに戻る（採点は無料の枠で続けられる）
  await db.exec("update grading_jobs set status='failed' where status='running'");
  await db.exec("update billing_accounts set prepaid_until=now()-interval '1 day',period_start=now()-interval '31 days',period_end=now()-interval '1 day'");
  await db.exec(start(20));
  await ok("select plan_id||'/'||status||'/'||quota||'/'||coalesce(prepaid_until::text,'-') as v from billing_accounts",'free/free/10/-');
  // 0020：無料プランは学校（personal=false）でも Opus単独を断る（3モデル併用だけ）
  await db.exec("update grading_jobs set status='failed' where status='running'; update billing_accounts set personal=false");
  await deny(start(21,'opus',true));
  await db.exec(start(21));
  await db.exec("update grading_jobs set status='failed' where status='running'; update billing_accounts set personal=true");
  // 0025：無料プランは月10答案まで。今月の10答案目までは受け付け、11答案目は断る（失敗は数えない）
  await db.exec(`delete from billing_usage; update billing_accounts set plan_id='free',status='free',quota=10,
    period_start=date_trunc('month',now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo',
    period_end=(date_trunc('month',now() at time zone 'Asia/Tokyo')+interval '1 month') at time zone 'Asia/Tokyo'`);
  await db.exec(start(30)); await db.exec("update grading_jobs set status='failed' where status='running'");   // 失敗した採点は数えない
  for (let i = 31; i <= 40; i++) { await db.exec(start(i)); await db.exec("update grading_jobs set status='done' where status='running'"); }
  await ok("select count(*)::int as v from billing_usage where status in ('reserved','done')",10);
  await deny(start(41)); // 11答案目
  await db.exec("update billing_accounts set period_start=period_start+interval '1 month',period_end=period_end+interval '1 month'");
  await db.exec(start(42)); // 翌月はまた受け付ける
  await db.exec("update grading_jobs set status='failed' where status='running'");
  // ---------------------------------------------------------------- 0026：上限を超えた分の従量課金・学校の Opus単独の追加料金
  const start2=(req,{mode='cascade',consent=false,overage=false}={})=>`select billing_start_job('eeeeeeee-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000005','eeeeeeee-0000-0000-0000-${String(req).padStart(12,'0')}','${mode}',true,${consent},${overage})`;
  const denyMsg=async(sql,re)=>{await assert.rejects(db.exec(sql),(e)=>re.test(e.message));checks++;};
  const asAdmin=async(sql)=>{await db.exec("set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"eeeeeeee-0000-0000-0000-000000000001\",\"role\":\"authenticated\"}',false)");try{return await db.query(sql);}finally{await db.exec('set role app_owner');}};
  const done=async()=>db.exec("update grading_jobs set status='done' where status='running'");
  const failRunning=async()=>db.exec("update grading_jobs set status='failed' where status='running'");
  // 無料プラン：上限で止まる（従量課金は無い）
  await db.exec(`delete from billing_usage; update billing_accounts set plan_id='free',status='free',quota=1,subscription_id=null,personal=false,
    period_start=date_trunc('month',now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo',
    period_end=(date_trunc('month',now() at time zone 'Asia/Tokyo')+interval '1 month') at time zone 'Asia/Tokyo'`);
  await db.exec(start2(50)); await done();
  await denyMsg(start2(51,{overage:true}),/月間採点上限/);
  await assert.rejects(asAdmin("select set_overage_settings(true, 1000)"), /有料の月額契約/); checks++;
  // 学校の月額契約（上限2）：上限に達したら、管理者が有効にするまで止まる
  await db.exec("delete from billing_usage; update billing_accounts set plan_id='school-mini',status='active',quota=2,subscription_id='sub_overage_fixture',personal=false");
  await db.exec(start2(52)); await done(); await db.exec(start2(53)); await done();
  await denyMsg(start2(54,{overage:true}),/月間採点上限/);
  // 先生は設定を変えられない（管理者だけ）
  await db.exec("insert into auth.users(id,email,raw_app_meta_data) values('eeeeeeee-0000-0000-0000-0000000000b7','teacher-bill@example.test','{\"school_id\":\"eeeeeeee-0000-0000-0000-000000000000\",\"role\":\"teacher\"}')");
  await db.exec("set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"eeeeeeee-0000-0000-0000-0000000000b7\",\"role\":\"authenticated\"}',false)");
  await assert.rejects(db.query("select set_overage_settings(true, 1000)"), /管理者/); checks++;
  await db.exec('set role app_owner');
  await assert.rejects(asAdmin("select set_overage_settings(true, 50)"), /100円以上/); checks++;
  await asAdmin("select set_overage_settings(true, 100)");
  await ok("select overage_enabled::text||'/'||overage_cap_yen as v from billing_accounts",'true/100');
  await ok("select count(*)::int as v from audit_logs where action='billing.overage'",1);
  // 同意が無ければ断る → 同意すれば 20円（税別）の従量課金で受け付ける
  await denyMsg(start2(54),/従量課金への同意/);
  await db.exec(start2(55,{overage:true}));
  await ok("select kind||'/'||overage_yen||'/'||charge_status as v from billing_usage where id=(select id from grading_jobs where request_id='eeeeeeee-0000-0000-0000-000000000055')",'overage/20/none');
  await done();
  await ok("select charge_status as v from billing_usage where id=(select id from grading_jobs where request_id='eeeeeeee-0000-0000-0000-000000000055')",'pending'); // 終わったものだけ請求待ち
  // 失敗した採点は請求しない
  await db.exec(start2(56,{overage:true})); await failRunning();
  await ok("select charge_status as v from billing_usage where id=(select id from grading_jobs where request_id='eeeeeeee-0000-0000-0000-000000000056')",'void');
  for (const r of [57, 63, 64, 65]) { await db.exec(start2(r,{overage:true})); await done(); }   // 20円×5＝100円（上限100円まで）
  await ok("select sum(overage_yen)::int as v from billing_usage where status in ('reserved','done')",100);
  await denyMsg(start2(58,{overage:true}),/月の上限額/);      // 120円になるので断る
  // 同意の印は後から書き換えられない
  await assert.rejects(db.exec("set role service_role; update grading_jobs set overage_accepted=false where request_id='eeeeeeee-0000-0000-0000-000000000057'")); checks++;
  await db.exec('set role app_owner');
  // 学校の Opus単独：同意が無ければ断る・同意すれば 50円（税別）を請求に加える
  await db.exec("delete from billing_usage; update billing_accounts set quota=100");
  await denyMsg(start2(59,{mode:'opus'}),/Opus単独の追加料金への同意/);
  await db.exec(start2(60,{mode:'opus',consent:true}));
  await ok("select opus_yen||'/'||amount||'/'||kind as v from billing_usage where id=(select id from grading_jobs where request_id='eeeeeeee-0000-0000-0000-000000000060')",'50/0/quota');
  await ok("select count(*)::int as v from billing_orders where id=(select id from grading_jobs where request_id='eeeeeeee-0000-0000-0000-000000000060')",0); // 学校はその場の支払いではない
  await done();
  await ok("select charge_status as v from billing_usage where id=(select id from grading_jobs where request_id='eeeeeeee-0000-0000-0000-000000000060')",'pending');
  // 個人・塾の従量課金は 22円（税込）
  await db.exec("delete from billing_usage; update billing_accounts set personal=true,plan_id='personal-mini',quota=1");
  await db.exec(start2(61)); await done();
  await db.exec(start2(62,{overage:true})); await done();
  await ok("select overage_yen as v from billing_usage where kind='overage'",22);
  // 先生の画面向けの料金（誰でも読める）
  await ok("select (billing_prices()->>'school_opus_yen')::int as v",50);
  await db.exec("delete from billing_usage; update billing_accounts set overage_enabled=false,overage_cap_yen=0,subscription_id=null,plan_id='free',status='free',quota=10,personal=true");
  // 先生は前払いの注文を書き換えられない・反映の関数を呼べない
  await db.exec('set role authenticated');
  await db.exec("select set_config('request.jwt.claims','{\"sub\":\"eeeeeeee-0000-0000-0000-000000000001\",\"role\":\"authenticated\"}',false)");
  await ok('select count(*)::int as v from billing_prepaid',3);
  await deny("update billing_prepaid set status='pending'");
  await deny("select billing_apply_prepaid('eeeeeeee-0000-0000-0000-0000000000a3')");
  await db.exec('set role app_owner');

  await db.exec('set role authenticated');
  await db.exec("select set_config('request.jwt.claims','{\"sub\":\"aaaaaaaa-0000-0000-0000-000000000001\",\"role\":\"authenticated\"}',false)");
  await ok('select count(*)::int as v from billing_usage',0);
  await ok('select count(*)::int as v from billing_prepaid',0); // 他校の前払いは見えない
  console.log(`PASS billing PostgreSQL: ${checks} checks`);
} catch(e) { console.error(e.message);process.exitCode=1; } finally { await db.close(); }
