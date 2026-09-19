-- Internal-only support workflow. Public consultation stays disabled by default
-- in server configuration. These tables grant no browser Data API access.
create table public.support_staff_applications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  category text not null check (category in ('counselor', 'social_worker', 'listening_volunteer', 'school_duty_teacher')),
  status text not null default 'pending' check (status in ('pending', 'trial', 'approved', 'paused', 'removed', 'rejected')),
  legal_name text not null check (char_length(legal_name) between 2 and 120),
  credential_type text check (credential_type is null or char_length(credential_type) <= 120),
  credential_number text check (credential_number is null or char_length(credential_number) <= 120),
  evidence_path text check (evidence_path is null or char_length(evidence_path) <= 300),
  service_languages text[] not null default array['zh-CN']::text[],
  age_scopes text[] not null default array['18_plus']::text[],
  service_scope text not null check (char_length(service_scope) between 1 and 500),
  availability text not null check (char_length(availability) between 1 and 500),
  institution_name text check (institution_name is null or char_length(institution_name) <= 160),
  boundaries_confirmed boolean not null,
  crisis_rules_confirmed boolean not null,
  privacy_rules_confirmed boolean not null,
  invited_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (service_languages <@ array['zh-CN','en']::text[]),
  check (age_scopes <@ array['14_17','18_plus']::text[]),
  check (cardinality(service_languages) > 0 and cardinality(age_scopes) > 0),
  check ((boundaries_confirmed and crisis_rules_confirmed and privacy_rules_confirmed)
    or (category = 'school_duty_teacher' and status = 'pending')),
  check (category <> 'school_duty_teacher' or age_scopes = array['14_17']::text[])
);
create index support_staff_applications_status_idx on public.support_staff_applications(status, category);

create or replace function public.validate_support_staff_invitation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.category = 'school_duty_teacher' and new.invited_by is null then
    raise exception 'school_duty_invitation_required' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger support_staff_invitation_check before insert
on public.support_staff_applications for each row
execute function public.validate_support_staff_invitation();

create table public.support_staff_events (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_ref text not null,
  previous_status text,
  next_status text not null,
  action text not null check (action in ('applied', 'invited', 'reviewed', 'paused', 'resumed', 'removed')),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index support_staff_events_user_created_idx on public.support_staff_events(staff_user_id, created_at);

create or replace function public.audit_support_staff_status()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_actor uuid;
  v_action text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  v_actor := coalesce(new.reviewed_by, new.invited_by, new.user_id);
  v_action := case
    when tg_op = 'INSERT' and new.invited_by is not null then 'invited'
    when tg_op = 'INSERT' then 'applied'
    when new.status = 'paused' then 'paused'
    when new.status = 'removed' then 'removed'
    when old.status = 'paused' and new.status = 'approved' then 'resumed'
    else 'reviewed'
  end;
  insert into public.support_staff_events
    (staff_user_id, actor_user_id, actor_ref, previous_status, next_status, action, note)
  values
    (new.user_id, v_actor, encode(sha256(convert_to(v_actor::text, 'UTF8')), 'hex'),
      case when tg_op = 'INSERT' then null else old.status end,
      new.status, v_action, new.review_note);
  return new;
end;
$$;
create trigger support_staff_status_audit after insert or update of status
on public.support_staff_applications for each row
execute function public.audit_support_staff_status();

create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  case_type text not null check (case_type in ('youth_request', 'adult_consultation')),
  risk_priority text not null default 'standard' check (risk_priority in ('standard', 'urgent')),
  status text not null default 'requested'
    check (status in ('requested', 'triage', 'awaiting_assignment', 'assigned', 'active', 'paused', 'transfer_requested', 'transferred', 'referred', 'closed', 'cancelled')),
  need_summary text not null check (char_length(need_summary) between 1 and 1000),
  availability text check (availability is null or char_length(availability) <= 500),
  appointment_at timestamptz,
  appointment_status text not null default 'none'
    check (appointment_status in ('none', 'proposed', 'accepted', 'reschedule_requested', 'cancelled')),
  referral_type text check (referral_type is null or referral_type in ('school', 'social_work', 'medical', 'professional', 'community')),
  student_authorization_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index support_cases_student_created_idx on public.support_cases(student_user_id, created_at desc);
create index support_cases_queue_idx on public.support_cases(status, case_type, created_at);

create table public.support_case_assignments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  assignment_role text not null check (assignment_role in ('primary', 'backup')),
  status text not null default 'offered' check (status in ('offered', 'accepted', 'rejected', 'revoked')),
  offered_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  offered_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  unique (case_id, staff_user_id, assignment_role)
);
create unique index support_case_assignments_one_primary_idx on public.support_case_assignments(case_id)
where assignment_role = 'primary' and status in ('offered', 'accepted');
create unique index support_case_assignments_one_backup_idx on public.support_case_assignments(case_id)
where assignment_role = 'backup' and status in ('offered', 'accepted');
create index support_case_assignments_staff_idx on public.support_case_assignments(staff_user_id, status);

create table public.support_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_ref text not null,
  actor_role text not null check (actor_role in ('student', 'admin', 'staff')),
  action text not null check (char_length(action) between 1 and 80),
  previous_status text,
  next_status text,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index support_case_events_case_created_idx on public.support_case_events(case_id, created_at);

create or replace function public.audit_support_case_creation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  insert into public.support_case_events
    (case_id, actor_user_id, actor_ref, actor_role, action, next_status)
  values
    (new.id, new.student_user_id,
      encode(sha256(convert_to(new.student_user_id::text, 'UTF8')), 'hex'),
      'student', 'requested', new.status);
  return new;
end;
$$;
create trigger support_case_creation_audit after insert on public.support_cases
for each row execute function public.audit_support_case_creation();

create or replace function public.audit_support_case_assignment()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_actor uuid;
  v_previous_case_status text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  v_actor := case when tg_op = 'INSERT' then new.offered_by else new.updated_by end;
  if v_actor is null then
    raise exception 'support_assignment_actor_required' using errcode = '22023';
  end if;
  insert into public.support_case_events
    (case_id, actor_user_id, actor_ref, actor_role, action, previous_status, next_status)
  values (new.case_id, v_actor, encode(sha256(convert_to(v_actor::text, 'UTF8')), 'hex'),
    case when tg_op = 'INSERT' or new.status = 'revoked' then 'admin' else 'staff' end,
    'assignment_' || new.assignment_role || '_' || new.status,
    case when tg_op = 'INSERT' then null else old.status end, new.status);
  if tg_op = 'UPDATE' and new.assignment_role = 'primary' and new.status = 'accepted' then
    select status into v_previous_case_status from public.support_cases
    where id = new.case_id for update;
    update public.support_cases
    set status = 'assigned', updated_at = now()
    where id = new.case_id and status in ('awaiting_assignment', 'transfer_requested', 'transferred', 'triage', 'requested');
    if not found then
      raise exception 'support_case_not_ready_for_acceptance' using errcode = '42501';
    end if;
    insert into public.support_case_events
      (case_id, actor_user_id, actor_ref, actor_role, action, previous_status, next_status)
    values (new.case_id, v_actor, encode(sha256(convert_to(v_actor::text, 'UTF8')), 'hex'),
      'staff', 'primary_offer_accepted', v_previous_case_status, 'assigned');
  end if;
  return new;
end;
$$;
create trigger support_case_assignment_audit after insert or update of status
on public.support_case_assignments for each row
execute function public.audit_support_case_assignment();

create or replace function public.transition_support_case(
  p_case_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_action text,
  p_next_status text,
  p_expected_status text,
  p_note text,
  p_appointment_at timestamptz,
  p_appointment_status text,
  p_referral_type text,
  p_authorization_active boolean
)
returns table (case_id uuid, case_status text)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_case public.support_cases%rowtype;
begin
  if p_actor_role not in ('student', 'admin', 'staff')
    or char_length(coalesce(p_action, '')) not between 1 and 80
    or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid_support_transition' using errcode = '22023';
  end if;
  select * into v_case from public.support_cases where id = p_case_id for update;
  if not found then raise exception 'support_case_not_found' using errcode = '22023'; end if;
  if v_case.status <> p_expected_status
    or (p_actor_role = 'student' and v_case.student_user_id <> p_actor_id)
    or (not v_case.student_authorization_active and p_authorization_active) then
    raise exception 'support_case_state_changed' using errcode = '42501';
  end if;
  if p_actor_role = 'student'
    and not (
      (p_action = 'cancel' and v_case.status in ('requested', 'triage', 'awaiting_assignment', 'assigned') and p_next_status = 'cancelled')
      or (p_action = 'accept_assignment' and v_case.status = 'assigned' and p_next_status = 'active'
        and exists (
          select 1 from public.support_case_assignments assignment
          join public.support_staff_applications staff on staff.user_id = assignment.staff_user_id
          where assignment.case_id = p_case_id
            and assignment.assignment_role = 'primary'
            and assignment.status = 'accepted'
            and staff.status = 'approved'
        ))
      or (p_action in ('reject_assignment', 'request_change')
        and ((v_case.status = 'assigned' and p_action = 'reject_assignment')
          or (v_case.status = 'active' and p_action = 'request_change'))
        and p_next_status = 'transfer_requested')
      or (p_action = 'withdraw_authorization' and v_case.status in ('active', 'paused', 'transfer_requested')
        and p_next_status = 'paused' and not p_authorization_active)
      or (p_action = 'close' and v_case.status in ('active', 'paused', 'transfer_requested', 'transferred', 'referred')
        and p_next_status = 'closed' and not p_authorization_active)
      or (p_action in ('accept_appointment', 'request_reschedule', 'cancel_appointment')
        and v_case.status = 'active' and p_next_status = 'active')
    ) then
    raise exception 'support_case_student_action_invalid' using errcode = '42501';
  end if;
  update public.support_cases
  set status = p_next_status,
      appointment_at = p_appointment_at,
      appointment_status = p_appointment_status,
      referral_type = p_referral_type,
      student_authorization_active = p_authorization_active,
      updated_at = now(),
      closed_at = case when p_next_status in ('closed', 'cancelled') then now() else null end
  where id = p_case_id;
  insert into public.support_case_events
    (case_id, actor_user_id, actor_ref, actor_role, action, previous_status, next_status, note)
  values (p_case_id, p_actor_id, encode(sha256(convert_to(p_actor_id::text, 'UTF8')), 'hex'),
    p_actor_role, p_action, v_case.status, p_next_status, nullif(trim(p_note), ''));
  return query select p_case_id, p_next_status;
end;
$$;

create table public.support_case_feedback (
  case_id uuid primary key references public.support_cases(id) on delete cascade,
  student_user_id uuid not null references auth.users(id) on delete cascade,
  felt_heard boolean,
  found_help boolean,
  boundaries_respected boolean,
  would_choose_again boolean,
  complaint boolean not null default false,
  safety_review boolean not null default false,
  comment text check (comment is null or char_length(comment) <= 500),
  review_status text not null default 'pending' check (review_status in ('pending', 'reviewed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  created_at timestamptz not null default now()
);

create table public.support_case_feedback_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_case_feedback(case_id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_ref text not null,
  action text not null check (action in ('reviewed')),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create table public.support_staff_training_records (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  training_title text not null check (char_length(training_title) between 1 and 160),
  completed_at timestamptz not null,
  verified_by uuid references auth.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index support_staff_training_user_idx on public.support_staff_training_records(staff_user_id, completed_at desc);

create or replace function public.review_support_case_feedback(
  p_case_id uuid, p_actor_id uuid, p_note text
)
returns boolean language plpgsql security invoker set search_path = ''
as $$
begin
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid_feedback_review_note' using errcode = '22023';
  end if;
  update public.support_case_feedback
  set review_status = 'reviewed', reviewed_by = p_actor_id,
      reviewed_at = now(), review_note = nullif(trim(p_note), '')
  where case_id = p_case_id and review_status = 'pending';
  if not found then return false; end if;
  insert into public.support_case_feedback_events
    (case_id, actor_user_id, actor_ref, action, note)
  values (p_case_id, p_actor_id,
    encode(sha256(convert_to(p_actor_id::text, 'UTF8')), 'hex'),
    'reviewed', nullif(trim(p_note), ''));
  return true;
end;
$$;

create or replace function public.validate_support_case()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_role text;
  v_school uuid;
  v_age text;
  v_basis text;
  v_status text;
  v_policy text;
  v_assented timestamptz;
begin
  select role, school_id into v_role, v_school
  from public.profiles where id = new.student_user_id;
  select age_band, consent_basis, status, policy_version, student_assented_at
  into v_age, v_basis, v_status, v_policy, v_assented
  from public.student_consents where student_user_id = new.student_user_id;
  if v_role <> '学生' or v_status <> 'active'
    or v_policy <> '2026-08-28' or v_assented is null
    or (new.case_type = 'adult_consultation' and (v_age <> '18_plus' or v_basis <> 'adult_self'))
    or (new.case_type = 'youth_request' and v_age <> '14_17') then
    raise exception 'support_case_student_not_eligible' using errcode = '42501';
  end if;
  new.school_id := v_school;
  return new;
end;
$$;
create trigger support_case_student_check before insert on public.support_cases
for each row execute function public.validate_support_case();

create or replace function public.validate_support_case_assignment()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_case public.support_cases%rowtype;
  v_category text;
begin
  select * into v_case from public.support_cases where id = new.case_id;
  select category into v_category from public.support_staff_applications
  where user_id = new.staff_user_id and status = 'approved'
    and (
      (v_case.case_type = 'adult_consultation' and '18_plus' = any(age_scopes))
      or (v_case.case_type = 'youth_request' and '14_17' = any(age_scopes))
    );
  if v_category is null
    or v_case.status in ('closed', 'cancelled', 'referred')
    or (v_case.case_type = 'adult_consultation' and v_category <> 'counselor')
    or (v_category = 'school_duty_teacher' and not exists (
      select 1 from public.teacher_student_assignments assignment
      where assignment.teacher_user_id = new.staff_user_id
        and assignment.student_user_id = v_case.student_user_id
        and assignment.school_id = v_case.school_id
        and assignment.status = 'active'
    )) then
    raise exception 'support_staff_not_eligible' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger support_case_assignment_check before insert
on public.support_case_assignments for each row
execute function public.validate_support_case_assignment();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-staff-evidence', 'support-staff-evidence', false, 5242880,
  array['application/pdf','image/jpeg','image/png']::text[])
on conflict (id) do nothing;

alter table public.support_staff_applications enable row level security;
alter table public.support_staff_events enable row level security;
alter table public.support_cases enable row level security;
alter table public.support_case_assignments enable row level security;
alter table public.support_case_events enable row level security;
alter table public.support_case_feedback enable row level security;
alter table public.support_case_feedback_events enable row level security;
alter table public.support_staff_training_records enable row level security;
revoke all on public.support_staff_applications, public.support_staff_events,
  public.support_cases, public.support_case_assignments,
  public.support_case_events, public.support_case_feedback,
  public.support_case_feedback_events, public.support_staff_training_records
  from public, anon, authenticated;
grant select, insert, update on public.support_staff_applications to service_role;
grant select, insert on public.support_staff_events to service_role;
grant select, insert, update on public.support_cases to service_role;
grant select, insert, update on public.support_case_assignments to service_role;
grant select, insert on public.support_case_events to service_role;
grant select, insert, update on public.support_case_feedback to service_role;
grant select, insert on public.support_case_feedback_events to service_role;
grant select, insert on public.support_staff_training_records to service_role;
create policy support_staff_applications_server_only on public.support_staff_applications
  for all to service_role using (true) with check (true);
create policy support_staff_events_server_only on public.support_staff_events
  for all to service_role using (true) with check (true);
create policy support_cases_server_only on public.support_cases
  for all to service_role using (true) with check (true);
create policy support_case_assignments_server_only on public.support_case_assignments
  for all to service_role using (true) with check (true);
create policy support_case_events_server_only on public.support_case_events
  for all to service_role using (true) with check (true);
create policy support_case_feedback_server_only on public.support_case_feedback
  for all to service_role using (true) with check (true);
create policy support_case_feedback_events_server_only on public.support_case_feedback_events
  for all to service_role using (true) with check (true);
create policy support_staff_training_records_server_only on public.support_staff_training_records
  for all to service_role using (true) with check (true);
revoke all on function public.validate_support_case() from public, anon, authenticated;
revoke all on function public.validate_support_case_assignment() from public, anon, authenticated;
revoke all on function public.audit_support_staff_status() from public, anon, authenticated;
revoke all on function public.validate_support_staff_invitation() from public, anon, authenticated;
revoke all on function public.audit_support_case_assignment() from public, anon, authenticated;
revoke all on function public.audit_support_case_creation() from public, anon, authenticated;
revoke all on function public.transition_support_case(
  uuid, uuid, text, text, text, text, text, timestamptz, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.transition_support_case(
  uuid, uuid, text, text, text, text, text, timestamptz, text, text, boolean
) to service_role;
revoke all on function public.review_support_case_feedback(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.review_support_case_feedback(uuid, uuid, text)
  to service_role;
