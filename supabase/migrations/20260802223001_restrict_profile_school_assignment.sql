-- Profile ownership does not imply permission to choose a school. School
-- assignment is managed by trusted server routes through the service role.
revoke insert, update on table public.profiles from anon, authenticated;

grant insert (id, email, display_name, role, updated_at)
on table public.profiles to authenticated;

grant update (email, display_name, role, updated_at)
on table public.profiles to authenticated;
