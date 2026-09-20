-- Platform-managed email invitations for the adult Peer Space pilot.
-- No public Data API access; claims and revocations use service-role-only RPCs.
create table public.peer_space_email_invitations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.peer_spaces(id) on delete restrict,
  cohort_id uuid not null,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  school_id uuid references public.schools(id) on delete set null,
  eligibility_kind text not null check (eligibility_kind in ('adult_pilot', 'verified_university_student')),
  evidence_source text not null check (evidence_source in ('trusted_roster', 'direct_review')),
  evidence_reference text not null check (char_length(btrim(evidence_reference)) between 8 and 160),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  claimed_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) between 3 and 160),
  updated_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cohort_id, space_id)
    references public.peer_space_cohorts(id, space_id) on delete restrict,
  check (status <> 'claimed' or claimed_at is not null),
  check (status <> 'revoked' or revoked_at is not null)
);

create unique index peer_space_email_invitations_current_email_space_idx
on public.peer_space_email_invitations (email, space_id)
where status in ('pending', 'claimed');
create index peer_space_email_invitations_cohort_status_idx
on public.peer_space_email_invitations (cohort_id, status, invited_at desc);
create index peer_space_email_invitations_claimed_user_idx
on public.peer_space_email_invitations (claimed_user_id)
where claimed_user_id is not null;

create table public.peer_space_email_invitation_events (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid references public.peer_space_email_invitations(id) on delete set null,
  event_type text not null check (event_type in ('created', 'corrected', 'claimed', 'revoked')),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index peer_space_email_invitation_events_invitation_created_idx
on public.peer_space_email_invitation_events (invitation_id, created_at desc);

alter table public.peer_space_email_invitations enable row level security;
alter table public.peer_space_email_invitation_events enable row level security;
revoke all on table public.peer_space_email_invitations from public, anon, authenticated, service_role;
revoke all on table public.peer_space_email_invitation_events from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.peer_space_email_invitations to service_role;
grant select, insert on table public.peer_space_email_invitation_events to service_role;
create policy peer_space_email_invitations_server_only on public.peer_space_email_invitations
for all to authenticated using (false) with check (false);
create policy peer_space_email_invitation_events_server_only on public.peer_space_email_invitation_events
for all to authenticated using (false) with check (false);

create or replace function public.protect_peer_space_email_invitation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'revoked' then
    raise exception 'peer_space_invitation_immutable' using errcode = '42501';
  end if;
  if old.status = 'claimed' and (
    new.status <> 'revoked'
    or new.email is distinct from old.email
    or new.space_id is distinct from old.space_id
    or new.cohort_id is distinct from old.cohort_id
    or new.school_id is distinct from old.school_id
    or new.eligibility_kind is distinct from old.eligibility_kind
    or new.evidence_source is distinct from old.evidence_source
    or new.evidence_reference is distinct from old.evidence_reference
    or new.claimed_user_id is distinct from old.claimed_user_id
    or new.claimed_at is distinct from old.claimed_at
  ) then
    raise exception 'peer_space_invitation_immutable' using errcode = '42501';
  end if;
  if old.status = 'pending' and new.status = 'claimed'
    and (new.claimed_user_id is null or new.claimed_at is null) then
    raise exception 'peer_space_invitation_invalid_claim' using errcode = '22023';
  end if;
  if old.status = 'pending' and new.status = 'pending'
    and (new.claimed_user_id is distinct from old.claimed_user_id
      or new.claimed_at is distinct from old.claimed_at) then
    raise exception 'peer_space_invitation_invalid_claim' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.audit_peer_space_email_invitation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event_type text;
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'created';
    v_actor := new.invited_by;
  elsif new.status = 'claimed' and old.status <> 'claimed' then
    v_event_type := 'claimed';
    v_actor := new.claimed_user_id;
  elsif new.status = 'revoked' and old.status <> 'revoked' then
    v_event_type := 'revoked';
    v_actor := new.revoked_by;
  else
    v_event_type := 'corrected';
    v_actor := new.updated_by;
  end if;
  insert into public.peer_space_email_invitation_events (invitation_id, event_type, actor_user_id)
  values (new.id, v_event_type, v_actor);
  return new;
end;
$$;

create trigger protect_peer_space_email_invitation_before_update
before update on public.peer_space_email_invitations
for each row execute function public.protect_peer_space_email_invitation();
create trigger audit_peer_space_email_invitation_after_insert
after insert on public.peer_space_email_invitations
for each row execute function public.audit_peer_space_email_invitation();
create trigger audit_peer_space_email_invitation_after_update
after update on public.peer_space_email_invitations
for each row execute function public.audit_peer_space_email_invitation();

revoke all on function public.protect_peer_space_email_invitation() from public, anon, authenticated;
revoke all on function public.audit_peer_space_email_invitation() from public, anon, authenticated;

create or replace function public.claim_peer_space_email_invitation(
  p_user_id uuid,
  p_email text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invitation public.peer_space_email_invitations%rowtype;
  v_membership_id uuid;
begin
  if p_user_id is null or p_email is null or p_email <> lower(btrim(p_email)) then
    return null;
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_user_id and profile.role = '学生'
  ) or not exists (
    select 1 from public.student_consents consent
    where consent.student_user_id = p_user_id
      and consent.age_band = '18_plus'
      and consent.consent_basis = 'adult_self'
      and consent.policy_version = '2026-08-28'
      and consent.status = 'active'
      and consent.student_assented_at is not null
  ) then
    return null;
  end if;

  select invitation.* into v_invitation
  from public.peer_space_email_invitations invitation
  join public.peer_spaces space on space.id = invitation.space_id
  join public.peer_space_cohorts cohort
    on cohort.id = invitation.cohort_id and cohort.space_id = invitation.space_id
  where invitation.email = p_email
    and invitation.status = 'pending'
    and space.code = 'adult_peer_space'
    and space.age_scope = '18_plus'
    and space.status in ('invite_only', 'active')
    and cohort.status = 'active'
    and (cohort.starts_at is null or cohort.starts_at <= now())
    and (cohort.ends_at is null or cohort.ends_at > now())
  order by invitation.invited_at desc
  limit 1
  for update of invitation;

  if v_invitation.id is null then
    return null;
  end if;
  insert into public.peer_space_memberships (
    space_id, cohort_id, user_id, status, invited_by, invited_at
  ) values (
    v_invitation.space_id, v_invitation.cohort_id, p_user_id,
    'invited', v_invitation.invited_by, v_invitation.invited_at
  )
  on conflict (space_id, cohort_id, user_id) do nothing
  returning id into v_membership_id;
  if v_membership_id is null then
    return null;
  end if;

  update public.peer_space_email_invitations
  set status = 'claimed', claimed_user_id = p_user_id, claimed_at = now(), updated_by = p_user_id
  where id = v_invitation.id;
  return v_membership_id;
end;
$$;
revoke all on function public.claim_peer_space_email_invitation(uuid, text)
from public, anon, authenticated;
grant execute on function public.claim_peer_space_email_invitation(uuid, text)
to service_role;

create or replace function public.revoke_peer_space_email_invitation(
  p_invitation_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invitation public.peer_space_email_invitations%rowtype;
  v_now timestamptz := now();
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 160 then
    raise exception 'peer_space_invitation_reason_required' using errcode = '22023';
  end if;
  select * into v_invitation
  from public.peer_space_email_invitations
  where id = p_invitation_id
  for update;
  if v_invitation.id is null or v_invitation.status = 'revoked' then
    return false;
  end if;

  update public.peer_space_email_invitations
  set status = 'revoked', revoked_by = p_actor_user_id,
    revoked_at = v_now, revoked_reason = btrim(p_reason), updated_by = p_actor_user_id
  where id = p_invitation_id;

  if v_invitation.claimed_user_id is not null then
    update public.peer_space_room_memberships room_member
    set status = 'removed',
      visible_until = greatest(v_now, room_member.visible_from + interval '1 microsecond'),
      updated_at = v_now
    from public.peer_space_memberships member
    where room_member.membership_id = member.id
      and member.space_id = v_invitation.space_id
      and member.cohort_id = v_invitation.cohort_id
      and member.user_id = v_invitation.claimed_user_id
      and room_member.status = 'active';

    update public.peer_space_memberships
    set status = 'removed', ended_at = v_now,
      ended_reason = 'email_invitation_revoked', updated_at = v_now
    where space_id = v_invitation.space_id
      and cohort_id = v_invitation.cohort_id
      and user_id = v_invitation.claimed_user_id
      and status in ('invited', 'active', 'paused');
  end if;
  return true;
end;
$$;
revoke all on function public.revoke_peer_space_email_invitation(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.revoke_peer_space_email_invitation(uuid, uuid, text)
to service_role;
