create table if not exists public.api_rate_limits (
  identifier_hash text not null check (identifier_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (char_length(action) between 1 and 50),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (identifier_hash, action, window_started_at)
);

alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from anon, authenticated;
grant all on table public.api_rate_limits to service_role;

drop policy if exists api_rate_limits_server_only on public.api_rate_limits;
create policy api_rate_limits_server_only on public.api_rate_limits
for all to authenticated using (false) with check (false);

create index if not exists api_rate_limits_window_idx
on public.api_rate_limits(window_started_at);

create or replace function public.consume_api_rate_limit(
  p_identifier_hash text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  if p_identifier_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_identifier_hash'; end if;
  if p_action is null or char_length(p_action) < 1 or char_length(p_action) > 50 then
    raise exception 'invalid_action';
  end if;
  if p_limit < 1 or p_limit > 1000 then raise exception 'invalid_limit'; end if;
  if p_window_seconds < 60 or p_window_seconds > 86400 then raise exception 'invalid_window'; end if;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits as rate_limit (
    identifier_hash, action, window_started_at, request_count, updated_at
  ) values (
    p_identifier_hash, p_action, v_window_started_at, 1, v_now
  )
  on conflict (identifier_hash, action, window_started_at)
  do update set
    request_count = rate_limit.request_count + 1,
    updated_at = excluded.updated_at
  returning request_count into v_request_count;

  delete from public.api_rate_limits
  where identifier_hash = p_identifier_hash
    and action = p_action
    and window_started_at < v_window_started_at - make_interval(secs => p_window_seconds * 6);

  if random() < 0.01 then
    delete from public.api_rate_limits
    where ctid in (
      select ctid from public.api_rate_limits
      where window_started_at < v_now - interval '2 days'
      order by window_started_at
      limit 500
    );
  end if;

  return query select
    v_request_count <= p_limit,
    greatest(p_limit - v_request_count, 0),
    v_window_started_at + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.consume_api_rate_limit(text, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer)
to service_role;
