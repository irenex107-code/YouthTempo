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
