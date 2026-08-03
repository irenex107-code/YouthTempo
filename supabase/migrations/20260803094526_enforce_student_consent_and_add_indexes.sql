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
  -- Trusted server and maintenance writes remain available for migrations,
  -- fixture setup and recovery operations. Browser-authenticated writes never
  -- carry the service_role claim.
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
        and consent.policy_version = '2026-08-03'
        and consent.status = 'active'
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
