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
    insert into submissions(id,school_id,test_id,class_id,student_id,image_paths) values('eeeeeeee-0000-0000-0000-000000000005','eeeeeeee-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000004','eeeeeeee-0000-0000-0000-000000000002','eeeeeeee-0000-0000-0000-000000000003',array['test.jpg']);
    update billing_config set enabled=true;
  `);
  const start=(req,mode='cascade',consent=false)=>`select billing_start_job('eeeeeeee-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000005','eeeeeeee-0000-0000-0000-${String(req).padStart(12,'0')}','${mode}',true,${consent})`;
  await db.exec(start(10));await db.exec(start(10));
  await ok('select count(*)::int as v from billing_usage',1);
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
  await db.exec("update submissions set image_paths=array['a.jpg','b.jpg','c.jpg']");
  await deny(start(15));
  await db.exec("update submissions set image_paths=array['answer.pdf']");
  await deny(start(16));
  await db.exec("update submissions set image_paths=array['answer.jpg']; update billing_accounts set status='payment_pending'");
  await deny(start(17));
  await db.exec("update billing_accounts set status='free',quota=20,period_start=now()-interval '2 months',period_end=now()-interval '1 month'");
  await db.exec(start(18));
  await ok("select (period_end>now()) as v from billing_accounts",true);
  await db.exec('set role authenticated');
  await db.exec("select set_config('request.jwt.claims','{\"sub\":\"aaaaaaaa-0000-0000-0000-000000000001\",\"role\":\"authenticated\"}',false)");
  await ok('select count(*)::int as v from billing_usage',0);
  console.log(`PASS billing PostgreSQL: ${checks} checks`);
} catch(e) { console.error(e.message);process.exitCode=1; } finally { await db.close(); }
