-- The consolidated baseline already contains the deny-only feedback policy.
-- Keep that denial active under a temporary name while the historical
-- 20260804045916 migration creates its canonical policy name.
do $$
begin
  if to_regclass('public.pilot_feedback') is not null
    and exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'pilot_feedback'
        and policyname = 'pilot_feedback_server_only'
    )
    and not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'pilot_feedback'
        and policyname = 'pilot_feedback_replay_guard'
    ) then
    alter policy pilot_feedback_server_only on public.pilot_feedback
      rename to pilot_feedback_replay_guard;
  end if;
end;
$$;
