-- Local-only room controls. No message or Realtime access is created here.
-- Applying this migration does not schedule the duty-lease watchdog.

create table public.peer_space_room_state_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.peer_space_rooms(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_assignment_id uuid not null references public.peer_space_staff_assignments(id) on delete restrict,
  action text not null check (action in ('open', 'read_only', 'pause', 'resume_read_only')),
  previous_status text not null check (previous_status in ('staffed_open', 'read_only', 'paused', 'closed')),
  new_status text not null check (new_status in ('staffed_open', 'read_only', 'paused', 'closed')),
  reason_code text check (reason_code is null or reason_code in (
    'staffing_gap', 'safety_concern', 'operational_issue', 'resume_authorized'
  )),
  created_at timestamptz not null default now()
);

create index peer_space_room_state_events_room_created_idx
on public.peer_space_room_state_events(room_id, created_at desc);

create index peer_space_room_state_events_actor_created_idx
on public.peer_space_room_state_events(actor_user_id, created_at desc);

create index peer_space_room_state_events_assignment_idx
on public.peer_space_room_state_events(actor_assignment_id);

alter table public.peer_space_room_state_events enable row level security;
revoke all on table public.peer_space_room_state_events from public, anon, authenticated, service_role;
grant select, insert on table public.peer_space_room_state_events to service_role;

create policy peer_space_room_state_events_server_only on public.peer_space_room_state_events
for all to authenticated using (false) with check (false);

create or replace function public.transition_peer_space_room_state(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_assignment_id uuid,
  p_action text,
  p_reason_code text default null
)
returns table (
  changed_room_id uuid,
  room_status text,
  changed_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room public.peer_space_rooms%rowtype;
  v_shift public.peer_space_duty_shifts%rowtype;
  v_assignment public.peer_space_staff_assignments%rowtype;
  v_backup public.peer_space_staff_assignments%rowtype;
  v_next_status text;
  v_now timestamptz;
begin
  if p_action is null or p_action not in ('open', 'read_only', 'pause', 'resume_read_only') then
    raise exception 'peer_space_room_action_invalid' using errcode = '22023';
  end if;

  -- Use the established lock order: room, then shift, then assignments.
  select room.* into v_room
  from public.peer_space_rooms room
  where room.id = p_room_id
  for update;
  if not found then
    raise exception 'peer_space_room_unavailable' using errcode = '42501';
  end if;
  v_now := clock_timestamp();

  if p_action = 'open' then
    if v_room.status not in ('closed', 'read_only')
      or not exists (
        select 1 from public.peer_spaces space
        where space.id = v_room.space_id
          and space.age_scope = '18_plus'
          and space.status in ('invite_only', 'active')
      ) then
      raise exception 'peer_space_room_not_openable' using errcode = '55000';
    end if;

    select shift.* into v_shift
    from public.peer_space_duty_shifts shift
    where shift.room_id = v_room.id
      and shift.space_id = v_room.space_id
      and shift.primary_staff_user_id = p_actor_user_id
      and shift.primary_assignment_id = p_assignment_id
      and shift.status in ('active', 'handoff_pending')
      and shift.lease_expires_at > v_now
      and shift.scheduled_end_at > v_now
      and shift.checklist_version = '2026-09-17'
      and shift.device_network_confirmed_at is not null
      and shift.backup_confirmed_at is not null
      and shift.safety_path_confirmed_at is not null
      and shift.rules_resources_confirmed_at is not null
      and shift.handoff_reviewed_at is not null
    order by shift.actual_start_at desc
    limit 1
    for update;
    if not found then
      raise exception 'peer_space_room_duty_unavailable' using errcode = '42501';
    end if;
  end if;

  select assignment.* into v_assignment
  from public.peer_space_staff_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.user_id = p_actor_user_id
    and assignment.space_id = v_room.space_id
    and assignment.status = 'active'
    and assignment.starts_at <= v_now
    and (assignment.ends_at is null or assignment.ends_at > v_now)
    and (assignment.room_id is null or assignment.room_id = v_room.id)
  for share;
  if not found then
    raise exception 'peer_space_room_permission_denied' using errcode = '42501';
  end if;

  if p_action = 'open' then
    if v_assignment.capability <> 'room_duty'
      or v_shift.primary_staff_user_id = v_shift.backup_staff_user_id then
      raise exception 'peer_space_room_permission_denied' using errcode = '42501';
    end if;

    select assignment.* into v_backup
    from public.peer_space_staff_assignments assignment
    where assignment.id = v_shift.backup_assignment_id
      and assignment.user_id = v_shift.backup_staff_user_id
      and assignment.space_id = v_room.space_id
      and assignment.capability in ('room_duty', 'safety_duty')
      and assignment.status = 'active'
      and assignment.starts_at <= v_now
      and (assignment.ends_at is null or assignment.ends_at > v_now)
      and (assignment.room_id is null or assignment.room_id = v_room.id)
    for share;
    if not found then
      raise exception 'peer_space_room_backup_unavailable' using errcode = '55000';
    end if;
    v_next_status := 'staffed_open';
  elsif p_action = 'read_only' then
    if v_assignment.capability not in ('room_duty', 'safety_duty')
      or v_room.status <> 'staffed_open'
      or p_reason_code is null
      or p_reason_code not in ('staffing_gap', 'safety_concern', 'operational_issue') then
      raise exception 'peer_space_room_transition_denied' using errcode = '42501';
    end if;
    v_next_status := 'read_only';
  elsif p_action = 'pause' then
    if v_assignment.capability not in ('room_duty', 'safety_duty')
      or v_room.status not in ('staffed_open', 'read_only')
      or p_reason_code is null
      or p_reason_code not in ('staffing_gap', 'safety_concern', 'operational_issue') then
      raise exception 'peer_space_room_transition_denied' using errcode = '42501';
    end if;
    v_next_status := 'paused';
  else
    if v_assignment.capability <> 'safety_duty'
      or v_room.status <> 'paused'
      or p_reason_code is distinct from 'resume_authorized' then
      raise exception 'peer_space_room_transition_denied' using errcode = '42501';
    end if;
    -- Safety review only clears the pause. A current room-duty shift must open separately.
    v_next_status := 'read_only';
  end if;

  if p_action = 'open' and p_reason_code is not null then
    raise exception 'peer_space_room_reason_invalid' using errcode = '22023';
  end if;

  update public.peer_space_rooms
  set status = v_next_status, updated_at = v_now
  where id = v_room.id;

  insert into public.peer_space_room_state_events (
    room_id, actor_user_id, actor_assignment_id, action,
    previous_status, new_status, reason_code, created_at
  ) values (
    v_room.id, p_actor_user_id, p_assignment_id, p_action,
    v_room.status, v_next_status, p_reason_code, v_now
  );

  return query select v_room.id, v_next_status, v_now;
end;
$$;

revoke all on function public.transition_peer_space_room_state(uuid, uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.transition_peer_space_room_state(uuid, uuid, uuid, text, text)
to service_role;
