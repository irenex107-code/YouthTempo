-- A private, optional prompt record. Both dismissal and submission start the
-- seven-day cooldown; the server decides age band and feature context.
create table public.pilot_experience_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  age_band text not null check (age_band in ('14_17', '18_plus')),
  feature text not null check (feature in ('quick_check_in', 'sweet', 'peer_space', 'support', 'mood_journal', 'worry_time')),
  outcome text not null check (outcome in ('dismissed', 'submitted')),
  helpful boolean,
  would_return boolean,
  wants_human_support boolean,
  comment text check (comment is null or char_length(comment) <= 500),
  safety_review boolean not null default false,
  review_status text not null default 'pending' check (review_status in ('pending', 'reviewed')),
  created_at timestamptz not null default now(),
  check (
    (outcome = 'dismissed' and helpful is null and would_return is null
      and wants_human_support is null and comment is null and safety_review = false)
    or outcome = 'submitted'
  )
);
create index pilot_experience_feedback_user_created_idx
  on public.pilot_experience_feedback(user_id, created_at desc);
create index pilot_experience_feedback_review_idx
  on public.pilot_experience_feedback(safety_review, review_status, created_at desc);

create or replace function public.enforce_pilot_experience_cooldown()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 20260919));
  if exists (
    select 1 from public.pilot_experience_feedback previous
    where previous.user_id = new.user_id
      and previous.created_at > now() - interval '7 days'
  ) then
    raise exception 'pilot_feedback_cooldown' using errcode = '23505';
  end if;
  return new;
end;
$$;
create trigger pilot_experience_cooldown before insert
  on public.pilot_experience_feedback
  for each row execute function public.enforce_pilot_experience_cooldown();

alter table public.pilot_experience_feedback enable row level security;
revoke all on public.pilot_experience_feedback from public, anon, authenticated;
grant select, insert, update on public.pilot_experience_feedback to service_role;
create policy pilot_experience_feedback_server_only
  on public.pilot_experience_feedback for all to service_role
  using (true) with check (true);
revoke all on function public.enforce_pilot_experience_cooldown() from public, anon, authenticated;
