alter table public.professional_verifications
add column if not exists institution_name text,
add column if not exists position_title text,
add column if not exists credential_type text,
add column if not exists credential_number text,
add column if not exists credential_issuer text,
add column if not exists credential_expires_on date,
add column if not exists evidence_reference text,
add column if not exists applicant_statement text,
add column if not exists verification_basis text not null default 'document_review',
add column if not exists credential_verified boolean not null default false,
add column if not exists institution_verified boolean not null default false,
add column if not exists submitted_at timestamptz,
add column if not exists reviewed_at timestamptz,
add column if not exists review_note text;

update public.professional_verifications
set verification_basis = 'legacy_platform_confirmation',
    credential_verified = true,
    institution_verified = true,
    submitted_at = coalesce(submitted_at, created_at),
    reviewed_at = coalesce(reviewed_at, updated_at, created_at)
where institution_name is null
  and credential_type is null
  and credential_number is null;

alter table public.professional_verifications
drop constraint if exists professional_verifications_status_check;

alter table public.professional_verifications
add constraint professional_verifications_status_check
check (status in ('pending', 'needs_more_info', 'active', 'rejected', 'revoked')),
add constraint professional_verifications_basis_check
check (verification_basis in ('document_review', 'legacy_platform_confirmation')),
add constraint professional_verifications_institution_name_length_check
check (institution_name is null or char_length(btrim(institution_name)) between 2 and 120),
add constraint professional_verifications_position_title_length_check
check (position_title is null or char_length(btrim(position_title)) between 2 and 80),
add constraint professional_verifications_credential_type_length_check
check (credential_type is null or char_length(btrim(credential_type)) between 2 and 80),
add constraint professional_verifications_credential_number_length_check
check (credential_number is null or char_length(btrim(credential_number)) between 2 and 120),
add constraint professional_verifications_credential_issuer_length_check
check (credential_issuer is null or char_length(btrim(credential_issuer)) between 2 and 120),
add constraint professional_verifications_evidence_reference_length_check
check (evidence_reference is null or char_length(btrim(evidence_reference)) between 5 and 500),
add constraint professional_verifications_applicant_statement_length_check
check (applicant_statement is null or char_length(btrim(applicant_statement)) <= 1000),
add constraint professional_verifications_review_note_length_check
check (review_note is null or char_length(btrim(review_note)) between 2 and 1000),
add constraint professional_verifications_expiry_check
check (credential_expires_on is null or credential_expires_on >= submitted_at::date),
add constraint professional_verifications_active_review_check
check (
  status <> 'active'
  or (
    reviewed_at is not null
    and (
      verification_basis = 'legacy_platform_confirmation'
      or (
        verified_by is not null
        and credential_verified
        and institution_verified
        and institution_name is not null
        and position_title is not null
        and credential_type is not null
        and credential_number is not null
        and credential_issuer is not null
        and evidence_reference is not null
      )
    )
  )
);

create index if not exists professional_verifications_status_submitted_idx
on public.professional_verifications(status, submitted_at desc);

create index if not exists professional_verifications_active_expiry_idx
on public.professional_verifications(status, credential_expires_on)
where status = 'active';

create table if not exists public.professional_verification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (
    action in ('submitted', 'resubmitted', 'approved', 'changes_requested', 'rejected', 'revoked', 'expired', 'legacy_imported')
  ),
  previous_status text check (
    previous_status is null
    or previous_status in ('pending', 'needs_more_info', 'active', 'rejected', 'revoked')
  ),
  new_status text not null check (
    new_status in ('pending', 'needs_more_info', 'active', 'rejected', 'revoked')
  ),
  note text check (note is null or char_length(btrim(note)) between 2 and 1000),
  created_at timestamptz not null default now()
);

alter table public.professional_verification_events enable row level security;
revoke all on table public.professional_verification_events from anon, authenticated;
grant all on table public.professional_verification_events to service_role;

create policy professional_verification_events_server_only
on public.professional_verification_events
for all
to authenticated
using (false)
with check (false);

create index if not exists professional_verification_events_user_created_idx
on public.professional_verification_events(user_id, created_at desc);

create index if not exists professional_verification_events_actor_created_idx
on public.professional_verification_events(actor_user_id, created_at desc)
where actor_user_id is not null;

insert into public.professional_verification_events (
  user_id,
  actor_user_id,
  action,
  previous_status,
  new_status,
  note,
  created_at
)
select
  user_id,
  verified_by,
  'legacy_imported',
  null,
  status,
  '迁移前已由平台确认的专业支持者记录。',
  coalesce(reviewed_at, updated_at, created_at)
from public.professional_verifications
where verification_basis = 'legacy_platform_confirmation'
  and not exists (
    select 1
    from public.professional_verification_events event
    where event.user_id = professional_verifications.user_id
      and event.action = 'legacy_imported'
  );

create or replace function public.submit_professional_verification(
  p_user_id uuid,
  p_institution_name text,
  p_position_title text,
  p_credential_type text,
  p_credential_number text,
  p_credential_issuer text,
  p_credential_expires_on date,
  p_evidence_reference text,
  p_applicant_statement text
)
returns table(status text, submitted_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous_status text;
  v_submitted_at timestamptz := now();
  v_action text;
begin
  select verification.status
  into v_previous_status
  from public.professional_verifications verification
  where verification.user_id = p_user_id
  for update;

  if v_previous_status = 'active' then
    raise exception 'professional_verification_already_active' using errcode = '23514';
  end if;

  if p_credential_expires_on is not null and p_credential_expires_on < current_date then
    raise exception 'professional_credential_expired' using errcode = '23514';
  end if;

  insert into public.professional_verifications (
    user_id,
    verified_by,
    status,
    institution_name,
    position_title,
    credential_type,
    credential_number,
    credential_issuer,
    credential_expires_on,
    evidence_reference,
    applicant_statement,
    verification_basis,
    credential_verified,
    institution_verified,
    submitted_at,
    reviewed_at,
    review_note,
    revoked_at,
    updated_at
  ) values (
    p_user_id,
    null,
    'pending',
    btrim(p_institution_name),
    btrim(p_position_title),
    btrim(p_credential_type),
    btrim(p_credential_number),
    btrim(p_credential_issuer),
    p_credential_expires_on,
    btrim(p_evidence_reference),
    nullif(btrim(p_applicant_statement), ''),
    'document_review',
    false,
    false,
    v_submitted_at,
    null,
    null,
    null,
    v_submitted_at
  )
  on conflict (user_id) do update
  set verified_by = null,
      status = 'pending',
      institution_name = excluded.institution_name,
      position_title = excluded.position_title,
      credential_type = excluded.credential_type,
      credential_number = excluded.credential_number,
      credential_issuer = excluded.credential_issuer,
      credential_expires_on = excluded.credential_expires_on,
      evidence_reference = excluded.evidence_reference,
      applicant_statement = excluded.applicant_statement,
      verification_basis = 'document_review',
      credential_verified = false,
      institution_verified = false,
      submitted_at = excluded.submitted_at,
      reviewed_at = null,
      review_note = null,
      revoked_at = null,
      updated_at = excluded.updated_at;

  v_action := case when v_previous_status is null then 'submitted' else 'resubmitted' end;

  insert into public.professional_verification_events (
    user_id,
    actor_user_id,
    action,
    previous_status,
    new_status
  ) values (
    p_user_id,
    p_user_id,
    v_action,
    v_previous_status,
    'pending'
  );

  return query select 'pending'::text, v_submitted_at;
end;
$$;

revoke all on function public.submit_professional_verification(uuid, text, text, text, text, text, date, text, text)
from public, anon, authenticated;
grant execute on function public.submit_professional_verification(uuid, text, text, text, text, text, date, text, text)
to service_role;

create or replace function public.review_professional_verification(
  p_user_id uuid,
  p_action text,
  p_note text,
  p_actor_user_id uuid
)
returns table(status text, reviewed_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous_status text;
  v_next_status text;
  v_reviewed_at timestamptz := now();
  v_note text := nullif(btrim(p_note), '');
begin
  if p_action not in ('approve', 'request_changes', 'reject', 'revoke') then
    raise exception 'invalid_professional_review_action' using errcode = '22023';
  end if;

  if p_action <> 'approve' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'professional_review_note_required' using errcode = '23514';
  end if;

  select verification.status
  into v_previous_status
  from public.professional_verifications verification
  where verification.user_id = p_user_id
  for update;

  if v_previous_status is null then
    raise exception 'professional_verification_not_found' using errcode = 'P0002';
  end if;

  v_next_status := case p_action
    when 'approve' then 'active'
    when 'request_changes' then 'needs_more_info'
    when 'reject' then 'rejected'
    else 'revoked'
  end;

  if p_action = 'approve' and exists (
    select 1
    from public.professional_verifications verification
    where verification.user_id = p_user_id
      and (
        verification.institution_name is null
        or verification.position_title is null
        or verification.credential_type is null
        or verification.credential_number is null
        or verification.credential_issuer is null
        or verification.evidence_reference is null
        or verification.credential_expires_on < current_date
      )
  ) then
    raise exception 'professional_verification_incomplete_or_expired' using errcode = '23514';
  end if;

  update public.professional_verifications
  set status = v_next_status,
      verified_by = p_actor_user_id,
      credential_verified = p_action = 'approve',
      institution_verified = p_action = 'approve',
      reviewed_at = v_reviewed_at,
      review_note = v_note,
      revoked_at = case when p_action = 'revoke' then v_reviewed_at else null end,
      updated_at = v_reviewed_at
  where user_id = p_user_id;

  if p_action = 'approve' then
    update public.profiles
    set role = '专业支持者', updated_at = v_reviewed_at
    where id = p_user_id;
  else
    update public.profiles
    set role = '学生', updated_at = v_reviewed_at
    where id = p_user_id
      and role = '专业支持者';
  end if;

  insert into public.professional_verification_events (
    user_id,
    actor_user_id,
    action,
    previous_status,
    new_status,
    note
  ) values (
    p_user_id,
    p_actor_user_id,
    case p_action
      when 'approve' then 'approved'
      when 'request_changes' then 'changes_requested'
      when 'reject' then 'rejected'
      else 'revoked'
    end,
    v_previous_status,
    v_next_status,
    v_note
  );

  return query select v_next_status, v_reviewed_at;
end;
$$;

revoke all on function public.review_professional_verification(uuid, text, text, uuid)
from public, anon, authenticated;
grant execute on function public.review_professional_verification(uuid, text, text, uuid)
to service_role;

create or replace function public.expire_professional_verifications()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_expired_count integer := 0;
begin
  for v_user_id in
    update public.professional_verifications
    set status = 'needs_more_info',
        credential_verified = false,
        institution_verified = false,
        reviewed_at = now(),
        review_note = '资质有效期已到，请更新有效资质后重新提交。',
        updated_at = now()
    where status = 'active'
      and verification_basis = 'document_review'
      and credential_expires_on < current_date
    returning user_id
  loop
    update public.profiles
    set role = '学生', updated_at = now()
    where id = v_user_id
      and role = '专业支持者';

    insert into public.professional_verification_events (
      user_id,
      actor_user_id,
      action,
      previous_status,
      new_status,
      note
    ) values (
      v_user_id,
      null,
      'expired',
      'active',
      'needs_more_info',
      '资质有效期已到，请更新有效资质后重新提交。'
    );

    v_expired_count := v_expired_count + 1;
  end loop;

  return v_expired_count;
end;
$$;

revoke all on function public.expire_professional_verifications()
from public, anon, authenticated;
grant execute on function public.expire_professional_verifications()
to postgres, service_role;

select cron.schedule(
  'youthtempo-expire-professional-verifications',
  '27 3 * * *',
  $$select public.expire_professional_verifications();$$
);
