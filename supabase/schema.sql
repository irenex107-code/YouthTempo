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
create policy "sweet_records_select_school_members"
on public.sweet_records for select
to authenticated
using (
  school_id is not null
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid()) and viewer.role <> '家长'
  )
  and exists (
    select 1 from public.school_members member
    where member.school_id = sweet_records.school_id
      and member.user_id = (select auth.uid())
      and member.status = 'active'
      and (
        member.member_role = 'school_admin'
        or (
          member.member_role = 'school_support'
          and exists (
            select 1
            from public.teacher_student_assignments assignment
            where assignment.school_id = sweet_records.school_id
              and assignment.teacher_user_id = (select auth.uid())
              and assignment.student_user_id = sweet_records.user_id
              and assignment.status = 'active'
          )
        )
      )
  )
);

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
