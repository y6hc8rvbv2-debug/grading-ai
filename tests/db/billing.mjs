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
  await ok("select plan_id||'/'||status||'/'||quota as v from billing_accounts",'free/free/30'); // 0020：無料プランは月30答案
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
  await db.exec("update billing_accounts set status='free',quota=30,period_start=now()-interval '2 months',period_end=now()-interval '1 month'");
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
  await ok("select plan_id||'/'||status||'/'||quota||'/'||coalesce(prepaid_until::text,'-') as v from billing_accounts",'free/free/30/-');
  // 0020：無料プランは学校（personal=false）でも Opus単独を断る（3モデル併用だけ）
  await db.exec("update grading_jobs set status='failed' where status='running'; update billing_accounts set personal=false");
  await deny(start(21,'opus',true));
  await db.exec(start(21));
  await db.exec("update grading_jobs set status='failed' where status='running'; update billing_accounts set personal=true");
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
