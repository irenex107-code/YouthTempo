-- Finish the baseline replay without ever leaving pilot_feedback readable by
-- an authenticated client. This also repairs an existing installation where
-- the historical feedback migration was already recorded before the guard.
do $$
begin
  if to_regclass('public.pilot_feedback') is null then
    raise exception 'pilot_feedback table is missing';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pilot_feedback'
      and policyname = 'pilot_feedback_server_only'
  ) then
    alter policy pilot_feedback_server_only on public.pilot_feedback
      to authenticated using (false) with check (false);
  else
    create policy pilot_feedback_server_only on public.pilot_feedback
      for all to authenticated using (false) with check (false);
  end if;

  drop policy if exists pilot_feedback_replay_guard on public.pilot_feedback;
end;
$$;
