-- ============================================================================
-- ローカル検証用：Supabase の土台を素の PostgreSQL 上に再現する
--
-- 本番の Supabase では用意済みのものを、最小限だけ作る。
--   - ロール     anon / authenticated / service_role（BYPASSRLS）
--   - auth       users テーブル、auth.uid()、auth.role()
--   - storage    buckets / objects、storage.foldername()
--   - extensions pgcrypto は Supabase と同じく extensions スキーマに入れる
--   - public     Supabase と同じ既定権限（新しいテーブルを3ロールへ GRANT）
--
-- 本番には流さないこと。supabase/tests/run.sh からのみ使う。
-- ============================================================================

create role anon         nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

-- マイグレーションを流すロール。Supabase の SQL Editor の「postgres」相当。
-- スーパーユーザーではないので、権限不足のエラーはここで再現できる。
create role app_owner login createrole bypassrls;
grant anon, authenticated, service_role to app_owner;

create schema extensions;
create extension pgcrypto schema extensions;
grant usage on schema extensions to anon, authenticated, service_role, app_owner;

-- ---------------------------------------------------------------- auth
create schema auth;
grant usage on schema auth to anon, authenticated, service_role, app_owner;

create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  raw_app_meta_data   jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
-- Supabase の postgres ロールは auth.users に対して全権限を持つ（トリガー作成も可）
grant all on auth.users to app_owner;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'role', '')
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role, app_owner;

-- ---------------------------------------------------------------- storage
create schema storage;
grant usage on schema storage to anon, authenticated, service_role, app_owner;

create table storage.buckets (
  id                 text primary key,
  name               text not null unique,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now()
);
create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;

create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end
$$;

grant all on storage.buckets, storage.objects to app_owner, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant execute on function storage.foldername(text) to anon, authenticated, service_role, app_owner;
-- Supabase の SQL Editor から storage.objects にポリシーを作れるようにする
alter table storage.objects owner to app_owner;

-- ---------------------------------------------------------------- public
alter schema public owner to app_owner;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role app_owner in schema public
  grant all on tables    to anon, authenticated, service_role;
alter default privileges for role app_owner in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role app_owner in schema public
  grant all on functions to anon, authenticated, service_role;

-- マイグレーション中の CREATE EXTENSION を成功させる（既存なので no-op になる）
alter role app_owner set search_path = public, extensions;
