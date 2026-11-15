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
