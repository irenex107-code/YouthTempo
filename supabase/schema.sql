create extension if not exists "pgcrypto";

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
  recipient_type text not null check (recipient_type in ('teacher', 'guardian', 'self')),
  recipient_user_id uuid references auth.users(id) on delete cascade,
  anonymous_to_recipient boolean not null default false,
  body text not null check (char_length(body) between 1 and 1000),
  moderation_status text not null default 'sent' check (moderation_status in ('sent', 'blocked', 'safety_review')),
  moderation_reason text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (recipient_type = 'self' and recipient_user_id = sender_user_id and anonymous_to_recipient = false)
    or (recipient_type in ('teacher', 'guardian') and recipient_user_id is not null)
  )
);

create index if not exists student_messages_sender_created_idx
on public.student_messages (sender_user_id, created_at desc);

create index if not exists student_messages_recipient_created_idx
on public.student_messages (recipient_user_id, created_at desc);

create index if not exists student_messages_school_created_idx
on public.student_messages (school_id, created_at desc);

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
alter table public.school_invites enable row level security;
alter table public.user_permissions enable row level security;
alter table public.wechat_identities enable row level security;
alter table public.wechat_bind_sessions enable row level security;
alter table public.admin_roles enable row level security;
alter table public.school_followups enable row level security;
alter table public.student_messages enable row level security;

-- Follow-up notes contain school support context and are only accessed by
-- authenticated server routes using the service role.
revoke all privileges on table public.school_followups from anon, authenticated;
revoke all privileges on table public.student_messages from anon, authenticated;

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
create policy "sweet_records_select_guardian"
on public.sweet_records for select
to authenticated
using (
  exists (
    select 1
    from public.guardian_student_links guardian_link
    where guardian_link.guardian_user_id = (select auth.uid())
      and guardian_link.student_user_id = sweet_records.user_id
      and guardian_link.school_id = sweet_records.school_id
      and guardian_link.status = 'active'
  )
);

drop policy if exists "sweet_records_select_school_members" on public.sweet_records;
create policy "sweet_records_select_school_members"
on public.sweet_records for select
to authenticated
using (
  school_id is not null
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
create policy "guardian_links_select_related"
on public.guardian_student_links for select
to authenticated
using (
  guardian_user_id = (select auth.uid())
  or student_user_id = (select auth.uid())
);

revoke insert, update, delete on table public.guardian_student_links from anon, authenticated;
revoke all on table public.guardian_student_links from anon;
grant select on table public.guardian_student_links to authenticated;

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
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  constraint community_reports_single_target check ((post_id is not null) <> (comment_id is not null))
);

alter table public.community_reports add column if not exists resolved_at timestamptz;
alter table public.community_reports add column if not exists resolved_by uuid references auth.users(id) on delete set null;

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

alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_moderation_actions enable row level security;

revoke all on table public.community_posts from anon, authenticated;
revoke all on table public.community_comments from anon, authenticated;
revoke all on table public.community_reports from anon, authenticated;
revoke all on table public.community_moderation_actions from anon, authenticated;
grant all on table public.community_posts to service_role;
grant all on table public.community_comments to service_role;
grant all on table public.community_reports to service_role;
grant all on table public.community_moderation_actions to service_role;

create policy community_posts_server_only on public.community_posts
for all to authenticated using (false) with check (false);
create policy community_comments_server_only on public.community_comments
for all to authenticated using (false) with check (false);
create policy community_reports_server_only on public.community_reports
for all to authenticated using (false) with check (false);
create policy community_moderation_actions_server_only on public.community_moderation_actions
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
create index if not exists community_moderation_actions_created_idx
on public.community_moderation_actions(created_at desc);
create index if not exists community_moderation_actions_target_idx
on public.community_moderation_actions(content_type, content_id, created_at desc);
create index if not exists community_moderation_actions_actor_idx
on public.community_moderation_actions(actor_user_id, created_at desc);

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
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.professional_verifications enable row level security;
revoke all on table public.professional_verifications from anon, authenticated;
grant all on table public.professional_verifications to service_role;
create policy professional_verifications_server_only on public.professional_verifications
for all to authenticated using (false) with check (false);
create index if not exists professional_verifications_verified_by_idx
on public.professional_verifications(verified_by) where verified_by is not null;
