create table if not exists public.pilot_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('student', 'guardian', 'teacher')),
  form_version text not null default '2026-08',
  overall_experience smallint not null check (overall_experience between 1 and 5),
  clarity smallint not null check (clarity between 1 and 5),
  safety smallint not null check (safety between 1 and 5),
  most_helpful text not null default '' check (char_length(most_helpful) <= 1000),
  hard_to_use text not null default '' check (char_length(hard_to_use) <= 1000),
  suggestion text not null default '' check (char_length(suggestion) <= 1000),
  may_contact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, form_version)
);

alter table public.pilot_feedback enable row level security;
revoke all on table public.pilot_feedback from anon, authenticated;
grant all on table public.pilot_feedback to service_role;

create policy pilot_feedback_server_only on public.pilot_feedback
for all to authenticated using (false) with check (false);

create index if not exists pilot_feedback_user_updated_idx
on public.pilot_feedback(user_id, updated_at desc);

create index if not exists pilot_feedback_role_version_updated_idx
on public.pilot_feedback(role, form_version, updated_at desc);
