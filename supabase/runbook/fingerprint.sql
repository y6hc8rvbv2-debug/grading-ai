-- DB の状態の指紋（読み取りだけ）：public の表・ビュー・関数・ポリシー・トリガー・列の数と名前。
-- scripts/verify-db/apply.mjs が、各マイグレーションの適用前後に supabase/runbook/verify-expected.json と比べる。
-- 1つの JSON を返す式（select を付けずに使う）
json_build_object(
  'tables', (select coalesce(json_agg(c.relname order by c.relname), '[]') from pg_class c
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
  'views', (select coalesce(json_agg(c.relname order by c.relname), '[]') from pg_class c
              where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'),
  'functions', (select coalesce(json_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by 1), '[]')
              from pg_proc p where p.pronamespace = 'public'::regnamespace
               and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  'policies_public', (select count(*) from pg_policies where schemaname = 'public'),
  'policies_storage', (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'answer_sheets%'),
  'triggers', (select coalesce(json_agg(t.tgname order by t.tgname), '[]') from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where not t.tgisinternal and (c.relnamespace = 'public'::regnamespace or (c.relnamespace = 'auth'::regnamespace and t.tgname like 'on_auth_user%'))),
  'columns', (select count(*) from information_schema.columns c join pg_class k on k.relname = c.table_name and k.relnamespace = 'public'::regnamespace and k.relkind in ('r', 'p')
              where c.table_schema = 'public'),
  'rls_off', (select coalesce(json_agg(c.relname order by c.relname), '[]') from pg_class c
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity)
)
