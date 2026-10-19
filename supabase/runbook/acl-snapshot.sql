-- public スキーマの各オブジェクトについて、Data API のロール（anon・authenticated・service_role）と PUBLIC に
-- 実際に付いている権限を、比べやすい1行ずつの形で出す（読み取り専用）。
-- 0014_explicit_grants.sql を作る元にし、「自動で公開」がオン／オフのどちらの環境でも同じになったかを確かめるのに使う。
-- 表・ビュー：SELECT/INSERT/UPDATE/DELETE だけを見る（Data API が使うのはこの4つ）。関数：EXECUTE。
with objs as (
  select 'table' as kind, c.oid, format('%I.%I', n.nspname, c.relname) as name, c.relacl as acl, c.relowner as owner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  union all
  select 'sequence', c.oid, format('%I.%I', n.nspname, c.relname), c.relacl, c.relowner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S'
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  union all
  select 'function', p.oid, format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), p.proacl, p.proowner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
), acl as (
  select o.kind, o.name, a.grantee, a.privilege_type
    from objs o, aclexplode(coalesce(o.acl, acldefault((case o.kind when 'function' then 'f' when 'sequence' then 's' else 'r' end)::"char", o.owner))) a
)
select kind, name, case when grantee = 0 then 'PUBLIC' else grantee::regrole::text end as grantee, privilege_type
  from acl
 where (grantee = 0 or grantee::regrole::text in ('anon', 'authenticated', 'service_role'))
   and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE', 'USAGE')
union all
-- 列ごとの権限（profiles の display_name・ui_lang の UPDATE など）
select 'column', format('%I.%I(%I)', n.nspname, c.relname, at.attname),
       case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
  from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace n on n.oid = c.relnamespace,
       aclexplode(at.attacl) a
 where n.nspname = 'public' and at.attacl is not null
   and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))
order by 1, 2, 3, 4;
