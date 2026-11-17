create extension if not exists "pgcrypto";
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text default '学生',
  school_id uuid references public.schools(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'profiles'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%role%'
  loop
    execute format('alter table public.profiles drop constraint if exists %I', constraint_name);
  end loop;
end $$;

alter table public.profiles alter column role set default '学生';
alter table public.profiles add column if not exists school_id uuid references public.schools(id) on delete set null;

update public.profiles
set role = case
  when role in ('家长', '支持者') then '家长'
  when role in ('老师', '学校合作方', '学校支持人员') then '学校支持人员'
  else '学生'
end;

alter table public.profiles
add constraint profiles_role_check check (role in ('学生', '家长', '学校支持人员', '专业支持者'));

create table if not exists public.sweet_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  records jsonb not null,
  summary text,
  small_step text,
  recommended_next_tool text,
  created_at timestamptz not null default now()
);

alter table public.sweet_records add column if not exists school_id uuid references public.schools(id) on delete set null;

create table if not exists public.school_members (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  member_role text not null default 'school_support' check (member_role in ('school_support', 'school_admin')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (school_id, user_id)
);

create table if not exists public.teacher_student_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_user_id uuid not null references auth.users(id) on delete cascade,
  student_user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (school_id, teacher_user_id, student_user_id)
);

create table if not exists public.guardian_student_links (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  guardian_user_id uuid not null references auth.users(id) on delete cascade,
  student_user_id uuid not null references auth.users(id) on delete cascade,
  confirmed_by uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (school_id, guardian_user_id, student_user_id),
  check (guardian_user_id <> student_user_id)
);

create table if not exists public.student_consents (
  student_user_id uuid primary key references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  age_band text not null check (age_band in ('under_14', '14_17', '18_plus')),
  consent_basis text not null default 'student_guardian' check (consent_basis in ('not_applicable', 'adult_self', 'student_self_pilot', 'student_guardian')),
  policy_version text not null,
  status text not null check (status in ('pending_guardian', 'active', 'withdrawn', 'ineligible')),
  student_assented_at timestamptz,
  guardian_user_id uuid references auth.users(id) on delete set null,
  guardian_consented_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (guardian_user_id is null or guardian_user_id <> student_user_id),
  check (
    (
      status = 'active'
      and student_assented_at is not null
      and (
        (age_band = '18_plus' and consent_basis = 'adult_self')
        or (age_band = '14_17' and consent_basis = 'student_self_pilot')
        or (
          age_band = '14_17'
          and consent_basis = 'student_guardian'
          and guardian_user_id is not null
          and guardian_consented_at is not null
        )
      )
    )
    or status <> 'active'
  )
);

create table if not exists public.student_consent_events (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  guardian_user_id uuid references auth.users(id) on delete set null,
  actor_user_id uuid not null,
  event_type text not null check (event_type in ('student_assented', 'guardian_consented', 'consent_withdrawn', 'declared_under_14')),
  age_band text not null check (age_band in ('under_14', '14_17', '18_plus')),
  consent_basis text not null default 'student_guardian' check (consent_basis in ('not_applicable', 'adult_self', 'student_self_pilot', 'student_guardian')),
  policy_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.school_invites (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  email text not null,
  display_name text,
  assignment_role text not null check (assignment_role in ('student', 'support_teacher', 'school_lead')),
  status text not null default 'active' check (status in ('active', 'applied', 'revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  applied_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  revoked_at timestamptz
);

alter table public.school_invites add column if not exists display_name text;

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

create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null default '管理员' check (role in ('管理员')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.school_followups (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  record_id uuid not null unique references public.sweet_records(id) on delete cascade,
  student_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  note text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.student_messages (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete set null,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('teacher', 'guardian', 'self', 'pilot_duty')),
  recipient_user_id uuid references auth.users(id) on delete cascade,
  anonymous_to_recipient boolean not null default false,
  body text not null check (char_length(body) between 1 and 1000),
  moderation_status text not null default 'sent' check (moderation_status in ('sent', 'blocked', 'safety_review')),
  moderation_reason text,
  read_at timestamptz,
  duty_status text not null default 'not_applicable' check (duty_status in ('not_applicable', 'new', 'in_progress', 'resolved')),
  duty_updated_at timestamptz,
  duty_updated_by uuid references auth.users(id) on delete set null,
  alert_delivery_status text not null default 'not_requested' check (alert_delivery_status in ('not_requested', 'pending', 'sent', 'failed', 'not_configured')),
  alert_last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (recipient_type = 'self' and recipient_user_id = sender_user_id and anonymous_to_recipient = false)
    or (recipient_type in ('teacher', 'guardian') and recipient_user_id is not null)
    or (recipient_type = 'pilot_duty' and recipient_user_id is null and anonymous_to_recipient = false)
  )
);

create table if not exists public.student_message_duty_actions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.student_messages(id) on delete cascade,
  previous_status text not null check (previous_status in ('new', 'in_progress', 'resolved')),
  new_status text not null check (new_status in ('new', 'in_progress', 'resolved')),
  note text not null check (char_length(note) between 1 and 500),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists student_messages_sender_created_idx
on public.student_messages (sender_user_id, created_at desc);

create index if not exists student_messages_recipient_created_idx
on public.student_messages (recipient_user_id, created_at desc);

create index if not exists student_messages_school_created_idx
on public.student_messages (school_id, created_at desc);

create index if not exists student_messages_duty_queue_idx
on public.student_messages (duty_status, created_at desc)
where duty_status <> 'not_applicable';

create index if not exists student_messages_duty_updated_by_idx
on public.student_messages (duty_updated_by);

create index if not exists student_message_duty_actions_message_created_idx
on public.student_message_duty_actions (message_id, created_at desc);

create index if not exists student_message_duty_actions_actor_user_idx
on public.student_message_duty_actions (actor_user_id);

insert into public.admin_roles (email, role, status)
values
  ('irenexiao107@outlook.com', '管理员', 'active'),
  ('irenex107@gmail.com', '管理员', 'active')
on conflict (email) do nothing;

update public.sweet_records record
set school_id = profile.school_id
from public.profiles profile
where record.user_id = profile.id
  and record.school_id is null
  and profile.school_id is not null;

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.sweet_records enable row level security;
alter table public.school_members enable row level security;
alter table public.teacher_student_assignments enable row level security;
alter table public.guardian_student_links enable row level security;
alter table public.student_consents enable row level security;
alter table public.student_consent_events enable row level security;
alter table public.school_invites enable row level security;
alter table public.user_permissions enable row level security;
alter table public.wechat_identities enable row level security;
alter table public.wechat_bind_sessions enable row level security;
alter table public.admin_roles enable row level security;
alter table public.school_followups enable row level security;
alter table public.student_messages enable row level security;
alter table public.student_message_duty_actions enable row level security;

-- Users may maintain their own public profile fields, but school assignment is
-- controlled exclusively by trusted server routes using the service role.
revoke insert, update on table public.profiles from anon, authenticated;
grant insert (id, email, display_name, school_id, updated_at) on table public.profiles to authenticated;
grant update (email, display_name, school_id, updated_at) on table public.profiles to authenticated;

create or replace function public.enforce_profile_school_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' and new.school_id is not null then
    raise exception 'profile_school_assignment_server_only' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.school_id is distinct from old.school_id then
    raise exception 'profile_school_assignment_server_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_profile_school_assignment() from public, anon, authenticated;
drop trigger if exists enforce_profile_school_assignment on public.profiles;
create trigger enforce_profile_school_assignment
before insert or update of school_id on public.profiles
for each row execute function public.enforce_profile_school_assignment();

create or replace function public.enforce_profile_role_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' and new.role is distinct from '学生' then
    raise exception 'profile_role_assignment_server_only' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    raise exception 'profile_role_assignment_server_only' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_profile_role_assignment() from public, anon, authenticated;
drop trigger if exists enforce_profile_role_assignment on public.profiles;
create trigger enforce_profile_role_assignment
before insert or update of role on public.profiles
for each row execute function public.enforce_profile_role_assignment();

-- Follow-up notes contain school support context and are only accessed by
-- authenticated server routes using the service role.
revoke all privileges on table public.school_followups from anon, authenticated;
revoke all privileges on table public.student_messages from anon, authenticated;
revoke all privileges on table public.student_message_duty_actions from anon, authenticated;

create or replace function public.apply_student_message_duty_action(
  p_message_id uuid,
  p_new_status text,
  p_note text,
  p_actor_user_id uuid
)
returns table (
  message_id uuid,
  duty_status text,
  duty_updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous_status text;
  v_updated_at timestamptz := now();
begin
  if p_new_status not in ('new', 'in_progress', 'resolved') then
    raise exception 'invalid_duty_status' using errcode = '22023';
  end if;
  if nullif(btrim(p_note), '') is null or char_length(btrim(p_note)) > 500 then
    raise exception 'invalid_duty_note' using errcode = '22023';
  end if;

  select message.duty_status
  into v_previous_status
  from public.student_messages message
  where message.id = p_message_id
    and message.duty_status <> 'not_applicable'
  for update;

  if v_previous_status is null then
    raise exception 'duty_message_not_found' using errcode = 'P0002';
  end if;

  update public.student_messages message
  set duty_status = p_new_status,
      duty_updated_at = v_updated_at,
      duty_updated_by = p_actor_user_id,
      read_at = case
        when p_new_status in ('in_progress', 'resolved') then coalesce(message.read_at, v_updated_at)
        else message.read_at
      end
  where message.id = p_message_id;

  insert into public.student_message_duty_actions (
    message_id,
    previous_status,
    new_status,
    note,
    actor_user_id
  ) values (
    p_message_id,
    v_previous_status,
    p_new_status,
    btrim(p_note),
    p_actor_user_id
  );

  return query select p_message_id, p_new_status, v_updated_at;
end;
$$;

revoke all on function public.apply_student_message_duty_action(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_student_message_duty_action(uuid, text, text, uuid) to service_role;

drop policy if exists "schools_select_member" on public.schools;
create policy "schools_select_member"
on public.schools for select
to authenticated
using (
  exists (
    select 1 from public.school_members member
    where member.school_id = schools.id
      and member.user_id = (select auth.uid())
      and member.status = 'active'
  )
  or exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.school_id = schools.id
  )
);

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "sweet_records_select_own" on public.sweet_records;
create policy "sweet_records_select_own"
on public.sweet_records for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "sweet_records_select_authorized_grantee" on public.sweet_records;
drop policy if exists "sweet_records_select_guardian" on public.sweet_records;

alter table public.guardian_student_links
  drop constraint if exists pilot_guardian_links_inactive;
alter table public.guardian_student_links
  add constraint pilot_guardian_links_inactive check (status <> 'active') not valid;

drop policy if exists "sweet_records_select_school_members" on public.sweet_records;
drop policy if exists "sweet_records_insert_own" on public.sweet_records;
create policy "sweet_records_insert_own"
on public.sweet_records for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and (
    school_id is null
    or school_id = (
      select profile.school_id
      from public.profiles profile
      where profile.id = (select auth.uid())
    )
  )
);

drop policy if exists "sweet_records_delete_own" on public.sweet_records;
create policy "sweet_records_delete_own"
on public.sweet_records for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "school_members_select_own_school" on public.school_members;
create policy "school_members_select_own_school"
on public.school_members for select
to authenticated
using (
  user_id = (select auth.uid())
);

drop policy if exists "teacher_assignments_select_own" on public.teacher_student_assignments;
create policy "teacher_assignments_select_own"
on public.teacher_student_assignments for select
to authenticated
using (teacher_user_id = (select auth.uid()));

drop policy if exists "guardian_links_select_related" on public.guardian_student_links;
create policy "guardian_links_select_student_own"
on public.guardian_student_links for select
to authenticated
using (student_user_id = (select auth.uid()));

revoke insert, update, delete on table public.guardian_student_links from anon, authenticated;
revoke all on table public.guardian_student_links from anon;
grant select on table public.guardian_student_links to authenticated;

revoke all privileges on table public.student_consents from anon, authenticated;
revoke all privileges on table public.student_consent_events from anon, authenticated;

create index if not exists student_consents_guardian_status_idx
on public.student_consents(guardian_user_id, status);

create index if not exists student_consent_events_student_created_idx
on public.student_consent_events(student_user_id, created_at desc);

create index if not exists student_consents_school_idx
on public.student_consents(school_id);

create index if not exists student_consents_withdrawn_by_idx
on public.student_consents(withdrawn_by)
where withdrawn_by is not null;

create index if not exists student_consent_events_guardian_created_idx
on public.student_consent_events(guardian_user_id, created_at desc)
where guardian_user_id is not null;

create index if not exists student_consent_events_school_created_idx
on public.student_consent_events(school_id, created_at desc)
where school_id is not null;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.enforce_student_consent_for_sweet_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_role text;
begin
  if session_user in ('postgres', 'service_role', 'supabase_admin')
     or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' then
    return new;
  end if;

  select profile.role
  into profile_role
  from public.profiles profile
  where profile.id = new.user_id;

  if profile_role is null or profile_role = '学生' then
    if not exists (
      select 1
      from public.student_consents consent
      where consent.student_user_id = new.user_id
        and consent.policy_version = '2026-08-28'
        and consent.status = 'active'
        and consent.student_assented_at is not null
        and (
          (consent.age_band = '18_plus' and consent.consent_basis = 'adult_self')
          or (consent.age_band = '14_17' and consent.consent_basis = 'student_self_pilot')
          or (
            consent.age_band = '14_17'
            and consent.consent_basis = 'student_guardian'
            and consent.guardian_user_id is not null
            and consent.guardian_consented_at is not null
          )
        )
    ) then
      raise exception 'student_consent_required' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_student_consent_for_sweet_record() from public, anon, authenticated;

drop trigger if exists enforce_student_consent_for_sweet_record on public.sweet_records;
create trigger enforce_student_consent_for_sweet_record
before insert on public.sweet_records
for each row execute function private.enforce_student_consent_for_sweet_record();

drop policy if exists "school_invites_select_relevant" on public.school_invites;
create policy "school_invites_select_relevant"
on public.school_invites for select
to authenticated
using (
  lower(email) = lower(auth.jwt() ->> 'email')
  or exists (
    select 1 from public.school_members member
    where member.school_id = school_invites.school_id
      and member.user_id = (select auth.uid())
      and member.status = 'active'
      and member.member_role = 'school_admin'
  )
  or exists (
    select 1 from public.admin_roles admin
    where lower(admin.email) = lower(auth.jwt() ->> 'email')
      and admin.status = 'active'
  )
);

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

drop policy if exists "admin_roles_select_own" on public.admin_roles;
create policy "admin_roles_select_own"
on public.admin_roles for select
to authenticated
using (lower(email) = lower(auth.jwt() ->> 'email'));

create index if not exists profiles_school_idx
on public.profiles(school_id);

create index if not exists sweet_records_user_created_idx
on public.sweet_records(user_id, created_at desc);

create index if not exists sweet_records_school_created_idx
on public.sweet_records(school_id, created_at desc);

create index if not exists school_members_user_status_idx
on public.school_members(user_id, status);

create index if not exists school_members_school_status_idx
on public.school_members(school_id, status);

create index if not exists teacher_assignments_teacher_status_idx
on public.teacher_student_assignments(teacher_user_id, status);

create index if not exists teacher_assignments_student_status_idx
on public.teacher_student_assignments(student_user_id, status);

create index if not exists teacher_assignments_school_status_idx
on public.teacher_student_assignments(school_id, status);

create index if not exists teacher_assignments_assigned_by_idx
on public.teacher_student_assignments(assigned_by);

create index if not exists guardian_links_guardian_status_idx
on public.guardian_student_links(guardian_user_id, status);

create index if not exists guardian_links_student_status_idx
on public.guardian_student_links(student_user_id, status);

create index if not exists guardian_links_school_status_idx
on public.guardian_student_links(school_id, status);

create index if not exists guardian_links_confirmed_by_idx
on public.guardian_student_links(confirmed_by)
where confirmed_by is not null;

create unique index if not exists school_invites_active_email_school_role_idx
on public.school_invites (lower(email), school_id, assignment_role)
where status = 'active';

create index if not exists school_invites_email_status_idx
on public.school_invites(lower(email), status);

create index if not exists school_invites_school_status_idx
on public.school_invites(school_id, status);

create index if not exists school_invites_applied_user_idx
on public.school_invites(applied_user_id)
where applied_user_id is not null;

create index if not exists school_invites_invited_by_idx
on public.school_invites(invited_by)
where invited_by is not null;

create index if not exists user_permissions_owner_created_idx
on public.user_permissions(owner_user_id, created_at desc);

create index if not exists user_permissions_grantee_status_idx
on public.user_permissions(lower(grantee_email), status);

create index if not exists wechat_identities_user_created_idx
on public.wechat_identities(user_id, created_at desc);

create index if not exists wechat_bind_sessions_user_created_idx
on public.wechat_bind_sessions(user_id, created_at desc);

create index if not exists admin_roles_email_status_idx
on public.admin_roles(lower(email), status);

create index if not exists school_followups_school_status_updated_idx
on public.school_followups(school_id, status, updated_at desc);

create index if not exists school_followups_student_updated_idx
on public.school_followups(student_user_id, updated_at desc);

create index if not exists school_followups_updated_by_idx
on public.school_followups(updated_by);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references auth.users(id) on delete cascade,
  author_role text not null check (author_role in ('student', 'guardian', 'teacher', 'professional')),
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 3000),
  viewer_roles text[] not null,
  commenter_roles text[] not null,
  moderation_status text not null default 'published' check (moderation_status in ('published', 'safety_review', 'removed')),
  moderation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_posts_viewer_roles_valid check (
    cardinality(viewer_roles) > 0
    and viewer_roles <@ array['student', 'guardian', 'teacher', 'professional']
  ),
  constraint community_posts_commenter_roles_valid check (
    commenter_roles <@ viewer_roles
    and commenter_roles <@ array['student', 'guardian', 'teacher', 'professional']
  )
);

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  author_role text not null check (author_role in ('student', 'guardian', 'teacher', 'professional')),
  body text not null check (char_length(body) between 1 and 1200),
  moderation_status text not null default 'published' check (moderation_status in ('published', 'safety_review', 'removed')),
  moderation_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid references public.community_posts(id) on delete cascade,
  comment_id uuid references public.community_comments(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 500),
  category text not null default 'other',
  priority text not null default 'standard',
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved')),
  created_at timestamptz not null default now(),
  target_review_at timestamptz not null default (now() + interval '72 hours'),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  constraint community_reports_single_target check ((post_id is not null) <> (comment_id is not null))
);

alter table public.community_reports add column if not exists resolved_at timestamptz;
alter table public.community_reports add column if not exists resolved_by uuid references auth.users(id) on delete set null;
alter table public.community_reports add column if not exists category text default 'other';
alter table public.community_reports add column if not exists priority text default 'standard';
alter table public.community_reports add column if not exists target_review_at timestamptz default (now() + interval '72 hours');
alter table public.community_reports drop constraint if exists community_reports_category_check;
alter table public.community_reports add constraint community_reports_category_check check (
  category in ('immediate_danger', 'sexual_harm', 'bullying_threat', 'privacy_exposure', 'harmful_content', 'fraud_spam', 'other')
);
alter table public.community_reports drop constraint if exists community_reports_priority_check;
alter table public.community_reports add constraint community_reports_priority_check check (priority in ('urgent', 'high', 'standard'));
alter table public.community_reports alter column category set not null;
alter table public.community_reports alter column priority set not null;
alter table public.community_reports alter column target_review_at set not null;

create or replace function public.assign_community_report_service_level()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.priority := case
    when new.category in ('immediate_danger', 'sexual_harm') then 'urgent'
    when new.category in ('bullying_threat', 'privacy_exposure', 'harmful_content') then 'high'
    else 'standard'
  end;
  new.target_review_at := coalesce(new.created_at, now()) + case new.priority
    when 'urgent' then interval '2 hours'
    when 'high' then interval '24 hours'
    else interval '72 hours'
  end;
  return new;
end;
$$;
revoke all on function public.assign_community_report_service_level() from public, anon, authenticated;
drop trigger if exists assign_community_report_service_level on public.community_reports;
create trigger assign_community_report_service_level
before insert or update of category, created_at on public.community_reports
for each row execute function public.assign_community_report_service_level();

create table if not exists public.community_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('post', 'comment')),
  content_id uuid not null,
  action text not null check (action in ('publish', 'remove')),
  previous_status text not null check (previous_status in ('published', 'safety_review', 'removed')),
  new_status text not null check (new_status in ('published', 'removed')),
  note text not null check (char_length(note) between 1 and 500),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.community_blocks (
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint community_blocks_not_self check (blocker_user_id <> blocked_user_id)
);

create table if not exists public.community_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  restriction_type text not null default 'mute' check (restriction_type = 'mute'),
  reason text not null check (char_length(reason) between 1 and 500),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_moderation_actions enable row level security;
alter table public.community_blocks enable row level security;
alter table public.community_restrictions enable row level security;

revoke all on table public.community_posts from anon, authenticated;
revoke all on table public.community_comments from anon, authenticated;
revoke all on table public.community_reports from anon, authenticated;
revoke all on table public.community_moderation_actions from anon, authenticated;
revoke all on table public.community_blocks from anon, authenticated;
revoke all on table public.community_restrictions from anon, authenticated;
grant all on table public.community_posts to service_role;
grant all on table public.community_comments to service_role;
grant all on table public.community_reports to service_role;
grant all on table public.community_moderation_actions to service_role;
grant all on table public.community_blocks to service_role;
grant all on table public.community_restrictions to service_role;

create policy community_posts_server_only on public.community_posts
for all to authenticated using (false) with check (false);
create policy community_comments_server_only on public.community_comments
for all to authenticated using (false) with check (false);
create policy community_reports_server_only on public.community_reports
for all to authenticated using (false) with check (false);
create policy community_moderation_actions_server_only on public.community_moderation_actions
for all to authenticated using (false) with check (false);
create policy community_blocks_server_only on public.community_blocks
for all to authenticated using (false) with check (false);
create policy community_restrictions_server_only on public.community_restrictions
for all to authenticated using (false) with check (false);

create index if not exists community_posts_published_created_idx
on public.community_posts(moderation_status, created_at desc);
create index if not exists community_posts_author_idx
on public.community_posts(author_user_id, created_at desc);
create index if not exists community_posts_viewer_roles_idx
on public.community_posts using gin(viewer_roles);
create index if not exists community_comments_post_created_idx
on public.community_comments(post_id, moderation_status, created_at);
create index if not exists community_comments_author_idx
on public.community_comments(author_user_id);
create index if not exists community_reports_status_created_idx
on public.community_reports(status, created_at desc);
create index if not exists community_reports_reporter_idx
on public.community_reports(reporter_user_id);
create index if not exists community_reports_post_idx
on public.community_reports(post_id) where post_id is not null;
create index if not exists community_reports_comment_idx
on public.community_reports(comment_id) where comment_id is not null;
create index if not exists community_reports_resolved_by_idx
on public.community_reports(resolved_by);
create index if not exists community_reports_open_deadline_idx
on public.community_reports(priority, target_review_at)
where status in ('new', 'reviewing');
create unique index if not exists community_reports_open_post_once_idx
on public.community_reports(reporter_user_id, post_id)
where post_id is not null and status in ('new', 'reviewing');
create unique index if not exists community_reports_open_comment_once_idx
on public.community_reports(reporter_user_id, comment_id)
where comment_id is not null and status in ('new', 'reviewing');
create index if not exists community_moderation_actions_created_idx
on public.community_moderation_actions(created_at desc);
create index if not exists community_moderation_actions_target_idx
on public.community_moderation_actions(content_type, content_id, created_at desc);
create index if not exists community_moderation_actions_actor_idx
on public.community_moderation_actions(actor_user_id, created_at desc);
create index if not exists community_blocks_blocked_idx
on public.community_blocks(blocked_user_id, blocker_user_id);
create index if not exists community_restrictions_active_user_idx
on public.community_restrictions(user_id, ends_at)
where status = 'active';
create unique index if not exists community_restrictions_one_active_idx
on public.community_restrictions(user_id, restriction_type)
where status = 'active';
create index if not exists community_restrictions_created_by_idx
on public.community_restrictions(created_by, created_at desc);
create index if not exists community_restrictions_revoked_by_idx
on public.community_restrictions(revoked_by);

create or replace function public.apply_community_restriction(
  p_user_id uuid,
  p_action text,
  p_duration_minutes integer,
  p_reason text,
  p_actor_user_id uuid
)
returns table(restriction_id uuid, status text, ends_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_restriction_id uuid;
  v_ends_at timestamptz;
begin
  if p_action not in ('mute', 'unmute') then raise exception 'invalid_action'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 or char_length(btrim(p_reason)) > 500 then
    raise exception 'invalid_reason';
  end if;
  if p_action = 'mute' and p_duration_minutes is not null and p_duration_minutes not in (1440, 10080, 43200) then
    raise exception 'invalid_duration';
  end if;

  update public.community_restrictions as restriction
  set status = 'revoked', revoked_at = now(), revoked_by = p_actor_user_id,
      revoked_reason = case
        when restriction.ends_at is not null and restriction.ends_at <= now() then '限制已到期'
        when p_action = 'unmute' then btrim(p_reason)
        else '由新的限制替代'
      end
  where restriction.user_id = p_user_id
    and restriction.restriction_type = 'mute'
    and restriction.status = 'active';

  if p_action = 'unmute' then
    return query select null::uuid, 'revoked'::text, null::timestamptz;
    return;
  end if;

  v_ends_at := case
    when p_duration_minutes is null then null
    else now() + make_interval(mins => p_duration_minutes)
  end;

  insert into public.community_restrictions (
    user_id, restriction_type, reason, starts_at, ends_at, status, created_by
  ) values (
    p_user_id, 'mute', btrim(p_reason), now(), v_ends_at, 'active', p_actor_user_id
  ) returning id into v_restriction_id;

  return query select v_restriction_id, 'active'::text, v_ends_at;
end;
$$;

revoke all on function public.apply_community_restriction(uuid, text, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_community_restriction(uuid, text, integer, text, uuid) to service_role;

create or replace function public.apply_community_moderation(
  p_content_type text,
  p_content_id uuid,
  p_action text,
  p_note text,
  p_actor_user_id uuid
)
returns table(action_id uuid, previous_status text, new_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_status text;
  v_new_status text;
  v_action_id uuid;
begin
  if p_content_type not in ('post', 'comment') then
    raise exception 'invalid_content_type';
  end if;
  if p_action not in ('publish', 'remove') then
    raise exception 'invalid_action';
  end if;
  if p_note is null or char_length(btrim(p_note)) < 1 or char_length(btrim(p_note)) > 500 then
    raise exception 'invalid_note';
  end if;

  v_new_status := case when p_action = 'publish' then 'published' else 'removed' end;

  if p_content_type = 'post' then
    select moderation_status into v_previous_status
    from public.community_posts
    where id = p_content_id
    for update;

    if not found then raise exception 'content_not_found'; end if;

    update public.community_posts
    set moderation_status = v_new_status,
        moderation_reason = btrim(p_note),
        updated_at = now()
    where id = p_content_id;

    update public.community_reports
    set status = 'resolved', resolved_at = now(), resolved_by = p_actor_user_id
    where post_id = p_content_id and status in ('new', 'reviewing');
  else
    select moderation_status into v_previous_status
    from public.community_comments
    where id = p_content_id
    for update;

    if not found then raise exception 'content_not_found'; end if;

    update public.community_comments
    set moderation_status = v_new_status,
        moderation_reason = btrim(p_note)
    where id = p_content_id;

    update public.community_reports
    set status = 'resolved', resolved_at = now(), resolved_by = p_actor_user_id
    where comment_id = p_content_id and status in ('new', 'reviewing');
  end if;

  insert into public.community_moderation_actions (
    content_type, content_id, action, previous_status, new_status, note, actor_user_id
  ) values (
    p_content_type, p_content_id, p_action, v_previous_status, v_new_status, btrim(p_note), p_actor_user_id
  ) returning id into v_action_id;

  return query select v_action_id, v_previous_status, v_new_status;
end;
$$;

revoke all on function public.apply_community_moderation(text, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_community_moderation(text, uuid, text, text, uuid) to service_role;

create table if not exists public.professional_verifications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  verified_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' constraint professional_verifications_status_check
    check (status in ('pending', 'needs_more_info', 'active', 'rejected', 'revoked')),
  institution_name text constraint professional_verifications_institution_name_length_check
    check (institution_name is null or char_length(btrim(institution_name)) between 2 and 120),
  position_title text constraint professional_verifications_position_title_length_check
    check (position_title is null or char_length(btrim(position_title)) between 2 and 80),
  credential_type text constraint professional_verifications_credential_type_length_check
    check (credential_type is null or char_length(btrim(credential_type)) between 2 and 80),
  credential_number text constraint professional_verifications_credential_number_length_check
    check (credential_number is null or char_length(btrim(credential_number)) between 2 and 120),
  credential_issuer text constraint professional_verifications_credential_issuer_length_check
    check (credential_issuer is null or char_length(btrim(credential_issuer)) between 2 and 120),
  credential_expires_on date,
  evidence_reference text constraint professional_verifications_evidence_reference_length_check
    check (evidence_reference is null or char_length(btrim(evidence_reference)) between 5 and 500),
  applicant_statement text constraint professional_verifications_applicant_statement_length_check
    check (applicant_statement is null or char_length(btrim(applicant_statement)) <= 1000),
  verification_basis text not null default 'document_review'
    constraint professional_verifications_basis_check
    check (verification_basis in ('document_review', 'legacy_platform_confirmation')),
  credential_verified boolean not null default false,
  institution_verified boolean not null default false,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  review_note text constraint professional_verifications_review_note_length_check
    check (review_note is null or char_length(btrim(review_note)) between 2 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint professional_verifications_expiry_check
    check (credential_expires_on is null or credential_expires_on >= submitted_at::date),
  constraint professional_verifications_active_review_check
    check (
      status <> 'active'
      or (
        reviewed_at is not null
        and (
          verification_basis = 'legacy_platform_confirmation'
          or (
            verified_by is not null
            and credential_verified
            and position_title is not null
            and credential_type is not null
            and credential_number is not null
            and credential_issuer is not null
            and evidence_reference is not null
          )
        )
      )
    )
);

alter table public.professional_verifications enable row level security;
revoke all on table public.professional_verifications from anon, authenticated;
grant all on table public.professional_verifications to service_role;
create policy professional_verifications_server_only on public.professional_verifications
for all to authenticated using (false) with check (false);
create index if not exists professional_verifications_verified_by_idx
on public.professional_verifications(verified_by) where verified_by is not null;
create index if not exists professional_verifications_status_submitted_idx
on public.professional_verifications(status, submitted_at desc);
create index if not exists professional_verifications_active_expiry_idx
on public.professional_verifications(status, credential_expires_on)
where status = 'active';

create table if not exists public.professional_verification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (
    action in ('submitted', 'resubmitted', 'approved', 'changes_requested', 'rejected', 'revoked', 'expired', 'legacy_imported')
  ),
  previous_status text check (
    previous_status is null
    or previous_status in ('pending', 'needs_more_info', 'active', 'rejected', 'revoked')
  ),
  new_status text not null check (
    new_status in ('pending', 'needs_more_info', 'active', 'rejected', 'revoked')
  ),
  note text check (note is null or char_length(btrim(note)) between 2 and 1000),
  created_at timestamptz not null default now()
);

alter table public.professional_verification_events enable row level security;
revoke all on table public.professional_verification_events from anon, authenticated;
grant all on table public.professional_verification_events to service_role;
create policy professional_verification_events_server_only
on public.professional_verification_events
for all to authenticated using (false) with check (false);
create index if not exists professional_verification_events_user_created_idx
on public.professional_verification_events(user_id, created_at desc);
create index if not exists professional_verification_events_actor_created_idx
on public.professional_verification_events(actor_user_id, created_at desc)
where actor_user_id is not null;

create table if not exists public.api_rate_limits (
  identifier_hash text not null check (identifier_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (char_length(action) between 1 and 50),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (identifier_hash, action, window_started_at)
);

alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from anon, authenticated;
grant all on table public.api_rate_limits to service_role;
create policy api_rate_limits_server_only on public.api_rate_limits
for all to authenticated using (false) with check (false);
create index if not exists api_rate_limits_window_idx on public.api_rate_limits(window_started_at);

create table if not exists public.account_deletion_audits (
  id uuid primary key default gen_random_uuid(),
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  account_role text not null check (char_length(account_role) between 1 and 50),
  deletion_summary jsonb not null default '{}'::jsonb,
  status text not null default 'completed' check (status in ('completed', 'cleanup_required')),
  completed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 months')
);

alter table public.account_deletion_audits enable row level security;
revoke all on table public.account_deletion_audits from anon, authenticated;
grant all on table public.account_deletion_audits to service_role;
create policy account_deletion_audits_server_only on public.account_deletion_audits
for all to authenticated using (false) with check (false);
create index if not exists account_deletion_audits_expires_idx
on public.account_deletion_audits(expires_at);

create table if not exists public.school_exit_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  school_name text not null check (char_length(school_name) between 1 and 200),
  reason text not null check (char_length(reason) between 10 and 500),
  actor_user_id uuid references auth.users(id) on delete set null,
  affected_counts jsonb not null default '{}'::jsonb,
  policy_version text not null,
  completed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 months')
);

alter table public.school_exit_events enable row level security;
revoke all on table public.school_exit_events from anon, authenticated;
grant all on table public.school_exit_events to service_role;
create policy school_exit_events_server_only on public.school_exit_events
for all to authenticated using (false) with check (false);
create index if not exists school_exit_events_school_completed_idx
on public.school_exit_events(school_id, completed_at desc);
create index if not exists school_exit_events_expires_idx
on public.school_exit_events(expires_at);
create index if not exists school_exit_events_actor_idx
on public.school_exit_events(actor_user_id);

create or replace function public.exit_school_pilot(
  p_school_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_policy_version text
)
returns table(event_id uuid, affected_counts jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_school_name text;
  v_event_id uuid;
  v_counts jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 or char_length(btrim(p_reason)) > 500 then
    raise exception 'invalid_exit_reason';
  end if;
  if p_policy_version is null or char_length(btrim(p_policy_version)) < 1 then
    raise exception 'invalid_policy_version';
  end if;

  select lower(auth_user.email) into v_actor_email
  from auth.users auth_user
  where auth_user.id = p_actor_user_id;

  if v_actor_email is null or not exists (
    select 1 from public.admin_roles admin_role
    where lower(admin_role.email) = v_actor_email and admin_role.status = 'active'
  ) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  select school.name into v_school_name
  from public.schools school
  where school.id = p_school_id and school.status = 'active'
  for update;
  if not found then raise exception 'active_school_not_found'; end if;

  select jsonb_build_object(
    'members', (select count(*) from public.school_members where school_id = p_school_id),
    'teacherAssignments', (select count(*) from public.teacher_student_assignments where school_id = p_school_id),
    'guardianLinks', (select count(*) from public.guardian_student_links where school_id = p_school_id),
    'sweetRecordsDetached', (select count(*) from public.sweet_records where school_id = p_school_id),
    'messagesDetached', (select count(*) from public.student_messages where school_id = p_school_id),
    'consentsDetached', (select count(*) from public.student_consents where school_id = p_school_id),
    'consentEventsDetached', (select count(*) from public.student_consent_events where school_id = p_school_id),
    'followupsDeleted', (select count(*) from public.school_followups where school_id = p_school_id),
    'invitesDeleted', (select count(*) from public.school_invites where school_id = p_school_id)
  ) into v_counts;

  delete from public.school_followups where school_id = p_school_id;
  update public.sweet_records set school_id = null where school_id = p_school_id;
  update public.student_messages set school_id = null where school_id = p_school_id;
  update public.student_consents set school_id = null where school_id = p_school_id;
  update public.student_consent_events set school_id = null where school_id = p_school_id;

  update public.profiles profile
  set school_id = (
        select membership.school_id
        from public.school_members membership
        where membership.user_id = profile.id
          and membership.school_id <> p_school_id
          and membership.status = 'active'
        order by membership.created_at
        limit 1
      ),
      role = case
        when profile.role = '学校支持人员' and not exists (
          select 1 from public.school_members membership
          where membership.user_id = profile.id
            and membership.school_id <> p_school_id
            and membership.status = 'active'
        ) then '学生'
        else profile.role
      end,
      updated_at = now()
  where profile.school_id = p_school_id;

  delete from public.teacher_student_assignments where school_id = p_school_id;
  delete from public.guardian_student_links where school_id = p_school_id;
  delete from public.school_invites where school_id = p_school_id;
  delete from public.school_members where school_id = p_school_id;

  update public.schools
  set status = 'archived', updated_at = now()
  where id = p_school_id;

  insert into public.school_exit_events (
    school_id, school_name, reason, actor_user_id, affected_counts, policy_version
  ) values (
    p_school_id, v_school_name, btrim(p_reason), p_actor_user_id, v_counts, btrim(p_policy_version)
  ) returning id into v_event_id;

  return query select v_event_id, v_counts;
end;
$$;

revoke all on function public.exit_school_pilot(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.exit_school_pilot(uuid, uuid, text, text) to service_role;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'youthtempo-purge-expired-account-deletion-audits',
  '17 3 * * *',
  $$
    delete from public.account_deletion_audits where expires_at <= now();
    delete from public.school_exit_events where expires_at <= now();
  $$
);

create or replace function public.consume_api_rate_limit(
  p_identifier_hash text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  if p_identifier_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_identifier_hash'; end if;
  if p_action is null or char_length(p_action) < 1 or char_length(p_action) > 50 then raise exception 'invalid_action'; end if;
  if p_limit < 1 or p_limit > 1000 then raise exception 'invalid_limit'; end if;
  if p_window_seconds < 60 or p_window_seconds > 86400 then raise exception 'invalid_window'; end if;
  v_window_started_at := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  insert into public.api_rate_limits as rate_limit (
    identifier_hash, action, window_started_at, request_count, updated_at
  ) values (p_identifier_hash, p_action, v_window_started_at, 1, v_now)
  on conflict (identifier_hash, action, window_started_at)
  do update set request_count = rate_limit.request_count + 1, updated_at = excluded.updated_at
  returning request_count into v_request_count;
  delete from public.api_rate_limits
  where identifier_hash = p_identifier_hash and action = p_action
    and window_started_at < v_window_started_at - make_interval(secs => p_window_seconds * 6);
  if random() < 0.01 then
    delete from public.api_rate_limits where ctid in (
      select ctid from public.api_rate_limits
      where window_started_at < v_now - interval '2 days'
      order by window_started_at limit 500
    );
  end if;
  return query select v_request_count <= p_limit, greatest(p_limit - v_request_count, 0),
    v_window_started_at + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.consume_api_rate_limit(text, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer) to service_role;

create table if not exists public.pilot_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('student', 'guardian', 'teacher')),
  form_version text not null default '2026-08',
  overall_experience smallint not null check (overall_experience between 1 and 5),
  clarity smallint not null check (clarity between 1 and 5),
  safety smallint not null check (safety between 1 and 5),
  most_helpful text not null default '' check (char_length(most_helpful) <= 1000),
  hard_to_use text not null default '' check (char_length(hard_to_use) <= 1000),
  suggestion text not null default '' check (char_length(suggestion) <= 1000),
  may_contact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, form_version)
);

alter table public.pilot_feedback enable row level security;
revoke all on table public.pilot_feedback from anon, authenticated;
grant all on table public.pilot_feedback to service_role;
create policy pilot_feedback_server_only on public.pilot_feedback
for all to authenticated using (false) with check (false);
create index if not exists pilot_feedback_user_updated_idx
on public.pilot_feedback(user_id, updated_at desc);
create index if not exists pilot_feedback_role_version_updated_idx
on public.pilot_feedback(role, form_version, updated_at desc);

create or replace function public.submit_professional_verification(
  p_user_id uuid,
  p_institution_name text,
  p_position_title text,
  p_credential_type text,
  p_credential_number text,
  p_credential_issuer text,
  p_credential_expires_on date,
  p_evidence_reference text,
  p_applicant_statement text
)
returns table(status text, submitted_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous_status text;
  v_submitted_at timestamptz := now();
  v_action text;
begin
  select verification.status
  into v_previous_status
  from public.professional_verifications verification
  where verification.user_id = p_user_id
  for update;

  if v_previous_status = 'active' then
    raise exception 'professional_verification_already_active' using errcode = '23514';
  end if;

  if p_credential_expires_on is not null and p_credential_expires_on < current_date then
    raise exception 'professional_credential_expired' using errcode = '23514';
  end if;

  insert into public.professional_verifications (
    user_id,
    verified_by,
    status,
    institution_name,
    position_title,
    credential_type,
    credential_number,
    credential_issuer,
    credential_expires_on,
    evidence_reference,
    applicant_statement,
    verification_basis,
    credential_verified,
    institution_verified,
    submitted_at,
    reviewed_at,
    review_note,
    revoked_at,
    updated_at
  ) values (
    p_user_id,
    null,
    'pending',
    btrim(p_institution_name),
    btrim(p_position_title),
    btrim(p_credential_type),
    btrim(p_credential_number),
    btrim(p_credential_issuer),
    p_credential_expires_on,
    btrim(p_evidence_reference),
    nullif(btrim(p_applicant_statement), ''),
    'document_review',
    false,
    false,
    v_submitted_at,
    null,
    null,
    null,
    v_submitted_at
  )
  on conflict (user_id) do update
  set verified_by = null,
      status = 'pending',
      institution_name = excluded.institution_name,
      position_title = excluded.position_title,
      credential_type = excluded.credential_type,
      credential_number = excluded.credential_number,
      credential_issuer = excluded.credential_issuer,
      credential_expires_on = excluded.credential_expires_on,
      evidence_reference = excluded.evidence_reference,
      applicant_statement = excluded.applicant_statement,
      verification_basis = 'document_review',
      credential_verified = false,
      institution_verified = false,
      submitted_at = excluded.submitted_at,
      reviewed_at = null,
      review_note = null,
      revoked_at = null,
      updated_at = excluded.updated_at;

  v_action := case when v_previous_status is null then 'submitted' else 'resubmitted' end;

  insert into public.professional_verification_events (
    user_id,
    actor_user_id,
    action,
    previous_status,
    new_status
  ) values (
    p_user_id,
    p_user_id,
    v_action,
    v_previous_status,
    'pending'
  );

  return query select 'pending'::text, v_submitted_at;
end;
$$;

revoke all on function public.submit_professional_verification(uuid, text, text, text, text, text, date, text, text)
from public, anon, authenticated;
grant execute on function public.submit_professional_verification(uuid, text, text, text, text, text, date, text, text)
to service_role;

create or replace function public.review_professional_verification(
  p_user_id uuid,
  p_action text,
  p_note text,
  p_actor_user_id uuid
)
returns table(status text, reviewed_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous_status text;
  v_next_status text;
  v_reviewed_at timestamptz := now();
  v_note text := nullif(btrim(p_note), '');
begin
  if p_action not in ('approve', 'request_changes', 'reject', 'revoke') then
    raise exception 'invalid_professional_review_action' using errcode = '22023';
  end if;

  if p_action <> 'approve' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'professional_review_note_required' using errcode = '23514';
  end if;

  select verification.status
  into v_previous_status
  from public.professional_verifications verification
  where verification.user_id = p_user_id
  for update;

  if v_previous_status is null then
    raise exception 'professional_verification_not_found' using errcode = 'P0002';
  end if;

  v_next_status := case p_action
    when 'approve' then 'active'
    when 'request_changes' then 'needs_more_info'
    when 'reject' then 'rejected'
    else 'revoked'
  end;

  if p_action = 'approve' and exists (
    select 1
    from public.professional_verifications verification
    where verification.user_id = p_user_id
      and (
        verification.position_title is null
        or verification.credential_type is null
        or verification.credential_number is null
        or verification.credential_issuer is null
        or verification.evidence_reference is null
        or verification.credential_expires_on < current_date
      )
  ) then
    raise exception 'professional_verification_incomplete_or_expired' using errcode = '23514';
  end if;

  update public.professional_verifications
  set status = v_next_status,
      verified_by = p_actor_user_id,
      credential_verified = p_action = 'approve',
      institution_verified = p_action = 'approve' and institution_name is not null,
      reviewed_at = v_reviewed_at,
      review_note = v_note,
      revoked_at = case when p_action = 'revoke' then v_reviewed_at else null end,
      updated_at = v_reviewed_at
  where user_id = p_user_id;

  if p_action = 'approve' then
    update public.profiles
    set role = '专业支持者', updated_at = v_reviewed_at
    where id = p_user_id;
  else
    update public.profiles
    set role = '学生', updated_at = v_reviewed_at
    where id = p_user_id
      and role = '专业支持者';
  end if;

  insert into public.professional_verification_events (
    user_id,
    actor_user_id,
    action,
    previous_status,
    new_status,
    note
  ) values (
    p_user_id,
    p_actor_user_id,
    case p_action
      when 'approve' then 'approved'
      when 'request_changes' then 'changes_requested'
      when 'reject' then 'rejected'
      else 'revoked'
    end,
    v_previous_status,
    v_next_status,
    v_note
  );

  return query select v_next_status, v_reviewed_at;
end;
$$;

revoke all on function public.review_professional_verification(uuid, text, text, uuid)
from public, anon, authenticated;
grant execute on function public.review_professional_verification(uuid, text, text, uuid)
to service_role;

create or replace function public.expire_professional_verifications()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_expired_count integer := 0;
begin
  for v_user_id in
    update public.professional_verifications
    set status = 'needs_more_info',
        credential_verified = false,
        institution_verified = false,
        reviewed_at = now(),
        review_note = '资质有效期已到，请更新有效资质后重新提交。',
        updated_at = now()
    where status = 'active'
      and verification_basis = 'document_review'
      and credential_expires_on < current_date
    returning user_id
  loop
    update public.profiles
    set role = '学生', updated_at = now()
    where id = v_user_id
      and role = '专业支持者';

    insert into public.professional_verification_events (
      user_id,
      actor_user_id,
      action,
      previous_status,
      new_status,
      note
    ) values (
      v_user_id,
      null,
      'expired',
      'active',
      'needs_more_info',
      '资质有效期已到，请更新有效资质后重新提交。'
    );

    v_expired_count := v_expired_count + 1;
  end loop;

  return v_expired_count;
end;
$$;

revoke all on function public.expire_professional_verifications()
from public, anon, authenticated;
grant execute on function public.expire_professional_verifications()
to postgres, service_role;

select cron.schedule(
  'youthtempo-expire-professional-verifications',
  '27 3 * * *',
  $$select public.expire_professional_verifications();$$
);

-- Adults-only Peer Space access foundation.
-- This migration deliberately does not create messages, school rooms,
-- Realtime topics, staff shifts, or any browser-direct business-table access.

create table public.peer_spaces (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{3,48}$'),
  age_scope text not null check (age_scope in ('18_plus', '14_17')),
  status text not null default 'hidden' check (status in ('hidden', 'invite_only', 'active', 'paused', 'closed')),
  rules_version text not null check (char_length(rules_version) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.peer_space_cohorts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.peer_spaces(id) on delete restrict,
  partner_school_id uuid references public.schools(id) on delete set null,
  internal_name text not null check (char_length(internal_name) between 1 and 120),
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'paused', 'closed')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, space_id),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.peer_space_memberships (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.peer_spaces(id) on delete restrict,
  cohort_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'active', 'paused', 'left', 'removed')),
  accepted_rules_version text check (accepted_rules_version is null or char_length(accepted_rules_version) between 1 and 40),
  accepted_rules_at timestamptz,
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text check (ended_reason is null or char_length(ended_reason) between 1 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, cohort_id, user_id),
  unique (id, space_id),
  foreign key (cohort_id, space_id)
    references public.peer_space_cohorts(id, space_id) on delete restrict,
  check ((accepted_rules_version is null) = (accepted_rules_at is null)),
  check (status <> 'active' or accepted_rules_at is not null),
  check (status not in ('left', 'removed') or ended_at is not null)
);

create table public.peer_space_rule_acceptance_events (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.peer_space_memberships(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rules_version text not null check (char_length(rules_version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  unique (membership_id, rules_version)
);

create table public.peer_space_rooms (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.peer_spaces(id) on delete restrict,
  room_type text not null default 'everyone' check (room_type = 'everyone'),
  status text not null default 'closed' check (status in ('staffed_open', 'read_only', 'paused', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, space_id),
  unique (space_id, room_type)
);

create table public.peer_space_room_memberships (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.peer_spaces(id) on delete restrict,
  room_id uuid not null,
  membership_id uuid not null,
  status text not null default 'active' check (status in ('active', 'left', 'removed')),
  auto_join_suppressed boolean not null default false,
  visible_from timestamptz not null default now(),
  visible_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (room_id, space_id)
    references public.peer_space_rooms(id, space_id) on delete restrict,
  foreign key (membership_id, space_id)
    references public.peer_space_memberships(id, space_id) on delete cascade,
  check (visible_until is null or visible_until > visible_from),
  check (
    (status = 'active' and visible_until is null)
    or (status in ('left', 'removed') and visible_until is not null)
  )
);

create unique index peer_space_room_memberships_active_once_idx
on public.peer_space_room_memberships(room_id, membership_id)
where status = 'active' and visible_until is null;

create index peer_space_cohorts_space_status_idx
on public.peer_space_cohorts(space_id, status, starts_at, ends_at);

create index peer_space_cohorts_partner_school_idx
on public.peer_space_cohorts(partner_school_id)
where partner_school_id is not null;

create index peer_space_memberships_user_status_idx
on public.peer_space_memberships(user_id, status, created_at);

create index peer_space_memberships_cohort_status_idx
on public.peer_space_memberships(cohort_id, status);

create index peer_space_memberships_invited_by_idx
on public.peer_space_memberships(invited_by)
where invited_by is not null;

create index peer_space_rule_events_user_accepted_idx
on public.peer_space_rule_acceptance_events(user_id, accepted_at desc);

create index peer_space_room_memberships_member_period_idx
on public.peer_space_room_memberships(membership_id, visible_from, visible_until);

create index peer_space_room_memberships_room_period_idx
on public.peer_space_room_memberships(room_id, visible_from, visible_until);

alter table public.peer_spaces enable row level security;
alter table public.peer_space_cohorts enable row level security;
alter table public.peer_space_memberships enable row level security;
alter table public.peer_space_rule_acceptance_events enable row level security;
alter table public.peer_space_rooms enable row level security;
alter table public.peer_space_room_memberships enable row level security;

revoke all on table public.peer_spaces from public, anon, authenticated, service_role;
revoke all on table public.peer_space_cohorts from public, anon, authenticated, service_role;
revoke all on table public.peer_space_memberships from public, anon, authenticated, service_role;
revoke all on table public.peer_space_rule_acceptance_events from public, anon, authenticated, service_role;
revoke all on table public.peer_space_rooms from public, anon, authenticated, service_role;
revoke all on table public.peer_space_room_memberships from public, anon, authenticated, service_role;

grant select on table public.peer_spaces to service_role;
grant select, insert, update on table public.peer_space_cohorts to service_role;
grant select, insert, update on table public.peer_space_memberships to service_role;
grant select, insert on table public.peer_space_rule_acceptance_events to service_role;
grant select, insert, update on table public.peer_space_rooms to service_role;
grant select, insert, update on table public.peer_space_room_memberships to service_role;

create policy peer_spaces_server_only on public.peer_spaces
for all to authenticated using (false) with check (false);
create policy peer_space_cohorts_server_only on public.peer_space_cohorts
for all to authenticated using (false) with check (false);
create policy peer_space_memberships_server_only on public.peer_space_memberships
for all to authenticated using (false) with check (false);
create policy peer_space_rule_events_server_only on public.peer_space_rule_acceptance_events
for all to authenticated using (false) with check (false);
create policy peer_space_rooms_server_only on public.peer_space_rooms
for all to authenticated using (false) with check (false);
create policy peer_space_room_memberships_server_only on public.peer_space_room_memberships
for all to authenticated using (false) with check (false);

insert into public.peer_spaces (id, code, age_scope, status, rules_version)
values (
  '00000000-0000-4000-8000-000000000018',
  'adult_peer_space',
  '18_plus',
  'invite_only',
  '2026-09-17'
)
on conflict (code) do nothing;

insert into public.peer_space_rooms (id, space_id, room_type, status)
select
  '00000000-0000-4000-8000-000000001800',
  space.id,
  'everyone',
  'closed'
from public.peer_spaces space
where space.code = 'adult_peer_space'
on conflict (space_id, room_type) do nothing;

create or replace function public.accept_peer_space_rules(
  p_user_id uuid,
  p_membership_id uuid,
  p_rules_version text
)
returns table (
  accepted_membership_id uuid,
  joined_room_id uuid,
  room_membership_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_membership public.peer_space_memberships%rowtype;
  v_room_id uuid;
  v_room_membership_id uuid;
  v_rules_version text;
  v_now timestamptz := now();
begin
  select membership.*
  into v_membership
  from public.peer_space_memberships membership
  join public.peer_spaces space on space.id = membership.space_id
  join public.peer_space_cohorts cohort
    on cohort.id = membership.cohort_id
   and cohort.space_id = membership.space_id
  where membership.id = p_membership_id
    and membership.user_id = p_user_id
    and membership.status in ('invited', 'active')
    and space.age_scope = '18_plus'
    and space.status in ('invite_only', 'active')
    and cohort.status = 'active'
    and (cohort.starts_at is null or cohort.starts_at <= v_now)
    and (cohort.ends_at is null or cohort.ends_at > v_now)
    and exists (
      select 1
      from public.profiles profile
      where profile.id = p_user_id
        and profile.role = '学生'
    )
    and exists (
      select 1
      from public.student_consents consent
      where consent.student_user_id = p_user_id
        and consent.age_band = '18_plus'
        and consent.consent_basis = 'adult_self'
        and consent.policy_version = '2026-08-28'
        and consent.status = 'active'
        and consent.student_assented_at is not null
    )
  for update of membership;

  if not found then
    raise exception 'peer_space_unavailable' using errcode = '42501';
  end if;

  select space.rules_version
  into v_rules_version
  from public.peer_spaces space
  where space.id = v_membership.space_id;

  if p_rules_version is distinct from v_rules_version then
    raise exception 'peer_space_rules_version_mismatch' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.peer_space_room_memberships room_membership
    where room_membership.membership_id = v_membership.id
      and room_membership.auto_join_suppressed = true
  ) then
    raise exception 'peer_space_rejoin_requires_explicit_flow' using errcode = '42501';
  end if;

  select room.id
  into v_room_id
  from public.peer_space_rooms room
  where room.space_id = v_membership.space_id
    and room.room_type = 'everyone';

  if v_room_id is null then
    raise exception 'peer_space_room_unavailable' using errcode = '55000';
  end if;

  update public.peer_space_memberships
  set status = 'active',
      accepted_rules_at = case
        when accepted_rules_version is distinct from v_rules_version then v_now
        else coalesce(accepted_rules_at, v_now)
      end,
      accepted_rules_version = v_rules_version,
      ended_at = null,
      ended_reason = null,
      updated_at = v_now
  where id = v_membership.id;

  insert into public.peer_space_rule_acceptance_events (
    membership_id,
    user_id,
    rules_version,
    accepted_at
  ) values (
    v_membership.id,
    p_user_id,
    v_rules_version,
    v_now
  )
  on conflict (membership_id, rules_version) do nothing;

  insert into public.peer_space_room_memberships (
    space_id,
    room_id,
    membership_id,
    status,
    visible_from
  ) values (
    v_membership.space_id,
    v_room_id,
    v_membership.id,
    'active',
    v_now
  )
  on conflict do nothing;

  select room_membership.id
  into v_room_membership_id
  from public.peer_space_room_memberships room_membership
  where room_membership.room_id = v_room_id
    and room_membership.membership_id = v_membership.id
    and room_membership.status = 'active'
    and room_membership.visible_until is null;

  if v_room_membership_id is null then
    raise exception 'peer_space_membership_unavailable' using errcode = '55000';
  end if;

  return query
  select v_membership.id, v_room_id, v_room_membership_id;
end;
$$;

revoke all on function public.accept_peer_space_rules(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.accept_peer_space_rules(uuid, uuid, text)
to service_role;

-- Peer Space staff authorization and duty-shift foundation.
-- This batch is server-only. It does not expose student content, enable Realtime,
-- open the room, schedule production duty, or grant any browser-direct access.

create table public.peer_space_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  space_id uuid not null references public.peer_spaces(id) on delete restrict,
  room_id uuid,
  capability text not null check (capability in ('room_duty', 'content_moderator', 'safety_duty', 'config_admin')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  granted_by uuid not null references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) between 1 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id, space_id),
  foreign key (room_id, space_id)
    references public.peer_space_rooms(id, space_id) on delete restrict,
  check (ends_at is null or ends_at > starts_at),
  check (
    (status = 'active' and revoked_by is null and revoked_at is null and revoke_reason is null)
    or (status = 'revoked' and revoked_by is not null and revoked_at is not null)
  )
);

create table public.peer_space_staff_assignment_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.peer_space_staff_assignments(id) on delete restrict,
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('granted', 'revoked')),
  capability text not null check (capability in ('room_duty', 'content_moderator', 'safety_duty', 'config_admin')),
  space_id uuid not null references public.peer_spaces(id) on delete restrict,
  room_id uuid,
  reason text check (reason is null or char_length(reason) between 1 and 240),
  created_at timestamptz not null default now(),
  foreign key (room_id, space_id)
    references public.peer_space_rooms(id, space_id) on delete restrict
);

create table public.peer_space_duty_shifts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.peer_spaces(id) on delete restrict,
  room_id uuid not null,
  primary_assignment_id uuid not null,
  primary_staff_user_id uuid not null references auth.users(id) on delete restrict,
  backup_assignment_id uuid not null,
  backup_staff_user_id uuid not null references auth.users(id) on delete restrict,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'handoff_pending', 'ended', 'cancelled')),
  checklist_version text check (checklist_version is null or char_length(checklist_version) between 1 and 40),
  device_network_confirmed_at timestamptz,
  backup_confirmed_at timestamptz,
  safety_path_confirmed_at timestamptz,
  rules_resources_confirmed_at timestamptz,
  handoff_reviewed_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  last_heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (room_id, space_id)
    references public.peer_space_rooms(id, space_id) on delete restrict,
  foreign key (primary_assignment_id, primary_staff_user_id, space_id)
    references public.peer_space_staff_assignments(id, user_id, space_id) on delete restrict,
  foreign key (backup_assignment_id, backup_staff_user_id, space_id)
    references public.peer_space_staff_assignments(id, user_id, space_id) on delete restrict,
  check (scheduled_end_at > scheduled_start_at),
  check (primary_staff_user_id <> backup_staff_user_id),
  check (primary_assignment_id <> backup_assignment_id),
  check (
    (status = 'scheduled' and actual_start_at is null and actual_end_at is null and lease_expires_at is null)
    or (status in ('active', 'handoff_pending') and actual_start_at is not null and actual_end_at is null and lease_expires_at is not null)
    or (status = 'ended' and actual_start_at is not null and actual_end_at is not null and lease_expires_at is null)
    or (status = 'cancelled' and actual_end_at is not null and lease_expires_at is null)
  )
);

create table public.peer_space_duty_shift_events (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.peer_space_duty_shifts(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_assignment_id uuid references public.peer_space_staff_assignments(id) on delete restrict,
  event_type text not null check (event_type in ('started', 'heartbeat', 'handoff_started', 'ended', 'lease_expired')),
  previous_status text check (previous_status is null or previous_status in ('scheduled', 'active', 'handoff_pending', 'ended', 'cancelled')),
  new_status text not null check (new_status in ('scheduled', 'active', 'handoff_pending', 'ended', 'cancelled')),
  lease_expires_at timestamptz,
  checklist_version text check (checklist_version is null or char_length(checklist_version) between 1 and 40),
  created_at timestamptz not null default now()
);

create unique index peer_space_staff_active_space_scope_idx
on public.peer_space_staff_assignments(user_id, capability, space_id)
where status = 'active' and room_id is null;

create unique index peer_space_staff_active_room_scope_idx
on public.peer_space_staff_assignments(user_id, capability, room_id)
where status = 'active' and room_id is not null;

create index peer_space_staff_assignments_space_status_idx
on public.peer_space_staff_assignments(space_id, status, capability);

create index peer_space_staff_assignments_user_idx
on public.peer_space_staff_assignments(user_id);

create index peer_space_staff_assignments_granted_by_idx
on public.peer_space_staff_assignments(granted_by);

create index peer_space_staff_assignments_revoked_by_idx
on public.peer_space_staff_assignments(revoked_by)
where revoked_by is not null;

create index peer_space_staff_assignments_room_status_idx
on public.peer_space_staff_assignments(room_id, status, capability)
where room_id is not null;

create index peer_space_staff_assignment_events_assignment_created_idx
on public.peer_space_staff_assignment_events(assignment_id, created_at desc);

create index peer_space_staff_assignment_events_actor_created_idx
on public.peer_space_staff_assignment_events(actor_user_id, created_at desc);

create index peer_space_staff_assignment_events_staff_created_idx
on public.peer_space_staff_assignment_events(staff_user_id, created_at desc);

create index peer_space_staff_assignment_events_space_created_idx
on public.peer_space_staff_assignment_events(space_id, created_at desc);

create index peer_space_staff_assignment_events_room_created_idx
on public.peer_space_staff_assignment_events(room_id, created_at desc)
where room_id is not null;

create index peer_space_duty_shifts_room_schedule_idx
on public.peer_space_duty_shifts(room_id, scheduled_start_at, scheduled_end_at);

create index peer_space_duty_shifts_primary_schedule_idx
on public.peer_space_duty_shifts(primary_staff_user_id, scheduled_start_at desc);

create index peer_space_duty_shifts_backup_schedule_idx
on public.peer_space_duty_shifts(backup_staff_user_id, scheduled_start_at desc);

create index peer_space_duty_shifts_space_schedule_idx
on public.peer_space_duty_shifts(space_id, scheduled_start_at desc);

create index peer_space_duty_shifts_primary_assignment_idx
on public.peer_space_duty_shifts(primary_assignment_id);

create index peer_space_duty_shifts_backup_assignment_idx
on public.peer_space_duty_shifts(backup_assignment_id);

create index peer_space_duty_shifts_created_by_idx
on public.peer_space_duty_shifts(created_by);

create unique index peer_space_duty_one_active_room_per_primary_idx
on public.peer_space_duty_shifts(primary_staff_user_id)
where status in ('active', 'handoff_pending');

-- One live primary per room; an outgoing handoff may briefly overlap the
-- incoming active shift, but two shifts in the same state may not.
create unique index peer_space_duty_one_active_shift_per_room_idx
on public.peer_space_duty_shifts(room_id)
where status = 'active';

create unique index peer_space_duty_one_handoff_shift_per_room_idx
on public.peer_space_duty_shifts(room_id)
where status = 'handoff_pending';

create index peer_space_duty_active_lease_idx
on public.peer_space_duty_shifts(lease_expires_at)
where status in ('active', 'handoff_pending');

create index peer_space_duty_shift_events_shift_created_idx
on public.peer_space_duty_shift_events(shift_id, created_at desc);

create index peer_space_duty_shift_events_actor_created_idx
on public.peer_space_duty_shift_events(actor_user_id, created_at desc)
where actor_user_id is not null;

create index peer_space_duty_shift_events_assignment_created_idx
on public.peer_space_duty_shift_events(actor_assignment_id, created_at desc)
where actor_assignment_id is not null;

alter table public.peer_space_staff_assignments enable row level security;
alter table public.peer_space_staff_assignment_events enable row level security;
alter table public.peer_space_duty_shifts enable row level security;
alter table public.peer_space_duty_shift_events enable row level security;

revoke all on table public.peer_space_staff_assignments from public, anon, authenticated, service_role;
revoke all on table public.peer_space_staff_assignment_events from public, anon, authenticated, service_role;
revoke all on table public.peer_space_duty_shifts from public, anon, authenticated, service_role;
revoke all on table public.peer_space_duty_shift_events from public, anon, authenticated, service_role;

grant select, insert, update on table public.peer_space_staff_assignments to service_role;
grant select, insert on table public.peer_space_staff_assignment_events to service_role;
grant select, insert, update on table public.peer_space_duty_shifts to service_role;
grant select, insert on table public.peer_space_duty_shift_events to service_role;

create policy peer_space_staff_assignments_server_only on public.peer_space_staff_assignments
for all to authenticated using (false) with check (false);
create policy peer_space_staff_assignment_events_server_only on public.peer_space_staff_assignment_events
for all to authenticated using (false) with check (false);
create policy peer_space_duty_shifts_server_only on public.peer_space_duty_shifts
for all to authenticated using (false) with check (false);
create policy peer_space_duty_shift_events_server_only on public.peer_space_duty_shift_events
for all to authenticated using (false) with check (false);

create or replace function public.protect_peer_space_staff_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'revoked'
    or new.user_id is distinct from old.user_id
    or new.space_id is distinct from old.space_id
    or new.room_id is distinct from old.room_id
    or new.capability is distinct from old.capability
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.granted_by is distinct from old.granted_by
    or new.granted_at is distinct from old.granted_at
    or new.created_at is distinct from old.created_at
    or new.status <> 'revoked' then
    raise exception 'peer_space_staff_assignment_immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.audit_peer_space_staff_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.peer_space_staff_assignment_events (
    assignment_id,
    staff_user_id,
    actor_user_id,
    action,
    capability,
    space_id,
    room_id,
    reason,
    created_at
  ) values (
    new.id,
    new.user_id,
    case when tg_op = 'INSERT' then new.granted_by else new.revoked_by end,
    case when tg_op = 'INSERT' then 'granted' else 'revoked' end,
    new.capability,
    new.space_id,
    new.room_id,
    case when tg_op = 'INSERT' then null else new.revoke_reason end,
    case when tg_op = 'INSERT' then new.granted_at else new.revoked_at end
  );

  return new;
end;
$$;

create trigger protect_peer_space_staff_assignment_before_update
before update on public.peer_space_staff_assignments
for each row execute function public.protect_peer_space_staff_assignment();

create trigger audit_peer_space_staff_assignment_after_insert
after insert on public.peer_space_staff_assignments
for each row execute function public.audit_peer_space_staff_assignment();

create trigger audit_peer_space_staff_assignment_after_revoke
after update of status on public.peer_space_staff_assignments
for each row
when (old.status is distinct from new.status)
execute function public.audit_peer_space_staff_assignment();

create or replace function public.peer_space_room_has_live_duty(
  p_room_id uuid,
  p_now timestamptz
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.peer_space_duty_shifts shift
    join public.peer_space_staff_assignments primary_assignment
      on primary_assignment.id = shift.primary_assignment_id
     and primary_assignment.user_id = shift.primary_staff_user_id
     and primary_assignment.space_id = shift.space_id
    join public.peer_space_staff_assignments backup_assignment
      on backup_assignment.id = shift.backup_assignment_id
     and backup_assignment.user_id = shift.backup_staff_user_id
     and backup_assignment.space_id = shift.space_id
    where shift.room_id = p_room_id
      and shift.status in ('active', 'handoff_pending')
      and shift.lease_expires_at > p_now
      and shift.scheduled_end_at > p_now
      and primary_assignment.capability = 'room_duty'
      and primary_assignment.status = 'active'
      and primary_assignment.starts_at <= p_now
      and (primary_assignment.ends_at is null or primary_assignment.ends_at > p_now)
      and (primary_assignment.room_id is null or primary_assignment.room_id = p_room_id)
      and backup_assignment.capability in ('room_duty', 'safety_duty')
      and backup_assignment.status = 'active'
      and backup_assignment.starts_at <= p_now
      and (backup_assignment.ends_at is null or backup_assignment.ends_at > p_now)
      and (backup_assignment.room_id is null or backup_assignment.room_id = p_room_id)
  );
$$;

create or replace function public.start_peer_space_duty_shift(
  p_shift_id uuid,
  p_user_id uuid,
  p_assignment_id uuid,
  p_checklist_version text,
  p_device_network_confirmed boolean,
  p_backup_confirmed boolean,
  p_safety_path_confirmed boolean,
  p_rules_resources_confirmed boolean,
  p_handoff_reviewed boolean
)
returns table (
  duty_shift_id uuid,
  duty_status text,
  duty_lease_expires_at timestamptz,
  duty_last_heartbeat_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_shift public.peer_space_duty_shifts%rowtype;
  v_now timestamptz;
  v_lease_expires_at timestamptz;
begin
  if p_checklist_version is distinct from '2026-09-17'
    or not coalesce(p_device_network_confirmed, false)
    or not coalesce(p_backup_confirmed, false)
    or not coalesce(p_safety_path_confirmed, false)
    or not coalesce(p_rules_resources_confirmed, false)
    or not coalesce(p_handoff_reviewed, false) then
    raise exception 'peer_space_duty_checklist_incomplete' using errcode = '22023';
  end if;

  select shift.room_id
  into v_room_id
  from public.peer_space_duty_shifts shift
  where shift.id = p_shift_id;

  if not found then
    raise exception 'peer_space_duty_unavailable' using errcode = '42501';
  end if;

  -- All room-level transitions lock room before shift, including the sweeper.
  perform 1 from public.peer_space_rooms room
  where room.id = v_room_id
  for update;

  select shift.*
  into v_shift
  from public.peer_space_duty_shifts shift
  where shift.id = p_shift_id and shift.room_id = v_room_id
  for update;

  if not found
    or v_shift.primary_staff_user_id <> p_user_id
    or v_shift.primary_assignment_id <> p_assignment_id then
    raise exception 'peer_space_duty_unavailable' using errcode = '42501';
  end if;

  v_now := clock_timestamp();
  v_lease_expires_at := least(v_now + interval '120 seconds', v_shift.scheduled_end_at);

  if not exists (
    select 1
    from public.peer_space_staff_assignments assignment
    where assignment.id = p_assignment_id
      and assignment.user_id = p_user_id
      and assignment.space_id = v_shift.space_id
      and assignment.capability = 'room_duty'
      and assignment.status = 'active'
      and assignment.starts_at <= v_now
      and (assignment.ends_at is null or assignment.ends_at > v_now)
      and (assignment.room_id is null or assignment.room_id = v_shift.room_id)
  ) then
    raise exception 'peer_space_duty_unavailable' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.peer_space_staff_assignments assignment
    where assignment.id = v_shift.backup_assignment_id
      and assignment.user_id = v_shift.backup_staff_user_id
      and assignment.space_id = v_shift.space_id
      and assignment.capability in ('room_duty', 'safety_duty')
      and assignment.status = 'active'
      and assignment.starts_at <= v_now
      and (assignment.ends_at is null or assignment.ends_at > v_now)
      and (assignment.room_id is null or assignment.room_id = v_shift.room_id)
  ) then
    raise exception 'peer_space_duty_backup_unavailable' using errcode = '55000';
  end if;

  if v_shift.status = 'active'
    and v_shift.lease_expires_at > v_now
    and v_shift.scheduled_end_at > v_now then
    return query select v_shift.id, v_shift.status, v_shift.lease_expires_at, v_shift.last_heartbeat_at;
    return;
  end if;

  if v_shift.status <> 'scheduled'
    or v_now < v_shift.scheduled_start_at
    or v_now >= v_shift.scheduled_end_at then
    raise exception 'peer_space_duty_not_startable' using errcode = '55000';
  end if;

  update public.peer_space_duty_shifts
  set status = 'active',
      checklist_version = p_checklist_version,
      device_network_confirmed_at = v_now,
      backup_confirmed_at = v_now,
      safety_path_confirmed_at = v_now,
      rules_resources_confirmed_at = v_now,
      handoff_reviewed_at = v_now,
      actual_start_at = v_now,
      last_heartbeat_at = v_now,
      lease_expires_at = v_lease_expires_at,
      updated_at = v_now
  where id = v_shift.id;

  insert into public.peer_space_duty_shift_events (
    shift_id, actor_user_id, actor_assignment_id, event_type,
    previous_status, new_status, lease_expires_at, checklist_version
  ) values (
    v_shift.id, p_user_id, p_assignment_id, 'started',
    v_shift.status, 'active', v_lease_expires_at, p_checklist_version
  );

  return query select v_shift.id, 'active'::text, v_lease_expires_at, v_now;
end;
$$;

create or replace function public.renew_peer_space_duty_lease(
  p_shift_id uuid,
  p_user_id uuid,
  p_assignment_id uuid
)
returns table (
  duty_shift_id uuid,
  duty_status text,
  duty_lease_expires_at timestamptz,
  duty_last_heartbeat_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_shift public.peer_space_duty_shifts%rowtype;
  v_now timestamptz;
  v_lease_expires_at timestamptz;
begin
  select shift.room_id
  into v_room_id
  from public.peer_space_duty_shifts shift
  where shift.id = p_shift_id;

  if not found then
    raise exception 'peer_space_duty_lease_unavailable' using errcode = '42501';
  end if;

  perform 1 from public.peer_space_rooms room
  where room.id = v_room_id
  for update;

  select shift.*
  into v_shift
  from public.peer_space_duty_shifts shift
  where shift.id = p_shift_id and shift.room_id = v_room_id
  for update;

  if not found then
    raise exception 'peer_space_duty_lease_unavailable' using errcode = '42501';
  end if;

  v_now := clock_timestamp();
  v_lease_expires_at := least(v_now + interval '120 seconds', v_shift.scheduled_end_at);

  if v_shift.primary_staff_user_id <> p_user_id
    or v_shift.primary_assignment_id <> p_assignment_id
    or v_shift.status not in ('active', 'handoff_pending')
    or v_shift.lease_expires_at <= v_now
    or v_shift.scheduled_end_at <= v_now
    or not exists (
      select 1
      from public.peer_space_staff_assignments assignment
      where assignment.id = p_assignment_id
        and assignment.user_id = p_user_id
        and assignment.space_id = v_shift.space_id
        and assignment.capability = 'room_duty'
        and assignment.status = 'active'
        and assignment.starts_at <= v_now
        and (assignment.ends_at is null or assignment.ends_at > v_now)
        and (assignment.room_id is null or assignment.room_id = v_shift.room_id)
    )
    or not exists (
      select 1
      from public.peer_space_staff_assignments assignment
      where assignment.id = v_shift.backup_assignment_id
        and assignment.user_id = v_shift.backup_staff_user_id
        and assignment.space_id = v_shift.space_id
        and assignment.capability in ('room_duty', 'safety_duty')
        and assignment.status = 'active'
        and assignment.starts_at <= v_now
        and (assignment.ends_at is null or assignment.ends_at > v_now)
        and (assignment.room_id is null or assignment.room_id = v_shift.room_id)
    ) then
    raise exception 'peer_space_duty_lease_unavailable' using errcode = '42501';
  end if;

  update public.peer_space_duty_shifts
  set last_heartbeat_at = v_now,
      lease_expires_at = v_lease_expires_at,
      updated_at = v_now
  where id = v_shift.id;

  insert into public.peer_space_duty_shift_events (
    shift_id, actor_user_id, actor_assignment_id, event_type,
    previous_status, new_status, lease_expires_at, checklist_version
  ) values (
    v_shift.id, p_user_id, p_assignment_id, 'heartbeat',
    v_shift.status, v_shift.status, v_lease_expires_at, v_shift.checklist_version
  );

  return query select v_shift.id, v_shift.status, v_lease_expires_at, v_now;
end;
$$;

create or replace function public.transition_peer_space_duty_shift(
  p_shift_id uuid,
  p_user_id uuid,
  p_assignment_id uuid,
  p_action text
)
returns table (
  duty_shift_id uuid,
  duty_status text,
  duty_lease_expires_at timestamptz,
  duty_last_heartbeat_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_shift public.peer_space_duty_shifts%rowtype;
  v_now timestamptz;
  v_next_status text;
  v_next_lease timestamptz;
  v_event_type text;
begin
  if p_action is null or p_action not in ('begin_handoff', 'end') then
    raise exception 'peer_space_duty_action_invalid' using errcode = '22023';
  end if;

  select shift.room_id
  into v_room_id
  from public.peer_space_duty_shifts shift
  where shift.id = p_shift_id;

  if not found then
    raise exception 'peer_space_duty_unavailable' using errcode = '42501';
  end if;

  perform 1 from public.peer_space_rooms room
  where room.id = v_room_id
  for update;

  select shift.*
  into v_shift
  from public.peer_space_duty_shifts shift
  where shift.id = p_shift_id and shift.room_id = v_room_id
  for update;

  if not found then
    raise exception 'peer_space_duty_unavailable' using errcode = '42501';
  end if;

  v_now := clock_timestamp();

  if v_shift.primary_staff_user_id <> p_user_id
    or v_shift.primary_assignment_id <> p_assignment_id
    or v_shift.status not in ('active', 'handoff_pending')
    or not exists (
      select 1
      from public.peer_space_staff_assignments assignment
      where assignment.id = p_assignment_id
        and assignment.user_id = p_user_id
        and assignment.space_id = v_shift.space_id
        and assignment.capability = 'room_duty'
        and assignment.status = 'active'
        and assignment.starts_at <= v_now
        and (assignment.ends_at is null or assignment.ends_at > v_now)
        and (assignment.room_id is null or assignment.room_id = v_shift.room_id)
    ) then
    raise exception 'peer_space_duty_unavailable' using errcode = '42501';
  end if;

  if p_action = 'begin_handoff' then
    if v_shift.lease_expires_at <= v_now or v_shift.scheduled_end_at <= v_now then
      raise exception 'peer_space_duty_lease_unavailable' using errcode = '55000';
    end if;
    if not exists (
      select 1
      from public.peer_space_staff_assignments assignment
      where assignment.id = v_shift.backup_assignment_id
        and assignment.user_id = v_shift.backup_staff_user_id
        and assignment.space_id = v_shift.space_id
        and assignment.capability in ('room_duty', 'safety_duty')
        and assignment.status = 'active'
        and assignment.starts_at <= v_now
        and (assignment.ends_at is null or assignment.ends_at > v_now)
        and (assignment.room_id is null or assignment.room_id = v_shift.room_id)
    ) then
      raise exception 'peer_space_duty_backup_unavailable' using errcode = '55000';
    end if;
    v_next_status := 'handoff_pending';
    v_next_lease := least(v_now + interval '120 seconds', v_shift.scheduled_end_at);
    v_event_type := 'handoff_started';
  else
    v_next_status := 'ended';
    v_next_lease := null;
    v_event_type := 'ended';
  end if;

  update public.peer_space_duty_shifts
  set status = v_next_status,
      actual_end_at = case when p_action = 'end' then v_now else actual_end_at end,
      last_heartbeat_at = case when p_action = 'end' then last_heartbeat_at else v_now end,
      lease_expires_at = v_next_lease,
      updated_at = v_now
  where id = v_shift.id;

  insert into public.peer_space_duty_shift_events (
    shift_id, actor_user_id, actor_assignment_id, event_type,
    previous_status, new_status, lease_expires_at, checklist_version
  ) values (
    v_shift.id, p_user_id, p_assignment_id, v_event_type,
    v_shift.status, v_next_status, v_next_lease, v_shift.checklist_version
  );

  if p_action = 'end' then
    update public.peer_space_rooms
    set status = 'read_only', updated_at = v_now
    where id = v_shift.room_id
      and status = 'staffed_open'
      and not public.peer_space_room_has_live_duty(v_shift.room_id, v_now);
  end if;

  return query select v_shift.id, v_next_status, v_next_lease,
    case when p_action = 'end' then v_shift.last_heartbeat_at else v_now end;
end;
$$;

create or replace function public.expire_peer_space_duty_leases()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate record;
  v_shift public.peer_space_duty_shifts%rowtype;
  v_now timestamptz;
  v_expired_count integer := 0;
begin
  for v_candidate in
    select shift.id, shift.room_id
    from public.peer_space_duty_shifts shift
    where shift.status in ('active', 'handoff_pending')
      and (shift.lease_expires_at <= clock_timestamp()
        or shift.scheduled_end_at <= clock_timestamp())
    order by shift.room_id, shift.id
  loop
    perform 1 from public.peer_space_rooms room
    where room.id = v_candidate.room_id
    for update skip locked;
    if not found then
      continue;
    end if;

    select shift.*
    into v_shift
    from public.peer_space_duty_shifts shift
    where shift.id = v_candidate.id and shift.room_id = v_candidate.room_id
    for update skip locked;
    if not found then
      continue;
    end if;

    v_now := clock_timestamp();
    if v_shift.status not in ('active', 'handoff_pending')
      or (v_shift.lease_expires_at > v_now and v_shift.scheduled_end_at > v_now) then
      continue;
    end if;

    update public.peer_space_duty_shifts
    set status = 'ended',
        actual_end_at = v_now,
        lease_expires_at = null,
        updated_at = v_now
    where id = v_shift.id;

    update public.peer_space_rooms
    set status = 'read_only', updated_at = v_now
    where id = v_shift.room_id
      and status = 'staffed_open'
      and not public.peer_space_room_has_live_duty(v_shift.room_id, v_now);

    insert into public.peer_space_duty_shift_events (
      shift_id, event_type, previous_status, new_status, checklist_version, created_at
    ) values (
      v_shift.id, 'lease_expired', v_shift.status, 'ended', v_shift.checklist_version, v_now
    );

    v_expired_count := v_expired_count + 1;
  end loop;

  return v_expired_count;
end;
$$;

revoke all on function public.start_peer_space_duty_shift(uuid, uuid, uuid, text, boolean, boolean, boolean, boolean, boolean)
from public, anon, authenticated;
revoke all on function public.renew_peer_space_duty_lease(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.transition_peer_space_duty_shift(uuid, uuid, uuid, text)
from public, anon, authenticated;
revoke all on function public.expire_peer_space_duty_leases()
from public, anon, authenticated;
revoke all on function public.protect_peer_space_staff_assignment()
from public, anon, authenticated;
revoke all on function public.audit_peer_space_staff_assignment()
from public, anon, authenticated;
revoke all on function public.peer_space_room_has_live_duty(uuid, timestamptz)
from public, anon, authenticated;

grant execute on function public.start_peer_space_duty_shift(uuid, uuid, uuid, text, boolean, boolean, boolean, boolean, boolean)
to service_role;
grant execute on function public.renew_peer_space_duty_lease(uuid, uuid, uuid)
to service_role;
grant execute on function public.transition_peer_space_duty_shift(uuid, uuid, uuid, text)
to service_role;
grant execute on function public.expire_peer_space_duty_leases()
to service_role;
grant execute on function public.peer_space_room_has_live_duty(uuid, timestamptz)
to service_role;

-- Local-only room controls. No message or Realtime access is created here.
-- Applying this migration does not schedule the duty-lease watchdog.

create table public.peer_space_room_state_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.peer_space_rooms(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_assignment_id uuid not null references public.peer_space_staff_assignments(id) on delete restrict,
  action text not null check (action in ('open', 'read_only', 'pause', 'resume_read_only')),
  previous_status text not null check (previous_status in ('staffed_open', 'read_only', 'paused', 'closed')),
  new_status text not null check (new_status in ('staffed_open', 'read_only', 'paused', 'closed')),
  reason_code text check (reason_code is null or reason_code in (
    'staffing_gap', 'safety_concern', 'operational_issue', 'resume_authorized'
  )),
  created_at timestamptz not null default now()
);

create index peer_space_room_state_events_room_created_idx
on public.peer_space_room_state_events(room_id, created_at desc);

create index peer_space_room_state_events_actor_created_idx
on public.peer_space_room_state_events(actor_user_id, created_at desc);

create index peer_space_room_state_events_assignment_idx
on public.peer_space_room_state_events(actor_assignment_id);

alter table public.peer_space_room_state_events enable row level security;
revoke all on table public.peer_space_room_state_events from public, anon, authenticated, service_role;
grant select, insert on table public.peer_space_room_state_events to service_role;

create policy peer_space_room_state_events_server_only on public.peer_space_room_state_events
for all to authenticated using (false) with check (false);

create or replace function public.transition_peer_space_room_state(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_assignment_id uuid,
  p_action text,
  p_reason_code text default null
)
returns table (
  changed_room_id uuid,
  room_status text,
  changed_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room public.peer_space_rooms%rowtype;
  v_shift public.peer_space_duty_shifts%rowtype;
  v_assignment public.peer_space_staff_assignments%rowtype;
  v_backup public.peer_space_staff_assignments%rowtype;
  v_next_status text;
  v_now timestamptz;
begin
  if p_action is null or p_action not in ('open', 'read_only', 'pause', 'resume_read_only') then
    raise exception 'peer_space_room_action_invalid' using errcode = '22023';
  end if;

  -- Use the established lock order: room, then shift, then assignments.
  select room.* into v_room
  from public.peer_space_rooms room
  where room.id = p_room_id
  for update;
  if not found then
    raise exception 'peer_space_room_unavailable' using errcode = '42501';
  end if;
  v_now := clock_timestamp();

  if p_action = 'open' then
    if v_room.status not in ('closed', 'read_only')
      or not exists (
        select 1 from public.peer_spaces space
        where space.id = v_room.space_id
          and space.age_scope = '18_plus'
          and space.status in ('invite_only', 'active')
      ) then
      raise exception 'peer_space_room_not_openable' using errcode = '55000';
    end if;

    select shift.* into v_shift
    from public.peer_space_duty_shifts shift
    where shift.room_id = v_room.id
      and shift.space_id = v_room.space_id
      and shift.primary_staff_user_id = p_actor_user_id
      and shift.primary_assignment_id = p_assignment_id
      and shift.status in ('active', 'handoff_pending')
      and shift.lease_expires_at > v_now
      and shift.scheduled_end_at > v_now
      and shift.checklist_version = '2026-09-17'
      and shift.device_network_confirmed_at is not null
      and shift.backup_confirmed_at is not null
      and shift.safety_path_confirmed_at is not null
      and shift.rules_resources_confirmed_at is not null
      and shift.handoff_reviewed_at is not null
    order by shift.actual_start_at desc
    limit 1
    for update;
    if not found then
      raise exception 'peer_space_room_duty_unavailable' using errcode = '42501';
    end if;
  end if;

  select assignment.* into v_assignment
  from public.peer_space_staff_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.user_id = p_actor_user_id
    and assignment.space_id = v_room.space_id
    and assignment.status = 'active'
    and assignment.starts_at <= v_now
    and (assignment.ends_at is null or assignment.ends_at > v_now)
    and (assignment.room_id is null or assignment.room_id = v_room.id)
  for share;
  if not found then
    raise exception 'peer_space_room_permission_denied' using errcode = '42501';
  end if;

  if p_action = 'open' then
    if v_assignment.capability <> 'room_duty'
      or v_shift.primary_staff_user_id = v_shift.backup_staff_user_id then
      raise exception 'peer_space_room_permission_denied' using errcode = '42501';
    end if;

    select assignment.* into v_backup
    from public.peer_space_staff_assignments assignment
    where assignment.id = v_shift.backup_assignment_id
      and assignment.user_id = v_shift.backup_staff_user_id
      and assignment.space_id = v_room.space_id
      and assignment.capability in ('room_duty', 'safety_duty')
      and assignment.status = 'active'
      and assignment.starts_at <= v_now
      and (assignment.ends_at is null or assignment.ends_at > v_now)
      and (assignment.room_id is null or assignment.room_id = v_room.id)
    for share;
    if not found then
      raise exception 'peer_space_room_backup_unavailable' using errcode = '55000';
    end if;
    v_next_status := 'staffed_open';
  elsif p_action = 'read_only' then
    if v_assignment.capability not in ('room_duty', 'safety_duty')
      or v_room.status <> 'staffed_open'
      or p_reason_code is null
      or p_reason_code not in ('staffing_gap', 'safety_concern', 'operational_issue') then
      raise exception 'peer_space_room_transition_denied' using errcode = '42501';
    end if;
    v_next_status := 'read_only';
  elsif p_action = 'pause' then
    if v_assignment.capability not in ('room_duty', 'safety_duty')
      or v_room.status not in ('staffed_open', 'read_only')
      or p_reason_code is null
      or p_reason_code not in ('staffing_gap', 'safety_concern', 'operational_issue') then
      raise exception 'peer_space_room_transition_denied' using errcode = '42501';
    end if;
    v_next_status := 'paused';
  else
    if v_assignment.capability <> 'safety_duty'
      or v_room.status <> 'paused'
      or p_reason_code is distinct from 'resume_authorized' then
      raise exception 'peer_space_room_transition_denied' using errcode = '42501';
    end if;
    -- Safety review only clears the pause. A current room-duty shift must open separately.
    v_next_status := 'read_only';
  end if;

  if p_action = 'open' and p_reason_code is not null then
    raise exception 'peer_space_room_reason_invalid' using errcode = '22023';
  end if;

  update public.peer_space_rooms
  set status = v_next_status, updated_at = v_now
  where id = v_room.id;

  insert into public.peer_space_room_state_events (
    room_id, actor_user_id, actor_assignment_id, action,
    previous_status, new_status, reason_code, created_at
  ) values (
    v_room.id, p_actor_user_id, p_assignment_id, p_action,
    v_room.status, v_next_status, p_reason_code, v_now
  );

  return query select v_room.id, v_next_status, v_now;
end;
$$;

revoke all on function public.transition_peer_space_room_state(uuid, uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.transition_peer_space_room_state(uuid, uuid, uuid, text, text)
to service_role;

-- Tempo Garden derives growth from these participation facts and existing
-- sweet_records. No second mutable score, streak, or public profile field exists.
create table if not exists public.tempo_check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feeling text not null check (feeling in ('steady', 'mixed', 'heavy', 'unsure')),
  created_at timestamptz not null default now()
);

create index if not exists tempo_check_ins_user_created_idx
on public.tempo_check_ins(user_id, created_at desc);

create table if not exists public.tempo_reminder_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'off' check (mode in ('off', 'daily', 'weekly')),
  updated_at timestamptz not null default now()
);

alter table public.tempo_check_ins enable row level security;
alter table public.tempo_reminder_preferences enable row level security;
revoke all on table public.tempo_check_ins, public.tempo_reminder_preferences from public, anon, authenticated;
grant select, insert, delete on table public.tempo_check_ins to service_role;
grant select, insert, update, delete on table public.tempo_reminder_preferences to service_role;

-- Defense in depth: if table privileges are later changed, rows stay owner-only.
drop policy if exists tempo_check_ins_own on public.tempo_check_ins;
create policy tempo_check_ins_own on public.tempo_check_ins
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists tempo_reminder_preferences_own on public.tempo_reminder_preferences;
create policy tempo_reminder_preferences_own on public.tempo_reminder_preferences
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Private, user-owned interaction state for the SWEET Garden.
-- Growth continues to derive only from participation records; these tables do
-- not store scores, streaks, diagnoses, AI output, or public profile data.
create table public.tempo_garden_care_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  care_date date not null,
  action text not null check (action in ('water', 'sunlight', 'invite_visitor')),
  created_at timestamptz not null default now(),
  unique (user_id, care_date)
);

create index tempo_garden_care_events_user_created_idx
on public.tempo_garden_care_events(user_id, created_at desc);

create table public.tempo_garden_layout_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null check (slot in ('flower_border', 'hill_path', 'pond_edge', 'bench_corner')),
  item_key text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot),
  check (
    (slot = 'flower_border' and item_key in ('wildflower_patch', 'low_fern'))
    or (slot = 'hill_path' and item_key in ('flat_stones', 'wooden_sign'))
    or (slot = 'pond_edge' and item_key in ('water_grass', 'small_birdbath'))
    or (slot = 'bench_corner' and item_key in ('linen_cushion', 'warm_lantern'))
  )
);

create table public.tempo_garden_keepsakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  keepsake_date date not null,
  keepsake_type text not null check (keepsake_type in ('flower', 'stone', 'lantern')),
  created_at timestamptz not null default now(),
  unique (user_id, keepsake_date)
);

alter table public.tempo_garden_care_events enable row level security;
alter table public.tempo_garden_layout_items enable row level security;
alter table public.tempo_garden_keepsakes enable row level security;

revoke all on table public.tempo_garden_care_events from public, anon, authenticated;
revoke all on table public.tempo_garden_layout_items from public, anon, authenticated;
revoke all on table public.tempo_garden_keepsakes from public, anon, authenticated;

grant select, insert, update, delete on table public.tempo_garden_care_events to service_role;
grant select, insert, update, delete on table public.tempo_garden_layout_items to service_role;
grant select, insert, update, delete on table public.tempo_garden_keepsakes to service_role;

-- These policies are defense in depth if authenticated table grants are added
-- later. Browser clients currently hold no privileges on the tables.
create policy tempo_garden_care_events_select_own
on public.tempo_garden_care_events for select to authenticated
using ((select auth.uid()) = user_id);

create policy tempo_garden_care_events_insert_own
on public.tempo_garden_care_events for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy tempo_garden_care_events_update_own
on public.tempo_garden_care_events for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy tempo_garden_care_events_delete_own
on public.tempo_garden_care_events for delete to authenticated
using ((select auth.uid()) = user_id);

create policy tempo_garden_layout_items_select_own
on public.tempo_garden_layout_items for select to authenticated
using ((select auth.uid()) = user_id);

create policy tempo_garden_layout_items_insert_own
on public.tempo_garden_layout_items for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy tempo_garden_layout_items_update_own
on public.tempo_garden_layout_items for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy tempo_garden_layout_items_delete_own
on public.tempo_garden_layout_items for delete to authenticated
using ((select auth.uid()) = user_id);

create policy tempo_garden_keepsakes_select_own
on public.tempo_garden_keepsakes for select to authenticated
using ((select auth.uid()) = user_id);

create policy tempo_garden_keepsakes_insert_own
on public.tempo_garden_keepsakes for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy tempo_garden_keepsakes_update_own
on public.tempo_garden_keepsakes for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy tempo_garden_keepsakes_delete_own
on public.tempo_garden_keepsakes for delete to authenticated
using ((select auth.uid()) = user_id);

-- Cross-school adult theme rooms start closed until a staffed duty approves opening.
alter table public.peer_space_rooms
  drop constraint if exists peer_space_rooms_room_type_check;
alter table public.peer_space_rooms
  add constraint peer_space_rooms_room_type_check check (room_type in ('everyone', 'theme'));
alter table public.peer_space_rooms
  drop constraint if exists peer_space_rooms_space_id_room_type_key;
alter table public.peer_space_rooms
  add column if not exists room_code text not null default 'everyone',
  add column if not exists title_zh text not null default '大家的解忧室',
  add column if not exists title_en text not null default 'Peer Space',
  add column if not exists description_zh text not null default '一个有人值守、尊重边界的跨校空间。',
  add column if not exists description_en text not null default 'A staffed cross-school space with clear boundaries.',
  add column if not exists guidelines_zh text not null default '尊重他人，不分享联系方式；紧急时请联系现实支持。',
  add column if not exists guidelines_en text not null default 'Respect others. Do not share contact details. Seek real-world help in an emergency.';
alter table public.peer_space_rooms
  add constraint peer_space_rooms_code_check check (room_code ~ '^[a-z0-9_]{3,48}$');
create unique index if not exists peer_space_rooms_space_code_idx
on public.peer_space_rooms(space_id, room_code);

insert into public.peer_space_rooms
  (space_id, room_type, room_code, status, title_zh, title_en, description_zh, description_en, guidelines_zh, guidelines_en)
select space.id, 'theme', theme.code, 'closed', theme.title_zh, theme.title_en,
       theme.description_zh, theme.description_en,
       '尊重他人，不分享联系方式；紧急时请联系现实支持。',
       'Respect others. Do not share contact details. Seek real-world help in an emergency.'
from public.peer_spaces space
cross join (values
  ('study', '学习与压力', 'Study and pressure', '聊聊学习、工作和期待带来的压力。', 'Talk about pressure from study, work, and expectations.'),
  ('connections', '关系与陪伴', 'Connection and company', '聊聊关系中的困惑、界限和被理解的时刻。', 'Talk about relationships, boundaries, and feeling understood.')
) as theme(code, title_zh, title_en, description_zh, description_en)
where space.code = 'adult_peer_space'
on conflict (space_id, room_code) do nothing;

create table if not exists public.peer_space_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.peer_space_rooms(id) on delete restrict,
  room_membership_id uuid not null references public.peer_space_room_memberships(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 600),
  moderation_status text not null default 'visible' check (moderation_status in ('visible', 'safety_review', 'hidden', 'deleted')),
  risk_priority text not null default 'standard' check (risk_priority in ('standard', 'high', 'urgent')),
  risk_source text not null default 'deterministic' check (risk_source in ('deterministic', 'ai_assisted')),
  risk_category text not null default 'other' check (risk_category in ('crisis', 'privacy', 'harassment', 'report', 'other')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  hidden_at timestamptz,
  check ((moderation_status = 'deleted') = (deleted_at is not null))
);
create index if not exists peer_space_messages_room_created_idx
on public.peer_space_messages(room_id, created_at desc);
create index if not exists peer_space_messages_review_idx
on public.peer_space_messages(moderation_status, risk_priority, created_at)
where moderation_status = 'safety_review';

create table if not exists public.peer_space_user_controls (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.peer_space_rooms(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  target_room_membership_id uuid not null references public.peer_space_room_memberships(id) on delete cascade,
  control_type text not null check (control_type in ('block', 'mute')),
  created_at timestamptz not null default now(),
  unique (room_id, actor_user_id, target_user_id, control_type),
  check (actor_user_id <> target_user_id)
);
create index if not exists peer_space_user_controls_target_idx
on public.peer_space_user_controls(room_id, target_user_id, control_type);

create table if not exists public.peer_space_message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.peer_space_messages(id) on delete cascade,
  room_id uuid not null references public.peer_space_rooms(id) on delete restrict,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason_code text not null check (reason_code in ('privacy', 'harassment', 'safety', 'other')),
  status text not null default 'pending' check (status in ('pending', 'reviewing', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (message_id, reporter_user_id)
);

create table if not exists public.peer_space_review_cases (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.peer_space_messages(id) on delete cascade,
  room_id uuid not null references public.peer_space_rooms(id) on delete restrict,
  subject_user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('crisis', 'privacy', 'harassment', 'report', 'other')),
  priority text not null check (priority in ('standard', 'high', 'urgent')),
  status text not null default 'pending'
    check (status in ('pending', 'assigned', 'reviewing', 'action_required', 'referred', 'resolved', 'closed')),
  assigned_to uuid references auth.users(id) on delete set null,
  follow_up_required boolean not null default false,
  escalated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists peer_space_review_cases_queue_idx
on public.peer_space_review_cases(status, priority, created_at);

create table if not exists public.peer_space_review_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.peer_space_review_cases(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_ref text not null,
  actor_capability text not null check (actor_capability in ('content_moderator', 'safety_duty')),
  previous_status text,
  next_status text not null,
  note text check (note is null or char_length(note) <= 500),
  follow_up_required boolean not null default false,
  escalated boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists peer_space_review_events_case_created_idx
on public.peer_space_review_events(case_id, created_at);

create or replace function public.queue_peer_space_review_case()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.moderation_status = 'safety_review' then
    insert into public.peer_space_review_cases
      (message_id, room_id, subject_user_id, category, priority)
    values (new.id, new.room_id, new.author_user_id, new.risk_category, new.risk_priority)
    on conflict (message_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists peer_space_review_case_queue on public.peer_space_messages;
create trigger peer_space_review_case_queue
after insert or update of moderation_status on public.peer_space_messages
for each row execute function public.queue_peer_space_review_case();

create or replace function public.validate_peer_space_message_author()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.peer_space_room_memberships room_member
    join public.peer_space_memberships member on member.id = room_member.membership_id
    join public.peer_spaces space on space.id = member.space_id
    join public.peer_space_rooms room on room.id = room_member.room_id
    join public.student_consents consent on consent.student_user_id = member.user_id
    where room_member.id = new.room_membership_id
      and room_member.room_id = new.room_id
      and room_member.status = 'active'
      and room_member.visible_until is null
      and member.status = 'active'
      and member.user_id = new.author_user_id
      and space.age_scope = '18_plus'
      and space.status in ('invite_only', 'active')
      and room.status = 'staffed_open'
      and exists (
        select 1 from public.peer_space_duty_shifts shift
        where shift.room_id = room.id
          and shift.status in ('active', 'handoff_pending')
          and shift.lease_expires_at > now()
      )
      and consent.age_band = '18_plus'
      and consent.consent_basis = 'adult_self'
      and consent.status = 'active'
  ) then
    raise exception 'peer_space_message_author_not_eligible' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists peer_space_message_author_check on public.peer_space_messages;
create trigger peer_space_message_author_check
before insert on public.peer_space_messages
for each row execute function public.validate_peer_space_message_author();

alter table public.peer_space_messages enable row level security;
alter table public.peer_space_user_controls enable row level security;
alter table public.peer_space_message_reports enable row level security;
alter table public.peer_space_review_cases enable row level security;
alter table public.peer_space_review_events enable row level security;
revoke all on table public.peer_space_messages, public.peer_space_user_controls,
  public.peer_space_message_reports, public.peer_space_review_cases,
  public.peer_space_review_events from public, anon, authenticated;
grant select, insert, update on table public.peer_space_messages to service_role;
grant select, insert, delete on table public.peer_space_user_controls to service_role;
grant select, insert, update on table public.peer_space_message_reports to service_role;
grant select, insert, update on table public.peer_space_review_cases to service_role;
grant select, insert on table public.peer_space_review_events to service_role;
create policy peer_space_messages_server_only on public.peer_space_messages
  for all to service_role using (true) with check (true);
create policy peer_space_user_controls_server_only on public.peer_space_user_controls
  for all to service_role using (true) with check (true);
create policy peer_space_message_reports_server_only on public.peer_space_message_reports
  for all to service_role using (true) with check (true);
create policy peer_space_review_cases_server_only on public.peer_space_review_cases
  for all to service_role using (true) with check (true);
create policy peer_space_review_events_server_only on public.peer_space_review_events
  for all to service_role using (true) with check (true);
revoke all on function public.validate_peer_space_message_author() from public, anon, authenticated;
revoke all on function public.queue_peer_space_review_case() from public, anon, authenticated;

-- No chat table is added to the Realtime publication. Clients receive fresh
-- messages through short polling of the authenticated API, so every read checks
-- current age, invitation and room membership; old sockets receive no content.

-- Human review actions are atomic with their minimal audit event.
create or replace function public.process_peer_space_review_case(
  p_case_id uuid,
  p_actor_id uuid,
  p_next_status text,
  p_message_action text,
  p_note text,
  p_follow_up_required boolean,
  p_escalated boolean
)
returns table (review_case_id uuid, review_status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case public.peer_space_review_cases%rowtype;
  v_capability text;
  v_previous text;
begin
  if p_next_status not in ('pending', 'assigned', 'reviewing', 'action_required', 'referred', 'resolved', 'closed')
    or p_message_action not in ('none', 'hide', 'publish')
    or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid_peer_review_action' using errcode = '22023';
  end if;
  select * into v_case
  from public.peer_space_review_cases
  where id = p_case_id
  for update;
  if not found then
    raise exception 'peer_review_case_not_found' using errcode = '22023';
  end if;
  select assignment.capability into v_capability
  from public.peer_space_staff_assignments assignment
  join public.peer_space_rooms room on room.id = v_case.room_id
  where assignment.user_id = p_actor_id
    and assignment.space_id = room.space_id
    and (assignment.room_id is null or assignment.room_id = room.id)
    and assignment.status = 'active'
    and assignment.starts_at <= now()
    and (assignment.ends_at is null or assignment.ends_at > now())
    and assignment.capability in ('content_moderator', 'safety_duty')
    and (
      (v_case.category <> 'crisis' and v_case.priority <> 'urgent')
      or assignment.capability = 'safety_duty'
    )
  order by case when assignment.capability = 'content_moderator' then 0 else 1 end
  limit 1;
  if v_capability is null then
    raise exception 'peer_review_capability_required' using errcode = '42501';
  end if;
  if p_message_action = 'publish'
    and (v_case.category = 'crisis' or v_case.priority = 'urgent'
      or p_next_status not in ('resolved', 'closed')) then
    raise exception 'unsafe_peer_review_publish' using errcode = '42501';
  end if;
  if p_message_action = 'hide' then
    update public.peer_space_messages
    set moderation_status = 'hidden', hidden_at = now()
    where id = v_case.message_id and moderation_status <> 'deleted';
  elsif p_message_action = 'publish' then
    update public.peer_space_messages
    set moderation_status = 'visible', hidden_at = null
    where id = v_case.message_id and moderation_status <> 'deleted';
  end if;
  v_previous := v_case.status;
  update public.peer_space_review_cases
  set status = p_next_status,
      assigned_to = case when p_next_status in ('assigned', 'reviewing') then p_actor_id else assigned_to end,
      follow_up_required = p_follow_up_required,
      escalated = p_escalated,
      updated_at = now(),
      closed_at = case when p_next_status = 'closed' then now() else null end
  where id = p_case_id;
  insert into public.peer_space_review_events (
    case_id, actor_user_id, actor_ref, actor_capability, previous_status, next_status,
    note, follow_up_required, escalated
  ) values (
    p_case_id, p_actor_id, encode(sha256(convert_to(p_actor_id::text, 'UTF8')), 'hex'),
    v_capability, v_previous, p_next_status, nullif(trim(p_note), ''),
    p_follow_up_required, p_escalated
  );
  return query select p_case_id, p_next_status;
end;
$$;
revoke all on function public.process_peer_space_review_case(
  uuid, uuid, text, text, text, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.process_peer_space_review_case(
  uuid, uuid, text, text, text, boolean, boolean
) to service_role;

-- A private, optional prompt record. Both dismissal and submission start the
-- seven-day cooldown; the server decides age band and feature context.
create table public.pilot_experience_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  age_band text not null check (age_band in ('14_17', '18_plus')),
  feature text not null check (feature in ('quick_check_in', 'sweet', 'peer_space', 'support', 'mood_journal', 'worry_time')),
  outcome text not null check (outcome in ('dismissed', 'submitted')),
  helpful boolean,
  would_return boolean,
  wants_human_support boolean,
  comment text check (comment is null or char_length(comment) <= 500),
  safety_review boolean not null default false,
  review_status text not null default 'pending' check (review_status in ('pending', 'reviewed')),
  created_at timestamptz not null default now(),
  check (
    (outcome = 'dismissed' and helpful is null and would_return is null
      and wants_human_support is null and comment is null and safety_review = false)
    or outcome = 'submitted'
  )
);
create index pilot_experience_feedback_user_created_idx
  on public.pilot_experience_feedback(user_id, created_at desc);
create index pilot_experience_feedback_review_idx
  on public.pilot_experience_feedback(safety_review, review_status, created_at desc);

create or replace function public.enforce_pilot_experience_cooldown()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 20260919));
  if exists (
    select 1 from public.pilot_experience_feedback previous
    where previous.user_id = new.user_id
      and previous.created_at > now() - interval '7 days'
  ) then
    raise exception 'pilot_feedback_cooldown' using errcode = '23505';
  end if;
  return new;
end;
$$;
create trigger pilot_experience_cooldown before insert
  on public.pilot_experience_feedback
  for each row execute function public.enforce_pilot_experience_cooldown();

alter table public.pilot_experience_feedback enable row level security;
revoke all on public.pilot_experience_feedback from public, anon, authenticated;
grant select, insert, update on public.pilot_experience_feedback to service_role;
create policy pilot_experience_feedback_server_only
  on public.pilot_experience_feedback for all to service_role
  using (true) with check (true);
revoke all on function public.enforce_pilot_experience_cooldown() from public, anon, authenticated;

-- Internal-only support workflow. Public consultation stays disabled by default
-- in server configuration. These tables grant no browser Data API access.
create table public.support_staff_applications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  category text not null check (category in ('counselor', 'social_worker', 'listening_volunteer', 'school_duty_teacher')),
  status text not null default 'pending' check (status in ('pending', 'trial', 'approved', 'paused', 'removed', 'rejected')),
  legal_name text not null check (char_length(legal_name) between 2 and 120),
  credential_type text check (credential_type is null or char_length(credential_type) <= 120),
  credential_number text check (credential_number is null or char_length(credential_number) <= 120),
  evidence_path text check (evidence_path is null or char_length(evidence_path) <= 300),
  service_languages text[] not null default array['zh-CN']::text[],
  age_scopes text[] not null default array['18_plus']::text[],
  service_scope text not null check (char_length(service_scope) between 1 and 500),
  availability text not null check (char_length(availability) between 1 and 500),
  institution_name text check (institution_name is null or char_length(institution_name) <= 160),
  boundaries_confirmed boolean not null,
  crisis_rules_confirmed boolean not null,
  privacy_rules_confirmed boolean not null,
  invited_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (service_languages <@ array['zh-CN','en']::text[]),
  check (age_scopes <@ array['14_17','18_plus']::text[]),
  check (cardinality(service_languages) > 0 and cardinality(age_scopes) > 0),
  check ((boundaries_confirmed and crisis_rules_confirmed and privacy_rules_confirmed)
    or (category = 'school_duty_teacher' and status = 'pending')),
  check (category <> 'school_duty_teacher' or age_scopes = array['14_17']::text[])
);
create index support_staff_applications_status_idx on public.support_staff_applications(status, category);

create or replace function public.validate_support_staff_invitation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.category = 'school_duty_teacher' and new.invited_by is null then
    raise exception 'school_duty_invitation_required' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger support_staff_invitation_check before insert
on public.support_staff_applications for each row
execute function public.validate_support_staff_invitation();

create table public.support_staff_events (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_ref text not null,
  previous_status text,
  next_status text not null,
  action text not null check (action in ('applied', 'invited', 'reviewed', 'paused', 'resumed', 'removed')),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index support_staff_events_user_created_idx on public.support_staff_events(staff_user_id, created_at);

create or replace function public.audit_support_staff_status()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_actor uuid;
  v_action text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  v_actor := coalesce(new.reviewed_by, new.invited_by, new.user_id);
  v_action := case
    when tg_op = 'INSERT' and new.invited_by is not null then 'invited'
    when tg_op = 'INSERT' then 'applied'
    when new.status = 'paused' then 'paused'
    when new.status = 'removed' then 'removed'
    when old.status = 'paused' and new.status = 'approved' then 'resumed'
    else 'reviewed'
  end;
  insert into public.support_staff_events
    (staff_user_id, actor_user_id, actor_ref, previous_status, next_status, action, note)
  values
    (new.user_id, v_actor, encode(sha256(convert_to(v_actor::text, 'UTF8')), 'hex'),
      case when tg_op = 'INSERT' then null else old.status end,
      new.status, v_action, new.review_note);
  return new;
end;
$$;
create trigger support_staff_status_audit after insert or update of status
on public.support_staff_applications for each row
execute function public.audit_support_staff_status();

create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  row_revision uuid not null default gen_random_uuid(),
  student_user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  case_type text not null check (case_type in ('youth_request', 'adult_consultation')),
  risk_priority text not null default 'standard' check (risk_priority in ('standard', 'urgent')),
  status text not null default 'requested'
    check (status in ('requested', 'triage', 'awaiting_assignment', 'assigned', 'active', 'paused', 'transfer_requested', 'transferred', 'referred', 'closed', 'cancelled')),
  need_summary text not null check (char_length(need_summary) between 1 and 1000),
  availability text check (availability is null or char_length(availability) <= 500),
  appointment_at timestamptz,
  appointment_status text not null default 'none'
    check (appointment_status in ('none', 'proposed', 'accepted', 'reschedule_requested', 'cancelled')),
  referral_type text check (referral_type is null or referral_type in ('school', 'social_work', 'medical', 'professional', 'community')),
  student_authorization_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create or replace function public.stamp_support_case_revision()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  new.row_revision := pg_catalog.gen_random_uuid();
  if tg_op = 'UPDATE' then
    while new.row_revision = old.row_revision loop
      new.row_revision := pg_catalog.gen_random_uuid();
    end loop;
  end if;
  return new;
end;
$$;
create trigger support_case_revision_stamp before insert or update on public.support_cases
for each row execute function public.stamp_support_case_revision();
revoke all on function public.stamp_support_case_revision() from public, anon, authenticated;
grant execute on function public.stamp_support_case_revision() to service_role;

create index support_cases_student_created_idx on public.support_cases(student_user_id, created_at desc);
create index support_cases_queue_idx on public.support_cases(status, case_type, created_at);

create table public.support_case_assignments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  assignment_role text not null check (assignment_role in ('primary', 'backup')),
  status text not null default 'offered' check (status in ('offered', 'accepted', 'rejected', 'revoked')),
  offered_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  offered_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  unique (case_id, staff_user_id, assignment_role)
);
create unique index support_case_assignments_one_primary_idx on public.support_case_assignments(case_id)
where assignment_role = 'primary' and status in ('offered', 'accepted');
create unique index support_case_assignments_one_backup_idx on public.support_case_assignments(case_id)
where assignment_role = 'backup' and status in ('offered', 'accepted');
create index support_case_assignments_staff_idx on public.support_case_assignments(staff_user_id, status);

create table public.support_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_ref text not null,
  actor_role text not null check (actor_role in ('student', 'admin', 'staff')),
  action text not null check (char_length(action) between 1 and 80),
  previous_status text,
  next_status text,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index support_case_events_case_created_idx on public.support_case_events(case_id, created_at);

create or replace function public.audit_support_case_creation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  insert into public.support_case_events
    (case_id, actor_user_id, actor_ref, actor_role, action, next_status)
  values
    (new.id, new.student_user_id,
      encode(sha256(convert_to(new.student_user_id::text, 'UTF8')), 'hex'),
      'student', 'requested', new.status);
  return new;
end;
$$;
create trigger support_case_creation_audit after insert on public.support_cases
for each row execute function public.audit_support_case_creation();

create or replace function public.audit_support_case_assignment()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_actor uuid;
  v_previous_case_status text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  v_actor := case when tg_op = 'INSERT' then new.offered_by else new.updated_by end;
  if v_actor is null then
    raise exception 'support_assignment_actor_required' using errcode = '22023';
  end if;
  insert into public.support_case_events
    (case_id, actor_user_id, actor_ref, actor_role, action, previous_status, next_status)
  values (new.case_id, v_actor, encode(sha256(convert_to(v_actor::text, 'UTF8')), 'hex'),
    case when tg_op = 'INSERT' or new.status = 'revoked' then 'admin' else 'staff' end,
    'assignment_' || new.assignment_role || '_' || new.status,
    case when tg_op = 'INSERT' then null else old.status end, new.status);
  if tg_op = 'UPDATE' and new.assignment_role = 'primary' and new.status = 'accepted' then
    select status into v_previous_case_status from public.support_cases
    where id = new.case_id for update;
    update public.support_cases
    set status = 'assigned', updated_at = now()
    where id = new.case_id and status in ('awaiting_assignment', 'transfer_requested', 'transferred', 'triage', 'requested');
    if not found then
      raise exception 'support_case_not_ready_for_acceptance' using errcode = '42501';
    end if;
    insert into public.support_case_events
      (case_id, actor_user_id, actor_ref, actor_role, action, previous_status, next_status)
    values (new.case_id, v_actor, encode(sha256(convert_to(v_actor::text, 'UTF8')), 'hex'),
      'staff', 'primary_offer_accepted', v_previous_case_status, 'assigned');
  end if;
  return new;
end;
$$;
create trigger support_case_assignment_audit after insert or update of status
on public.support_case_assignments for each row
execute function public.audit_support_case_assignment();

create or replace function public.transition_support_case(
  p_case_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_action text,
  p_next_status text,
  p_expected_status text,
  p_note text,
  p_appointment_at timestamptz,
  p_appointment_status text,
  p_referral_type text,
  p_authorization_active boolean
)
returns table (case_id uuid, case_status text)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_case public.support_cases%rowtype;
begin
  if p_actor_role not in ('student', 'admin', 'staff')
    or char_length(coalesce(p_action, '')) not between 1 and 80
    or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid_support_transition' using errcode = '22023';
  end if;
  select * into v_case from public.support_cases where id = p_case_id for update;
  if not found then raise exception 'support_case_not_found' using errcode = '22023'; end if;
  if v_case.status <> p_expected_status
    or (p_actor_role = 'student' and v_case.student_user_id <> p_actor_id)
    or (not v_case.student_authorization_active and p_authorization_active) then
    raise exception 'support_case_state_changed' using errcode = '42501';
  end if;
  -- Student-only eligibility split; existing transitions and audit stay below.
  if p_actor_role = 'student' then
    if p_action in ('cancel', 'withdraw_authorization', 'close', 'cancel_appointment') then
      raise exception 'support_termination_requires_conditional_rpc' using errcode = '42501';
    end if;
    if v_case.student_user_id is distinct from p_actor_id
      or p_expected_status is distinct from v_case.status
      or not exists (
        select 1 from public.profiles profile
        where profile.id = p_actor_id and profile.role = '学生'
      )
      or v_case.case_type not in ('youth_request', 'adult_consultation') then
      raise exception 'support_case_student_not_eligible' using errcode = '42501';
    end if;
    if p_action not in ('cancel', 'withdraw_authorization', 'close', 'cancel_appointment')
      and (v_case.student_authorization_active is not true
        or not exists (
        select 1 from public.student_consents consent
        where consent.student_user_id = p_actor_id
          and consent.status = 'active'
          and consent.policy_version = '2026-08-28'
          and consent.student_assented_at is not null
          and (
            (v_case.case_type = 'adult_consultation' and consent.age_band = '18_plus'
              and consent.consent_basis = 'adult_self')
            or (v_case.case_type = 'youth_request' and consent.age_band = '14_17'
              and (consent.consent_basis = 'student_self_pilot'
                or (consent.consent_basis = 'student_guardian'
                  and consent.guardian_user_id is not null
                  and consent.guardian_consented_at is not null)))
          )
      )) then
      raise exception 'support_case_student_consent_required' using errcode = '42501';
    end if;
  end if;
  if p_actor_role = 'student'
    and not (
      (p_action = 'cancel' and v_case.status in ('requested', 'triage', 'awaiting_assignment', 'assigned') and p_next_status = 'cancelled')
      or (p_action = 'accept_assignment' and v_case.status = 'assigned' and p_next_status = 'active'
        and exists (
          select 1 from public.support_case_assignments assignment
          join public.support_staff_applications staff on staff.user_id = assignment.staff_user_id
          where assignment.case_id = p_case_id
            and assignment.assignment_role = 'primary'
            and assignment.status = 'accepted'
            and staff.status = 'approved'
        ))
      or (p_action in ('reject_assignment', 'request_change')
        and ((v_case.status = 'assigned' and p_action = 'reject_assignment')
          or (v_case.status = 'active' and p_action = 'request_change'))
        and p_next_status = 'transfer_requested')
      or (p_action = 'withdraw_authorization' and v_case.status in ('active', 'paused', 'transfer_requested')
        and p_next_status = 'paused' and not p_authorization_active)
      or (p_action = 'close' and v_case.status in ('active', 'paused', 'transfer_requested', 'transferred', 'referred')
        and p_next_status = 'closed' and not p_authorization_active)
      or (p_action in ('accept_appointment', 'request_reschedule', 'cancel_appointment')
        and v_case.status = 'active' and p_next_status = 'active')
    ) then
    raise exception 'support_case_student_action_invalid' using errcode = '42501';
  end if;
  update public.support_cases
  set status = p_next_status,
      appointment_at = p_appointment_at,
      appointment_status = p_appointment_status,
      referral_type = p_referral_type,
      student_authorization_active = p_authorization_active,
      updated_at = now(),
      closed_at = case when p_next_status in ('closed', 'cancelled') then now() else null end
  where id = p_case_id;
  insert into public.support_case_events
    (case_id, actor_user_id, actor_ref, actor_role, action, previous_status, next_status, note)
  values (p_case_id, p_actor_id, encode(sha256(convert_to(p_actor_id::text, 'UTF8')), 'hex'),
    p_actor_role, p_action, v_case.status, p_next_status, nullif(trim(p_note), ''));
  return query select p_case_id, p_next_status;
end;
$$;

create table public.support_case_feedback (
  case_id uuid primary key references public.support_cases(id) on delete cascade,
  student_user_id uuid not null references auth.users(id) on delete cascade,
  felt_heard boolean,
  found_help boolean,
  boundaries_respected boolean,
  would_choose_again boolean,
  complaint boolean not null default false,
  safety_review boolean not null default false,
  comment text check (comment is null or char_length(comment) <= 500),
  review_status text not null default 'pending' check (review_status in ('pending', 'reviewed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  created_at timestamptz not null default now()
);

create table public.support_case_feedback_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_case_feedback(case_id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_ref text not null,
  action text not null check (action in ('reviewed')),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create table public.support_staff_training_records (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  training_title text not null check (char_length(training_title) between 1 and 160),
  completed_at timestamptz not null,
  verified_by uuid references auth.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index support_staff_training_user_idx on public.support_staff_training_records(staff_user_id, completed_at desc);

create or replace function public.terminate_support_case(
  p_case_id uuid, p_actor_id uuid, p_action text,
  p_expected_status text, p_expected_revision uuid
)
returns table (
  case_id uuid, case_action text, case_status text,
  appointment_at timestamptz, appointment_status text, referral_type text,
  student_authorization_active boolean, matched_revision uuid, row_revision uuid
)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_case public.support_cases%rowtype;
  v_after public.support_cases%rowtype;
  v_next text;
begin
  if p_case_id is null or p_actor_id is null or p_action is null
    or p_action not in ('cancel', 'withdraw_authorization', 'close', 'cancel_appointment')
    or p_expected_status is null
    or (p_action = 'cancel_appointment' and p_expected_revision is null)
    or (p_action <> 'cancel_appointment' and p_expected_revision is not null) then
    raise exception 'invalid_support_termination' using errcode = '22023';
  end if;
  select c.* into v_case from public.support_cases c where c.id = p_case_id for update;
  if not found then raise exception 'support_case_not_accessible' using errcode = '42501'; end if;
  if v_case.student_user_id is distinct from p_actor_id
    or v_case.case_type not in ('youth_request', 'adult_consultation')
    or not exists (select 1 from public.profiles profile where profile.id = p_actor_id and profile.role = '学生') then
    raise exception 'support_case_not_accessible' using errcode = '42501';
  end if;
  if v_case.status is distinct from p_expected_status then
    raise exception 'support_case_state_changed' using errcode = '40001';
  end if;
  if p_action = 'cancel' and v_case.status in ('requested', 'triage', 'awaiting_assignment', 'assigned') then
    v_next := 'cancelled';
  elsif p_action = 'withdraw_authorization' and v_case.status in ('active', 'paused', 'transfer_requested') then
    v_next := 'paused';
  elsif p_action = 'close' and v_case.status in ('active', 'paused', 'transfer_requested', 'transferred', 'referred') then
    v_next := 'closed';
  elsif p_action = 'cancel_appointment' and v_case.status = 'active'
    and v_case.appointment_status in ('proposed', 'accepted')
    and v_case.row_revision = p_expected_revision then
    v_next := 'active';
  else
    raise exception 'support_case_termination_conflict' using errcode = '40001';
  end if;
  if p_action = 'cancel_appointment' then
    update public.support_cases as c
    set appointment_status = 'cancelled', updated_at = now()
    where c.id = p_case_id returning c.* into v_after;
  else
    update public.support_cases as c
    set status = v_next, student_authorization_active = false, updated_at = now(),
      closed_at = case when v_next in ('closed', 'cancelled') then now() else null end
    where c.id = p_case_id returning c.* into v_after;
  end if;
  insert into public.support_case_events
    (case_id, actor_user_id, actor_ref, actor_role, action, previous_status, next_status, note)
  values (p_case_id, p_actor_id, encode(sha256(convert_to(p_actor_id::text, 'UTF8')), 'hex'),
    'student', p_action, v_case.status, v_after.status, null);
  return query select v_after.id, p_action, v_after.status, v_after.appointment_at,
    v_after.appointment_status, v_after.referral_type, v_after.student_authorization_active,
    v_case.row_revision, v_after.row_revision;
end;
$$;
revoke all on function public.terminate_support_case(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.terminate_support_case(uuid, uuid, text, text, uuid) to service_role;

create or replace function public.review_support_case_feedback(
  p_case_id uuid, p_actor_id uuid, p_note text
)
returns boolean language plpgsql security invoker set search_path = ''
as $$
begin
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid_feedback_review_note' using errcode = '22023';
  end if;
  update public.support_case_feedback
  set review_status = 'reviewed', reviewed_by = p_actor_id,
      reviewed_at = now(), review_note = nullif(trim(p_note), '')
  where case_id = p_case_id and review_status = 'pending';
  if not found then return false; end if;
  insert into public.support_case_feedback_events
    (case_id, actor_user_id, actor_ref, action, note)
  values (p_case_id, p_actor_id,
    encode(sha256(convert_to(p_actor_id::text, 'UTF8')), 'hex'),
    'reviewed', nullif(trim(p_note), ''));
  return true;
end;
$$;

create or replace function public.validate_support_case()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_role text;
  v_school uuid;
  v_age text;
  v_basis text;
  v_status text;
  v_policy text;
  v_assented timestamptz;
begin
  select role, school_id into v_role, v_school
  from public.profiles where id = new.student_user_id;
  select age_band, consent_basis, status, policy_version, student_assented_at
  into v_age, v_basis, v_status, v_policy, v_assented
  from public.student_consents where student_user_id = new.student_user_id;
  if v_role <> '学生' or v_status <> 'active'
    or v_policy <> '2026-08-28' or v_assented is null
    or (new.case_type = 'adult_consultation' and (v_age <> '18_plus' or v_basis <> 'adult_self'))
    or (new.case_type = 'youth_request' and v_age <> '14_17') then
    raise exception 'support_case_student_not_eligible' using errcode = '42501';
  end if;
  new.school_id := v_school;
  return new;
end;
$$;
create trigger support_case_student_check before insert on public.support_cases
for each row execute function public.validate_support_case();

create or replace function public.validate_support_case_assignment()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_case public.support_cases%rowtype;
  v_category text;
begin
  select * into v_case from public.support_cases where id = new.case_id;
  select category into v_category from public.support_staff_applications
  where user_id = new.staff_user_id and status = 'approved'
    and (
      (v_case.case_type = 'adult_consultation' and '18_plus' = any(age_scopes))
      or (v_case.case_type = 'youth_request' and '14_17' = any(age_scopes))
    );
  if v_category is null
    or v_case.status in ('closed', 'cancelled', 'referred')
    or (v_case.case_type = 'adult_consultation' and v_category <> 'counselor')
    or (v_category = 'school_duty_teacher' and not exists (
      select 1 from public.teacher_student_assignments assignment
      where assignment.teacher_user_id = new.staff_user_id
        and assignment.student_user_id = v_case.student_user_id
        and assignment.school_id = v_case.school_id
        and assignment.status = 'active'
    )) then
    raise exception 'support_staff_not_eligible' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger support_case_assignment_check before insert
on public.support_case_assignments for each row
execute function public.validate_support_case_assignment();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-staff-evidence', 'support-staff-evidence', false, 5242880,
  array['application/pdf','image/jpeg','image/png']::text[])
on conflict (id) do nothing;

alter table public.support_staff_applications enable row level security;
alter table public.support_staff_events enable row level security;
alter table public.support_cases enable row level security;
alter table public.support_case_assignments enable row level security;
alter table public.support_case_events enable row level security;
alter table public.support_case_feedback enable row level security;
alter table public.support_case_feedback_events enable row level security;
alter table public.support_staff_training_records enable row level security;
revoke all on public.support_staff_applications, public.support_staff_events,
  public.support_cases, public.support_case_assignments,
  public.support_case_events, public.support_case_feedback,
  public.support_case_feedback_events, public.support_staff_training_records
  from public, anon, authenticated;
grant select, insert, update on public.support_staff_applications to service_role;
grant select, insert on public.support_staff_events to service_role;
grant select, insert, update on public.support_cases to service_role;
grant select, insert, update on public.support_case_assignments to service_role;
grant select, insert on public.support_case_events to service_role;
grant select, insert, update on public.support_case_feedback to service_role;
grant select, insert on public.support_case_feedback_events to service_role;
grant select, insert on public.support_staff_training_records to service_role;
create policy support_staff_applications_server_only on public.support_staff_applications
  for all to service_role using (true) with check (true);
create policy support_staff_events_server_only on public.support_staff_events
  for all to service_role using (true) with check (true);
create policy support_cases_server_only on public.support_cases
  for all to service_role using (true) with check (true);
create policy support_case_assignments_server_only on public.support_case_assignments
  for all to service_role using (true) with check (true);
create policy support_case_events_server_only on public.support_case_events
  for all to service_role using (true) with check (true);
create policy support_case_feedback_server_only on public.support_case_feedback
  for all to service_role using (true) with check (true);
create policy support_case_feedback_events_server_only on public.support_case_feedback_events
  for all to service_role using (true) with check (true);
create policy support_staff_training_records_server_only on public.support_staff_training_records
  for all to service_role using (true) with check (true);
revoke all on function public.validate_support_case() from public, anon, authenticated;
revoke all on function public.validate_support_case_assignment() from public, anon, authenticated;
revoke all on function public.audit_support_staff_status() from public, anon, authenticated;
revoke all on function public.validate_support_staff_invitation() from public, anon, authenticated;
revoke all on function public.audit_support_case_assignment() from public, anon, authenticated;
revoke all on function public.audit_support_case_creation() from public, anon, authenticated;
revoke all on function public.transition_support_case(
  uuid, uuid, text, text, text, text, text, timestamptz, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.transition_support_case(
  uuid, uuid, text, text, text, text, text, timestamptz, text, text, boolean
) to service_role;
revoke all on function public.review_support_case_feedback(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.review_support_case_feedback(uuid, uuid, text)
  to service_role;

-- Explicit core-table grants keep fresh installs independent of project-level
-- default privileges. Existing row policies still decide each user's access.
grant select, insert, update, delete on
  public.admin_roles,
  public.guardian_student_links,
  public.profiles,
  public.school_followups,
  public.school_invites,
  public.school_members,
  public.schools,
  public.student_consent_events,
  public.student_consents,
  public.student_message_duty_actions,
  public.student_messages,
  public.sweet_records,
  public.teacher_student_assignments,
  public.user_permissions,
  public.wechat_bind_sessions,
  public.wechat_identities
to service_role;

grant select on
  public.admin_roles,
  public.profiles,
  public.school_invites,
  public.school_members,
  public.schools,
  public.teacher_student_assignments,
  public.wechat_bind_sessions,
  public.wechat_identities
to authenticated;
grant select, insert, delete on public.sweet_records to authenticated;
grant select, insert, update on public.user_permissions to authenticated;

-- Local report access foundation. Applying this migration to a remote project
-- requires a separate production approval. This does not enable report routes
-- or reopen guardian account/link creation.

create table public.minor_eligibility_assertions (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  verified_by uuid references auth.users(id) on delete set null,
  verification_basis text not null check (verification_basis = 'school_verified'),
  source_reference text not null check (source_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  verified_at timestamptz not null default clock_timestamp(),
  valid_until timestamptz not null,
  revoked_at timestamptz,
  check (isfinite(verified_at) and isfinite(valid_until) and valid_until > verified_at)
);

create table public.report_authorizations (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('teacher','guardian')),
  relationship_id uuid not null,
  school_id uuid not null references public.schools(id) on delete cascade,
  minor_assertion_id uuid references public.minor_eligibility_assertions(id) on delete set null,
  dimensions text[] not null check (cardinality(dimensions) between 1 and 5 and array_position(dimensions,null) is null
    and dimensions <@ array['sleep','wake','eat','exercise','task']::text[]),
  purpose text not null default 'rhythm_context' check (purpose = 'rhythm_context'),
  policy_version text not null check (policy_version = 'reports-2026-10-27'),
  consent_snapshot jsonb not null check (jsonb_typeof(consent_snapshot) = 'object'),
  effective_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','revoked','invalidated')),
  revoked_at timestamptz,
  invalidated_at timestamptz,
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(student_user_id,request_id),
  check (student_user_id <> recipient_user_id),
  check (isfinite(effective_at) and isfinite(expires_at) and expires_at > effective_at
    and expires_at <= effective_at + interval '2592000 seconds'),
  check ((status = 'active' and revoked_at is null and invalidated_at is null)
    or (status = 'revoked' and revoked_at is not null)
    or (status = 'invalidated' and invalidated_at is not null))
);

create table public.report_authorization_events (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid references public.report_authorizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('authorized','revoked','invalidated')),
  policy_version text not null default 'reports-2026-10-27' check (policy_version = 'reports-2026-10-27'),
  created_at timestamptz not null default clock_timestamp()
);

create table public.report_access_audit (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid references public.report_authorizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  outcome text not null check (outcome in ('waiting','ready','denied')),
  summary_version text not null check (summary_version = 'sweet-period-report-v1'),
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check ((period_start is null and period_end is null) or
    (period_start is not null and period_end is not null and period_end > period_start))
);

alter table public.minor_eligibility_assertions enable row level security;
alter table public.report_authorizations enable row level security;
alter table public.report_authorization_events enable row level security;
alter table public.report_access_audit enable row level security;
revoke all on table public.minor_eligibility_assertions,public.report_authorizations,
  public.report_authorization_events,public.report_access_audit from public,anon,authenticated,service_role;
grant select,insert,update on public.minor_eligibility_assertions,public.report_authorizations to service_role;
grant select,insert on public.report_authorization_events,public.report_access_audit to service_role;

create index report_minor_student_idx on public.minor_eligibility_assertions(student_user_id,verified_at desc);
create index report_minor_school_idx on public.minor_eligibility_assertions(school_id);
create index report_minor_verifier_idx on public.minor_eligibility_assertions(verified_by);
create index report_auth_recipient_idx on public.report_authorizations(recipient_user_id,status);
create index report_auth_student_idx on public.report_authorizations(student_user_id,status);
create index report_auth_school_idx on public.report_authorizations(school_id,status);
create index report_auth_relationship_idx on public.report_authorizations(relationship_id,status);
create index report_auth_minor_idx on public.report_authorizations(minor_assertion_id);
create index report_events_authorization_idx on public.report_authorization_events(authorization_id,created_at);
create index report_events_actor_idx on public.report_authorization_events(actor_user_id);
create index report_audit_authorization_idx on public.report_access_audit(authorization_id,created_at);
create index report_audit_actor_idx on public.report_access_audit(actor_user_id);

-- One transaction mutex deliberately serializes report reads with mutations of
-- their dependencies. The pilot trades throughput for a verifiable order. The
-- BEFORE STATEMENT trigger obtains it before row locks; a READ COMMITTED RPC
-- takes a fresh snapshot after obtaining it. Failures/timeouts never return data.
create function public.report_dependency_write_lock()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(73190428,20261027);
  return null;
end;
$$;
revoke all on function public.report_dependency_write_lock() from public,anon,authenticated,service_role;

do $$
declare t text;
begin
  foreach t in array array['profiles','schools','school_members','teacher_student_assignments',
    'guardian_student_links','student_consents','admin_roles','sweet_records','minor_eligibility_assertions','report_authorizations'] loop
    execute format('create trigger report_dependency_write_lock before insert or update or delete on public.%I for each statement execute function public.report_dependency_write_lock()',t);
  end loop;
end;
$$;
create trigger report_dependency_write_lock before insert or update or delete on auth.users
  for each statement execute function public.report_dependency_write_lock();

-- Internal maintenance only: GoTrue deletes as supabase_auth_admin, which must
-- not receive report-table privileges. Fixed search_path, no arguments, no direct
-- EXECUTE grant, and OLD-row predicates limit this definer to terminal invalidation
-- and minimal events during genuine dependency mutations (including cascades).
create function public.invalidate_dependent_report_authorizations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_kind text := tg_table_name; v_old jsonb := to_jsonb(old); v_new jsonb := case when tg_op='UPDATE' then to_jsonb(new) else null end;
begin
  if tg_op = 'UPDATE' then
    if v_kind = 'profiles' and jsonb_build_array(v_new->'school_id',v_new->'role') = jsonb_build_array(v_old->'school_id',v_old->'role') then return new; end if;
    if v_kind = 'schools' and v_new->'status' = v_old->'status' then return new; end if;
    if v_kind = 'school_members' and jsonb_build_array(v_new->'school_id',v_new->'user_id',v_new->'member_role',v_new->'status') = jsonb_build_array(v_old->'school_id',v_old->'user_id',v_old->'member_role',v_old->'status') then return new; end if;
    if v_kind = 'teacher_student_assignments' and jsonb_build_array(v_new->'school_id',v_new->'teacher_user_id',v_new->'student_user_id',v_new->'status') = jsonb_build_array(v_old->'school_id',v_old->'teacher_user_id',v_old->'student_user_id',v_old->'status') then return new; end if;
    if v_kind = 'guardian_student_links' and jsonb_build_array(v_new->'school_id',v_new->'guardian_user_id',v_new->'student_user_id',v_new->'status',v_new->'confirmed_by') = jsonb_build_array(v_old->'school_id',v_old->'guardian_user_id',v_old->'student_user_id',v_old->'status',v_old->'confirmed_by') then return new; end if;
    if v_kind = 'minor_eligibility_assertions' and jsonb_build_array(v_new->'student_user_id',v_new->'school_id',v_new->'verified_at',v_new->'valid_until',v_new->'revoked_at') = jsonb_build_array(v_old->'student_user_id',v_old->'school_id',v_old->'verified_at',v_old->'valid_until',v_old->'revoked_at') then return new; end if;
    if v_kind = 'student_consents' and (v_new-array['created_at','updated_at']) = (v_old-array['created_at','updated_at']) then return new; end if;
  end if;
  for v_id in
    update public.report_authorizations a set status='invalidated',invalidated_at=pg_catalog.clock_timestamp()
    where a.status='active' and case v_kind
      when 'profiles' then a.student_user_id=(v_old->>'id')::uuid or a.recipient_user_id=(v_old->>'id')::uuid
        or (a.minor_assertion_id is not null and a.consent_snapshot->>'guardian_user_id'=v_old->>'id')
      when 'schools' then a.school_id=(v_old->>'id')::uuid
      when 'school_members' then a.school_id=(v_old->>'school_id')::uuid and a.recipient_user_id=(v_old->>'user_id')::uuid
      when 'teacher_student_assignments' then a.recipient_type='teacher' and a.relationship_id=(v_old->>'id')::uuid
      when 'guardian_student_links' then (a.recipient_type='guardian' and a.relationship_id=(v_old->>'id')::uuid)
        or (a.student_user_id=(v_old->>'student_user_id')::uuid and a.school_id=(v_old->>'school_id')::uuid
          and a.consent_snapshot->>'guardian_user_id'=v_old->>'guardian_user_id')
      when 'student_consents' then a.student_user_id=(v_old->>'student_user_id')::uuid
      when 'minor_eligibility_assertions' then a.minor_assertion_id=(v_old->>'id')::uuid
      else false end
    returning a.id
  loop
    insert into public.report_authorization_events(authorization_id,event_type) values(v_id,'invalidated');
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.invalidate_dependent_report_authorizations() from public,anon,authenticated,service_role;
do $$
declare t text;
begin
  foreach t in array array['profiles','schools','school_members','teacher_student_assignments',
    'guardian_student_links','student_consents','minor_eligibility_assertions'] loop
    execute format('create trigger invalidate_dependent_report_authorizations after update or delete on public.%I for each row execute function public.invalidate_dependent_report_authorizations()',t);
  end loop;
end;
$$;

create function public.enforce_report_authorization_integrity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if pg_catalog.cardinality(new.dimensions) <> (select pg_catalog.count(distinct d) from pg_catalog.unnest(new.dimensions) d) then
    raise exception 'invalid_report_scope' using errcode='22023';
  end if;
  if tg_op='UPDATE' then
    if (new.id,new.student_user_id,new.recipient_user_id,new.recipient_type,new.relationship_id,new.school_id,
        new.dimensions,new.purpose,new.policy_version,new.consent_snapshot,new.effective_at,new.expires_at,new.request_id,new.created_at)
      is distinct from
       (old.id,old.student_user_id,old.recipient_user_id,old.recipient_type,old.relationship_id,old.school_id,
        old.dimensions,old.purpose,old.policy_version,old.consent_snapshot,old.effective_at,old.expires_at,old.request_id,old.created_at)
       or (new.minor_assertion_id is distinct from old.minor_assertion_id and new.minor_assertion_id is not null)
       or (old.status <> 'active' and new.status is distinct from old.status) then
      raise exception 'immutable_report_authorization' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_report_authorization_integrity() from public,anon,authenticated,service_role;
create trigger enforce_report_authorization_integrity before insert or update on public.report_authorizations
for each row execute function public.enforce_report_authorization_integrity();

create function public.issue_report_minor_eligibility(
  p_actor_user_id uuid,p_student_user_id uuid,p_school_id uuid,
  p_verification_basis text,p_source_reference text,p_valid_until timestamptz
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_now timestamptz;
begin
  -- A pre-existing REPEATABLE READ snapshot cannot be refreshed by the mutex.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unsupported_report_transaction' using errcode='25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(73190428,20261027);
  v_now:=pg_catalog.clock_timestamp();
  if p_verification_basis is distinct from 'school_verified' or p_source_reference is null
    or p_source_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
    or p_valid_until is null or not pg_catalog.isfinite(p_valid_until) or p_valid_until <= v_now
    or not exists(select 1 from public.schools s where s.id=p_school_id and s.status='active')
    or not exists(select 1 from public.profiles p join public.student_consents c on c.student_user_id=p.id
      where p.id=p_student_user_id and p.role='学生' and p.school_id=p_school_id and c.school_id=p_school_id
      and c.age_band='14_17' and c.status='active' and c.consent_basis='student_guardian'
      and c.policy_version='reports-school-2026-10-27')
    or not (exists(select 1 from auth.users u join public.admin_roles a on lower(a.email)=lower(u.email)
      where u.id=p_actor_user_id and a.status='active') or exists(select 1 from public.school_members m
      where m.user_id=p_actor_user_id and m.school_id=p_school_id and m.member_role='school_admin' and m.status='active')) then
    raise exception 'report_access_denied' using errcode='42501';
  end if;
  -- A new trusted assertion supersedes every previous proof. Revoking the
  -- latest proof must never fall back to an older, longer assertion.
  update public.minor_eligibility_assertions set revoked_at=v_now
    where student_user_id=p_student_user_id and revoked_at is null;
  insert into public.minor_eligibility_assertions(student_user_id,school_id,verified_by,verification_basis,source_reference,verified_at,valid_until)
  values(p_student_user_id,p_school_id,p_actor_user_id,p_verification_basis,p_source_reference,v_now,p_valid_until) returning id into v_id;
  return v_id;
end;
$$;

-- The school-consent version below is a closed implementation boundary for the
-- separately reviewed school report basis; naming it here does not approve or
-- publish consent copy, nor migrate existing students to it automatically.
-- Server supplies actor only after bearer authentication. Never expose this RPC
-- to browser roles, or pass an unverified request-body actor through a server.
create function public.create_report_authorization(
  p_actor_user_id uuid,p_recipient_user_id uuid,p_recipient_type text,p_dimensions text[],p_request_id uuid,p_policy_version text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_consent public.student_consents; v_school uuid; v_relation uuid; v_proof uuid;
  v_now timestamptz; v_expiry timestamptz; v_id uuid; v_existing public.report_authorizations;
begin
  -- A pre-existing REPEATABLE READ snapshot cannot be refreshed by the mutex.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unsupported_report_transaction' using errcode='25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(73190428,20261027);
  v_now:=pg_catalog.clock_timestamp();
  if p_actor_user_id is null or p_recipient_user_id is null or p_actor_user_id=p_recipient_user_id
    or p_request_id is null or p_policy_version is distinct from 'reports-2026-10-27'
    or p_recipient_type is null or p_recipient_type not in ('teacher','guardian') or p_dimensions is null
    or pg_catalog.cardinality(p_dimensions) not between 1 and 5 or pg_catalog.array_position(p_dimensions,null) is not null
    or not p_dimensions <@ array['sleep','wake','eat','exercise','task']::text[]
    or pg_catalog.cardinality(p_dimensions) <> (select pg_catalog.count(distinct d) from pg_catalog.unnest(p_dimensions) d) then
    raise exception 'invalid_report_scope' using errcode='22023';
  end if;
  select * into v_existing from public.report_authorizations where student_user_id=p_actor_user_id and request_id=p_request_id;
  if found then
    if v_existing.recipient_user_id<>p_recipient_user_id or v_existing.recipient_type<>p_recipient_type
      or v_existing.dimensions<>p_dimensions or v_existing.policy_version<>p_policy_version then
      raise exception 'invalid_report_scope' using errcode='22023';
    end if;
    -- An idempotent retry is an acknowledgement of the original ID, never renewal.
    return v_existing.id;
  end if;
  select p.school_id into v_school from public.profiles p join public.schools s on s.id=p.school_id
    where p.id=p_actor_user_id and p.role='学生' and s.status='active';
  select * into v_consent from public.student_consents where student_user_id=p_actor_user_id;
  if v_school is null or v_consent.school_id is distinct from v_school or v_consent.status is distinct from 'active'
    or v_consent.policy_version is distinct from 'reports-school-2026-10-27'
    or v_consent.student_assented_at is null or v_consent.student_assented_at > v_now
    or v_consent.age_band not in ('14_17','18_plus')
    or (v_consent.age_band='18_plus' and v_consent.consent_basis<>'adult_self')
    or (v_consent.age_band='14_17' and (v_consent.consent_basis<>'student_guardian'
      or v_consent.guardian_user_id is null or v_consent.guardian_consented_at is null or v_consent.guardian_consented_at>v_now
      or not exists(select 1 from public.guardian_student_links g join public.profiles gp on gp.id=g.guardian_user_id
        where g.student_user_id=p_actor_user_id and g.guardian_user_id=v_consent.guardian_user_id and g.school_id=v_school
          and g.status='active' and g.confirmed_by is not null and gp.role='家长'))) then
    raise exception 'report_access_denied' using errcode='42501';
  end if;
  v_expiry:=v_now+interval '2592000 seconds';
  if v_consent.age_band='14_17' then
    select e.id,least(v_expiry,e.valid_until) into v_proof,v_expiry from public.minor_eligibility_assertions e
    where e.student_user_id=p_actor_user_id and e.school_id=v_school
    order by e.verified_at desc,e.id limit 1;
    if v_proof is null or not exists(select 1 from public.minor_eligibility_assertions e where e.id=v_proof
      and e.revoked_at is null and e.verified_at<=v_now and e.valid_until>v_now) then
      raise exception 'report_access_denied' using errcode='42501';
    end if;
  end if;
  if p_recipient_type='teacher' then
    select a.id into v_relation from public.teacher_student_assignments a
      join public.school_members m on m.user_id=a.teacher_user_id and m.school_id=a.school_id
      join public.profiles p on p.id=a.teacher_user_id
    where a.student_user_id=p_actor_user_id and a.teacher_user_id=p_recipient_user_id and a.school_id=v_school
      and a.status='active' and m.status='active' and m.member_role='school_support'
      and p.role='学校支持人员' and p.school_id=v_school;
  else
    if v_consent.age_band<>'14_17' or v_consent.guardian_user_id is distinct from p_recipient_user_id then
      raise exception 'report_access_denied' using errcode='42501';
    end if;
    select g.id into v_relation from public.guardian_student_links g join public.profiles p on p.id=g.guardian_user_id
    where g.student_user_id=p_actor_user_id and g.guardian_user_id=p_recipient_user_id and g.school_id=v_school
      and g.status='active' and g.confirmed_by is not null and p.role='家长' and p.school_id=v_school;
  end if;
  if v_relation is null then raise exception 'report_access_denied' using errcode='42501'; end if;
  -- A new explicit grant for a recipient scope terminates the previous grant.
  with ended as (update public.report_authorizations set status='invalidated',invalidated_at=v_now
    where student_user_id=p_actor_user_id and recipient_type=p_recipient_type and status='active' returning id)
  insert into public.report_authorization_events(authorization_id,actor_user_id,event_type)
    select id,p_actor_user_id,'invalidated' from ended;
  insert into public.report_authorizations(student_user_id,recipient_user_id,recipient_type,relationship_id,school_id,
    minor_assertion_id,dimensions,policy_version,consent_snapshot,effective_at,expires_at,request_id)
  values(p_actor_user_id,p_recipient_user_id,p_recipient_type,v_relation,v_school,v_proof,p_dimensions,p_policy_version,
    pg_catalog.to_jsonb(v_consent)-array['created_at','updated_at'],v_now,v_expiry,p_request_id) returning id into v_id;
  insert into public.report_authorization_events(authorization_id,actor_user_id,event_type) values(v_id,p_actor_user_id,'authorized');
  return v_id;
end;
$$;

create function public.revoke_report_authorization(p_actor_user_id uuid,p_authorization_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_auth public.report_authorizations;
begin
  -- A pre-existing REPEATABLE READ snapshot cannot be refreshed by the mutex.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unsupported_report_transaction' using errcode='25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(73190428,20261027);
  select * into v_auth from public.report_authorizations where id=p_authorization_id and student_user_id=p_actor_user_id;
  if not found then raise exception 'report_access_denied' using errcode='42501'; end if;
  if v_auth.status='active' then
    update public.report_authorizations set status='revoked',revoked_at=pg_catalog.clock_timestamp() where id=v_auth.id;
    insert into public.report_authorization_events(authorization_id,actor_user_id,event_type) values(v_auth.id,p_actor_user_id,'revoked');
  end if;
  return true;
end;
$$;

create function public.lock_report_authorization(p_actor_user_id uuid,p_authorization_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_auth public.report_authorizations; v_consent public.student_consents; v_now timestamptz; v_valid boolean;
begin
  -- A pre-existing REPEATABLE READ snapshot cannot be refreshed by the mutex.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unsupported_report_transaction' using errcode='25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(73190428,20261027);
  v_now:=pg_catalog.clock_timestamp();
  select * into v_auth from public.report_authorizations where id=p_authorization_id;
  if not found or p_actor_user_id is null or p_actor_user_id not in (v_auth.student_user_id,v_auth.recipient_user_id)
    or not exists(select 1 from auth.users u where u.id=p_actor_user_id) then return false; end if;
  if v_auth.status<>'active' or v_now>=v_auth.expires_at or v_auth.effective_at>v_now then return false; end if;
  select * into v_consent from public.student_consents where student_user_id=v_auth.student_user_id;
  v_valid:=v_consent.status='active' and v_consent.school_id=v_auth.school_id
    and v_consent.policy_version='reports-school-2026-10-27'
    and (pg_catalog.to_jsonb(v_consent)-array['created_at','updated_at'])=v_auth.consent_snapshot
    and v_consent.student_assented_at<=v_auth.effective_at
    and exists(select 1 from public.profiles p join public.schools s on s.id=p.school_id
      where p.id=v_auth.student_user_id and p.school_id=v_auth.school_id and p.role='学生' and s.status='active');
  if v_consent.age_band='14_17' then
    v_valid:=v_valid and v_consent.consent_basis='student_guardian' and v_consent.guardian_consented_at<=v_auth.effective_at
      and exists(select 1 from public.guardian_student_links g join public.profiles gp on gp.id=g.guardian_user_id
        where g.student_user_id=v_auth.student_user_id and g.guardian_user_id=v_consent.guardian_user_id
          and g.school_id=v_auth.school_id and g.status='active' and g.confirmed_by is not null and gp.role='家长')
      and exists(select 1 from public.minor_eligibility_assertions e where e.id=v_auth.minor_assertion_id
        and e.student_user_id=v_auth.student_user_id and e.school_id=v_auth.school_id and e.revoked_at is null
        and e.verified_at<=v_auth.effective_at and e.valid_until>=v_auth.expires_at and e.valid_until>v_now);
  elsif v_consent.age_band='18_plus' then
    v_valid:=v_valid and v_consent.consent_basis='adult_self' and v_auth.recipient_type='teacher';
  else v_valid:=false; end if;
  if v_auth.recipient_type='teacher' then
    v_valid:=v_valid and exists(select 1 from public.teacher_student_assignments a
      join public.school_members m on m.user_id=a.teacher_user_id and m.school_id=a.school_id
      join public.profiles p on p.id=a.teacher_user_id
      where a.id=v_auth.relationship_id and a.student_user_id=v_auth.student_user_id and a.teacher_user_id=v_auth.recipient_user_id
        and a.school_id=v_auth.school_id and a.status='active' and m.status='active' and m.member_role='school_support'
        and p.role='学校支持人员' and p.school_id=v_auth.school_id);
  else
    v_valid:=v_valid and v_consent.age_band='14_17' and v_consent.guardian_user_id=v_auth.recipient_user_id
      and exists(select 1 from public.guardian_student_links g join public.profiles p on p.id=g.guardian_user_id
      where g.id=v_auth.relationship_id and g.student_user_id=v_auth.student_user_id and g.guardian_user_id=v_auth.recipient_user_id
        and g.school_id=v_auth.school_id and g.status='active' and g.confirmed_by is not null and p.role='家长' and p.school_id=v_auth.school_id);
  end if;
  if not coalesce(v_valid,false) then
    update public.report_authorizations set status='invalidated',invalidated_at=v_now where id=v_auth.id and status='active';
    insert into public.report_authorization_events(authorization_id,event_type) values(v_auth.id,'invalidated');
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.issue_report_minor_eligibility(uuid,uuid,uuid,text,text,timestamptz),
 public.create_report_authorization(uuid,uuid,text,text[],uuid,text),
 public.revoke_report_authorization(uuid,uuid),public.lock_report_authorization(uuid,uuid) from public,anon,authenticated;
grant execute on function public.issue_report_minor_eligibility(uuid,uuid,uuid,text,text,timestamptz),
 public.create_report_authorization(uuid,uuid,text,text[],uuid,text),
 public.revoke_report_authorization(uuid,uuid),public.lock_report_authorization(uuid,uuid) to service_role;

-- Ownership remains the only ordinary Data API path for original SWEET rows.
drop policy if exists "sweet_records_select_school_members" on public.sweet_records;
drop policy if exists "sweet_records_select_authorized_grantee" on public.sweet_records;
drop policy if exists "sweet_records_select_guardian" on public.sweet_records;

-- The invoker RPC only reads the two trusted Auth identity columns needed for
-- account existence and the existing platform-admin email allowlist.
grant usage on schema auth to service_role;
grant select(id,email) on auth.users to service_role;

-- Read-only aggregation behind the separately implemented, service-only lock helper.
-- No report bodies are persisted. The helper owns every authorization decision.
create or replace function public.read_report_summary(
  p_actor_user_id uuid,
  p_authorization_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_authorization public.report_authorizations;
  v_now timestamptz;
  v_completed bigint;
  v_start timestamptz;
  v_end timestamptz;
  v_source_start timestamptz;
  v_dimensions jsonb;
  v_result jsonb;
  v_actor uuid;
  v_version constant text := 'sweet-period-report-v1';
begin
  if not public.lock_report_authorization(p_actor_user_id, p_authorization_id) then
    select u.id into v_actor from auth.users u where u.id=p_actor_user_id;
    insert into public.report_access_audit(authorization_id,actor_user_id,outcome,summary_version)
      values(null,v_actor,'denied',v_version);
    return pg_catalog.jsonb_build_object('version',v_version,'status','invalid','dimensions','[]'::jsonb);
  end if;
  select * into v_authorization from public.report_authorizations where id=p_authorization_id;
  v_now := pg_catalog.clock_timestamp();

  if v_authorization.id is null
     or not pg_catalog.isfinite(v_authorization.effective_at)
     or not pg_catalog.isfinite(v_authorization.expires_at)
     or v_authorization.expires_at <= v_authorization.effective_at
     or v_now >= v_authorization.expires_at
     or v_authorization.dimensions is null
     or pg_catalog.cardinality(v_authorization.dimensions) = 0
     or exists (
       select 1 from pg_catalog.unnest(v_authorization.dimensions) d
       where d is null or not (d = any(array['sleep','wake','eat','exercise','task']::text[]))
     )
     or pg_catalog.cardinality(v_authorization.dimensions) <> (
       select pg_catalog.count(distinct d) from pg_catalog.unnest(v_authorization.dimensions) d
     ) then
    insert into public.report_access_audit(authorization_id,actor_user_id,outcome,summary_version)
      values(v_authorization.id,p_actor_user_id,'denied',v_version);
    return pg_catalog.jsonb_build_object('version',v_version,'status','invalid','dimensions','[]'::jsonb);
  end if;

  v_completed := pg_catalog.floor(extract(epoch from (v_now - v_authorization.effective_at)) / 604800)::bigint;
  if v_completed < 1 then
    v_result := pg_catalog.jsonb_build_object('version', v_version, 'status', 'waiting', 'dimensions', '[]'::jsonb);
  else
    -- Seconds, rather than calendar-day intervals, preserve the TS 7*24h rule in any DB timezone.
    v_start := v_authorization.effective_at + ((v_completed - 1) * interval '604800 seconds');
    v_end := v_start + interval '604800 seconds';
    v_source_start := case when v_completed >= 2 then v_start - interval '604800 seconds' else v_start end;

    with
    definitions(dimension, field_id, options, ordinal) as (
      values
      ('sleep', 'quality', '{"睡得很好":"sleep_very_good","比较好":"sleep_good","一般":"sleep_neutral","不太好":"sleep_poor","很不好":"sleep_very_poor"}'::jsonb, 1),
      ('wake', 'state', '{"很有精神":"wake_very_energized","比较有精神":"wake_energized","一般":"wake_neutral","有点疲惫":"wake_tired","很疲惫":"wake_very_tired"}'::jsonb, 2),
      ('eat', 'rhythm', '{"很规律":"eat_very_regular","比较规律":"eat_regular","一般":"eat_neutral","不太规律":"eat_irregular","很不规律":"eat_very_irregular"}'::jsonb, 3),
      ('exercise', 'duration', '{"0 分钟":"exercise_none","1–9 分钟":"exercise_one_to_nine","10–19 分钟":"exercise_ten_to_nineteen","20–29 分钟":"exercise_twenty_to_twenty_nine","30 分钟以上":"exercise_over_thirty","不太确定":"exercise_unsure"}'::jsonb, 4),
      ('task', 'engagement', '{"很顺利":"task_very_smooth","比较顺利":"task_smooth","一般":"task_neutral","不太顺利":"task_difficult","很不顺利":"task_very_difficult"}'::jsonb, 5)
    ),
    source_rows as materialized (
      select r.id, r.created_at, r.records
      from public.sweet_records r
      where r.user_id = v_authorization.student_user_id
        and r.school_id = v_authorization.school_id
        and r.created_at >= v_authorization.effective_at
        and r.created_at >= v_source_start and r.created_at < v_end
      order by r.created_at, r.id
      for share of r
    ),
    matching_steps as (
      select r.id, r.created_at, d.dimension, d.field_id, d.options,
             pg_catalog.jsonb_agg(s.step)->0 as step
      from source_rows r
      cross join definitions d
      cross join lateral pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(r.records) = 'array' then r.records else '[]'::jsonb end
      ) s(step)
      where pg_catalog.jsonb_array_length(
        case when pg_catalog.jsonb_typeof(r.records) = 'array' then r.records else '[]'::jsonb end
      ) = 5
        and pg_catalog.jsonb_typeof(s.step) = 'object'
        and s.step->'id' = pg_catalog.to_jsonb(d.dimension)
      group by r.id, r.created_at, d.dimension, d.field_id, d.options
      having pg_catalog.count(*) = 1
    ),
    matching_fields as (
      select s.id, s.created_at, s.dimension, s.options,
             pg_catalog.jsonb_agg(f.field)->0 as field
      from matching_steps s
      cross join lateral pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(s.step->'fields') = 'array' then s.step->'fields' else '[]'::jsonb end
      ) f(field)
      where pg_catalog.jsonb_typeof(f.field) = 'object'
        and f.field->'id' = pg_catalog.to_jsonb(s.field_id)
      group by s.id, s.created_at, s.dimension, s.options
      having pg_catalog.count(*) = 1
    ),
    mapped_fields as (
      select id, created_at, dimension, options->>(field->>'value') as category
      from matching_fields
      where pg_catalog.jsonb_typeof(field->'value') = 'string'
        and options ? (field->>'value')
    ),
    normalized as materialized (
      select id, created_at,
             (created_at at time zone 'Asia/Shanghai')::date as shanghai_day,
             case when created_at >= v_start then 'current' else 'previous' end as side,
             pg_catalog.jsonb_object_agg(dimension, category) as answers
      from mapped_fields
      group by id, created_at
      having pg_catalog.count(*) = 5
    ),
    instant_conflicts as (
      select side, shanghai_day, created_at, pg_catalog.count(distinct answers) > 1 as conflicted
      from normalized
      group by side, shanghai_day, created_at
    ),
    conflicted_days as (
      select side, shanghai_day
      from instant_conflicts
      group by side, shanghai_day
      having pg_catalog.bool_or(conflicted)
    ),
    daily as (
      select distinct on (n.side, n.shanghai_day) n.side, n.shanghai_day, n.answers
      from normalized n
      where not exists (
        select 1 from conflicted_days c where c.side = n.side and c.shanghai_day = n.shanghai_day
      )
      order by n.side, n.shanghai_day, n.created_at desc, n.id
    ),
    category_counts as (
      select day.side, d.dimension, day.answers->>d.dimension as category, pg_catalog.count(*) as count
      from daily day
      cross join definitions d
      where d.dimension = any(v_authorization.dimensions)
      group by day.side, d.dimension, day.answers->>d.dimension
    ),
    ranked_counts as (
      select *, pg_catalog.sum(count) over (partition by side, dimension) as total,
                pg_catalog.max(count) over (partition by side, dimension) as maximum
      from category_counts
    ),
    modes as (
      select side, dimension,
             case when pg_catalog.max(total) < 3 then 'insufficient'
                  when pg_catalog.count(*) filter (where count = maximum) <> 1 then 'mixed'
                  else 'category' end as state,
             pg_catalog.max(category) filter (where count = maximum) as category
      from ranked_counts
      group by side, dimension
    )
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'id', d.dimension,
        'state', coalesce(c.state, 'insufficient'),
        'category', case when c.state = 'category' then c.category end,
        'previousCategory', case when c.state = 'category' and p.state = 'category' then p.category end,
        'comparison', case when c.state = 'category' and p.state = 'category'
                           then case when c.category = p.category then 'same' else 'different' end
                           else 'unavailable' end
      )) order by d.ordinal
    ), '[]'::jsonb) into v_dimensions
    from definitions d
    left join modes c on c.dimension = d.dimension and c.side = 'current'
    left join modes p on p.dimension = d.dimension and p.side = 'previous'
    where d.dimension = any(v_authorization.dimensions);

    v_result := pg_catalog.jsonb_build_object(
      'version', v_version,
      'status', 'ready',
      'period', pg_catalog.jsonb_build_object(
        'start', pg_catalog.to_char(v_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.') ||
                 case when mod(extract(microseconds from v_start)::bigint, 1000) = 0
                      then pg_catalog.to_char(v_start at time zone 'UTC', 'MS')
                      else pg_catalog.to_char(v_start at time zone 'UTC', 'US') end || 'Z',
        'end', pg_catalog.to_char(v_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.') ||
               case when mod(extract(microseconds from v_end)::bigint, 1000) = 0
                    then pg_catalog.to_char(v_end at time zone 'UTC', 'MS')
                    else pg_catalog.to_char(v_end at time zone 'UTC', 'US') end || 'Z'
      ),
      'dimensions', v_dimensions
    );
  end if;

  -- Recheck real time after waiting on source locks; an expired authorization never yields a report.
  if pg_catalog.clock_timestamp() >= v_authorization.expires_at then
    insert into public.report_access_audit(authorization_id,actor_user_id,outcome,summary_version)
      values(v_authorization.id,p_actor_user_id,'denied',v_version);
    return pg_catalog.jsonb_build_object('version',v_version,'status','expired','dimensions','[]'::jsonb);
  end if;
  insert into public.report_access_audit(authorization_id, actor_user_id, outcome, summary_version,period_start,period_end)
  values (v_authorization.id, p_actor_user_id, v_result->>'status', v_version,v_start,v_end);
  return v_result;
end;
$$;

revoke all on function public.read_report_summary(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_report_summary(uuid, uuid) to service_role;

-- Approved local-only comprehensive report implementation. No remote apply.
create table public.school_report_enrollments (
 id uuid primary key default gen_random_uuid(),
 student_user_id uuid not null references auth.users(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 minor_assertion_id uuid references public.minor_eligibility_assertions(id) on delete set null,
 issued_by uuid references auth.users(id) on delete set null,
 policy_version text not null default 'school-reports-2026-10-28' check(policy_version='school-reports-2026-10-28'),
 history_scope text not null default 'all_retained_history' check(history_scope='all_retained_history'),
 basis_reference text not null check(basis_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
 notice_reference text not null check(notice_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
 base_consent_snapshot jsonb not null,
 school_registered_until timestamptz not null,
 basis_valid_until timestamptz not null,
 effective_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 status text not null default 'active' check(status in('active','withdrawn','invalidated')),
 terminal_at timestamptz,
 terminal_reason text check(terminal_reason in('withdrawn','dependency','expired','replaced')),
 request_id uuid not null,
 recipient_epoch bigint not null default 0 check(recipient_epoch>=0),
 recipient_fingerprint text not null default '',
 source_revision bigint not null default 0 check(source_revision>=0),
 created_at timestamptz not null default clock_timestamp(),
 unique(student_user_id,request_id),
 check(isfinite(effective_at) and isfinite(expires_at) and isfinite(school_registered_until) and isfinite(basis_valid_until)
  and expires_at>effective_at and expires_at<=effective_at+interval '2592000 seconds'
  and expires_at<=school_registered_until and expires_at<=basis_valid_until),
 check((status='active' and terminal_at is null and terminal_reason is null)
   or(status<>'active' and terminal_at is not null and terminal_reason is not null))
);
create unique index school_report_one_active_student on public.school_report_enrollments(student_user_id) where status='active';
create index school_report_enrollment_school on public.school_report_enrollments(school_id);
create index school_report_enrollment_proof on public.school_report_enrollments(minor_assertion_id);
create index school_report_enrollment_issuer on public.school_report_enrollments(issued_by);
create index school_report_enrollment_retention on public.school_report_enrollments(expires_at,terminal_at);
create table public.school_report_detail_states (
 enrollment_id uuid primary key references public.school_report_enrollments(id) on delete cascade,
 enabled boolean not null default false,
 detail_revision bigint not null default 0 check(detail_revision>=0),
 enabled_by uuid references auth.users(id) on delete set null,
 enabled_at timestamptz,
 notice_version text not null default 'sweet-details-2026-10-28' check(notice_version='sweet-details-2026-10-28'),
 enabled_recipient_epoch bigint
);
create index school_report_detail_actor on public.school_report_detail_states(enabled_by);
create table public.school_report_sharing_events (
 id uuid primary key default gen_random_uuid(),
 enrollment_id uuid references public.school_report_enrollments(id) on delete set null,
 actor_user_id uuid references auth.users(id) on delete set null,
 event_type text not null check(event_type in('issued','withdrawn','invalidated','recipients_changed','details_on','details_off')),
 policy_version text not null default 'school-reports-2026-10-28' check(policy_version='school-reports-2026-10-28'),
 request_id uuid,
 command_fingerprint text,
 detail_revision bigint,
 recipient_epoch bigint,
 created_at timestamptz not null default clock_timestamp(),
 unique(enrollment_id,actor_user_id,request_id)
);
create index school_report_event_enrollment on public.school_report_sharing_events(enrollment_id,created_at);
create index school_report_event_actor on public.school_report_sharing_events(actor_user_id);
create index school_report_event_retention on public.school_report_sharing_events(created_at);
create table public.school_report_mode_access_audit (
 id uuid primary key default gen_random_uuid(),
 enrollment_id uuid references public.school_report_enrollments(id) on delete set null,
 actor_user_id uuid references auth.users(id) on delete set null,
 mode text not null check(mode in('trend','detail')),
 outcome text not null check(outcome in('ready','denied','expired','refresh_required')),
 source_revision bigint, recipient_epoch bigint, detail_revision bigint,
 created_at timestamptz not null default clock_timestamp()
);
create index school_report_audit_enrollment on public.school_report_mode_access_audit(enrollment_id,created_at);
create index school_report_audit_actor on public.school_report_mode_access_audit(actor_user_id);
create index school_report_audit_retention on public.school_report_mode_access_audit(created_at);
do $$ declare t text; begin
 foreach t in array array['school_report_enrollments','school_report_detail_states','school_report_sharing_events','school_report_mode_access_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select,insert,delete on table public.%I to service_role',t);
 end loop;
end $$;
grant update on public.school_report_enrollments,public.school_report_detail_states to service_role;
grant usage on schema private to service_role;
-- No client original-SWEET policy is added. The only source read is a bounded DTO RPC.
create index if not exists school_report_source_owner_time on public.sweet_records(user_id,created_at desc,id);

create function private.school_report_base_valid(p_consent public.student_consents,p_now timestamptz)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce((p_consent).status='active' and (p_consent).policy_version='2026-08-28' and (p_consent).age_band='14_17'
 and (p_consent).student_assented_at is not null and isfinite((p_consent).student_assented_at) and (p_consent).student_assented_at<=p_now
 and ((p_consent).consent_basis='student_self_pilot' or ((p_consent).consent_basis='student_guardian'
  and (p_consent).guardian_user_id is not null and (p_consent).guardian_consented_at is not null
  and isfinite((p_consent).guardian_consented_at) and (p_consent).guardian_consented_at<=p_now)),false)
$$;
create function private.school_report_guard() returns void language plpgsql security invoker set search_path='' as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'unsupported_report_transaction' using errcode='25000'; end if;
 perform pg_catalog.pg_advisory_xact_lock(73190428,20261027);
end $$;
create function private.school_report_teachers(p_student uuid,p_school uuid)
returns table(recipient_id uuid,relationship_id uuid) language sql stable security invoker set search_path='' as $$
 select a.teacher_user_id,a.id from public.teacher_student_assignments a
 join public.school_members m on m.user_id=a.teacher_user_id and m.school_id=a.school_id
 join public.profiles p on p.id=a.teacher_user_id
 where a.student_user_id=p_student and a.school_id=p_school and a.status='active'
 and m.status='active' and m.member_role='school_support' and p.role='学校支持人员' and p.school_id=p_school
$$;
create function private.school_report_terminate(p_id uuid,p_status text,p_reason text,p_actor uuid default null,p_request uuid default null)
returns void language plpgsql security invoker set search_path='' as $$
declare e public.school_report_enrollments;
begin
 select * into e from public.school_report_enrollments where id=p_id;
 if e.id is null or e.status<>'active' then return; end if;
 update public.school_report_enrollments set status=p_status,terminal_reason=p_reason,
  terminal_at=least(clock_timestamp(),expires_at) where id=p_id;
 update public.school_report_detail_states set enabled=false,detail_revision=detail_revision+1,
  enabled_by=null,enabled_at=null,enabled_recipient_epoch=null where enrollment_id=p_id;
 insert into public.school_report_sharing_events(enrollment_id,actor_user_id,event_type,request_id,detail_revision,recipient_epoch)
 select p_id,p_actor,case when p_status='withdrawn' then 'withdrawn' else 'invalidated' end,p_request,d.detail_revision,e.recipient_epoch
 from public.school_report_detail_states d where d.enrollment_id=p_id;
end $$;
create function private.school_report_reconcile(p_id uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare e public.school_report_enrollments;c public.student_consents;v_fp text;v_now timestamptz:=clock_timestamp();v_latest uuid;
begin
 select * into e from public.school_report_enrollments where id=p_id;
 if e.id is null or e.status<>'active' then return false; end if;
 if v_now>=e.expires_at then perform private.school_report_terminate(p_id,'invalidated','expired');return false;end if;
 select * into c from public.student_consents where student_user_id=e.student_user_id;
 select id into v_latest from public.minor_eligibility_assertions where student_user_id=e.student_user_id and school_id=e.school_id order by verified_at desc,id limit 1;
 if not private.school_report_base_valid(c,v_now)
 or (to_jsonb(c)-array['created_at','updated_at']) is distinct from e.base_consent_snapshot
 or not exists(select 1 from public.profiles p join public.schools s on s.id=p.school_id where p.id=e.student_user_id and p.role='学生' and p.school_id=e.school_id and s.status='active')
 or e.minor_assertion_id is distinct from v_latest
 or not exists(select 1 from public.minor_eligibility_assertions q where q.id=e.minor_assertion_id and q.revoked_at is null
   and q.student_user_id=e.student_user_id and q.school_id=e.school_id and q.verified_at<=e.effective_at and q.valid_until>=e.expires_at and q.valid_until>v_now)
 then perform private.school_report_terminate(p_id,'invalidated','dependency');return false;end if;
 select md5(coalesce(string_agg(t.recipient_id::text||':'||t.relationship_id::text,',' order by t.recipient_id,t.relationship_id),'')) into v_fp
 from private.school_report_teachers(e.student_user_id,e.school_id) t;
 if e.recipient_fingerprint is distinct from v_fp then
  update public.school_report_enrollments set recipient_fingerprint=v_fp,recipient_epoch=recipient_epoch+1 where id=p_id;
  update public.school_report_detail_states set enabled=false,detail_revision=detail_revision+1,enabled_by=null,enabled_at=null,enabled_recipient_epoch=null where enrollment_id=p_id;
  insert into public.school_report_sharing_events(enrollment_id,event_type,detail_revision,recipient_epoch)
  select p_id,'recipients_changed',d.detail_revision,n.recipient_epoch from public.school_report_detail_states d join public.school_report_enrollments n on n.id=d.enrollment_id where n.id=p_id;
 end if;
 return true;
end $$;
create function private.school_report_context(p_actor uuid,p_id uuid,p_mode text,p_as_of timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.school_report_enrollments;d public.school_report_detail_states;v_asof timestamptz:=coalesce(p_as_of,clock_timestamp());
begin
 perform private.school_report_guard();
 if p_mode is null or p_mode not in('trend','detail') or not isfinite(v_asof) or v_asof>clock_timestamp() or v_asof<clock_timestamp()-interval '5 minutes'
 then return jsonb_build_object('status','refresh_required');end if;
 if not private.school_report_reconcile(p_id) then
  select * into e from public.school_report_enrollments where id=p_id;
  return jsonb_build_object('status',case when e.expires_at<=clock_timestamp() then 'expired' else 'denied' end);
 end if;
 select * into e from public.school_report_enrollments where id=p_id;
 select * into d from public.school_report_detail_states where enrollment_id=p_id;
 if p_actor is null or not exists(select 1 from auth.users where id=p_actor)
 or (p_actor<>e.student_user_id and not exists(select 1 from private.school_report_teachers(e.student_user_id,e.school_id) t where t.recipient_id=p_actor))
 or (p_mode='detail' and p_actor<>e.student_user_id and not(d.enabled and d.enabled_recipient_epoch=e.recipient_epoch))
 then return jsonb_build_object('status','denied');end if;
 return jsonb_build_object('status','ready','context',jsonb_build_object('enrollmentId',e.id,'studentId',e.student_user_id,'actorId',p_actor,
 'asOf',private.school_report_iso(v_asof),'sourceRevision',e.source_revision,'recipientEpoch',e.recipient_epoch,
 'detailRevision',d.detail_revision,'expiresAt',private.school_report_iso(e.expires_at)),'detailsEnabled',d.enabled);
end $$;
create function private.school_report_audit(p_actor uuid,p_id uuid,p_mode text,p_result jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.school_report_mode_access_audit(enrollment_id,actor_user_id,mode,outcome,source_revision,recipient_epoch,detail_revision)
 select e.id,u.id,p_mode,coalesce(p_result->>'status','denied'),(p_result#>>'{context,sourceRevision}')::bigint,
 (p_result#>>'{context,recipientEpoch}')::bigint,(p_result#>>'{context,detailRevision}')::bigint
 from (select 1) seed left join public.school_report_enrollments e on e.id=p_id left join auth.users u on u.id=p_actor;
end $$;

create function public.issue_school_report_enrollment(p_actor_user_id uuid,p_student_user_id uuid,p_school_id uuid,
 p_basis_reference text,p_notice_reference text,p_school_registered_until timestamptz,p_basis_valid_until timestamptz,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.student_consents;e public.school_report_enrollments;q public.minor_eligibility_assertions;v_now timestamptz;v_id uuid;v_exp timestamptz;
begin
 perform private.school_report_guard();v_now:=clock_timestamp();
 if p_request_id is null or p_basis_reference is null or p_notice_reference is null
 or p_basis_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' or p_notice_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
 or not coalesce(isfinite(p_school_registered_until) and isfinite(p_basis_valid_until) and p_school_registered_until>v_now and p_basis_valid_until>v_now,false)
 or not (exists(select 1 from public.school_members m where m.user_id=p_actor_user_id and m.school_id=p_school_id and m.member_role='school_admin' and m.status='active' and exists(select 1 from public.profiles operator_profile where operator_profile.id=m.user_id and operator_profile.role='学校支持人员' and operator_profile.school_id=m.school_id))
 or exists(select 1 from auth.users u join public.admin_roles a on lower(a.email)=lower(u.email) where u.id=p_actor_user_id and a.status='active'))
 then return jsonb_build_object('status','denied');end if;
 select * into e from public.school_report_enrollments where student_user_id=p_student_user_id and request_id=p_request_id;
 if found then
  if (e.school_id,e.basis_reference,e.notice_reference,e.school_registered_until,e.basis_valid_until,e.issued_by)
   is distinct from(p_school_id,p_basis_reference,p_notice_reference,p_school_registered_until,p_basis_valid_until,p_actor_user_id)
  then return jsonb_build_object('status','denied');end if;
  return jsonb_build_object('status','ready','enrollmentId',e.id,'replayed',true);
 end if;
 select * into c from public.student_consents where student_user_id=p_student_user_id;
 select * into q from public.minor_eligibility_assertions where student_user_id=p_student_user_id and school_id=p_school_id order by verified_at desc,id limit 1;
 if not private.school_report_base_valid(c,v_now)
 or not exists(select 1 from public.profiles p join public.schools s on s.id=p.school_id where p.id=p_student_user_id and p.role='学生' and p.school_id=p_school_id and s.status='active')
 or q.id is null or q.revoked_at is not null or q.verified_at>v_now or q.valid_until<=v_now
 then return jsonb_build_object('status','denied');end if;
 v_exp:=least(v_now+interval '2592000 seconds',q.valid_until,p_school_registered_until,p_basis_valid_until);
 for e in select * from public.school_report_enrollments where student_user_id=p_student_user_id and status='active' loop
  perform private.school_report_terminate(e.id,'invalidated','replaced',p_actor_user_id);
 end loop;
 insert into public.school_report_enrollments(student_user_id,school_id,minor_assertion_id,issued_by,basis_reference,notice_reference,
 base_consent_snapshot,school_registered_until,basis_valid_until,effective_at,expires_at,request_id)
 values(p_student_user_id,p_school_id,q.id,p_actor_user_id,p_basis_reference,p_notice_reference,to_jsonb(c)-array['created_at','updated_at'],
 p_school_registered_until,p_basis_valid_until,v_now,v_exp,p_request_id) returning id into v_id;
 insert into public.school_report_detail_states(enrollment_id) values(v_id);
 perform private.school_report_reconcile(v_id);
 insert into public.school_report_sharing_events(enrollment_id,actor_user_id,event_type,request_id) values(v_id,p_actor_user_id,'issued',p_request_id);
 return jsonb_build_object('status','ready','enrollmentId',v_id,'replayed',false);
end $$;
create function public.end_school_report_enrollment(p_actor_user_id uuid,p_enrollment_id uuid,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.school_report_enrollments;
begin
 perform private.school_report_guard();select * into e from public.school_report_enrollments where id=p_enrollment_id;
 if e.id is null or p_request_id is null or not (p_actor_user_id=e.student_user_id
 or exists(select 1 from public.school_members m where m.user_id=p_actor_user_id and m.school_id=e.school_id and m.member_role='school_admin' and m.status='active' and exists(select 1 from public.profiles operator_profile where operator_profile.id=m.user_id and operator_profile.role='学校支持人员' and operator_profile.school_id=m.school_id))
 or exists(select 1 from auth.users u join public.admin_roles a on lower(a.email)=lower(u.email) where u.id=p_actor_user_id and a.status='active'))
 then return jsonb_build_object('status','denied');end if;
 if exists(select 1 from public.school_report_sharing_events where enrollment_id=e.id and actor_user_id=p_actor_user_id and request_id=p_request_id and event_type<>'withdrawn') then return jsonb_build_object('status','denied');end if;
 perform private.school_report_terminate(e.id,'withdrawn','withdrawn',p_actor_user_id,p_request_id);
 return jsonb_build_object('status','ready','ended',true);
end $$;
create function public.set_school_report_details(p_actor_user_id uuid,p_enrollment_id uuid,p_enabled boolean,
 p_expected_detail_revision bigint default null,p_expected_recipient_epoch bigint default null,p_request_id uuid default null,
 p_notice_version text default 'sweet-details-2026-10-28',p_confirmed boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.school_report_enrollments;d public.school_report_detail_states;v_fingerprint text;v_old text;v_replayed boolean:=false;
begin
 perform private.school_report_guard();select * into e from public.school_report_enrollments where id=p_enrollment_id;
 if e.id is null or e.student_user_id is distinct from p_actor_user_id or p_enabled is null or p_request_id is null then return jsonb_build_object('status','denied');end if;
 perform private.school_report_reconcile(e.id);
 select * into e from public.school_report_enrollments where id=p_enrollment_id;
 select * into d from public.school_report_detail_states where enrollment_id=e.id;
 v_fingerprint:=md5(jsonb_build_array(p_enabled,p_expected_detail_revision,p_expected_recipient_epoch,p_notice_version,p_confirmed)::text);
 select command_fingerprint into v_old from public.school_report_sharing_events where enrollment_id=e.id and actor_user_id=p_actor_user_id and request_id=p_request_id;
 if found then
  if v_old is distinct from v_fingerprint then return jsonb_build_object('status','denied');end if;
  v_replayed:=true;
 else
  if p_enabled and (e.status<>'active' or not coalesce(p_confirmed,false) or p_notice_version is distinct from 'sweet-details-2026-10-28'
   or p_expected_detail_revision is distinct from d.detail_revision or p_expected_recipient_epoch is distinct from e.recipient_epoch
   or not exists(select 1 from private.school_report_teachers(e.student_user_id,e.school_id)))
  then return jsonb_build_object('status','refresh_required');end if;
  update public.school_report_detail_states set enabled=p_enabled,detail_revision=detail_revision+1,
   enabled_by=case when p_enabled then p_actor_user_id end,enabled_at=case when p_enabled then clock_timestamp() end,
   enabled_recipient_epoch=case when p_enabled then e.recipient_epoch end where enrollment_id=e.id returning * into d;
  insert into public.school_report_sharing_events(enrollment_id,actor_user_id,event_type,request_id,command_fingerprint,detail_revision,recipient_epoch)
  values(e.id,p_actor_user_id,case when p_enabled then 'details_on' else 'details_off' end,p_request_id,v_fingerprint,d.detail_revision,e.recipient_epoch);
 end if;
 return jsonb_build_object('status','ready','enabled',d.enabled,'detailRevision',d.detail_revision,'recipientEpoch',e.recipient_epoch,'replayed',v_replayed);
end $$;
create function public.validate_school_report_view(p_actor_user_id uuid,p_enrollment_id uuid,p_mode text,p_student_id uuid,
 p_as_of timestamptz,p_source_revision bigint,p_recipient_epoch bigint,p_detail_revision bigint,p_expires_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb;
begin
 v:=private.school_report_context(p_actor_user_id,p_enrollment_id,p_mode,p_as_of);
 if v->>'status'='ready' and ((v#>>'{context,studentId}')::uuid is distinct from p_student_id
 or (v#>>'{context,sourceRevision}')::bigint is distinct from p_source_revision
 or (v#>>'{context,recipientEpoch}')::bigint is distinct from p_recipient_epoch
 or (v#>>'{context,detailRevision}')::bigint is distinct from p_detail_revision
 or (v#>>'{context,expiresAt}')::timestamptz is distinct from p_expires_at)
 then v:=jsonb_build_object('status','refresh_required');end if;
 return v;
end $$;

create function private.school_report_enrollment_integrity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (to_jsonb(new)-array['status','terminal_at','terminal_reason','recipient_epoch','recipient_fingerprint','source_revision','minor_assertion_id','issued_by'])
   is distinct from(to_jsonb(old)-array['status','terminal_at','terminal_reason','recipient_epoch','recipient_fingerprint','source_revision','minor_assertion_id','issued_by'])
 or (new.minor_assertion_id is distinct from old.minor_assertion_id and new.minor_assertion_id is not null)
 or (new.issued_by is distinct from old.issued_by and new.issued_by is not null)
 or (old.status<>'active' and new.status is distinct from old.status)
 or new.recipient_epoch<old.recipient_epoch or new.source_revision<old.source_revision
 then raise exception 'immutable_school_report_basis' using errcode='22023';end if;
 return new;
end $$;
create trigger school_report_enrollment_integrity before update on public.school_report_enrollments for each row execute function private.school_report_enrollment_integrity();
-- Maintenance runs as the table owner so GoTrue's deletion role needs no new grants.
create function private.school_report_anonymize_deleted_enrollment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.school_report_sharing_events set enrollment_id=null,actor_user_id=null,request_id=null,command_fingerprint=null where enrollment_id=old.id;
 update public.school_report_mode_access_audit set enrollment_id=null,actor_user_id=null where enrollment_id=old.id;
 return old;
end $$;
create trigger school_report_anonymize_deleted_enrollment before delete on public.school_report_enrollments for each row execute function private.school_report_anonymize_deleted_enrollment();
create function private.school_report_dependency_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare v_old jsonb:=to_jsonb(old);v_new jsonb:=case when tg_op='DELETE' then null else to_jsonb(new) end; e record; k text:=tg_table_name;
begin
 if k='sweet_records' then
  update public.school_report_enrollments set source_revision=source_revision+1 where status='active'
   and student_user_id in((v_old->>'user_id')::uuid,(v_new->>'user_id')::uuid);
 else
  for e in select n.id from public.school_report_enrollments n where n.status='active' and case k
   when 'profiles' then n.student_user_id in((v_old->>'id')::uuid,(v_new->>'id')::uuid) or exists(select 1 from public.teacher_student_assignments a where a.student_user_id=n.student_user_id and a.teacher_user_id in((v_old->>'id')::uuid,(v_new->>'id')::uuid))
   when 'schools' then n.school_id in((v_old->>'id')::uuid,(v_new->>'id')::uuid)
   when 'school_members' then n.school_id in((v_old->>'school_id')::uuid,(v_new->>'school_id')::uuid)
   when 'teacher_student_assignments' then n.student_user_id in((v_old->>'student_user_id')::uuid,(v_new->>'student_user_id')::uuid)
   when 'student_consents' then n.student_user_id in((v_old->>'student_user_id')::uuid,(v_new->>'student_user_id')::uuid)
   when 'minor_eligibility_assertions' then (tg_op='DELETE' and n.minor_assertion_id=(v_old->>'id')::uuid) or(tg_op<>'DELETE' and n.student_user_id in((v_old->>'student_user_id')::uuid,(v_new->>'student_user_id')::uuid))
   else false end
  loop
   if k='minor_eligibility_assertions' and tg_op='DELETE' then perform private.school_report_terminate(e.id,'invalidated','dependency');
   else perform private.school_report_reconcile(e.id);end if;
  end loop;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
do $$declare t text;begin
 foreach t in array array['profiles','schools','school_members','teacher_student_assignments','student_consents'] loop
  execute format('create trigger school_report_dependency_changed after insert or update or delete on public.%I for each row execute function private.school_report_dependency_changed()',t);
 end loop;
end $$;
create trigger school_report_proof_changed after insert or update on public.minor_eligibility_assertions for each row execute function private.school_report_dependency_changed();
create trigger school_report_proof_deleted before delete on public.minor_eligibility_assertions for each row execute function private.school_report_dependency_changed();
create trigger school_report_source_changed after insert or update or delete on public.sweet_records for each row execute function private.school_report_dependency_changed();
do $$declare t text;begin
 foreach t in array array['school_report_enrollments','school_report_detail_states','school_report_sharing_events','school_report_mode_access_audit'] loop
  execute format('create trigger report_dependency_write_lock before insert or update or delete on public.%I for each statement execute function public.report_dependency_write_lock()',t);
 end loop;
end $$;

create function public.purge_expired_school_report_metadata() returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();v_e bigint;v_events bigint;v_audit bigint;v_more bigint;v_ids uuid[];
begin
 perform private.school_report_guard();
 select coalesce(array_agg(id),'{}'::uuid[]) into v_ids from public.school_report_enrollments
 where least(coalesce(terminal_at,expires_at),expires_at)<v_now-interval '24 months' and(status<>'active' or expires_at<=v_now);
 delete from public.school_report_sharing_events where enrollment_id=any(v_ids);get diagnostics v_events=row_count;
 delete from public.school_report_mode_access_audit where enrollment_id=any(v_ids);get diagnostics v_audit=row_count;
 delete from public.school_report_enrollments where id=any(v_ids);get diagnostics v_e=row_count;
 delete from public.school_report_sharing_events where enrollment_id is null and created_at<v_now-interval '24 months';get diagnostics v_more=row_count;v_events:=v_events+v_more;
 delete from public.school_report_mode_access_audit where enrollment_id is null and created_at<v_now-interval '24 months';get diagnostics v_more=row_count;v_audit:=v_audit+v_more;
 return jsonb_build_object('status','ready','enrollmentsDeleted',v_e,'eventsDeleted',v_events,'auditsDeleted',v_audit);
end $$;
-- Replace only the old age-verification prerequisite; it still confers no reporting right.
create or replace function public.issue_report_minor_eligibility(
  p_actor_user_id uuid,p_student_user_id uuid,p_school_id uuid,
  p_verification_basis text,p_source_reference text,p_valid_until timestamptz
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_now timestamptz;
begin
  -- A pre-existing REPEATABLE READ snapshot cannot be refreshed by the mutex.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unsupported_report_transaction' using errcode='25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(73190428,20261027);
  v_now:=pg_catalog.clock_timestamp();
  if p_verification_basis is distinct from 'school_verified' or p_source_reference is null
    or p_source_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
    or p_valid_until is null or not pg_catalog.isfinite(p_valid_until) or p_valid_until <= v_now
    or not exists(select 1 from public.schools s where s.id=p_school_id and s.status='active')
    or not exists(select 1 from public.profiles p join public.student_consents c on c.student_user_id=p.id
      where p.id=p_student_user_id and p.role='学生' and p.school_id=p_school_id
      and c.age_band='14_17' and c.status='active' and c.consent_basis in ('student_self_pilot','student_guardian')
      and c.policy_version='2026-08-28' and private.school_report_base_valid(c,v_now))
    or not (exists(select 1 from auth.users u join public.admin_roles a on lower(a.email)=lower(u.email)
      where u.id=p_actor_user_id and a.status='active') or exists(select 1 from public.school_members m
      where m.user_id=p_actor_user_id and m.school_id=p_school_id and m.member_role='school_admin' and m.status='active' and exists(select 1 from public.profiles operator_profile where operator_profile.id=m.user_id and operator_profile.role='学校支持人员' and operator_profile.school_id=m.school_id))) then
    raise exception 'report_access_denied' using errcode='42501';
  end if;
  -- A new trusted assertion supersedes every previous proof. Revoking the
  -- latest proof must never fall back to an older, longer assertion.
  update public.minor_eligibility_assertions set revoked_at=v_now
    where student_user_id=p_student_user_id and revoked_at is null;
  insert into public.minor_eligibility_assertions(student_user_id,school_id,verified_by,verification_basis,source_reference,verified_at,valid_until)
  values(p_student_user_id,p_school_id,p_actor_user_id,p_verification_basis,p_source_reference,v_now,p_valid_until) returning id into v_id;
  return v_id;
end;
$$;

create function private.school_report_iso(p_time timestamptz) returns text language sql immutable security invoker set search_path='' as $$
 select to_char(p_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.')||case when mod(extract(microseconds from p_time)::bigint,1000)=0 then to_char(p_time at time zone 'UTC','MS') else to_char(p_time at time zone 'UTC','US') end||'Z'
$$;
create function private.school_report_blank(p_value text) returns boolean language sql immutable security invoker set search_path='' as $$
 select translate(p_value,E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279),'')=''
$$;
create function private.school_report_normalize(p_records jsonb,p_summary text) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare defs constant jsonb:='[{"id":"sleep","fields":[{"id":"quality","kind":"single","required":true,"options":["睡得很好","比较好","一般","不太好","很不好"]},{"id":"duration","kind":"single","options":["少于 5 小时","5 小时以上、不足 6 小时","6 小时以上、不足 7 小时","7 小时以上、不足 8 小时","8 小时以上","不太确定"]},{"id":"factors","kind":"multi","options":["睡前想太多","作业或任务压力","手机使用时间较长","家庭或人际压力","身体不舒服","不太确定"]},{"id":"note","kind":"text"}],"categories":["sleep_very_good","sleep_good","sleep_neutral","sleep_poor","sleep_very_poor"]},{"id":"wake","fields":[{"id":"state","kind":"single","required":true,"options":["很有精神","比较有精神","一般","有点疲惫","很疲惫"]},{"id":"factors","kind":"multi","options":["没睡够","一醒来就想到很多事","早上任务压力大","身体有点累","情绪影响","不太确定"]},{"id":"note","kind":"text"}],"categories":["wake_very_energized","wake_energized","wake_neutral","wake_tired","wake_very_tired"]},{"id":"eat","fields":[{"id":"rhythm","kind":"single","required":true,"options":["很规律","比较规律","一般","不太规律","很不规律"]},{"id":"mealCount","kind":"single","options":["3 餐或以上","2 餐","1 餐","没有吃正餐","不太确定"]},{"id":"foodDetails","kind":"text"},{"id":"factors","kind":"multi","options":["太忙了","没胃口","作息太乱","情绪影响","忘记吃饭","家里或学校选择有限","不太确定"]}],"categories":["eat_very_regular","eat_regular","eat_neutral","eat_irregular","eat_very_irregular"]},{"id":"exercise","fields":[{"id":"duration","kind":"single","required":true,"options":["0 分钟","1–9 分钟","10–19 分钟","20–29 分钟","30 分钟以上","不太确定"]},{"id":"activityTypes","kind":"multi","options":["步行、通勤或上下楼","拉伸或轻量活动","体育课","跑步、球类或跳操等运动","家务或日常活动","其他"]},{"id":"activityNote","kind":"text"},{"id":"bodyState","kind":"single","options":["很有活力","比较有活力","一般","有点疲惫","很疲惫"]},{"id":"factors","kind":"multi","options":["太累了","没有时间","没有动力","一直坐着学习或工作","情绪影响","身体不舒服","不太确定"]}],"categories":["exercise_none","exercise_one_to_nine","exercise_ten_to_nineteen","exercise_twenty_to_twenty_nine","exercise_over_thirty","exercise_unsure"]},{"id":"task","fields":[{"id":"engagement","kind":"single","required":true,"options":["很顺利","比较顺利","一般","不太顺利","很不顺利"]},{"id":"difficultyReasons","kind":"multi","options":["任务太多","不知道从哪里开始","担心做不好","被催促后更抗拒","情绪很累","不太确定"]},{"id":"completedSmallTask","kind":"text"}],"categories":["task_very_smooth","task_smooth","task_neutral","task_difficult","task_very_difficult"]}]'::jsonb;
 dim jsonb;def jsonb;matches jsonb;step jsonb;fm jsonb;value jsonb;fields jsonb;dims jsonb:='[]';answers jsonb:='{}';malformed boolean:=false;
 recognized int:=0;available int:=0;ok boolean;txt text;canonical jsonb;summary_state text:='missing';summary_value text:=null;
begin
 if jsonb_typeof(p_records) is distinct from 'array' then return jsonb_build_object('answers','{}'::jsonb,'dimensions','[]'::jsonb,'summary',null,'summaryState','unsupported','state','unsupported');end if;
 malformed:=jsonb_array_length(p_records)<>5 or exists(select 1 from jsonb_array_elements(p_records) s where jsonb_typeof(s)<>'object' or not exists(select 1 from jsonb_array_elements(defs) d where s->'id'=d->'id'));
 for dim in select v from jsonb_array_elements(defs) v loop
  fields:='[]';select coalesce(jsonb_agg(s),'[]') into matches from jsonb_array_elements(p_records) s where jsonb_typeof(s)='object' and s->'id'=dim->'id';
  if jsonb_array_length(matches)<>1 or jsonb_typeof(matches#>'{0,fields}') is distinct from 'array' then
   fields:=jsonb_build_array(jsonb_build_object('id',dim#>>'{fields,0,id}','state','unsupported'));malformed:=true;
  else
   recognized:=recognized+1;step:=matches->0;
   if exists(select 1 from jsonb_array_elements(step->'fields') f where jsonb_typeof(f)<>'object' or not exists(select 1 from jsonb_array_elements(dim->'fields') k where k->'id'=f->'id')) then malformed:=true;end if;
   for def in select v from jsonb_array_elements(dim->'fields') v loop
    select coalesce(jsonb_agg(f),'[]') into fm from jsonb_array_elements(step->'fields') f where jsonb_typeof(f)='object' and f->'id'=def->'id';
    if jsonb_array_length(fm)=0 and not coalesce((def->>'required')::boolean,false) then continue;end if;
    ok:=jsonb_array_length(fm)=1;value:=fm#>'{0,value}';
    if ok and not coalesce((def->>'required')::boolean,false) and ((def->>'kind'='multi' and value='[]'::jsonb) or(def->>'kind'='single' and value='""'::jsonb) or(def->>'kind'='text' and jsonb_typeof(value)='string' and private.school_report_blank(value#>>'{}'))) then continue;end if;
    if def->>'kind'='text' then ok:=ok and coalesce(jsonb_typeof(value)='string' and char_length(value#>>'{}')<=8192 and not private.school_report_blank(value#>>'{}'),false);canonical:=value;
    elsif def->>'kind'='single' then ok:=ok and coalesce(jsonb_typeof(value)='string' and (def->'options')@>jsonb_build_array(value),false);canonical:=value;
    else
     if jsonb_typeof(value) is distinct from 'array' then ok:=false;else
      ok:=ok and jsonb_array_length(value)>0 and jsonb_array_length(value)=(select count(distinct v) from jsonb_array_elements(value) v)
       and not exists(select 1 from jsonb_array_elements(value) v where jsonb_typeof(v)<>'string' or not(def->'options')@>jsonb_build_array(v));
      select coalesce(jsonb_agg(o order by ord),'[]') into canonical from jsonb_array_elements(def->'options') with ordinality a(o,ord) where value@>jsonb_build_array(o);
     end if;
    end if;
    if not coalesce(ok,false) then fields:=fields||jsonb_build_array(jsonb_build_object('id',def->>'id','state','unsupported'));malformed:=true;
    else
     available:=available+1;fields:=fields||jsonb_build_array(jsonb_build_object('id',def->>'id','state','available','value',canonical));
     if coalesce((def->>'required')::boolean,false) then
      select dim->'categories'->(ord::int-1) into canonical from jsonb_array_elements(def->'options') with ordinality a(o,ord) where o=value;
      answers:=answers||jsonb_build_object(dim->>'id',canonical);
     end if;
    end if;
   end loop;
  end if;
  dims:=dims||jsonb_build_array(jsonb_build_object('id',dim->>'id','fields',fields));
 end loop;
 if recognized=0 then return jsonb_build_object('answers','{}'::jsonb,'dimensions','[]'::jsonb,'summary',null,'summaryState','unsupported','state','unsupported');end if;
 if p_summary is not null and p_summary<>'' then
  if char_length(p_summary)>8192 then summary_state:='unsupported';malformed:=true;
  elsif not private.school_report_blank(p_summary) then summary_state:='available';summary_value:=p_summary;end if;
 end if;
 return jsonb_build_object('answers',answers,'dimensions',dims,'summary',summary_value,'summaryState',summary_state,
 'state',case when not malformed and (select count(*) from jsonb_object_keys(answers))=5 then 'available' when available>0 or summary_state='available' then 'partial' else 'unsupported' end);
end $$;
create function private.school_report_daily(p_student uuid,p_asof timestamptz)
returns table(source_id uuid,day date,instant timestamptz,normalized jsonb,conflict boolean)
language sql stable security invoker set search_path='' as $$
 with source as materialized(
  select r.id,r.created_at,r.records,r.summary,
   case when isfinite(r.created_at) then abs(extract(epoch from r.created_at)*1000000)<=9007199254740991 else false end as valid_time
  from public.sweet_records r where r.user_id=p_student and (not isfinite(r.created_at) or r.created_at<p_asof)
 ), dated as materialized(
  select *, (created_at at time zone 'Asia/Shanghai')::date as local_day,
   max(created_at) over(partition by (created_at at time zone 'Asia/Shanghai')::date) as latest
  from source where valid_time
 ), normalized_source as materialized(
  select id,created_at,local_day,summary,private.school_report_normalize(records,summary) as norm from dated where created_at=latest
 ), mapped as materialized(
  select id,created_at,local_day,norm,jsonb_build_object('normalized',norm,'originalSummary',summary) as fingerprint from normalized_source
 ), grouped as (
  select min(id::text)::uuid as source_id,local_day,max(created_at) as instant,
   (jsonb_agg(norm order by id))->0 as norm,count(distinct fingerprint)>1 as conflict
  from mapped group by local_day
 )
 select source_id,local_day,instant,norm,conflict from grouped
 union all
 select id,null,created_at,null,false from source where not valid_time
$$;
create function private.school_report_daily_page(p_student uuid,p_asof timestamptz,p_before_day date,p_limit integer)
returns table(source_id uuid,day date,instant timestamptz,normalized jsonb,conflict boolean)
language sql stable security invoker set search_path='' as $$
 with source as materialized(
  select r.id,r.created_at,r.records,r.summary,
   case when isfinite(r.created_at) then abs(extract(epoch from r.created_at)*1000000)<=9007199254740991 else false end as valid_time
  from public.sweet_records r where r.user_id=p_student and (not isfinite(r.created_at) or r.created_at<p_asof)
 ), dated as materialized(
  select *, (created_at at time zone 'Asia/Shanghai')::date as local_day,
   max(created_at) over(partition by (created_at at time zone 'Asia/Shanghai')::date) as latest
  from source where valid_time
 ), page_days as materialized(select distinct local_day from dated where p_before_day is null or local_day<p_before_day order by local_day desc limit p_limit), normalized_source as materialized(
  select id,created_at,local_day,summary,private.school_report_normalize(records,summary) as norm from dated where created_at=latest and local_day in(select local_day from page_days)
 ), mapped as materialized(
  select id,created_at,local_day,norm,jsonb_build_object('normalized',norm,'originalSummary',summary) as fingerprint from normalized_source
 ), grouped as (
  select min(id::text)::uuid as source_id,local_day,max(created_at) as instant,
   (jsonb_agg(norm order by id))->0 as norm,count(distinct fingerprint)>1 as conflict
  from mapped group by local_day
 )
 select source_id,local_day,instant,norm,conflict from grouped
$$;
create function private.school_report_window(p_days jsonb,p_start timestamptz,p_end timestamptz,p_undated boolean default false)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare dim text;v_n bigint;v_unknown boolean;v_max bigint;v_leaders bigint;v_cat text;v_dims jsonb:='[]';
begin
 foreach dim in array array['sleep','wake','eat','exercise','task'] loop
  with rows as(select v from jsonb_array_elements(p_days) v where (p_start is null or (v->>'instant')::timestamptz>=p_start) and (v->>'instant')::timestamptz<p_end),
  counts as(select v#>>array['answers',dim] as cat,count(*) as n from rows where not(v->>'conflict')::boolean and v#>>array['answers',dim] is not null group by 1)
  select coalesce((select sum(n) from counts),0),p_undated or coalesce((select bool_or((v->>'conflict')::boolean or v#>>array['answers',dim] is null) from rows),false),
   (select max(n) from counts) into v_n,v_unknown,v_max;
  if v_n<3 then v_dims:=v_dims||jsonb_build_array(jsonb_build_object('id',dim,'state',case when v_n=0 and v_unknown then 'unsupported' else 'insufficient' end));
  else
   with rows as(select v from jsonb_array_elements(p_days) v where(p_start is null or(v->>'instant')::timestamptz>=p_start) and(v->>'instant')::timestamptz<p_end),
   counts as(select v#>>array['answers',dim] as cat,count(*) as n from rows where not(v->>'conflict')::boolean and v#>>array['answers',dim] is not null group by 1)
   select count(*),max(cat) into v_leaders,v_cat from counts where n=v_max;
   v_dims:=v_dims||jsonb_build_array(case when v_leaders=1 then jsonb_build_object('id',dim,'state','category','category',v_cat) else jsonb_build_object('id',dim,'state','mixed') end);
  end if;
 end loop;
 return jsonb_build_object('start',case when p_start is not null then private.school_report_iso(p_start) end,'end',private.school_report_iso(p_end),'dimensions',v_dims);
end $$;
create function private.school_report_recent(p_days jsonb,p_asof timestamptz,p_length integer)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare a jsonb;b jsonb;v_comp jsonb:='[]';i int;x jsonb;y jsonb;d text;
begin
 a:=private.school_report_window(p_days,p_asof-p_length*interval '86400 seconds',p_asof);
 b:=private.school_report_window(p_days,p_asof-2*p_length*interval '86400 seconds',p_asof-p_length*interval '86400 seconds');
 for i in 0..4 loop
  x:=a->'dimensions'->i;y:=b->'dimensions'->i;d:=x->>'id';
  v_comp:=v_comp||jsonb_build_array(jsonb_build_object('id',d,'state',case when x->>'state'='category' and y->>'state'='category'
   and not(d='exercise' and (x->>'category'='exercise_unsure' or y->>'category'='exercise_unsure'))
   then case when x->>'category'=y->>'category' then 'same' else 'different' end else 'unavailable' end));
 end loop;
 return jsonb_build_object('current',a,'previous',b,'comparisons',v_comp);
end $$;
create function public.read_school_report_trend(p_actor_user_id uuid,p_enrollment_id uuid,p_as_of timestamptz default null,p_before_bin timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb;ctx jsonb;asof timestamptz;sid uuid;days jsonb;oldest timestamptz;v_unknown boolean;v_known boolean;v_undated boolean;v_unit text;
 v_start timestamp;v_finish timestamp;bstart timestamptz;bend timestamptz;bins jsonb:='[]';page jsonb;v_total bigint;v_report jsonb;
begin
 v:=private.school_report_context(p_actor_user_id,p_enrollment_id,'trend',p_as_of);
 if v->>'status'<>'ready' then perform private.school_report_audit(p_actor_user_id,p_enrollment_id,'trend',v);return v;end if;
 if p_before_bin is not null and not isfinite(p_before_bin) then return jsonb_build_object('status','refresh_required');end if;
 ctx:=v->'context';asof:=(ctx->>'asOf')::timestamptz;sid:=(ctx->>'studentId')::uuid;
 with daily as materialized(select * from private.school_report_daily(sid,asof))
 select coalesce(jsonb_agg(jsonb_build_object('instant',private.school_report_iso(instant),'answers',normalized->'answers','state',normalized->>'state','conflict',conflict))filter(where day is not null),'[]'),
 min(instant)filter(where day is not null),coalesce(bool_or(day is null or conflict or normalized->>'state'<>'available'),false),
 coalesce(bool_or(day is not null and not conflict and normalized->'answers'<>'{}'::jsonb),false),coalesce(bool_or(day is null),false)
 into days,oldest,v_unknown,v_known,v_undated from daily;
 v_unit:=case when oldest is null or (asof at time zone 'Asia/Shanghai')::date-(oldest at time zone 'Asia/Shanghai')::date+1<=90 then 'week' else 'month' end;
 if oldest is not null then
  v_start:=date_trunc(v_unit,oldest at time zone 'Asia/Shanghai');
  while v_start at time zone 'Asia/Shanghai'<asof loop
   v_finish:=v_start+case when v_unit='week' then interval '7 days' else interval '1 month' end;
   bstart:=v_start at time zone 'Asia/Shanghai';bend:=v_finish at time zone 'Asia/Shanghai';
   bins:=jsonb_build_array(private.school_report_window(days,bstart,bend)||jsonb_build_object('partial',bstart<oldest or bend>asof))||bins;
   v_start:=v_finish;
  end loop;
 end if;
 select count(*) into v_total from jsonb_array_elements(bins) b where p_before_bin is null or(b->>'start')::timestamptz<p_before_bin;
 select coalesce(jsonb_agg(b order by ord),'[]') into page from(select b,ord from jsonb_array_elements(bins)with ordinality q(b,ord)
 where p_before_bin is null or(b->>'start')::timestamptz<p_before_bin order by ord limit 24)t;
 v_report:=jsonb_build_object('version','sweet-comprehensive-report-v2','asOf',private.school_report_iso(asof),
 'coverage',jsonb_build_object('start',case when oldest is not null then private.school_report_iso(oldest) end,'end',private.school_report_iso(asof),'state',case when not v_unknown then 'complete' when v_known then 'partial' else 'unsupported' end),
 'overview',private.school_report_window(days,oldest,asof,v_undated),'recent',jsonb_build_object('days7',private.school_report_recent(days,asof,7),'days30',private.school_report_recent(days,asof,30)),
 'longTerm',jsonb_build_object('unit',v_unit,'bins',page,'hasMore',v_total>24,'nextBinStart',case when v_total>24 then page->23->>'start' end),
 'detailsState',case when (v->>'detailsEnabled')::boolean then 'available' else 'off' end);
 v:=jsonb_build_object('status','ready','report',v_report,'context',ctx);perform private.school_report_audit(p_actor_user_id,p_enrollment_id,'trend',v);return v;
end $$;
create function public.read_school_report_details(p_actor_user_id uuid,p_enrollment_id uuid,p_as_of timestamptz default null,p_phase text default 'dated',p_before_day date default null,p_before_id uuid default null,p_limit integer default 25)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb;ctx jsonb;asof timestamptz;sid uuid;items jsonb;v_total bigint;v_undated bigint;v_position jsonb:=null;lastday date;lastid uuid;v_report jsonb;
begin
 v:=private.school_report_context(p_actor_user_id,p_enrollment_id,'detail',p_as_of);
 if v->>'status'<>'ready' then perform private.school_report_audit(p_actor_user_id,p_enrollment_id,'detail',v);return v;end if;
 if p_phase is null or p_phase not in('dated','undated') or p_limit is null or p_limit<1 or p_limit>25 or(p_before_day is not null and not isfinite(p_before_day)) then return jsonb_build_object('status','refresh_required');end if;
 ctx:=v->'context';asof:=(ctx->>'asOf')::timestamptz;sid:=(ctx->>'studentId')::uuid;
 if p_phase='dated' then
  with times as(select created_at,case when isfinite(created_at) then abs(extract(epoch from created_at)*1000000)<=9007199254740991 else false end valid_time
   from public.sweet_records where user_id=sid and(not isfinite(created_at)or created_at<asof))
  select count(distinct (created_at at time zone 'Asia/Shanghai')::date)filter(where valid_time and(p_before_day is null or(created_at at time zone 'Asia/Shanghai')::date<p_before_day)),count(*)filter(where not valid_time)
   into v_total,v_undated from times;
  select coalesce(jsonb_agg(item order by day desc),'[]'),min(day) into items,lastday from(
   select day,case when conflict then jsonb_build_object('key',source_id,'date',day,'state','conflict')
    when normalized->>'state'='unsupported' then jsonb_build_object('key',source_id,'date',day,'state','unsupported')
    else jsonb_build_object('key',source_id,'date',day,'state',normalized->>'state','dimensions',normalized->'dimensions','summary',normalized->'summary','summaryState',normalized->>'summaryState')end item
   from private.school_report_daily_page(sid,asof,p_before_day,p_limit) where day is not null order by day desc)t;
  if v_total>0 then
   if v_total>p_limit then v_position:=jsonb_build_object('phase','dated','beforeDate',lastday);
   elsif v_undated>0 then v_position:=jsonb_build_object('phase','undated','afterId',null);end if;
  end if;
 end if;
 if p_phase='undated' or coalesce(v_total,0)=0 then
  select count(*) into v_total from public.sweet_records where user_id=sid and(not isfinite(created_at)or(created_at<asof and abs(extract(epoch from created_at)*1000000)>9007199254740991)) and(p_before_id is null or id>p_before_id);
  select coalesce(jsonb_agg(item order by source_id),'[]'),max(source_id::text)::uuid into items,lastid from(
   select id as source_id,jsonb_build_object('key',id,'date',null,'state','unsupported') item from public.sweet_records
   where user_id=sid and(not isfinite(created_at)or(created_at<asof and abs(extract(epoch from created_at)*1000000)>9007199254740991)) and(p_before_id is null or id>p_before_id) order by id limit p_limit)t;
  if v_total>p_limit then v_position:=jsonb_build_object('phase','undated','afterId',lastid);end if;
 end if;
 v_report:=jsonb_build_object('version','sweet-history-details-v1','asOf',private.school_report_iso(asof),'items',items,'hasMore',v_position is not null,'nextPosition',v_position);
 v:=jsonb_build_object('status','ready','report',v_report,'context',ctx);perform private.school_report_audit(p_actor_user_id,p_enrollment_id,'detail',v);return v;
end $$;
create function public.read_school_report_access(p_actor_user_id uuid,p_after_id uuid default null,p_section text default 'received',p_enrollment_id uuid default null,p_limit integer default 30,p_expected_recipient_epoch bigint default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.profiles;e public.school_report_enrollments;d public.school_report_detail_states;v_owner jsonb:=null;v_received jsonb:='[]';v_recipients jsonb:='[]';v_ctx jsonb;v_name text;r record;n int:=0;v_next uuid;v_recnext uuid;v_role text:='unavailable';v_elig text:='not_available';
begin
 perform private.school_report_guard();
 if p_limit is null or p_limit<1 or p_limit>30 or p_section is null or p_section not in('received','recipients') then return jsonb_build_object('status','denied');end if;
 select * into p from public.profiles where id=p_actor_user_id;
 if p.id is null or not exists(select 1 from auth.users where id=p_actor_user_id) then return jsonb_build_object('status','denied');end if;
 if p.role='学生' then
  v_role:='student';v_elig:='not_enrolled';
  select * into e from public.school_report_enrollments where student_user_id=p_actor_user_id order by created_at desc,id desc limit 1;
  if p_enrollment_id is not null and e.id is distinct from p_enrollment_id then return jsonb_build_object('status','denied');end if;
  if e.id is not null then
   perform private.school_report_reconcile(e.id);select * into e from public.school_report_enrollments where id=e.id;
   select * into d from public.school_report_detail_states where enrollment_id=e.id;
   v_elig:=case when e.status='active' then 'enrolled' when e.terminal_reason='expired' then 'expired' else 'not_enrolled' end;
   if p_section='recipients' and p_expected_recipient_epoch is not null and e.recipient_epoch<>p_expected_recipient_epoch then return jsonb_build_object('status','refresh_required');end if;
   if e.status='active' then
    for r in select t.recipient_id from private.school_report_teachers(e.student_user_id,e.school_id)t
     where p_section<>'recipients' or p_after_id is null or t.recipient_id>p_after_id order by t.recipient_id limit p_limit+1 loop
     n:=n+1;if n>p_limit then v_recnext:=(v_recipients->(p_limit-1)->>'id')::uuid;exit;end if;
     select left(coalesce(display_name,''),80) into v_name from public.profiles where id=r.recipient_id;
     v_recipients:=v_recipients||jsonb_build_array(jsonb_build_object('id',r.recipient_id,'type','teacher','displayName',coalesce(v_name,'')));
    end loop;
   end if;
   select left(coalesce(display_name,''),80) into v_name from public.profiles where id=p_actor_user_id;
   v_owner:=jsonb_build_object('enrollmentId',e.id,'displayName',coalesce(v_name,''),'effectiveAt',private.school_report_iso(e.effective_at),'expiresAt',private.school_report_iso(e.expires_at),
   'status',case when e.terminal_reason='expired' then 'expired' else e.status end,'detailsEnabled',d.enabled,'detailRevision',d.detail_revision,'recipientEpoch',e.recipient_epoch,'recipients',v_recipients);
  end if;
 elsif p.role='学校支持人员' then
  v_role:='teacher';v_elig:='not_available';n:=0;
  for r in select q.id from public.school_report_enrollments q where q.status='active' and q.expires_at>clock_timestamp()
   and(p_after_id is null or q.id>p_after_id) and exists(select 1 from private.school_report_teachers(q.student_user_id,q.school_id)t where t.recipient_id=p_actor_user_id) order by q.id loop
   v_ctx:=private.school_report_context(p_actor_user_id,r.id,'trend');
   if v_ctx->>'status'<>'ready' then continue;end if;
   n:=n+1;if n>p_limit then v_next:=(v_received->(p_limit-1)->>'enrollmentId')::uuid;exit;end if;
   select * into e from public.school_report_enrollments where id=r.id;
   select left(coalesce(display_name,''),80) into v_name from public.profiles where id=e.student_user_id;
   v_received:=v_received||jsonb_build_array(jsonb_build_object('enrollmentId',e.id,'displayName',coalesce(v_name,''),'effectiveAt',private.school_report_iso(e.effective_at),'expiresAt',private.school_report_iso(e.expires_at)));
  end loop;
 end if;
 return jsonb_build_object('status','ready','version','school-report-access-v2','viewerRole',v_role,'eligibility',v_elig,'owner',v_owner,'received',v_received,'nextAfterId',v_next,'recipientNextAfterId',v_recnext);
end $$;
create function private.school_report_event_integrity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if(to_jsonb(new)-array['enrollment_id','actor_user_id','request_id','command_fingerprint']) is distinct from(to_jsonb(old)-array['enrollment_id','actor_user_id','request_id','command_fingerprint'])
 or(new.enrollment_id is distinct from old.enrollment_id and new.enrollment_id is not null)
 or(new.actor_user_id is distinct from old.actor_user_id and new.actor_user_id is not null)
 or(new.request_id is distinct from old.request_id and new.request_id is not null)
 or(new.command_fingerprint is distinct from old.command_fingerprint and new.command_fingerprint is not null)
 then raise exception 'immutable_school_report_event' using errcode='22023';end if;
 return new;
end $$;
create trigger school_report_event_integrity before update on public.school_report_sharing_events for each row execute function private.school_report_event_integrity();
create function private.school_report_audit_integrity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if(to_jsonb(new)-array['enrollment_id','actor_user_id'])is distinct from(to_jsonb(old)-array['enrollment_id','actor_user_id'])
 or(new.enrollment_id is distinct from old.enrollment_id and new.enrollment_id is not null)
 or(new.actor_user_id is distinct from old.actor_user_id and new.actor_user_id is not null)
 then raise exception 'immutable_school_report_audit' using errcode='22023';end if;return new;
end $$;
create trigger school_report_audit_integrity before update on public.school_report_mode_access_audit for each row execute function private.school_report_audit_integrity();
create function private.school_report_detail_integrity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.enrollment_id<>old.enrollment_id or new.notice_version<>old.notice_version or new.detail_revision<old.detail_revision
 or (new.enabled and new.enabled_by is not null and not exists(select 1 from public.school_report_enrollments e where e.id=new.enrollment_id and e.student_user_id=new.enabled_by and e.recipient_epoch=new.enabled_recipient_epoch))
 then raise exception 'invalid_school_report_details' using errcode='22023';end if;return new;
end $$;
create trigger school_report_detail_integrity before update on public.school_report_detail_states for each row execute function private.school_report_detail_integrity();

-- Historical opt-in grants remain history and cannot act as v2 access.
with ended as(update public.report_authorizations set status='invalidated',invalidated_at=clock_timestamp() where status='active' returning id)
insert into public.report_authorization_events(authorization_id,event_type)select id,'invalidated' from ended;
revoke all on function public.create_report_authorization(uuid,uuid,text,text[],uuid,text),public.revoke_report_authorization(uuid,uuid),
 public.lock_report_authorization(uuid,uuid),public.read_report_summary(uuid,uuid) from public,anon,authenticated,service_role;
-- Harden every new function's default execution ACL. Pure/transaction helpers
-- need service execution because all business RPCs remain SECURITY INVOKER.
do $$declare f record;begin
 for f in select p.oid::regprocedure as signature,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where(n.nspname='private' and p.proname like 'school_report_%')or(n.nspname='public' and p.proname in(
 'issue_school_report_enrollment','end_school_report_enrollment','read_school_report_access','set_school_report_details',
 'read_school_report_trend','read_school_report_details','validate_school_report_view','purge_expired_school_report_metadata'))loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname not in('school_report_enrollment_integrity','school_report_anonymize_deleted_enrollment','school_report_dependency_changed',
   'school_report_event_integrity','school_report_audit_integrity','school_report_detail_integrity')then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;

-- Local scope explicitly approved on 2026-10-29. Applying this migration to
-- any remote project or cleaning existing real data requires separate approval.
-- A DELETE establishes a same-day cutoff: older retained rows must not become
-- report sources again, while strictly newer rows remain untouched.
create function private.clear_retained_sweet_days_after_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Auth's maintenance role cannot SELECT/DELETE sweet_records directly. Its
  -- foreign-key cascade already removes every source row of the deleted user;
  -- preserve account deletion without granting that role application access.
  if current_user = 'supabase_auth_admin' then
    return null;
  end if;

  -- The transition relation belongs to this DELETE statement. An empty set
  -- must not issue another DELETE and recurse through statement triggers.
  if not exists (select 1 from sweet_deleted_rows where isfinite(created_at)) then
    return null;
  end if;

  if not exists (
    with cutoffs as materialized (
      select user_id, (created_at at time zone 'Asia/Shanghai')::date as local_day,
        max(created_at) as through_instant
      from sweet_deleted_rows
      where isfinite(created_at)
      group by user_id, (created_at at time zone 'Asia/Shanghai')::date
    )
    select 1
    from public.sweet_records r
    join cutoffs c on c.user_id = r.user_id
      and r.created_at >= (c.local_day::timestamp at time zone 'Asia/Shanghai')
      and r.created_at <= c.through_instant
    where isfinite(r.created_at)
  ) then
    return null;
  end if;

  -- The existing BEFORE STATEMENT report write lock is already held. This
  -- nested statement re-enters the same transaction lock, retains RLS and uses
  -- the same actor. It neither adds a second lock nor writes source revisions.
  with cutoffs as materialized (
    select user_id, (created_at at time zone 'Asia/Shanghai')::date as local_day,
      max(created_at) as through_instant
    from sweet_deleted_rows
    where isfinite(created_at)
    group by user_id, (created_at at time zone 'Asia/Shanghai')::date
  )
  delete from public.sweet_records r
  using cutoffs c
  where r.user_id = c.user_id
    and isfinite(r.created_at)
    and r.created_at >= (c.local_day::timestamp at time zone 'Asia/Shanghai')
    and r.created_at <= c.through_instant;

  return null;
end;
$$;
revoke all on function private.clear_retained_sweet_days_after_delete()
  from public, anon, authenticated, service_role;

create trigger sweet_records_clear_retained_days_after_delete
  after delete on public.sweet_records
  referencing old table as sweet_deleted_rows
  for each statement
  execute function private.clear_retained_sweet_days_after_delete();

-- Explicitly approved for disposable-local A+B implementation on 2026-10-29.
-- System withdrawal has no authenticated human actor; do not attribute an
-- administrator's Auth deletion to the affected guardian.
alter table public.account_deletion_audits alter column completed_at drop not null;
alter table public.account_deletion_audits
  add constraint account_deletion_audits_completed_time_check
  check (status <> 'completed' or completed_at is not null);

alter table public.student_consent_events alter column actor_user_id drop not null;
alter table public.student_consent_events
  add constraint student_consent_events_actor_context_check check (
    actor_user_id is not null
    or (event_type = 'consent_withdrawn' and consent_basis = 'student_guardian'
      and age_band = '14_17' and guardian_user_id is null)
  );

create function private.withdraw_consent_for_deleted_guardian()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_now timestamptz;
begin
  if tg_op <> 'UPDATE' or tg_table_schema <> 'public' or tg_table_name <> 'student_consents' then
    raise exception 'unsupported_consent_trigger' using errcode = '22023';
  end if;

  -- Only the existing FK's SET NULL action is eligible. An explicit new
  -- student_self_pilot/adult_self decision must retain its own semantics.
  if old.status <> 'active' or new.status <> 'active'
    or old.consent_basis <> 'student_guardian' or new.consent_basis <> 'student_guardian'
    or old.age_band <> '14_17' or new.age_band <> '14_17'
    or old.guardian_user_id is null or new.guardian_user_id is not null
    or new.student_user_id is distinct from old.student_user_id
    or (to_jsonb(new) - array['guardian_user_id','updated_at'])
      is distinct from (to_jsonb(old) - array['guardian_user_id','updated_at'])
    or exists (select 1 from auth.users where id = old.guardian_user_id)
  then
    return new;
  end if;

  v_now := clock_timestamp();
  new.status := 'withdrawn';
  new.withdrawn_at := v_now;
  new.withdrawn_by := null;
  new.updated_at := v_now;

  -- In a multi-user Auth DELETE the student may also have been deleted. Its
  -- consent/events already cascade, so do not insert an orphan event for it.
  if exists (select 1 from auth.users where id = old.student_user_id) then
    insert into public.student_consent_events (
      student_user_id, school_id, guardian_user_id, actor_user_id,
      event_type, age_band, consent_basis, policy_version, created_at
    ) values (
      old.student_user_id, old.school_id, null, null,
      'consent_withdrawn', old.age_band, old.consent_basis, old.policy_version, v_now
    );
  end if;
  return new;
end;
$$;
revoke all on function private.withdraw_consent_for_deleted_guardian()
  from public, anon, authenticated, service_role;

create trigger student_consents_withdraw_deleted_guardian
  before update of guardian_user_id on public.student_consents
  for each row execute function private.withdraw_consent_for_deleted_guardian();

-- S04_R03: local implementation artifact only. NOT APPLIED to any database.
-- Installing this migration intentionally closes SWEET writes/token issuance.
-- Preflight, backfill and reopening require separate database-operation approval.
-- No source data is backfilled, deleted, or rewritten by this migration.

create table private.sweet_record_heads (
  user_id uuid not null references auth.users(id) on delete cascade,
  business_day date not null check (isfinite(business_day)),
  head_token uuid not null,
  current_record_id uuid unique references public.sweet_records(id)
    on delete no action deferrable initially deferred,
  primary key (user_id, business_day),
  check (current_record_id is null or current_record_id = head_token)
);
alter table private.sweet_record_heads enable row level security;
revoke all on private.sweet_record_heads from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant select, insert, update on private.sweet_record_heads to service_role;

-- Operational barrier only: no actor, content, request history, or retention data.
create table private.sweet_protocol_control (
  singleton boolean primary key default true check (singleton),
  phase text not null check (phase in ('closed', 'open'))
);
alter table private.sweet_protocol_control enable row level security;
revoke all on private.sweet_protocol_control from public, anon, authenticated, service_role;
grant select, update on private.sweet_protocol_control to service_role;
insert into private.sweet_protocol_control(singleton, phase) values (true, 'closed');

create function private.sweet_require_service()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'sweet_service_required' using errcode = '42501';
  end if;
  if nullif(current_setting('request.method',true),'') is not null
    and current_setting('request.method',true)<>'POST' then
    raise exception 'sweet_post_required' using errcode='25006'; end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'sweet_read_committed_required' using errcode = '25001';
  end if;
end;
$$;

-- Match the TypeScript DTO's UTF-16 code-unit limits without normalizing text.
create function private.sweet_text_units(p_text text)
returns bigint language sql immutable security invoker set search_path='' as $$
  select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0)
  from regexp_split_to_table(coalesce(p_text,''),'') chars(ch) where ch<>'';
$$;

create function private.sweet_records_shape(p_records jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare s jsonb; f jsonb; ids text[] := '{}'; fields_seen text[];
begin
  if jsonb_typeof(p_records) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_records) <> 5 then return false; end if;
  for s in select value from jsonb_array_elements(p_records) loop
    if jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(s->'id') is distinct from 'string'
      or jsonb_typeof(s->'title') is distinct from 'string' or jsonb_typeof(s->'label') is distinct from 'string'
      or jsonb_typeof(s->'fields') is distinct from 'array'
      or private.sweet_text_units(s->>'title')>2000 or private.sweet_text_units(s->>'label')>2000 then return false; end if;
    if exists(select 1 from jsonb_object_keys(s) keys(name) where name not in ('id','title','label','fields')) then return false; end if;
    if s->>'id' not in ('sleep','wake','eat','exercise','task') or (s->>'id') = any(ids)
      or jsonb_array_length(s->'fields') = 0 or jsonb_array_length(s->'fields')>30 then return false; end if;
    ids := array_append(ids,s->>'id');
    fields_seen := '{}';
    for f in select value from jsonb_array_elements(s->'fields') loop
      if jsonb_typeof(f) is distinct from 'object' or jsonb_typeof(f->'id') is distinct from 'string'
        or jsonb_typeof(f->'title') is distinct from 'string' or private.sweet_text_units(f->>'title')>2000
        or private.sweet_text_units(f->>'id') not between 1 and 100 or (f->>'id')=any(fields_seen) then return false; end if;
      if exists(select 1 from jsonb_object_keys(f) keys(name) where name not in ('id','title','value')) then return false; end if;
      fields_seen:=array_append(fields_seen,f->>'id');
      if jsonb_typeof(f->'value') = 'array' then
        if jsonb_array_length(f->'value')>100 or exists(select 1 from jsonb_array_elements(f->'value') elem(value)
          where jsonb_typeof(elem.value) <> 'string' or private.sweet_text_units(elem.value#>>'{}')>10000) then return false; end if;
      elsif jsonb_typeof(f->'value') is distinct from 'string' or private.sweet_text_units(f->>'value')>10000 then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

create function private.sweet_context(p_mode text, p_actor uuid default null, p_day date default null,
  p_new_id uuid default null, p_cutoff timestamptz default null)
returns text language plpgsql volatile security invoker set search_path = '' as $$
declare prior text := current_setting('youthtempo.sweet_cas',true);
begin
  perform private.sweet_require_service();
  perform set_config('youthtempo.sweet_cas',jsonb_build_object('mode',p_mode,'actor',p_actor,
    'day',p_day,'newId',p_new_id,'cutoff',p_cutoff,'txid',txid_current()::text)::text,true);
  return coalesce(prior,'');
end;
$$;

create function private.sweet_dml_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare c jsonb; owner_id uuid; local_day date; r jsonb;
begin
  r := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  owner_id := (r->>'user_id')::uuid;
  -- Only genuine parent removal, never a blanket service/trigger-depth bypass.
  if tg_op='DELETE' and current_user in ('supabase_auth_admin','postgres','supabase_admin')
    and not exists(select 1 from auth.users where id=owner_id) then return old; end if;
  if tg_table_schema='public' and tg_op='UPDATE'
    and current_user in ('service_role','postgres','supabase_admin')
    and (to_jsonb(new)-'school_id')=(to_jsonb(old)-'school_id') then return new; end if;
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'sweet_protocol_required' using errcode='42501'; end if;
  begin c := nullif(current_setting('youthtempo.sweet_cas',true),'')::jsonb;
  exception when invalid_text_representation then raise exception 'sweet_protocol_required' using errcode='42501'; end;
  if c is null or c->>'txid' is distinct from txid_current()::text then
    raise exception 'sweet_protocol_required' using errcode='42501'; end if;
  if tg_table_schema='private' and c->>'mode'='backfill' and tg_op='INSERT'
    and exists(select 1 from private.sweet_protocol_control where singleton and phase='closed') then return new; end if;
  local_day := case when tg_table_schema='public' then ((r->>'created_at')::timestamptz at time zone 'Asia/Shanghai')::date
    else (r->>'business_day')::date end;
  if c->>'mode' is distinct from 'cas' or c->>'actor' is distinct from owner_id::text
    or c->>'day' is distinct from local_day::text then
    raise exception 'sweet_protocol_required' using errcode='42501'; end if;
  if tg_table_schema='private' and tg_op='DELETE' then
    raise exception 'sweet_tombstone_removal_forbidden' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.user_id is distinct from old.user_id
    or (tg_table_schema='private' and r->>'business_day' is distinct from to_jsonb(old)->>'business_day')) then
    raise exception 'sweet_owner_immutable' using errcode='42501'; end if;
  if tg_table_schema='private' and c->>'mode'='cas' then
    if tg_op='INSERT' and (c->>'newId' is distinct from new.head_token::text
      or new.current_record_id is distinct from new.head_token) then
      raise exception 'sweet_protocol_target_mismatch' using errcode='42501'; end if;
    if tg_op='UPDATE' and not ((new.head_token=old.head_token and new.current_record_id is null)
      or(c->>'newId' is not null and c->>'newId'=new.head_token::text and(new.current_record_id is null or new.current_record_id=new.head_token))) then
      raise exception 'sweet_protocol_target_mismatch' using errcode='42501'; end if;
  end if;
  if tg_table_schema='public' then
    if tg_op='UPDATE' then raise exception 'sweet_source_immutable' using errcode='42501'; end if;
    if tg_op='INSERT' and c->>'newId' is distinct from new.id::text then
      raise exception 'sweet_protocol_target_mismatch' using errcode='42501'; end if;
    if tg_op='DELETE' and (c->>'cutoff' is null or old.created_at > (c->>'cutoff')::timestamptz) then
      raise exception 'sweet_protocol_cutoff_mismatch' using errcode='42501'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create function private.sweet_control_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare c jsonb;
begin
  perform private.sweet_require_service();
  c := nullif(current_setting('youthtempo.sweet_cas',true),'')::jsonb;
  if c is null or c->>'mode' is distinct from 'control' or c->>'txid' is distinct from txid_current()::text then
    raise exception 'sweet_control_protocol_required' using errcode='42501'; end if;
  return new;
end;
$$;
create trigger sweet_control_write_guard before update on private.sweet_protocol_control
for each row execute function private.sweet_control_guard();
create trigger sweet_head_report_lock before insert or update or delete on private.sweet_record_heads
for each statement execute function public.report_dependency_write_lock();
create trigger sweet_head_write_guard before insert or update or delete on private.sweet_record_heads
for each row execute function private.sweet_dml_guard();
create trigger sweet_source_write_guard before insert or update or delete on public.sweet_records
for each row execute function private.sweet_dml_guard();
revoke insert, delete on public.sweet_records from authenticated;
revoke truncate on public.sweet_records from service_role;

create function private.sweet_head_valid(p_actor uuid,p_day date)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare h record; r record; source_count bigint; latest_time timestamptz; latest_count bigint;
begin
  select * into h from private.sweet_record_heads where user_id=p_actor and business_day=p_day;
  select count(*),max(created_at) into source_count,latest_time from public.sweet_records
    where user_id=p_actor and created_at >= (p_day::timestamp at time zone 'Asia/Shanghai')
      and created_at < ((p_day+1)::timestamp at time zone 'Asia/Shanghai');
  if h.user_id is null then return source_count=0; end if;
  if h.current_record_id is null then return source_count=0; end if;
  select * into r from public.sweet_records where id=h.current_record_id;
  if r.id is null or r.user_id<>p_actor or not isfinite(r.created_at)
    or (r.created_at at time zone 'Asia/Shanghai')::date<>p_day or r.id<>h.head_token
    or r.created_at<>latest_time then return false; end if;
  select count(*) into latest_count from public.sweet_records where user_id=p_actor and created_at=latest_time;
  return latest_count=1;
end;
$$;

create function private.sweet_integrity_after_write()
returns trigger language plpgsql security invoker set search_path='' as $$
declare r jsonb; actor uuid; d date;
begin
  r := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  actor := (r->>'user_id')::uuid;
  if tg_op='DELETE' and current_user in ('supabase_auth_admin','postgres','supabase_admin')
    and not exists(select 1 from auth.users where id=actor) then return null; end if;
  if tg_table_schema='public' and tg_op='UPDATE' and (to_jsonb(new)-'school_id')=(to_jsonb(old)-'school_id') then return null; end if;
  d := case when tg_table_schema='public' then ((r->>'created_at')::timestamptz at time zone 'Asia/Shanghai')::date
    else (r->>'business_day')::date end;
  if not private.sweet_head_valid(actor,d) then
    raise exception 'sweet_head_inconsistent' using errcode='23514'; end if;
  return null;
end;
$$;
create constraint trigger sweet_head_integrity after insert or update or delete on private.sweet_record_heads
  deferrable initially deferred for each row execute function private.sweet_integrity_after_write();
create constraint trigger sweet_source_head_integrity after insert or update or delete on public.sweet_records
  deferrable initially deferred for each row execute function private.sweet_integrity_after_write();

create function private.sweet_packet(p_status text,p_actor uuid,p_day date,p_now timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('status',p_status,'operationDay',(p_now at time zone 'Asia/Shanghai')::date,
    'targetDay',p_day,'headToken',h.head_token,'record',to_jsonb(r))
  from (select 1) seed left join private.sweet_record_heads h on h.user_id=p_actor and h.business_day=p_day
    left join public.sweet_records r on r.id=h.current_record_id;
$$;

create function public.sweet_scope_read(p_actor_user_id uuid,p_target_day date default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare n timestamptz; d date;
begin
  perform private.sweet_require_service();
  perform pg_advisory_xact_lock(73190428,20261027);
  if not exists(select 1 from private.sweet_protocol_control where singleton and phase='open') then
    return jsonb_build_object('status','protocol_unavailable'); end if;
  if not exists(select 1 from auth.users where id=p_actor_user_id) then return jsonb_build_object('status','denied'); end if;
  n:=clock_timestamp();d:=coalesce(p_target_day,(n at time zone 'Asia/Shanghai')::date);
  if not isfinite(d) or not private.sweet_head_valid(p_actor_user_id,d) then
    return jsonb_build_object('status','protocol_unavailable'); end if;
  return private.sweet_packet('ready',p_actor_user_id,d,n);
end;
$$;

create function public.sweet_scope_write(p_actor_user_id uuid,p_operation_day date,p_target_day date,
  p_expected_head uuid,p_intent text,p_records jsonb,p_summary text,p_small_step text,
  p_recommended_next_tool text,p_record_id uuid default null,p_student_only boolean default false)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare h record; r record; t record; role_name text; school uuid; n timestamptz; d date; prior text;
  next_id uuid; summary_value text; step_value text; tool_value text; cutoff timestamptz;
  is_delete boolean := coalesce(p_intent in ('delete_day','delete_record_cutoff'),false);
begin
  perform private.sweet_require_service();
  perform pg_advisory_xact_lock(73190428,20261027);
  if not exists(select 1 from private.sweet_protocol_control where singleton and phase='open') then
    return jsonb_build_object('status','protocol_unavailable'); end if;
  if not exists(select 1 from auth.users where id=p_actor_user_id) then return jsonb_build_object('status','denied'); end if;
  if p_intent is null or p_intent not in ('preserve_summary','replace_summary','clear_summary','delete_day','delete_record_cutoff') then
    return jsonb_build_object('status','invalid_request'); end if;
  select role,school_id into role_name,school from public.profiles where id=p_actor_user_id;
  if not is_delete and (p_student_only and role_name is distinct from '学生') then
    return jsonb_build_object('status','denied'); end if;
  if not is_delete and (role_name is null or role_name='学生') and not exists(
    select 1 from public.student_consents c where c.student_user_id=p_actor_user_id
      and c.policy_version='2026-08-28' and c.status='active' and c.student_assented_at is not null
      and ((c.age_band='18_plus' and c.consent_basis='adult_self')
        or(c.age_band='14_17' and c.consent_basis='student_self_pilot')
        or(c.age_band='14_17' and c.consent_basis='student_guardian' and c.guardian_user_id is not null and c.guardian_consented_at is not null))
    ) then return jsonb_build_object('status','denied'); end if;
  if p_target_day is null or not isfinite(p_target_day) or not private.sweet_head_valid(p_actor_user_id,p_target_day) then
    return jsonb_build_object('status','protocol_unavailable'); end if;
  select * into h from private.sweet_record_heads where user_id=p_actor_user_id and business_day=p_target_day for update;
  n:=clock_timestamp();d:=(n at time zone 'Asia/Shanghai')::date;
  if p_operation_day is distinct from d or (not is_delete and p_target_day<>d) then
    return private.sweet_packet('scope_expired',p_actor_user_id,p_target_day,n); end if;
  if h.head_token is distinct from p_expected_head then
    return private.sweet_packet('conflict',p_actor_user_id,p_target_day,n); end if;
  if p_intent not in ('preserve_summary','replace_summary','clear_summary','delete_day','delete_record_cutoff') then
    return jsonb_build_object('status','invalid_request'); end if;
  select * into r from public.sweet_records where id=h.current_record_id;
  if is_delete then
    select * into t from public.sweet_records where id=p_record_id and user_id=p_actor_user_id
      and (created_at at time zone 'Asia/Shanghai')::date=p_target_day;
    if t.id is null or h.current_record_id is null then return private.sweet_packet('not_found',p_actor_user_id,p_target_day,n); end if;
    cutoff:=case when p_intent='delete_day' then 'infinity'::timestamptz else t.created_at end;
    next_id:=case when p_intent='delete_day' or t.id=h.current_record_id then gen_random_uuid() else null end;
    prior:=private.sweet_context('cas',p_actor_user_id,p_target_day,next_id,cutoff);
    if p_intent='delete_day' or t.id=h.current_record_id then
      update private.sweet_record_heads set current_record_id=null,head_token=next_id
        where user_id=p_actor_user_id and business_day=p_target_day;
    end if;
    delete from public.sweet_records where user_id=p_actor_user_id
      and created_at >= (p_target_day::timestamp at time zone 'Asia/Shanghai')
      and created_at < ((p_target_day+1)::timestamp at time zone 'Asia/Shanghai') and created_at<=cutoff;
    perform set_config('youthtempo.sweet_cas',prior,true);
    return private.sweet_packet('accepted',p_actor_user_id,p_target_day,n);
  end if;
  if not private.sweet_records_shape(p_records) or octet_length(p_records::text)>60000
    or private.sweet_text_units(p_summary)>20000 or private.sweet_text_units(p_small_step)>20000
    or private.sweet_text_units(p_recommended_next_tool)>20000 then return jsonb_build_object('status','invalid_request'); end if;
  summary_value:=nullif(p_summary,'');step_value:=nullif(p_small_step,'');tool_value:=nullif(p_recommended_next_tool,'');
  if p_intent='replace_summary' and summary_value is null and step_value is null and tool_value is null then
    return jsonb_build_object('status','invalid_request'); end if;
  if p_intent='preserve_summary' and r.id is not null then
    if r.records<>p_records then return private.sweet_packet('conflict',p_actor_user_id,p_target_day,n); end if;
    summary_value:=nullif(r.summary,'');step_value:=nullif(r.small_step,'');tool_value:=nullif(r.recommended_next_tool,'');
  elsif p_intent='preserve_summary' or p_intent='clear_summary' then
    summary_value:=null;step_value:=null;tool_value:=null;
  end if;
  if r.id is not null and r.records=p_records and nullif(r.summary,'') is not distinct from summary_value
    and nullif(r.small_step,'') is not distinct from step_value and nullif(r.recommended_next_tool,'') is not distinct from tool_value then
    return private.sweet_packet('noop',p_actor_user_id,p_target_day,n); end if;
  next_id:=gen_random_uuid();prior:=private.sweet_context('cas',p_actor_user_id,p_target_day,next_id,'infinity'::timestamptz);
  -- All statements below commit or roll back together. Never catch-and-return after a partial write.
  update private.sweet_record_heads set current_record_id=null where user_id=p_actor_user_id and business_day=p_target_day;
  delete from public.sweet_records where user_id=p_actor_user_id
    and created_at >= (p_target_day::timestamp at time zone 'Asia/Shanghai')
    and created_at < ((p_target_day+1)::timestamp at time zone 'Asia/Shanghai');
  insert into public.sweet_records(id,user_id,school_id,records,summary,small_step,recommended_next_tool,created_at)
    values(next_id,p_actor_user_id,school,p_records,summary_value,step_value,tool_value,n);
  if h.user_id is null then
    insert into private.sweet_record_heads(user_id,business_day,head_token,current_record_id)
      values(p_actor_user_id,p_target_day,next_id,next_id);
  else
    update private.sweet_record_heads set head_token=next_id,current_record_id=next_id
      where user_id=p_actor_user_id and business_day=p_target_day;
  end if;
  perform set_config('youthtempo.sweet_cas',prior,true);
  return private.sweet_packet('accepted',p_actor_user_id,p_target_day,n);
end;
$$;

-- Snapshot-wide audit; only aggregate, non-content issue counts leave this function.
create function private.sweet_protocol_audit(p_require_heads boolean)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare issues jsonb:='[]'; n bigint; sources bigint; scopes bigint; follows bigint;
begin
  select count(*) into sources from public.sweet_records;
  select count(distinct (user_id,(created_at at time zone 'Asia/Shanghai')::date)) into scopes
    from public.sweet_records where isfinite(created_at);
  select count(*) into follows from public.school_followups;
  select count(*) into n from public.sweet_records r where r.created_at is null or not isfinite(r.created_at)
    or abs(extract(epoch from r.created_at)*1000000)>9007199254740991
    or (r.created_at at time zone 'Asia/Shanghai')::date not between date '0001-01-01' and date '9999-12-31';
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','invalid_time','count',n)); end if;
  select count(*) into n from public.sweet_records r where not private.sweet_records_shape(r.records)
    or octet_length(r.records::text)>60000 or private.sweet_text_units(r.summary)>20000
    or private.sweet_text_units(r.small_step)>20000 or private.sweet_text_units(r.recommended_next_tool)>20000;
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','invalid_payload','count',n)); end if;
  select count(*) into n from public.sweet_records r where not exists(select 1 from auth.users u where u.id=r.user_id);
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','missing_auth_owner','count',n)); end if;
  select count(*) into n from (
    select user_id,local_day from (
      select user_id,created_at,(created_at at time zone 'Asia/Shanghai')::date local_day,
        max(created_at) over(partition by user_id,(created_at at time zone 'Asia/Shanghai')::date) latest
      from public.sweet_records where isfinite(created_at)
    ) versions where created_at=latest group by user_id,local_day having count(*)>1
  ) ties;
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','latest_time_tie','count',n)); end if;
  select count(*) into n from pg_catalog.pg_constraint c where c.contype='f' and c.confrelid='public.sweet_records'::regclass
    and not (c.convalidated and ((c.conrelid='public.school_followups'::regclass
      and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='record_id')]::smallint[]
      and c.confkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.confrelid and attname='id')]::smallint[] and c.confdeltype='c')
      or(c.conrelid='private.sweet_record_heads'::regclass
      and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='current_record_id')]::smallint[]
      and c.confkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.confrelid and attname='id')]::smallint[]
      and c.confdeltype='a' and c.condeferrable and c.condeferred)));
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','unknown_incoming_fk','count',n)); end if;
  select count(distinct (c.conrelid,c.confrelid)) into n from pg_catalog.pg_constraint c where c.contype='f' and c.convalidated
    and c.confkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.confrelid and attname='id')]::smallint[]
    and ((c.conrelid='public.sweet_records'::regclass and c.confrelid='auth.users'::regclass and c.confdeltype='c'
      and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='user_id')]::smallint[])
    or(c.conrelid='private.sweet_record_heads'::regclass and c.confrelid='auth.users'::regclass and c.confdeltype='c'
      and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='user_id')]::smallint[])
    or(c.conrelid='private.sweet_record_heads'::regclass and c.confrelid='public.sweet_records'::regclass and c.confdeltype='a'
      and c.condeferrable and c.condeferred
      and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='current_record_id')]::smallint[])
    or(c.conrelid='public.school_followups'::regclass and c.confrelid='public.sweet_records'::regclass and c.confdeltype='c'
      and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='record_id')]::smallint[]));
  if n<>4 then issues:=issues||jsonb_build_array(jsonb_build_object('code','required_fk_inventory_incomplete','count',n)); end if;
  select count(*) into n from public.school_followups f where not exists(select 1 from public.sweet_records r where r.id=f.record_id);
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','orphan_followup','count',n)); end if;
  select count(*) into n from private.sweet_record_heads h where not private.sweet_head_valid(h.user_id,h.business_day);
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','head_inconsistent','count',n)); end if;
  if p_require_heads then
    select count(*) into n from (select distinct user_id,(created_at at time zone 'Asia/Shanghai')::date d
      from public.sweet_records where isfinite(created_at)) s
      where not exists(select 1 from private.sweet_record_heads h where h.user_id=s.user_id and h.business_day=s.d);
    if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','head_missing','count',n)); end if;
  end if;
  return jsonb_build_object('status',case when jsonb_array_length(issues)=0 then 'ready' else 'blocked' end,
    'counts',jsonb_build_object('sources',sources,'scopes',scopes,'schoolFollowups',follows),'issues',issues);
end;
$$;

create function public.sweet_scope_preflight()
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
begin
  perform private.sweet_require_service();perform pg_advisory_xact_lock(73190428,20261027);
  if not exists(select 1 from private.sweet_protocol_control where singleton and phase='closed') then
    return jsonb_build_object('status','blocked','issues',jsonb_build_array(jsonb_build_object('code','barrier_not_closed'))); end if;
  return private.sweet_protocol_audit(false);
end;
$$;

create function public.sweet_scope_backfill(p_reviewed_dependency_impacts boolean default false)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare audit jsonb; prior text; changed bigint;
begin
  perform private.sweet_require_service();perform pg_advisory_xact_lock(73190428,20261027);
  if not exists(select 1 from private.sweet_protocol_control where singleton and phase='closed') then
    raise exception 'sweet_barrier_not_closed' using errcode='55000'; end if;
  audit:=private.sweet_protocol_audit(false);
  if audit->>'status'<>'ready' then return audit; end if;
  if (audit#>>'{counts,schoolFollowups}')::bigint>0 and p_reviewed_dependency_impacts is not true then
    return jsonb_build_object('status','blocked','issues',jsonb_build_array(jsonb_build_object('code','dependency_review_required'))); end if;
  prior:=private.sweet_context('backfill');
  insert into private.sweet_record_heads(user_id,business_day,head_token,current_record_id)
    select r.user_id,(r.created_at at time zone 'Asia/Shanghai')::date,r.id,r.id from public.sweet_records r
    where not exists(select 1 from public.sweet_records later where later.user_id=r.user_id
      and (later.created_at at time zone 'Asia/Shanghai')::date=(r.created_at at time zone 'Asia/Shanghai')::date and later.created_at>r.created_at)
    and not exists(select 1 from private.sweet_record_heads h where h.user_id=r.user_id
      and h.business_day=(r.created_at at time zone 'Asia/Shanghai')::date);
  get diagnostics changed=row_count;
  if private.sweet_protocol_audit(true)->>'status'<>'ready' then raise exception 'sweet_backfill_inconsistent' using errcode='23514'; end if;
  perform set_config('youthtempo.sweet_cas',prior,true);
  return jsonb_build_object('status','ready','createdHeads',changed,'audit',private.sweet_protocol_audit(true));
end;
$$;

create function public.sweet_scope_close()
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare prior text;
begin
  perform private.sweet_require_service();perform pg_advisory_xact_lock(73190428,20261027);
  prior:=private.sweet_context('control');
  update private.sweet_protocol_control set phase='closed' where singleton;
  perform set_config('youthtempo.sweet_cas',prior,true);return jsonb_build_object('status','closed');
end;
$$;

create function public.sweet_scope_open(p_reviewed_dependency_impacts boolean default false)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare audit jsonb; prior text;
begin
  perform private.sweet_require_service();perform pg_advisory_xact_lock(73190428,20261027);
  if not exists(select 1 from private.sweet_protocol_control where singleton and phase='closed') then
    return jsonb_build_object('status','blocked','issues',jsonb_build_array(jsonb_build_object('code','barrier_not_closed'))); end if;
  audit:=private.sweet_protocol_audit(true);
  if audit->>'status'<>'ready' then return audit; end if;
  if (audit#>>'{counts,schoolFollowups}')::bigint>0 and p_reviewed_dependency_impacts is not true then
    return jsonb_build_object('status','blocked','issues',jsonb_build_array(jsonb_build_object('code','dependency_review_required'))); end if;
  prior:=private.sweet_context('control');
  update private.sweet_protocol_control set phase='open' where singleton;
  perform set_config('youthtempo.sweet_cas',prior,true);return jsonb_build_object('status','open');
end;
$$;

-- Explicit default/function ACLs: no new callable PUBLIC or authenticated RPC.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature,n.nspname,p.proname from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in ('sweet_require_service','sweet_text_units','sweet_records_shape','sweet_context',
      'sweet_dml_guard','sweet_control_guard','sweet_head_valid','sweet_integrity_after_write','sweet_packet','sweet_protocol_audit'))
      or(n.nspname='public' and p.proname in ('sweet_scope_read','sweet_scope_write','sweet_scope_preflight',
        'sweet_scope_backfill','sweet_scope_close','sweet_scope_open')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname not in ('sweet_dml_guard','sweet_control_guard','sweet_integrity_after_write') then
      execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end;
$$;

create or replace function public.mark_teacher_message_read(
  p_message_id uuid,
  p_teacher_id uuid
)
returns table (message_id uuid, read_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  update public.student_messages as message
  set read_at = coalesce(message.read_at, now())
  where message.id = p_message_id
    and message.recipient_type = 'teacher'
    and message.recipient_user_id = p_teacher_id
    and message.moderation_status in ('sent', 'safety_review')
    and exists (
      select 1
      from public.profiles teacher
      join public.schools school on school.id = teacher.school_id and school.status = 'active'
      join public.school_members member on member.school_id = school.id
        and member.user_id = teacher.id and member.member_role = 'school_support' and member.status = 'active'
      join public.profiles student on student.id = message.sender_user_id
        and student.role = '学生' and student.school_id = school.id
      join public.teacher_student_assignments assignment on assignment.school_id = school.id
        and assignment.teacher_user_id = teacher.id and assignment.student_user_id = student.id
        and assignment.status = 'active'
      join public.student_consents consent on consent.student_user_id = student.id
      where teacher.id = p_teacher_id
        and teacher.role = '学校支持人员'
        and message.school_id = school.id
        and consent.status = 'active'
        and consent.policy_version = '2026-08-28'
        and consent.student_assented_at is not null
        and (
          (consent.age_band = '18_plus' and consent.consent_basis = 'adult_self')
          or (consent.age_band = '14_17' and consent.consent_basis = 'student_self_pilot')
          or (consent.age_band = '14_17' and consent.consent_basis = 'student_guardian'
            and consent.guardian_user_id is not null and consent.guardian_consented_at is not null)
        )
    )
  returning message.id, message.read_at;
$$;
revoke all on function public.mark_teacher_message_read(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_teacher_message_read(uuid, uuid) to service_role;


-- S06: atomic student consent and audit; see independent migration 20261116183058.
begin;

create function public.apply_student_consent(
  p_actor_user_id uuid,
  p_student_user_id uuid,
  p_action text,
  p_age_band text,
  p_expected_updated_at timestamptz,
  p_operation_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_consent public.student_consents%rowtype;
  v_event public.student_consent_events%rowtype;
  v_exists boolean;
  v_now timestamptz;
  v_event_type text;
  v_basis text;
  v_status text;
begin
  if current_user <> 'service_role'
     or p_actor_user_id is null
     or p_actor_user_id is distinct from p_student_user_id then
    return pg_catalog.jsonb_build_object('outcome', 'denied');
  end if;
  if p_operation_id is null or p_action is null
     or p_action not in ('student_assent', 'withdraw')
     or (p_action = 'student_assent' and
         (p_age_band is null or p_age_band not in ('under_14', '14_17', '18_plus')))
     or (p_action = 'withdraw' and p_age_band is not null) then
    return pg_catalog.jsonb_build_object('outcome', 'invalid');
  end if;

  -- Same lock order as the existing consent/report dependency triggers.
  perform pg_catalog.pg_advisory_xact_lock(73190428, 20261027);
  select p.* into v_profile from public.profiles p where p.id = p_actor_user_id;
  if p_action = 'student_assent' and (not found or v_profile.role is distinct from '学生') then
    return pg_catalog.jsonb_build_object('outcome', 'denied');
  end if;
  v_event_type := case when p_action = 'withdraw' then 'consent_withdrawn'
    when p_age_band = 'under_14' then 'declared_under_14' else 'student_assented' end;
  v_basis := case when p_age_band = 'under_14' then 'not_applicable'
    when p_age_band = '18_plus' then 'adult_self' else 'student_self_pilot' end;

  select e.* into v_event from public.student_consent_events e where e.id = p_operation_id;
  if found then
    if v_event.student_user_id is distinct from p_student_user_id
       or v_event.actor_user_id is distinct from p_actor_user_id
       or v_event.event_type is distinct from v_event_type
       or (p_action = 'student_assent' and
           (v_event.age_band is distinct from p_age_band
            or v_event.consent_basis is distinct from v_basis
            or v_event.policy_version is distinct from '2026-08-28'
            or v_event.guardian_user_id is not null)) then
      return pg_catalog.jsonb_build_object('outcome', 'operation_mismatch');
    end if;
    -- A historical receipt never overwrites the current consent state.
    return pg_catalog.jsonb_build_object('outcome', 'replayed', 'operationId', p_operation_id,
      'eventId', v_event.id, 'action', p_action, 'studentUserId', p_student_user_id,
      'actorUserId', p_actor_user_id, 'eventType', v_event.event_type);
  end if;

  select c.* into v_consent from public.student_consents c
    where c.student_user_id = p_student_user_id for update;
  v_exists := found;
  if p_action = 'withdraw' and not v_exists then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;
  if (v_exists and p_expected_updated_at is distinct from v_consent.updated_at)
     or (not v_exists and p_expected_updated_at is not null) then
    return pg_catalog.jsonb_build_object('outcome', 'conflict');
  end if;
  v_now := pg_catalog.clock_timestamp();
  if v_exists then
    v_now := greatest(v_now, v_consent.updated_at + interval '1 microsecond');
  end if;

  if p_action = 'student_assent' then
    v_status := case when p_age_band = 'under_14' then 'ineligible' else 'active' end;
    insert into public.student_consents (
      student_user_id, school_id, age_band, consent_basis, policy_version, status,
      student_assented_at, guardian_user_id, guardian_consented_at,
      withdrawn_at, withdrawn_by, updated_at
    ) values (
      p_student_user_id, v_profile.school_id, p_age_band, v_basis, '2026-08-28', v_status,
      case when p_age_band = 'under_14' then null else v_now end,
      null, null, null, null, v_now
    ) on conflict (student_user_id) do update set
      school_id = excluded.school_id, age_band = excluded.age_band,
      consent_basis = excluded.consent_basis, policy_version = excluded.policy_version,
      status = excluded.status, student_assented_at = excluded.student_assented_at,
      guardian_user_id = null, guardian_consented_at = null,
      withdrawn_at = null, withdrawn_by = null, updated_at = excluded.updated_at;
    insert into public.student_consent_events (
      id, student_user_id, school_id, actor_user_id, event_type,
      age_band, consent_basis, policy_version, created_at
    ) values (
      p_operation_id, p_student_user_id, v_profile.school_id, p_actor_user_id,
      v_event_type, p_age_band, v_basis, '2026-08-28', v_now
    );
  else
    update public.student_consents set status = 'withdrawn', withdrawn_at = v_now,
      withdrawn_by = p_actor_user_id, updated_at = v_now
      where student_user_id = p_student_user_id;
    insert into public.student_consent_events (
      id, student_user_id, school_id, guardian_user_id, actor_user_id,
      event_type, age_band, consent_basis, policy_version, created_at
    ) values (
      p_operation_id, p_student_user_id, v_consent.school_id, v_consent.guardian_user_id,
      p_actor_user_id, v_event_type, v_consent.age_band,
      v_consent.consent_basis, v_consent.policy_version, v_now
    );
  end if;
  -- No exception handler or compensating write: an audit error propagates.
  return pg_catalog.jsonb_build_object('outcome', 'applied', 'operationId', p_operation_id,
    'eventId', p_operation_id, 'action', p_action, 'studentUserId', p_student_user_id,
    'actorUserId', p_actor_user_id, 'eventType', v_event_type);
end;
$$;

revoke all on function public.apply_student_consent(uuid, uuid, text, text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_student_consent(uuid, uuid, text, text, timestamptz, uuid)
  to service_role;

commit;
