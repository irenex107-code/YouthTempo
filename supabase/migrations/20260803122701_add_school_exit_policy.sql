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
drop policy if exists school_exit_events_server_only on public.school_exit_events;
create policy school_exit_events_server_only on public.school_exit_events
for all to authenticated using (false) with check (false);

create index if not exists school_exit_events_school_completed_idx
on public.school_exit_events(school_id, completed_at desc);
create index if not exists school_exit_events_expires_idx
on public.school_exit_events(expires_at);

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

select cron.unschedule(jobid)
from cron.job
where jobname = 'youthtempo-purge-expired-account-deletion-audits';

select cron.schedule(
  'youthtempo-purge-expired-account-deletion-audits',
  '17 3 * * *',
  $$
    delete from public.account_deletion_audits where expires_at <= now();
    delete from public.school_exit_events where expires_at <= now();
  $$
);
