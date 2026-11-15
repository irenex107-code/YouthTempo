-- Local scope explicitly approved on 2026-10-29. Applying this migration to
-- any remote project or cleaning existing real data requires separate approval.
-- A DELETE establishes a same-day cutoff: older retained rows must not become
-- report sources again, while strictly newer rows remain untouched.
create function private.clear_retained_sweet_days_after_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Auth's maintenance role cannot SELECT/DELETE sweet_records directly. Its
  -- foreign-key cascade already removes every source row of the deleted user;
  -- preserve account deletion without granting that role application access.
  if current_user = 'supabase_auth_admin' then
    return null;
  end if;

  -- The transition relation belongs to this DELETE statement. An empty set
  -- must not issue another DELETE and recurse through statement triggers.
  if not exists (select 1 from sweet_deleted_rows where isfinite(created_at)) then
    return null;
  end if;

  if not exists (
    with cutoffs as materialized (
      select user_id, (created_at at time zone 'Asia/Shanghai')::date as local_day,
        max(created_at) as through_instant
      from sweet_deleted_rows
      where isfinite(created_at)
      group by user_id, (created_at at time zone 'Asia/Shanghai')::date
    )
    select 1
    from public.sweet_records r
    join cutoffs c on c.user_id = r.user_id
      and r.created_at >= (c.local_day::timestamp at time zone 'Asia/Shanghai')
      and r.created_at <= c.through_instant
    where isfinite(r.created_at)
  ) then
    return null;
  end if;

  -- The existing BEFORE STATEMENT report write lock is already held. This
  -- nested statement re-enters the same transaction lock, retains RLS and uses
  -- the same actor. It neither adds a second lock nor writes source revisions.
  with cutoffs as materialized (
    select user_id, (created_at at time zone 'Asia/Shanghai')::date as local_day,
      max(created_at) as through_instant
    from sweet_deleted_rows
    where isfinite(created_at)
    group by user_id, (created_at at time zone 'Asia/Shanghai')::date
  )
  delete from public.sweet_records r
  using cutoffs c
  where r.user_id = c.user_id
    and isfinite(r.created_at)
    and r.created_at >= (c.local_day::timestamp at time zone 'Asia/Shanghai')
    and r.created_at <= c.through_instant;

  return null;
end;
$$;
revoke all on function private.clear_retained_sweet_days_after_delete()
  from public, anon, authenticated, service_role;

create trigger sweet_records_clear_retained_days_after_delete
  after delete on public.sweet_records
  referencing old table as sweet_deleted_rows
  for each statement
  execute function private.clear_retained_sweet_days_after_delete();
