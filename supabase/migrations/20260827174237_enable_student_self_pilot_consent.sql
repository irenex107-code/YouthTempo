set lock_timeout = '5s';
set statement_timeout = '30s';

alter table public.student_consents
add column if not exists consent_basis text;

update public.student_consents
set consent_basis = case
  when age_band = 'under_14' then 'not_applicable'
  when age_band = '18_plus' then 'adult_self'
  else 'student_guardian'
end
where consent_basis is null;

alter table public.student_consents
  alter column consent_basis set default 'student_guardian',
  alter column consent_basis set not null;

alter table public.student_consents
drop constraint if exists student_consents_consent_basis_check;

alter table public.student_consents
add constraint student_consents_consent_basis_check
check (consent_basis in ('not_applicable', 'adult_self', 'student_self_pilot', 'student_guardian'));

do $$
declare
  constraint_name text;
begin
  select constraint_row.conname
  into constraint_name
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.student_consents'::regclass
    and constraint_row.contype = 'c'
    and pg_get_constraintdef(constraint_row.oid) like '%guardian_consented_at%'
    and pg_get_constraintdef(constraint_row.oid) like '%status%active%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.student_consents drop constraint %I', constraint_name);
  end if;
end;
$$;

alter table public.student_consents
add constraint student_consents_active_basis_check
check (
  status <> 'active'
  or (
    student_assented_at is not null
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
);

alter table public.student_consent_events
add column if not exists consent_basis text;

update public.student_consent_events
set consent_basis = case
  when age_band = 'under_14' then 'not_applicable'
  when age_band = '18_plus' then 'adult_self'
  else 'student_guardian'
end
where consent_basis is null;

alter table public.student_consent_events
  alter column consent_basis set default 'student_guardian',
  alter column consent_basis set not null;

alter table public.student_consent_events
drop constraint if exists student_consent_events_consent_basis_check;

alter table public.student_consent_events
add constraint student_consent_events_consent_basis_check
check (consent_basis in ('not_applicable', 'adult_self', 'student_self_pilot', 'student_guardian'));

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
