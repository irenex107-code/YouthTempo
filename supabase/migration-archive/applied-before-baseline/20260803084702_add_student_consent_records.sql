create table if not exists public.student_consents (
  student_user_id uuid primary key references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  age_band text not null check (age_band in ('under_14', '14_17', '18_plus')),
  policy_version text not null,
  status text not null check (status in ('pending_guardian', 'active', 'withdrawn', 'ineligible')),
  student_assented_at timestamptz,
  guardian_user_id uuid references auth.users(id) on delete set null,
  guardian_consented_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (guardian_user_id is null or guardian_user_id <> student_user_id),
  check (
    (status = 'active' and student_assented_at is not null and (age_band = '18_plus' or guardian_consented_at is not null))
    or status <> 'active'
  )
);

create table if not exists public.student_consent_events (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  guardian_user_id uuid references auth.users(id) on delete set null,
  actor_user_id uuid not null,
  event_type text not null check (event_type in ('student_assented', 'guardian_consented', 'consent_withdrawn', 'declared_under_14')),
  age_band text not null check (age_band in ('under_14', '14_17', '18_plus')),
  policy_version text not null,
  created_at timestamptz not null default now()
);

alter table public.student_consents enable row level security;
alter table public.student_consent_events enable row level security;

-- Consent state is exposed only through authenticated server routes. The
-- service role verifies the student/guardian relationship before every write.
revoke all privileges on table public.student_consents from anon, authenticated;
revoke all privileges on table public.student_consent_events from anon, authenticated;

create index if not exists student_consents_guardian_status_idx
on public.student_consents(guardian_user_id, status);

create index if not exists student_consent_events_student_created_idx
on public.student_consent_events(student_user_id, created_at desc);
