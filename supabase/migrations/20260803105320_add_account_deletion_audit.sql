create table if not exists public.account_deletion_audits (
  id uuid primary key default gen_random_uuid(),
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  account_role text not null check (char_length(account_role) between 1 and 50),
  deletion_summary jsonb not null default '{}'::jsonb,
  status text not null default 'completed' check (status in ('completed', 'cleanup_required')),
  completed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 months')
);

alter table public.account_deletion_audits enable row level security;
revoke all on table public.account_deletion_audits from anon, authenticated;
grant all on table public.account_deletion_audits to service_role;

create policy account_deletion_audits_server_only
on public.account_deletion_audits
for all to authenticated using (false) with check (false);

create index if not exists account_deletion_audits_expires_idx
on public.account_deletion_audits(expires_at);
