-- Keep browser clients from assigning school ownership while allowing trusted
-- service-role routes and SECURITY DEFINER maintenance functions to do so.
create or replace function public.enforce_profile_school_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' and new.school_id is not null then
    raise exception 'profile_school_assignment_server_only' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.school_id is distinct from old.school_id then
    raise exception 'profile_school_assignment_server_only' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_profile_school_assignment()
from public, anon, authenticated;
