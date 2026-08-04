create table if not exists public.community_blocks (
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint community_blocks_not_self check (blocker_user_id <> blocked_user_id)
);

create table if not exists public.community_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  restriction_type text not null default 'mute' check (restriction_type = 'mute'),
  reason text not null check (char_length(reason) between 1 and 500),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.community_blocks enable row level security;
alter table public.community_restrictions enable row level security;
revoke all on table public.community_blocks from anon, authenticated;
revoke all on table public.community_restrictions from anon, authenticated;
grant all on table public.community_blocks to service_role;
grant all on table public.community_restrictions to service_role;

drop policy if exists community_blocks_server_only on public.community_blocks;
create policy community_blocks_server_only on public.community_blocks
for all to authenticated using (false) with check (false);
drop policy if exists community_restrictions_server_only on public.community_restrictions;
create policy community_restrictions_server_only on public.community_restrictions
for all to authenticated using (false) with check (false);

create index if not exists community_blocks_blocked_idx
on public.community_blocks(blocked_user_id, blocker_user_id);
create index if not exists community_restrictions_active_user_idx
on public.community_restrictions(user_id, ends_at)
where status = 'active';
create unique index if not exists community_restrictions_one_active_idx
on public.community_restrictions(user_id, restriction_type)
where status = 'active';
create index if not exists community_restrictions_created_by_idx
on public.community_restrictions(created_by, created_at desc);

create unique index if not exists community_reports_open_post_once_idx
on public.community_reports(reporter_user_id, post_id)
where post_id is not null and status in ('new', 'reviewing');
create unique index if not exists community_reports_open_comment_once_idx
on public.community_reports(reporter_user_id, comment_id)
where comment_id is not null and status in ('new', 'reviewing');

create or replace function public.apply_community_restriction(
  p_user_id uuid,
  p_action text,
  p_duration_minutes integer,
  p_reason text,
  p_actor_user_id uuid
)
returns table(restriction_id uuid, status text, ends_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_restriction_id uuid;
  v_ends_at timestamptz;
begin
  if p_action not in ('mute', 'unmute') then raise exception 'invalid_action'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 or char_length(btrim(p_reason)) > 500 then
    raise exception 'invalid_reason';
  end if;
  if p_action = 'mute' and p_duration_minutes is not null and p_duration_minutes not in (1440, 10080, 43200) then
    raise exception 'invalid_duration';
  end if;

  update public.community_restrictions as restriction
  set status = 'revoked', revoked_at = now(), revoked_by = p_actor_user_id,
      revoked_reason = case
        when restriction.ends_at is not null and restriction.ends_at <= now() then '限制已到期'
        when p_action = 'unmute' then btrim(p_reason)
        else '由新的限制替代'
      end
  where restriction.user_id = p_user_id
    and restriction.restriction_type = 'mute'
    and restriction.status = 'active';

  if p_action = 'unmute' then
    return query select null::uuid, 'revoked'::text, null::timestamptz;
    return;
  end if;

  v_ends_at := case
    when p_duration_minutes is null then null
    else now() + make_interval(mins => p_duration_minutes)
  end;

  insert into public.community_restrictions (
    user_id, restriction_type, reason, starts_at, ends_at, status, created_by
  ) values (
    p_user_id, 'mute', btrim(p_reason), now(), v_ends_at, 'active', p_actor_user_id
  ) returning id into v_restriction_id;

  return query select v_restriction_id, 'active'::text, v_ends_at;
end;
$$;

revoke all on function public.apply_community_restriction(uuid, text, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_community_restriction(uuid, text, integer, text, uuid) to service_role;
