-- Cross-school adult theme rooms start closed until a staffed duty approves opening.
alter table public.peer_space_rooms
  drop constraint if exists peer_space_rooms_room_type_check;
alter table public.peer_space_rooms
  add constraint peer_space_rooms_room_type_check check (room_type in ('everyone', 'theme'));
alter table public.peer_space_rooms
  drop constraint if exists peer_space_rooms_space_id_room_type_key;
alter table public.peer_space_rooms
  add column if not exists room_code text not null default 'everyone',
  add column if not exists title_zh text not null default '大家的解忧室',
  add column if not exists title_en text not null default 'Peer Space',
  add column if not exists description_zh text not null default '一个有人值守、尊重边界的跨校空间。',
  add column if not exists description_en text not null default 'A staffed cross-school space with clear boundaries.',
  add column if not exists guidelines_zh text not null default '尊重他人，不分享联系方式；紧急时请联系现实支持。',
  add column if not exists guidelines_en text not null default 'Respect others. Do not share contact details. Seek real-world help in an emergency.';
alter table public.peer_space_rooms
  add constraint peer_space_rooms_code_check check (room_code ~ '^[a-z0-9_]{3,48}$');
create unique index if not exists peer_space_rooms_space_code_idx
on public.peer_space_rooms(space_id, room_code);

insert into public.peer_space_rooms
  (space_id, room_type, room_code, status, title_zh, title_en, description_zh, description_en, guidelines_zh, guidelines_en)
select space.id, 'theme', theme.code, 'closed', theme.title_zh, theme.title_en,
       theme.description_zh, theme.description_en,
       '尊重他人，不分享联系方式；紧急时请联系现实支持。',
       'Respect others. Do not share contact details. Seek real-world help in an emergency.'
from public.peer_spaces space
cross join (values
  ('study', '学习与压力', 'Study and pressure', '聊聊学习、工作和期待带来的压力。', 'Talk about pressure from study, work, and expectations.'),
  ('connections', '关系与陪伴', 'Connection and company', '聊聊关系中的困惑、界限和被理解的时刻。', 'Talk about relationships, boundaries, and feeling understood.')
) as theme(code, title_zh, title_en, description_zh, description_en)
where space.code = 'adult_peer_space'
on conflict (space_id, room_code) do nothing;

create table if not exists public.peer_space_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.peer_space_rooms(id) on delete restrict,
  room_membership_id uuid not null references public.peer_space_room_memberships(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 600),
  moderation_status text not null default 'visible' check (moderation_status in ('visible', 'safety_review', 'hidden', 'deleted')),
  risk_priority text not null default 'standard' check (risk_priority in ('standard', 'high', 'urgent')),
  risk_source text not null default 'deterministic' check (risk_source in ('deterministic', 'ai_assisted')),
  risk_category text not null default 'other' check (risk_category in ('crisis', 'privacy', 'harassment', 'report', 'other')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  hidden_at timestamptz,
  check ((moderation_status = 'deleted') = (deleted_at is not null))
);
create index if not exists peer_space_messages_room_created_idx
on public.peer_space_messages(room_id, created_at desc);
create index if not exists peer_space_messages_review_idx
on public.peer_space_messages(moderation_status, risk_priority, created_at)
where moderation_status = 'safety_review';

create table if not exists public.peer_space_user_controls (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.peer_space_rooms(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  target_room_membership_id uuid not null references public.peer_space_room_memberships(id) on delete cascade,
  control_type text not null check (control_type in ('block', 'mute')),
  created_at timestamptz not null default now(),
  unique (room_id, actor_user_id, target_user_id, control_type),
  check (actor_user_id <> target_user_id)
);
create index if not exists peer_space_user_controls_target_idx
on public.peer_space_user_controls(room_id, target_user_id, control_type);

create table if not exists public.peer_space_message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.peer_space_messages(id) on delete cascade,
  room_id uuid not null references public.peer_space_rooms(id) on delete restrict,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason_code text not null check (reason_code in ('privacy', 'harassment', 'safety', 'other')),
  status text not null default 'pending' check (status in ('pending', 'reviewing', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (message_id, reporter_user_id)
);

create table if not exists public.peer_space_review_cases (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.peer_space_messages(id) on delete cascade,
  room_id uuid not null references public.peer_space_rooms(id) on delete restrict,
  subject_user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('crisis', 'privacy', 'harassment', 'report', 'other')),
  priority text not null check (priority in ('standard', 'high', 'urgent')),
  status text not null default 'pending'
    check (status in ('pending', 'assigned', 'reviewing', 'action_required', 'referred', 'resolved', 'closed')),
  assigned_to uuid references auth.users(id) on delete set null,
  follow_up_required boolean not null default false,
  escalated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists peer_space_review_cases_queue_idx
on public.peer_space_review_cases(status, priority, created_at);

create table if not exists public.peer_space_review_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.peer_space_review_cases(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_ref text not null,
  actor_capability text not null check (actor_capability in ('content_moderator', 'safety_duty')),
  previous_status text,
  next_status text not null,
  note text check (note is null or char_length(note) <= 500),
  follow_up_required boolean not null default false,
  escalated boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists peer_space_review_events_case_created_idx
on public.peer_space_review_events(case_id, created_at);

create or replace function public.queue_peer_space_review_case()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.moderation_status = 'safety_review' then
    insert into public.peer_space_review_cases
      (message_id, room_id, subject_user_id, category, priority)
    values (new.id, new.room_id, new.author_user_id, new.risk_category, new.risk_priority)
    on conflict (message_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists peer_space_review_case_queue on public.peer_space_messages;
create trigger peer_space_review_case_queue
after insert or update of moderation_status on public.peer_space_messages
for each row execute function public.queue_peer_space_review_case();

create or replace function public.validate_peer_space_message_author()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.peer_space_room_memberships room_member
    join public.peer_space_memberships member on member.id = room_member.membership_id
    join public.peer_spaces space on space.id = member.space_id
    join public.peer_space_rooms room on room.id = room_member.room_id
    join public.student_consents consent on consent.student_user_id = member.user_id
    where room_member.id = new.room_membership_id
      and room_member.room_id = new.room_id
      and room_member.status = 'active'
      and room_member.visible_until is null
      and member.status = 'active'
      and member.user_id = new.author_user_id
      and space.age_scope = '18_plus'
      and space.status in ('invite_only', 'active')
      and room.status = 'staffed_open'
      and exists (
        select 1 from public.peer_space_duty_shifts shift
        where shift.room_id = room.id
          and shift.status in ('active', 'handoff_pending')
          and shift.lease_expires_at > now()
      )
      and consent.age_band = '18_plus'
      and consent.consent_basis = 'adult_self'
      and consent.status = 'active'
  ) then
    raise exception 'peer_space_message_author_not_eligible' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists peer_space_message_author_check on public.peer_space_messages;
create trigger peer_space_message_author_check
before insert on public.peer_space_messages
for each row execute function public.validate_peer_space_message_author();

alter table public.peer_space_messages enable row level security;
alter table public.peer_space_user_controls enable row level security;
alter table public.peer_space_message_reports enable row level security;
alter table public.peer_space_review_cases enable row level security;
alter table public.peer_space_review_events enable row level security;
revoke all on table public.peer_space_messages, public.peer_space_user_controls,
  public.peer_space_message_reports, public.peer_space_review_cases,
  public.peer_space_review_events from public, anon, authenticated;
grant select, insert, update on table public.peer_space_messages to service_role;
grant select, insert, delete on table public.peer_space_user_controls to service_role;
grant select, insert, update on table public.peer_space_message_reports to service_role;
grant select, insert, update on table public.peer_space_review_cases to service_role;
grant select, insert on table public.peer_space_review_events to service_role;
create policy peer_space_messages_server_only on public.peer_space_messages
  for all to service_role using (true) with check (true);
create policy peer_space_user_controls_server_only on public.peer_space_user_controls
  for all to service_role using (true) with check (true);
create policy peer_space_message_reports_server_only on public.peer_space_message_reports
  for all to service_role using (true) with check (true);
create policy peer_space_review_cases_server_only on public.peer_space_review_cases
  for all to service_role using (true) with check (true);
create policy peer_space_review_events_server_only on public.peer_space_review_events
  for all to service_role using (true) with check (true);
revoke all on function public.validate_peer_space_message_author() from public, anon, authenticated;
revoke all on function public.queue_peer_space_review_case() from public, anon, authenticated;

-- No chat table is added to the Realtime publication. Clients receive fresh
-- messages through short polling of the authenticated API, so every read checks
-- current age, invitation and room membership; old sockets receive no content.

-- Human review actions are atomic with their minimal audit event.
create or replace function public.process_peer_space_review_case(
  p_case_id uuid,
  p_actor_id uuid,
  p_next_status text,
  p_message_action text,
  p_note text,
  p_follow_up_required boolean,
  p_escalated boolean
)
returns table (review_case_id uuid, review_status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case public.peer_space_review_cases%rowtype;
  v_capability text;
  v_previous text;
begin
  if p_next_status not in ('pending', 'assigned', 'reviewing', 'action_required', 'referred', 'resolved', 'closed')
    or p_message_action not in ('none', 'hide', 'publish')
    or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid_peer_review_action' using errcode = '22023';
  end if;
  select * into v_case
  from public.peer_space_review_cases
  where id = p_case_id
  for update;
  if not found then
    raise exception 'peer_review_case_not_found' using errcode = '22023';
  end if;
  select assignment.capability into v_capability
  from public.peer_space_staff_assignments assignment
  join public.peer_space_rooms room on room.id = v_case.room_id
  where assignment.user_id = p_actor_id
    and assignment.space_id = room.space_id
    and (assignment.room_id is null or assignment.room_id = room.id)
    and assignment.status = 'active'
    and assignment.starts_at <= now()
    and (assignment.ends_at is null or assignment.ends_at > now())
    and assignment.capability in ('content_moderator', 'safety_duty')
    and (
      (v_case.category <> 'crisis' and v_case.priority <> 'urgent')
      or assignment.capability = 'safety_duty'
    )
  order by case when assignment.capability = 'content_moderator' then 0 else 1 end
  limit 1;
  if v_capability is null then
    raise exception 'peer_review_capability_required' using errcode = '42501';
  end if;
  if p_message_action = 'publish'
    and (v_case.category = 'crisis' or v_case.priority = 'urgent'
      or p_next_status not in ('resolved', 'closed')) then
    raise exception 'unsafe_peer_review_publish' using errcode = '42501';
  end if;
  if p_message_action = 'hide' then
    update public.peer_space_messages
    set moderation_status = 'hidden', hidden_at = now()
    where id = v_case.message_id and moderation_status <> 'deleted';
  elsif p_message_action = 'publish' then
    update public.peer_space_messages
    set moderation_status = 'visible', hidden_at = null
    where id = v_case.message_id and moderation_status <> 'deleted';
  end if;
  v_previous := v_case.status;
  update public.peer_space_review_cases
  set status = p_next_status,
      assigned_to = case when p_next_status in ('assigned', 'reviewing') then p_actor_id else assigned_to end,
      follow_up_required = p_follow_up_required,
      escalated = p_escalated,
      updated_at = now(),
      closed_at = case when p_next_status = 'closed' then now() else null end
  where id = p_case_id;
  insert into public.peer_space_review_events (
    case_id, actor_user_id, actor_ref, actor_capability, previous_status, next_status,
    note, follow_up_required, escalated
  ) values (
    p_case_id, p_actor_id, encode(sha256(convert_to(p_actor_id::text, 'UTF8')), 'hex'),
    v_capability, v_previous, p_next_status, nullif(trim(p_note), ''),
    p_follow_up_required, p_escalated
  );
  return query select p_case_id, p_next_status;
end;
$$;
revoke all on function public.process_peer_space_review_case(
  uuid, uuid, text, text, text, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.process_peer_space_review_case(
  uuid, uuid, text, text, text, boolean, boolean
) to service_role;
