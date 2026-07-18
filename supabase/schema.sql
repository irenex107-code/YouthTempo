create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text check (role in ('学生', '家长', '老师', '学校合作方')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sweet_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  records jsonb not null,
  summary text,
  small_step text,
  recommended_next_tool text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  grantee_email text not null,
  permission_type text not null check (permission_type in ('guardian_view', 'school_support', 'research_feedback')),
  status text not null default 'active' check (status in ('pending', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.wechat_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  openid text not null unique,
  unionid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wechat_bind_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scene text not null unique,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'expired')),
  openid text,
  unionid text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.sweet_records enable row level security;
alter table public.user_permissions enable row level security;
alter table public.wechat_identities enable row level security;
alter table public.wechat_bind_sessions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "sweet_records_select_own" on public.sweet_records;
create policy "sweet_records_select_own"
on public.sweet_records for select
using (auth.uid() = user_id);

drop policy if exists "sweet_records_select_authorized_grantee" on public.sweet_records;
create policy "sweet_records_select_authorized_grantee"
on public.sweet_records for select
using (
  exists (
    select 1
    from public.user_permissions permission
    where permission.owner_user_id = sweet_records.user_id
      and lower(permission.grantee_email) = lower(auth.jwt() ->> 'email')
      and permission.status = 'active'
      and permission.permission_type in ('guardian_view', 'school_support')
  )
);

drop policy if exists "sweet_records_insert_own" on public.sweet_records;
create policy "sweet_records_insert_own"
on public.sweet_records for insert
with check (auth.uid() = user_id);

drop policy if exists "sweet_records_delete_own" on public.sweet_records;
create policy "sweet_records_delete_own"
on public.sweet_records for delete
using (auth.uid() = user_id);

drop policy if exists "permissions_select_own" on public.user_permissions;
create policy "permissions_select_own"
on public.user_permissions for select
using (auth.uid() = owner_user_id);

drop policy if exists "permissions_select_grantee" on public.user_permissions;
create policy "permissions_select_grantee"
on public.user_permissions for select
using (lower(grantee_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "permissions_insert_own" on public.user_permissions;
create policy "permissions_insert_own"
on public.user_permissions for insert
with check (auth.uid() = owner_user_id);

drop policy if exists "permissions_update_own" on public.user_permissions;
create policy "permissions_update_own"
on public.user_permissions for update
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

drop policy if exists "wechat_identities_select_own" on public.wechat_identities;
create policy "wechat_identities_select_own"
on public.wechat_identities for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "wechat_bind_sessions_select_own" on public.wechat_bind_sessions;
create policy "wechat_bind_sessions_select_own"
on public.wechat_bind_sessions for select
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists sweet_records_user_created_idx
on public.sweet_records(user_id, created_at desc);

create index if not exists user_permissions_owner_created_idx
on public.user_permissions(owner_user_id, created_at desc);

create index if not exists user_permissions_grantee_status_idx
on public.user_permissions(lower(grantee_email), status);

create index if not exists wechat_identities_user_created_idx
on public.wechat_identities(user_id, created_at desc);

create index if not exists wechat_bind_sessions_user_created_idx
on public.wechat_bind_sessions(user_id, created_at desc);
