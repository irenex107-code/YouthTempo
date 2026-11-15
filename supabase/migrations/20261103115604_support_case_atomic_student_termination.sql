-- P01-13 / Correction01 local source artifact. NOT APPLIED to any database.
-- A separately approved isolated run must verify DDL backfill, locks, ACL and rollback.
-- No youth content is copied or deleted. row_revision is a non-content write token.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Volatile UUID default fills every existing row; NOT NULL is enforced in the same DDL.
alter table public.support_cases
  add column row_revision uuid not null default gen_random_uuid();

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

-- Keep the legacy signature and privileged paths; student termination must use the conditional RPC.
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
revoke all on function public.transition_support_case(
  uuid, uuid, text, text, text, text, text, timestamptz, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.transition_support_case(
  uuid, uuid, text, text, text, text, text, timestamptz, text, text, boolean
) to service_role;

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
commit;
