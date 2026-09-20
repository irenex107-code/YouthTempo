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
