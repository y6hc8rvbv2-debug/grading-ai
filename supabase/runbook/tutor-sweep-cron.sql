-- ============================================================================
-- チャッピー先生の見回り（定期処理）を登録する。0013_tutor_sweep.sql の後に、環境ごとに1回実行する（docs/TUTOR-SWEEP.md）。
--
-- 実行の前に（SQL に秘密を書かないため、Supabase の管理画面で行う）
--   1. Database → Extensions で pg_cron と pg_net を有効にする（下の create extension でもよい）
--   2. Project Settings → Vault（Integrations → Vault）で Secret を追加する
--        名前 tutor_sweep_secret … アプリの環境変数 CRON_SECRET と同じ値（32文字以上の乱数）
--        名前 vercel_protection_bypass … （Vercel の Preview を保護しているときだけ）Protection Bypass for Automation の値
--   3. 下の __SWEEP_URL__ を、アプリの見回りの URL に置き換える（例：https://<固定の Preview の URL>/api/tutor/sweep）
--
-- 30秒ごとに、DB からアプリの /api/tutor/sweep を呼ぶ。アプリが止まっていても DB 側で動き続け、アプリが戻れば次の回で切る。
-- 止めるとき：select cron.unschedule('tutor-sweep');  （止めると、アプリは新しい会話を始めなくなる）
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 同じ名前の登録があれば置き換える（何度実行してもよい）
select cron.unschedule(jobid) from cron.job where jobname = 'tutor-sweep';
select cron.schedule('tutor-sweep', '30 seconds', $$select public.tutor_sweep_ping('__SWEEP_URL__')$$);

-- 確認：登録されたか・直近の実行結果（数分後に見る）
select jobid, jobname, schedule, active from cron.job where jobname = 'tutor-sweep';
