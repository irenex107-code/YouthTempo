-- Run only in a disposable local Supabase Postgres with the current schema.
-- All synthetic rows are rolled back even when the assertions pass.
begin;

insert into auth.users (id, email, confirmed_at)
values
  ('00000000-0000-4000-8000-000000000b01', 'adult-invite@youthtempo.test', now()),
  ('00000000-0000-4000-8000-000000000b02', 'minor-invite@youthtempo.test', now()),
  ('00000000-0000-4000-8000-000000000b03', 'pilot-admin@youthtempo.test', now());

insert into public.profiles (id, email, role)
values
  ('00000000-0000-4000-8000-000000000b01', 'adult-invite@youthtempo.test', '学生'),
  ('00000000-0000-4000-8000-000000000b02', 'minor-invite@youthtempo.test', '学生');

insert into public.student_consents
  (student_user_id, age_band, consent_basis, policy_version, status, student_assented_at)
values
  ('00000000-0000-4000-8000-000000000b01', '18_plus', 'adult_self', '2026-08-28', 'active', now()),
  ('00000000-0000-4000-8000-000000000b02', '14_17', 'student_self_pilot', '2026-08-28', 'active', now());

insert into public.peer_space_cohorts
  (id, space_id, internal_name, status, created_by)
values
  ('00000000-0000-4000-8000-000000000c01',
   '00000000-0000-4000-8000-000000000018', 'Disposable adult cohort', 'active',
   '00000000-0000-4000-8000-000000000b03');

set local role service_role;
insert into public.peer_space_email_invitations
  (space_id, cohort_id, email, school_id, eligibility_kind, evidence_source,
   evidence_reference, invited_by)
values
  ('00000000-0000-4000-8000-000000000018',
   '00000000-0000-4000-8000-000000000c01', 'adult-invite@youthtempo.test', null,
   'adult_pilot', 'trusted_roster', 'Disposable roster A',
   '00000000-0000-4000-8000-000000000b03'),
  ('00000000-0000-4000-8000-000000000018',
   '00000000-0000-4000-8000-000000000c01', 'minor-invite@youthtempo.test', null,
   'adult_pilot', 'trusted_roster', 'Disposable roster B',
   '00000000-0000-4000-8000-000000000b03');

do $$
declare
  v_membership uuid;
  v_invitation uuid;
begin
  if public.claim_peer_space_email_invitation(
    '00000000-0000-4000-8000-000000000b02', 'minor-invite@youthtempo.test') is not null then
    raise exception 'minor_claim_was_allowed';
  end if;
  if public.claim_peer_space_email_invitation(
    '00000000-0000-4000-8000-000000000b01', 'wrong@youthtempo.test') is not null then
    raise exception 'wrong_email_claim_was_allowed';
  end if;

  v_membership := public.claim_peer_space_email_invitation(
    '00000000-0000-4000-8000-000000000b01', 'adult-invite@youthtempo.test');
  if v_membership is null then raise exception 'adult_claim_failed'; end if;
  if public.claim_peer_space_email_invitation(
    '00000000-0000-4000-8000-000000000b01', 'adult-invite@youthtempo.test') is not null then
    raise exception 'duplicate_claim_was_allowed';
  end if;
  if (select count(*) from public.peer_space_memberships where user_id =
      '00000000-0000-4000-8000-000000000b01') <> 1 then
    raise exception 'duplicate_membership_created';
  end if;
  if exists (select 1 from public.school_members where user_id =
      '00000000-0000-4000-8000-000000000b01') then
    raise exception 'school_membership_created';
  end if;

  perform public.accept_peer_space_rules(
    '00000000-0000-4000-8000-000000000b01', v_membership, '2026-09-17');
  select id into v_invitation from public.peer_space_email_invitations
  where email = 'adult-invite@youthtempo.test';
  if not public.revoke_peer_space_email_invitation(
    v_invitation, '00000000-0000-4000-8000-000000000b03', 'Disposable revocation') then
    raise exception 'revocation_failed';
  end if;
  if exists (select 1 from public.peer_space_memberships
    where id = v_membership and status <> 'removed') then
    raise exception 'membership_survived_revocation';
  end if;
  if exists (select 1 from public.peer_space_room_memberships
    where membership_id = v_membership and status <> 'removed') then
    raise exception 'room_access_survived_revocation';
  end if;
  if (select count(*) from public.peer_space_email_invitation_events
    where invitation_id = v_invitation) <> 3 then
    raise exception 'invitation_audit_incomplete';
  end if;
  delete from public.peer_space_email_invitations where id = v_invitation;
  if (select count(*) from public.peer_space_email_invitation_events
    where invitation_id is null) < 3 then
    raise exception 'deletion_audit_not_anonymized';
  end if;
end;
$$;

reset role;
do $$
begin
  if has_table_privilege('authenticated', 'public.peer_space_email_invitations', 'SELECT')
    or has_table_privilege('authenticated', 'public.peer_space_email_invitations', 'INSERT')
    or has_function_privilege('authenticated',
      'public.claim_peer_space_email_invitation(uuid,text)', 'EXECUTE') then
    raise exception 'browser_role_has_invitation_access';
  end if;
end;
$$;

rollback;
