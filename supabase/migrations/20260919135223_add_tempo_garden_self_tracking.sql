-- Tempo Garden derives growth from these participation facts and existing
-- sweet_records. No second mutable score, streak, or public profile field exists.
create table if not exists public.tempo_check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feeling text not null check (feeling in ('steady', 'mixed', 'heavy', 'unsure')),
  created_at timestamptz not null default now()
);

create index if not exists tempo_check_ins_user_created_idx
on public.tempo_check_ins(user_id, created_at desc);

create table if not exists public.tempo_reminder_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'off' check (mode in ('off', 'daily', 'weekly')),
  updated_at timestamptz not null default now()
);

alter table public.tempo_check_ins enable row level security;
alter table public.tempo_reminder_preferences enable row level security;
revoke all on table public.tempo_check_ins, public.tempo_reminder_preferences from public, anon, authenticated;
grant select, insert, delete on table public.tempo_check_ins to service_role;
grant select, insert, update, delete on table public.tempo_reminder_preferences to service_role;

-- Defense in depth: if table privileges are later changed, rows stay owner-only.
drop policy if exists tempo_check_ins_own on public.tempo_check_ins;
create policy tempo_check_ins_own on public.tempo_check_ins
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists tempo_reminder_preferences_own on public.tempo_reminder_preferences;
create policy tempo_reminder_preferences_own on public.tempo_reminder_preferences
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
