-- Peer Space staff authorization and duty-shift foundation.
-- This batch is server-only. It does not expose student content, enable Realtime,
-- open the room, schedule production duty, or grant any browser-direct access.

create table public.peer_space_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  space_id uuid not null references public.peer_spaces(id) on delete restrict,
  room_id uuid,
  capability text not null check (capability in ('room_duty', 'content_moderator', 'safety_duty', 'config_admin')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  granted_by uuid not null references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) between 1 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id, space_id),
  foreign key (room_id, space_id)
    references public.peer_space_rooms(id, space_id) on delete restrict,
  check (ends_at is null or ends_at > starts_at),
  check (
    (status = 'active' and revoked_by is null and revoked_at is null and revoke_reason is null)
    or (status = 'revoked' and revoked_by is not null and revoked_at is not null)
  )
);

create table public.peer_space_staff_assignment_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.peer_space_staff_assignments(id) on delete restrict,
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('granted', 'revoked')),
  capability text not null check (capability in ('room_duty', 'content_moderator', 'safety_duty', 'config_admin')),
  space_id uuid not null references public.peer_spaces(id) on delete restrict,
  room_id uuid,
  reason text check (reason is null or char_length(reason) between 1 and 240),
  created_at timestamptz not null default now(),
  foreign key (room_id, space_id)
    references public.peer_space_rooms(id, space_id) on delete restrict
);

create table public.peer_space_duty_shifts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.peer_spaces(id) on delete restrict,
  room_id uuid not null,
  primary_assignment_id uuid not null,
  primary_staff_user_id uuid not null references auth.users(id) on delete restrict,
  backup_assignment_id uuid not null,
  backup_staff_user_id uuid not null references auth.users(id) on delete restrict,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'handoff_pending', 'ended', 'cancelled')),
  checklist_version text check (checklist_version is null or char_length(checklist_version) between 1 and 40),
  device_network_confirmed_at timestamptz,
  backup_confirmed_at timestamptz,
  safety_path_confirmed_at timestamptz,
  rules_resources_confirmed_at timestamptz,
  handoff_reviewed_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  last_heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (room_id, space_id)
    references public.peer_space_rooms(id, space_id) on delete restrict,
  foreign key (primary_assignment_id, primary_staff_user_id, space_id)
    references public.peer_space_staff_assignments(id, user_id, space_id) on delete restrict,
  foreign key (backup_assignment_id, backup_staff_user_id, space_id)
    references public.peer_space_staff_assignments(id, user_id, space_id) on delete restrict,
  check (scheduled_end_at > scheduled_start_at),
  check (primary_staff_user_id <> backup_staff_user_id),
  check (primary_assignment_id <> backup_assignment_id),
  check (
    (status = 'scheduled' and actual_start_at is null and actual_end_at is null and lease_expires_at is null)
    or (status in ('active', 'handoff_pending') and actual_start_at is not null and actual_end_at is null and lease_expires_at is not null)
    or (status = 'ended' and actual_start_at is not null and actual_end_at is not null and lease_expires_at is null)
    or (status = 'cancelled' and actual_end_at is not null and lease_expires_at is null)
  )
);

create table public.peer_space_duty_shift_events (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.peer_space_duty_shifts(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_assignment_id uuid references public.peer_space_staff_assignments(id) on delete restrict,
  event_type text not null check (event_type in ('started', 'heartbeat', 'handoff_started', 'ended', 'lease_expired')),
  previous_status text check (previous_status is null or previous_status in ('scheduled', 'active', 'handoff_pending', 'ended', 'cancelled')),
  new_status text not null check (new_status in ('scheduled', 'active', 'handoff_pending', 'ended', 'cancelled')),
  lease_expires_at timestamptz,
  checklist_version text check (checklist_version is null or char_length(checklist_version) between 1 and 40),
  created_at timestamptz not null default now()
);

create unique index peer_space_staff_active_space_scope_idx
on public.peer_space_staff_assignments(user_id, capability, space_id)
where status = 'active' and room_id is null;

create unique index peer_space_staff_active_room_scope_idx
on public.peer_space_staff_assignments(user_id, capability, room_id)
where status = 'active' and room_id is not null;

create index peer_space_staff_assignments_space_status_idx
on public.peer_space_staff_assignments(space_id, status, capability);

create index peer_space_staff_assignments_user_idx
on public.peer_space_staff_assignments(user_id);

create index peer_space_staff_assignments_granted_by_idx
on public.peer_space_staff_assignments(granted_by);

create index peer_space_staff_assignments_revoked_by_idx
on public.peer_space_staff_assignments(revoked_by)
where revoked_by is not null;

create index peer_space_staff_assignments_room_status_idx
on public.peer_space_staff_assignments(room_id, status, capability)
where room_id is not null;

create index peer_space_staff_assignment_events_assignment_created_idx
on public.peer_space_staff_assignment_events(assignment_id, created_at desc);

create index peer_space_staff_assignment_events_actor_created_idx
on public.peer_space_staff_assignment_events(actor_user_id, created_at desc);

create index peer_space_staff_assignment_events_staff_created_idx
on public.peer_space_staff_assignment_events(staff_user_id, created_at desc);

create index peer_space_staff_assignment_events_space_created_idx
on public.peer_space_staff_assignment_events(space_id, created_at desc);

create index peer_space_staff_assignment_events_room_created_idx
on public.peer_space_staff_assignment_events(room_id, created_at desc)
where room_id is not null;

create index peer_space_duty_shifts_room_schedule_idx
on public.peer_space_duty_shifts(room_id, scheduled_start_at, scheduled_end_at);

create index peer_space_duty_shifts_primary_schedule_idx
on public.peer_space_duty_shifts(primary_staff_user_id, scheduled_start_at desc);

create index peer_space_duty_shifts_backup_schedule_idx
on public.peer_space_duty_shifts(backup_staff_user_id, scheduled_start_at desc);

create index peer_space_duty_shifts_space_schedule_idx
on public.peer_space_duty_shifts(space_id, scheduled_start_at desc);

create index peer_space_duty_shifts_primary_assignment_idx
on public.peer_space_duty_shifts(primary_assignment_id);

create index peer_space_duty_shifts_backup_assignment_idx
on public.peer_space_duty_shifts(backup_assignment_id);

create index peer_space_duty_shifts_created_by_idx
on public.peer_space_duty_shifts(created_by);

create unique index peer_space_duty_one_active_room_per_primary_idx
on public.peer_space_duty_shifts(primary_staff_user_id)
where status in ('active', 'handoff_pending');

-- One live primary per room; an outgoing handoff may briefly overlap the
-- incoming active shift, but two shifts in the same state may not.
create unique index peer_space_duty_one_active_shift_per_room_idx
on public.peer_space_duty_shifts(room_id)
where status = 'active';

create unique index peer_space_duty_one_handoff_shift_per_room_idx
on public.peer_space_duty_shifts(room_id)
where status = 'handoff_pending';

create index peer_space_duty_active_lease_idx
on public.peer_space_duty_shifts(lease_expires_at)
where status in ('active', 'handoff_pending');

create index peer_space_duty_shift_events_shift_created_idx
on public.peer_space_duty_shift_events(shift_id, created_at desc);

create index peer_space_duty_shift_events_actor_created_idx
on public.peer_space_duty_shift_events(actor_user_id, created_at desc)
where actor_user_id is not null;

create index peer_space_duty_shift_events_assignment_created_idx
on public.peer_space_duty_shift_events(actor_assignment_id, created_at desc)
where actor_assignment_id is not null;

alter table public.peer_space_staff_assignments enable row level security;
alter table public.peer_space_staff_assignment_events enable row level security;
alter table public.peer_space_duty_shifts enable row level security;
alter table public.peer_space_duty_shift_events enable row level security;

revoke all on table public.peer_space_staff_assignments from public, anon, authenticated, service_role;
revoke all on table public.peer_space_staff_assignment_events from public, anon, authenticated, service_role;
revoke all on table public.peer_space_duty_shifts from public, anon, authenticated, service_role;
revoke all on table public.peer_space_duty_shift_events from public, anon, authenticated, service_role;

grant select, insert, update on table public.peer_space_staff_assignments to service_role;
grant select, insert on table public.peer_space_staff_assignment_events to service_role;
grant select, insert, update on table public.peer_space_duty_shifts to service_role;
grant select, insert on table public.peer_space_duty_shift_events to service_role;

create policy peer_space_staff_assignments_server_only on public.peer_space_staff_assignments
for all to authenticated using (false) with check (false);
create policy peer_space_staff_assignment_events_server_only on public.peer_space_staff_assignment_events
for all to authenticated using (false) with check (false);
create policy peer_space_duty_shifts_server_only on public.peer_space_duty_shifts
for all to authenticated using (false) with check (false);
create policy peer_space_duty_shift_events_server_only on public.peer_space_duty_shift_events
for all to authenticated using (false) with check (false);

create or replace function public.protect_peer_space_staff_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'revoked'
    or new.user_id is distinct from old.user_id
    or new.space_id is distinct from old.space_id
    or new.room_id is distinct from old.room_id
    or new.capability is distinct from old.capability
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.granted_by is distinct from old.granted_by
    or new.granted_at is distinct from old.granted_at
    or new.created_at is distinct from old.created_at
    or new.status <> 'revoked' then
    raise exception 'peer_space_staff_assignment_immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.audit_peer_space_staff_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.peer_space_staff_assignment_events (
    assignment_id,
    staff_user_id,
    actor_user_id,
    action,
    capability,
    space_id,
    room_id,
    reason,
    created_at
  ) values (
    new.id,
    new.user_id,
    case when tg_op = 'INSERT' then new.granted_by else new.revoked_by end,
    case when tg_op = 'INSERT' then 'granted' else 'revoked' end,
    new.capability,
    new.space_id,
    new.room_id,
    case when tg_op = 'INSERT' then null else new.revoke_reason end,
    case when tg_op = 'INSERT' then new.granted_at else new.revoked_at end
  );

  return new;
end;
$$;

create trigger protect_peer_space_staff_assignment_before_update
before update on public.peer_space_staff_assignments
for each row execute function public.protect_peer_space_staff_assignment();

create trigger audit_peer_space_staff_assignment_after_insert
after insert on public.peer_space_staff_assignments
for each row execute function public.audit_peer_space_staff_assignment();

create trigger audit_peer_space_staff_assignment_after_revoke
after update of status on public.peer_space_staff_assignments
for each row
when (old.status is distinct from new.status)
execute function public.audit_peer_space_staff_assignment();

create or replace function public.peer_space_room_has_live_duty(
  p_room_id uuid,
  p_now timestamptz
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.peer_space_duty_shifts shift
    join public.peer_space_staff_assignments primary_assignment
      on primary_assignment.id = shift.primary_assignment_id
     and primary_assignment.user_id = shift.primary_staff_user_id
     and primary_assignment.space_id = shift.space_id
    join public.peer_space_staff_assignments backup_assignment
      on backup_assignment.id = shift.backup_assignment_id
     and backup_assignment.user_id = shift.backup_staff_user_id
     and backup_assignment.space_id = shift.space_id
    where shift.room_id = p_room_id
      and shift.status in ('active', 'handoff_pending')
      and shift.lease_expires_at > p_now
      and shift.scheduled_end_at > p_now
      and primary_assignment.capability = 'room_duty'
      and primary_assignment.status = 'active'
      and primary_assignment.starts_at <= p_now
      and (primary_assignment.ends_at is null or primary_assignment.ends_at > p_now)
      and (primary_assignment.room_id is null or primary_assignment.room_id = p_room_id)
      and backup_assignment.capability in ('room_duty', 'safety_duty')
      and backup_assignment.status = 'active'
      and backup_assignment.starts_at <= p_now
      and (backup_assignment.ends_at is null or backup_assignment.ends_at > p_now)
      and (backup_assignment.room_id is null or backup_assignment.room_id = p_room_id)
  );
$$;

create or replace function public.start_peer_space_duty_shift(
  p_shift_id uuid,
  p_user_id uuid,
  p_assignment_id uuid,
  p_checklist_version text,
  p_device_network_confirmed boolean,
  p_backup_confirmed boolean,
  p_safety_path_confirmed boolean,
  p_rules_resources_confirmed boolean,
  p_handoff_reviewed boolean
)
returns table (
  duty_shift_id uuid,
  duty_status text,
  duty_lease_expires_at timestamptz,
  duty_last_heartbeat_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_shift public.peer_space_duty_shifts%rowtype;
  v_now timestamptz;
  v_lease_expires_at timestamptz;
begin
  if p_checklist_version is distinct from '2026-09-17'
    or not coalesce(p_device_network_confirmed, false)
    or not coalesce(p_backup_confirmed, false)
    or not coalesce(p_safety_path_confirmed, false)
    or not coalesce(p_rules_resources_confirmed, false)
    or not coalesce(p_handoff_reviewed, false) then
    raise exception 'peer_space_duty_checklist_incomplete' using errcode = '22023';
  end if;

  select shift.room_id
  into v_room_id
  from public.peer_space_duty_shifts shift
  where shift.id = p_shift_id;

  if not found then
    raise exception 'peer_space_duty_unavailable' using errcode = '42501';
  end if;

  -- All room-level transitions lock room before shift, including the sweeper.
  perform 1 from public.peer_space_rooms room
  where room.id = v_room_id
  for update;

  select shift.*
  into v_shift
  from public.peer_space_duty_shifts shift
  where shift.id = p_shift_id and shift.room_id = v_room_id
  for update;

  if not found
    or v_shift.primary_staff_user_id <> p_user_id
    or v_shift.primary_assignment_id <> p_assignment_id then
    raise exception 'peer_space_duty_unavailable' using errcode = '42501';
  end if;

  v_now := clock_timestamp();
  v_lease_expires_at := least(v_now + interval '120 seconds', v_shift.scheduled_end_at);

  if not exists (
    select 1
    from public.peer_space_staff_assignments assignment
    where assignment.id = p_assignment_id
      and assignment.user_id = p_user_id
      and assignment.space_id = v_shift.space_id
      and assignment.capability = 'room_duty'
      and assignment.status = 'active'
      and assignment.starts_at <= v_now
      and (assignment.ends_at is null or assignment.ends_at > v_now)
      and (assignment.room_id is null or assignment.room_id = v_shift.room_id)
  ) then
    raise exception 'peer_space_duty_unavailable' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.peer_space_staff_assignments assignment
    where assignment.id = v_shift.backup_assignment_id
      and assignment.user_id = v_shift.backup_staff_user_id
      and assignment.space_id = v_shift.space_id
      and assignment.capability in ('room_duty', 'safety_duty')
      and assignment.status = 'active'
      and assignment.starts_at <= v_now
      and (assignment.ends_at is null or assignment.ends_at > v_now)
      and (assignment.room_id is null or assignment.room_id = v_shift.room_id)
  ) then
    raise exception 'peer_space_duty_backup_unavailable' using errcode = '55000';
  end if;

  if v_shift.status = 'active'
    and v_shift.lease_expires_at > v_now
    and v_shift.scheduled_end_at > v_now then
    return query select v_shift.id, v_shift.status, v_shift.lease_expires_at, v_shift.last_heartbeat_at;
    return;
  end if;

  if v_shift.status <> 'scheduled'
    or v_now < v_shift.scheduled_start_at
    or v_now >= v_shift.scheduled_end_at then
    raise exception 'peer_space_duty_not_startable' using errcode = '55000';
  end if;

  update public.peer_space_duty_shifts
  set status = 'active',
      checklist_version = p_checklist_version,
      device_network_confirmed_at = v_now,
      backup_confirmed_at = v_now,
      safety_path_confirmed_at = v_now,
      rules_resources_confirmed_at = v_now,
      handoff_reviewed_at = v_now,
      actual_start_at = v_now,
      last_heartbeat_at = v_now,
      lease_expires_at = v_lease_expires_at,
      updated_at = v_now
  where id = v_shift.id;

  insert into public.peer_space_duty_shift_events (
    shift_id, actor_user_id, actor_assignment_id, event_type,
    previous_status, new_status, lease_expires_at, checklist_version
  ) values (
    v_shift.id, p_user_id, p_assignment_id, 'started',
    v_shift.status, 'active', v_lease_expires_at, p_checklist_version
  );

  return query select v_shift.id, 'active'::text, v_lease_expires_at, v_now;
end;
$$;

create or replace function public.renew_peer_space_duty_lease(
  p_shift_id uuid,
  p_user_id uuid,
  p_assignment_id uuid
)
returns table (
  duty_shift_id uuid,
  duty_status text,
  duty_lease_expires_at timestamptz,
  duty_last_heartbeat_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_shift public.peer_space_duty_shifts%rowtype;
  v_now timestamptz;
  v_lease_expires_at timestamptz;
begin
  select shift.room_id
  into v_room_id
  from public.peer_space_duty_shifts shift
  where shift.id = p_shift_id;

  if not found then
    raise exception 'peer_space_duty_lease_unavailable' using errcode = '42501';
  end if;

  perform 1 from public.peer_space_rooms room
  where room.id = v_room_id
  for update;

  select shift.*
  into v_shift
  from public.peer_space_duty_shifts shift
  where shift.id = p_shift_id and shift.room_id = v_room_id
  for update;

  if not found then
    raise exception 'peer_space_duty_lease_unavailable' using errcode = '42501';
  end if;

  v_now := clock_timestamp();
  v_lease_expires_at := least(v_now + interval '120 seconds', v_shift.scheduled_end_at);

  if v_shift.primary_staff_user_id <> p_user_id
    or v_shift.primary_assignment_id <> p_assignment_id
    or v_shift.status not in ('active', 'handoff_pending')
    or v_shift.lease_expires_at <= v_now
    or v_shift.scheduled_end_at <= v_now
    or not exists (
      select 1
      from public.peer_space_staff_assignments assignment
      where assignment.id = p_assignment_id
        and assignment.user_id = p_user_id
        and assignment.space_id = v_shift.space_id
        and assignment.capability = 'room_duty'
        and assignment.status = 'active'
        and assignment.starts_at <= v_now
        and (assignment.ends_at is null or assignment.ends_at > v_now)
        and (assignment.room_id is null or assignment.room_id = v_shift.room_id)
    )
    or not exists (
      select 1
      from public.peer_space_staff_assignments assignment
      where assignment.id = v_shift.backup_assignment_id
        and assignment.user_id = v_shift.backup_staff_user_id
        and assignment.space_id = v_shift.space_id
        and assignment.capability in ('room_duty', 'safety_duty')
        and assignment.status = 'active'
        and assignment.starts_at <= v_now
        and (assignment.ends_at is null or assignment.ends_at > v_now)
        and (assignment.room_id is null or assignment.room_id = v_shift.room_id)
    ) then
    raise exception 'peer_space_duty_lease_unavailable' using errcode = '42501';
  end if;

  update public.peer_space_duty_shifts
  set last_heartbeat_at = v_now,
      lease_expires_at = v_lease_expires_at,
      updated_at = v_now
  where id = v_shift.id;

  insert into public.peer_space_duty_shift_events (
    shift_id, actor_user_id, actor_assignment_id, event_type,
    previous_status, new_status, lease_expires_at, checklist_version
  ) values (
    v_shift.id, p_user_id, p_assignment_id, 'heartbeat',
    v_shift.status, v_shift.status, v_lease_expires_at, v_shift.checklist_version
  );

  return query select v_shift.id, v_shift.status, v_lease_expires_at, v_now;
end;
$$;

create or replace function public.transition_peer_space_duty_shift(
  p_shift_id uuid,
  p_user_id uuid,
  p_assignment_id uuid,
  p_action text
)
returns table (
  duty_shift_id uuid,
  duty_status text,
  duty_lease_expires_at timestamptz,
  duty_last_heartbeat_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_shift public.peer_space_duty_shifts%rowtype;
  v_now timestamptz;
  v_next_status text;
  v_next_lease timestamptz;
  v_event_type text;
begin
  if p_action is null or p_action not in ('begin_handoff', 'end') then
    raise exception 'peer_space_duty_action_invalid' using errcode = '22023';
  end if;

  select shift.room_id
  into v_room_id
  from public.peer_space_duty_shifts shift
  where shift.id = p_shift_id;

  if not found then
    raise exception 'peer_space_duty_unavailable' using errcode = '42501';
  end if;

  perform 1 from public.peer_space_rooms room
  where room.id = v_room_id
  for update;

  select shift.*
  into v_shift
  from public.peer_space_duty_shifts shift
  where shift.id = p_shift_id and shift.room_id = v_room_id
  for update;

  if not found then
    raise exception 'peer_space_duty_unavailable' using errcode = '42501';
  end if;

  v_now := clock_timestamp();

  if v_shift.primary_staff_user_id <> p_user_id
    or v_shift.primary_assignment_id <> p_assignment_id
    or v_shift.status not in ('active', 'handoff_pending')
    or not exists (
      select 1
      from public.peer_space_staff_assignments assignment
      where assignment.id = p_assignment_id
        and assignment.user_id = p_user_id
        and assignment.space_id = v_shift.space_id
        and assignment.capability = 'room_duty'
        and assignment.status = 'active'
        and assignment.starts_at <= v_now
        and (assignment.ends_at is null or assignment.ends_at > v_now)
        and (assignment.room_id is null or assignment.room_id = v_shift.room_id)
    ) then
    raise exception 'peer_space_duty_unavailable' using errcode = '42501';
  end if;

  if p_action = 'begin_handoff' then
    if v_shift.lease_expires_at <= v_now or v_shift.scheduled_end_at <= v_now then
      raise exception 'peer_space_duty_lease_unavailable' using errcode = '55000';
    end if;
    if not exists (
      select 1
      from public.peer_space_staff_assignments assignment
      where assignment.id = v_shift.backup_assignment_id
        and assignment.user_id = v_shift.backup_staff_user_id
        and assignment.space_id = v_shift.space_id
        and assignment.capability in ('room_duty', 'safety_duty')
        and assignment.status = 'active'
        and assignment.starts_at <= v_now
        and (assignment.ends_at is null or assignment.ends_at > v_now)
        and (assignment.room_id is null or assignment.room_id = v_shift.room_id)
    ) then
      raise exception 'peer_space_duty_backup_unavailable' using errcode = '55000';
    end if;
    v_next_status := 'handoff_pending';
    v_next_lease := least(v_now + interval '120 seconds', v_shift.scheduled_end_at);
    v_event_type := 'handoff_started';
  else
    v_next_status := 'ended';
    v_next_lease := null;
    v_event_type := 'ended';
  end if;

  update public.peer_space_duty_shifts
  set status = v_next_status,
      actual_end_at = case when p_action = 'end' then v_now else actual_end_at end,
      last_heartbeat_at = case when p_action = 'end' then last_heartbeat_at else v_now end,
      lease_expires_at = v_next_lease,
      updated_at = v_now
  where id = v_shift.id;

  insert into public.peer_space_duty_shift_events (
    shift_id, actor_user_id, actor_assignment_id, event_type,
    previous_status, new_status, lease_expires_at, checklist_version
  ) values (
    v_shift.id, p_user_id, p_assignment_id, v_event_type,
    v_shift.status, v_next_status, v_next_lease, v_shift.checklist_version
  );

  if p_action = 'end' then
    update public.peer_space_rooms
    set status = 'read_only', updated_at = v_now
    where id = v_shift.room_id
      and status = 'staffed_open'
      and not public.peer_space_room_has_live_duty(v_shift.room_id, v_now);
  end if;

  return query select v_shift.id, v_next_status, v_next_lease,
    case when p_action = 'end' then v_shift.last_heartbeat_at else v_now end;
end;
$$;

create or replace function public.expire_peer_space_duty_leases()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate record;
  v_shift public.peer_space_duty_shifts%rowtype;
  v_now timestamptz;
  v_expired_count integer := 0;
begin
  for v_candidate in
    select shift.id, shift.room_id
    from public.peer_space_duty_shifts shift
    where shift.status in ('active', 'handoff_pending')
      and (shift.lease_expires_at <= clock_timestamp()
        or shift.scheduled_end_at <= clock_timestamp())
    order by shift.room_id, shift.id
  loop
    perform 1 from public.peer_space_rooms room
    where room.id = v_candidate.room_id
    for update skip locked;
    if not found then
      continue;
    end if;

    select shift.*
    into v_shift
    from public.peer_space_duty_shifts shift
    where shift.id = v_candidate.id and shift.room_id = v_candidate.room_id
    for update skip locked;
    if not found then
      continue;
    end if;

    v_now := clock_timestamp();
    if v_shift.status not in ('active', 'handoff_pending')
      or (v_shift.lease_expires_at > v_now and v_shift.scheduled_end_at > v_now) then
      continue;
    end if;

    update public.peer_space_duty_shifts
    set status = 'ended',
        actual_end_at = v_now,
        lease_expires_at = null,
        updated_at = v_now
    where id = v_shift.id;

    update public.peer_space_rooms
    set status = 'read_only', updated_at = v_now
    where id = v_shift.room_id
      and status = 'staffed_open'
      and not public.peer_space_room_has_live_duty(v_shift.room_id, v_now);

    insert into public.peer_space_duty_shift_events (
      shift_id, event_type, previous_status, new_status, checklist_version, created_at
    ) values (
      v_shift.id, 'lease_expired', v_shift.status, 'ended', v_shift.checklist_version, v_now
    );

    v_expired_count := v_expired_count + 1;
  end loop;

  return v_expired_count;
end;
$$;

revoke all on function public.start_peer_space_duty_shift(uuid, uuid, uuid, text, boolean, boolean, boolean, boolean, boolean)
from public, anon, authenticated;
revoke all on function public.renew_peer_space_duty_lease(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.transition_peer_space_duty_shift(uuid, uuid, uuid, text)
from public, anon, authenticated;
revoke all on function public.expire_peer_space_duty_leases()
from public, anon, authenticated;
revoke all on function public.protect_peer_space_staff_assignment()
from public, anon, authenticated;
revoke all on function public.audit_peer_space_staff_assignment()
from public, anon, authenticated;
revoke all on function public.peer_space_room_has_live_duty(uuid, timestamptz)
from public, anon, authenticated;

grant execute on function public.start_peer_space_duty_shift(uuid, uuid, uuid, text, boolean, boolean, boolean, boolean, boolean)
to service_role;
grant execute on function public.renew_peer_space_duty_lease(uuid, uuid, uuid)
to service_role;
grant execute on function public.transition_peer_space_duty_shift(uuid, uuid, uuid, text)
to service_role;
grant execute on function public.expire_peer_space_duty_leases()
to service_role;
grant execute on function public.peer_space_room_has_live_duty(uuid, timestamptz)
to service_role;
