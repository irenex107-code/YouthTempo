-- Keep older clients compatible when they echo the existing school_id while
-- preventing authenticated users from choosing or changing that assignment.
create or replace function public.enforce_profile_school_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.school_id is not null then
    raise exception 'profile_school_assignment_server_only' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.school_id is distinct from old.school_id then
    raise exception 'profile_school_assignment_server_only' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_profile_school_assignment() from public, anon, authenticated;

drop trigger if exists enforce_profile_school_assignment on public.profiles;
create trigger enforce_profile_school_assignment
before insert or update of school_id on public.profiles
for each row execute function public.enforce_profile_school_assignment();

grant insert (school_id) on table public.profiles to authenticated;
grant update (school_id) on table public.profiles to authenticated;
