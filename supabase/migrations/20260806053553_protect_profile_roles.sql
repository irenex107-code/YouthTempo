-- Application users may create and maintain their own profile row, but role is
-- authorization data and must only be changed by trusted server workflows.
revoke insert (role) on table public.profiles from authenticated;
revoke update (role) on table public.profiles from authenticated;

create or replace function public.enforce_profile_role_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' and new.role is distinct from '学生' then
    raise exception 'profile_role_assignment_server_only' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    raise exception 'profile_role_assignment_server_only' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_profile_role_assignment() from public, anon, authenticated;

drop trigger if exists enforce_profile_role_assignment on public.profiles;
create trigger enforce_profile_role_assignment
before insert or update of role on public.profiles
for each row execute function public.enforce_profile_role_assignment();
