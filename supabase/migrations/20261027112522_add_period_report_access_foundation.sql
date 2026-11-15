-- Local report access foundation. Applying this migration to a remote project
-- requires a separate production approval. This does not enable report routes
-- or reopen guardian account/link creation.

create table public.minor_eligibility_assertions (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  verified_by uuid references auth.users(id) on delete set null,
  verification_basis text not null check (verification_basis = 'school_verified'),
  source_reference text not null check (source_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  verified_at timestamptz not null default clock_timestamp(),
  valid_until timestamptz not null,
  revoked_at timestamptz,
  check (isfinite(verified_at) and isfinite(valid_until) and valid_until > verified_at)
);

create table public.report_authorizations (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('teacher','guardian')),
  relationship_id uuid not null,
  school_id uuid not null references public.schools(id) on delete cascade,
  minor_assertion_id uuid references public.minor_eligibility_assertions(id) on delete set null,
  dimensions text[] not null check (cardinality(dimensions) between 1 and 5 and array_position(dimensions,null) is null
    and dimensions <@ array['sleep','wake','eat','exercise','task']::text[]),
  purpose text not null default 'rhythm_context' check (purpose = 'rhythm_context'),
  policy_version text not null check (policy_version = 'reports-2026-10-27'),
  consent_snapshot jsonb not null check (jsonb_typeof(consent_snapshot) = 'object'),
  effective_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','revoked','invalidated')),
  revoked_at timestamptz,
  invalidated_at timestamptz,
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(student_user_id,request_id),
  check (student_user_id <> recipient_user_id),
  check (isfinite(effective_at) and isfinite(expires_at) and expires_at > effective_at
    and expires_at <= effective_at + interval '2592000 seconds'),
  check ((status = 'active' and revoked_at is null and invalidated_at is null)
    or (status = 'revoked' and revoked_at is not null)
    or (status = 'invalidated' and invalidated_at is not null))
);

create table public.report_authorization_events (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid references public.report_authorizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('authorized','revoked','invalidated')),
  policy_version text not null default 'reports-2026-10-27' check (policy_version = 'reports-2026-10-27'),
  created_at timestamptz not null default clock_timestamp()
);

create table public.report_access_audit (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid references public.report_authorizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  outcome text not null check (outcome in ('waiting','ready','denied')),
  summary_version text not null check (summary_version = 'sweet-period-report-v1'),
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check ((period_start is null and period_end is null) or
    (period_start is not null and period_end is not null and period_end > period_start))
);

alter table public.minor_eligibility_assertions enable row level security;
alter table public.report_authorizations enable row level security;
alter table public.report_authorization_events enable row level security;
alter table public.report_access_audit enable row level security;
revoke all on table public.minor_eligibility_assertions,public.report_authorizations,
  public.report_authorization_events,public.report_access_audit from public,anon,authenticated,service_role;
grant select,insert,update on public.minor_eligibility_assertions,public.report_authorizations to service_role;
grant select,insert on public.report_authorization_events,public.report_access_audit to service_role;

create index report_minor_student_idx on public.minor_eligibility_assertions(student_user_id,verified_at desc);
create index report_minor_school_idx on public.minor_eligibility_assertions(school_id);
create index report_minor_verifier_idx on public.minor_eligibility_assertions(verified_by);
create index report_auth_recipient_idx on public.report_authorizations(recipient_user_id,status);
create index report_auth_student_idx on public.report_authorizations(student_user_id,status);
create index report_auth_school_idx on public.report_authorizations(school_id,status);
create index report_auth_relationship_idx on public.report_authorizations(relationship_id,status);
create index report_auth_minor_idx on public.report_authorizations(minor_assertion_id);
create index report_events_authorization_idx on public.report_authorization_events(authorization_id,created_at);
create index report_events_actor_idx on public.report_authorization_events(actor_user_id);
create index report_audit_authorization_idx on public.report_access_audit(authorization_id,created_at);
create index report_audit_actor_idx on public.report_access_audit(actor_user_id);

-- One transaction mutex deliberately serializes report reads with mutations of
-- their dependencies. The pilot trades throughput for a verifiable order. The
-- BEFORE STATEMENT trigger obtains it before row locks; a READ COMMITTED RPC
-- takes a fresh snapshot after obtaining it. Failures/timeouts never return data.
create function public.report_dependency_write_lock()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(73190428,20261027);
  return null;
end;
$$;
revoke all on function public.report_dependency_write_lock() from public,anon,authenticated,service_role;

do $$
declare t text;
begin
  foreach t in array array['profiles','schools','school_members','teacher_student_assignments',
    'guardian_student_links','student_consents','admin_roles','sweet_records','minor_eligibility_assertions','report_authorizations'] loop
    execute format('create trigger report_dependency_write_lock before insert or update or delete on public.%I for each statement execute function public.report_dependency_write_lock()',t);
  end loop;
end;
$$;
create trigger report_dependency_write_lock before insert or update or delete on auth.users
  for each statement execute function public.report_dependency_write_lock();

-- Internal maintenance only: GoTrue deletes as supabase_auth_admin, which must
-- not receive report-table privileges. Fixed search_path, no arguments, no direct
-- EXECUTE grant, and OLD-row predicates limit this definer to terminal invalidation
-- and minimal events during genuine dependency mutations (including cascades).
create function public.invalidate_dependent_report_authorizations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_kind text := tg_table_name; v_old jsonb := to_jsonb(old); v_new jsonb := case when tg_op='UPDATE' then to_jsonb(new) else null end;
begin
  if tg_op = 'UPDATE' then
    if v_kind = 'profiles' and jsonb_build_array(v_new->'school_id',v_new->'role') = jsonb_build_array(v_old->'school_id',v_old->'role') then return new; end if;
    if v_kind = 'schools' and v_new->'status' = v_old->'status' then return new; end if;
    if v_kind = 'school_members' and jsonb_build_array(v_new->'school_id',v_new->'user_id',v_new->'member_role',v_new->'status') = jsonb_build_array(v_old->'school_id',v_old->'user_id',v_old->'member_role',v_old->'status') then return new; end if;
    if v_kind = 'teacher_student_assignments' and jsonb_build_array(v_new->'school_id',v_new->'teacher_user_id',v_new->'student_user_id',v_new->'status') = jsonb_build_array(v_old->'school_id',v_old->'teacher_user_id',v_old->'student_user_id',v_old->'status') then return new; end if;
    if v_kind = 'guardian_student_links' and jsonb_build_array(v_new->'school_id',v_new->'guardian_user_id',v_new->'student_user_id',v_new->'status',v_new->'confirmed_by') = jsonb_build_array(v_old->'school_id',v_old->'guardian_user_id',v_old->'student_user_id',v_old->'status',v_old->'confirmed_by') then return new; end if;
    if v_kind = 'minor_eligibility_assertions' and jsonb_build_array(v_new->'student_user_id',v_new->'school_id',v_new->'verified_at',v_new->'valid_until',v_new->'revoked_at') = jsonb_build_array(v_old->'student_user_id',v_old->'school_id',v_old->'verified_at',v_old->'valid_until',v_old->'revoked_at') then return new; end if;
    if v_kind = 'student_consents' and (v_new-array['created_at','updated_at']) = (v_old-array['created_at','updated_at']) then return new; end if;
  end if;
  for v_id in
    update public.report_authorizations a set status='invalidated',invalidated_at=pg_catalog.clock_timestamp()
    where a.status='active' and case v_kind
      when 'profiles' then a.student_user_id=(v_old->>'id')::uuid or a.recipient_user_id=(v_old->>'id')::uuid
        or (a.minor_assertion_id is not null and a.consent_snapshot->>'guardian_user_id'=v_old->>'id')
      when 'schools' then a.school_id=(v_old->>'id')::uuid
      when 'school_members' then a.school_id=(v_old->>'school_id')::uuid and a.recipient_user_id=(v_old->>'user_id')::uuid
      when 'teacher_student_assignments' then a.recipient_type='teacher' and a.relationship_id=(v_old->>'id')::uuid
      when 'guardian_student_links' then (a.recipient_type='guardian' and a.relationship_id=(v_old->>'id')::uuid)
        or (a.student_user_id=(v_old->>'student_user_id')::uuid and a.school_id=(v_old->>'school_id')::uuid
          and a.consent_snapshot->>'guardian_user_id'=v_old->>'guardian_user_id')
      when 'student_consents' then a.student_user_id=(v_old->>'student_user_id')::uuid
      when 'minor_eligibility_assertions' then a.minor_assertion_id=(v_old->>'id')::uuid
      else false end
    returning a.id
  loop
    insert into public.report_authorization_events(authorization_id,event_type) values(v_id,'invalidated');
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.invalidate_dependent_report_authorizations() from public,anon,authenticated,service_role;
do $$
declare t text;
begin
  foreach t in array array['profiles','schools','school_members','teacher_student_assignments',
    'guardian_student_links','student_consents','minor_eligibility_assertions'] loop
    execute format('create trigger invalidate_dependent_report_authorizations after update or delete on public.%I for each row execute function public.invalidate_dependent_report_authorizations()',t);
  end loop;
end;
$$;

create function public.enforce_report_authorization_integrity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if pg_catalog.cardinality(new.dimensions) <> (select pg_catalog.count(distinct d) from pg_catalog.unnest(new.dimensions) d) then
    raise exception 'invalid_report_scope' using errcode='22023';
  end if;
  if tg_op='UPDATE' then
    if (new.id,new.student_user_id,new.recipient_user_id,new.recipient_type,new.relationship_id,new.school_id,
        new.dimensions,new.purpose,new.policy_version,new.consent_snapshot,new.effective_at,new.expires_at,new.request_id,new.created_at)
      is distinct from
       (old.id,old.student_user_id,old.recipient_user_id,old.recipient_type,old.relationship_id,old.school_id,
        old.dimensions,old.purpose,old.policy_version,old.consent_snapshot,old.effective_at,old.expires_at,old.request_id,old.created_at)
       or (new.minor_assertion_id is distinct from old.minor_assertion_id and new.minor_assertion_id is not null)
       or (old.status <> 'active' and new.status is distinct from old.status) then
      raise exception 'immutable_report_authorization' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_report_authorization_integrity() from public,anon,authenticated,service_role;
create trigger enforce_report_authorization_integrity before insert or update on public.report_authorizations
for each row execute function public.enforce_report_authorization_integrity();

create function public.issue_report_minor_eligibility(
  p_actor_user_id uuid,p_student_user_id uuid,p_school_id uuid,
  p_verification_basis text,p_source_reference text,p_valid_until timestamptz
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_now timestamptz;
begin
  -- A pre-existing REPEATABLE READ snapshot cannot be refreshed by the mutex.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unsupported_report_transaction' using errcode='25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(73190428,20261027);
  v_now:=pg_catalog.clock_timestamp();
  if p_verification_basis is distinct from 'school_verified' or p_source_reference is null
    or p_source_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
    or p_valid_until is null or not pg_catalog.isfinite(p_valid_until) or p_valid_until <= v_now
    or not exists(select 1 from public.schools s where s.id=p_school_id and s.status='active')
    or not exists(select 1 from public.profiles p join public.student_consents c on c.student_user_id=p.id
      where p.id=p_student_user_id and p.role='学生' and p.school_id=p_school_id and c.school_id=p_school_id
      and c.age_band='14_17' and c.status='active' and c.consent_basis='student_guardian'
      and c.policy_version='reports-school-2026-10-27')
    or not (exists(select 1 from auth.users u join public.admin_roles a on lower(a.email)=lower(u.email)
      where u.id=p_actor_user_id and a.status='active') or exists(select 1 from public.school_members m
      where m.user_id=p_actor_user_id and m.school_id=p_school_id and m.member_role='school_admin' and m.status='active')) then
    raise exception 'report_access_denied' using errcode='42501';
  end if;
  -- A new trusted assertion supersedes every previous proof. Revoking the
  -- latest proof must never fall back to an older, longer assertion.
  update public.minor_eligibility_assertions set revoked_at=v_now
    where student_user_id=p_student_user_id and revoked_at is null;
  insert into public.minor_eligibility_assertions(student_user_id,school_id,verified_by,verification_basis,source_reference,verified_at,valid_until)
  values(p_student_user_id,p_school_id,p_actor_user_id,p_verification_basis,p_source_reference,v_now,p_valid_until) returning id into v_id;
  return v_id;
end;
$$;

-- The school-consent version below is a closed implementation boundary for the
-- separately reviewed school report basis; naming it here does not approve or
-- publish consent copy, nor migrate existing students to it automatically.
-- Server supplies actor only after bearer authentication. Never expose this RPC
-- to browser roles, or pass an unverified request-body actor through a server.
create function public.create_report_authorization(
  p_actor_user_id uuid,p_recipient_user_id uuid,p_recipient_type text,p_dimensions text[],p_request_id uuid,p_policy_version text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_consent public.student_consents; v_school uuid; v_relation uuid; v_proof uuid;
  v_now timestamptz; v_expiry timestamptz; v_id uuid; v_existing public.report_authorizations;
begin
  -- A pre-existing REPEATABLE READ snapshot cannot be refreshed by the mutex.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unsupported_report_transaction' using errcode='25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(73190428,20261027);
  v_now:=pg_catalog.clock_timestamp();
  if p_actor_user_id is null or p_recipient_user_id is null or p_actor_user_id=p_recipient_user_id
    or p_request_id is null or p_policy_version is distinct from 'reports-2026-10-27'
    or p_recipient_type is null or p_recipient_type not in ('teacher','guardian') or p_dimensions is null
    or pg_catalog.cardinality(p_dimensions) not between 1 and 5 or pg_catalog.array_position(p_dimensions,null) is not null
    or not p_dimensions <@ array['sleep','wake','eat','exercise','task']::text[]
    or pg_catalog.cardinality(p_dimensions) <> (select pg_catalog.count(distinct d) from pg_catalog.unnest(p_dimensions) d) then
    raise exception 'invalid_report_scope' using errcode='22023';
  end if;
  select * into v_existing from public.report_authorizations where student_user_id=p_actor_user_id and request_id=p_request_id;
  if found then
    if v_existing.recipient_user_id<>p_recipient_user_id or v_existing.recipient_type<>p_recipient_type
      or v_existing.dimensions<>p_dimensions or v_existing.policy_version<>p_policy_version then
      raise exception 'invalid_report_scope' using errcode='22023';
    end if;
    -- An idempotent retry is an acknowledgement of the original ID, never renewal.
    return v_existing.id;
  end if;
  select p.school_id into v_school from public.profiles p join public.schools s on s.id=p.school_id
    where p.id=p_actor_user_id and p.role='学生' and s.status='active';
  select * into v_consent from public.student_consents where student_user_id=p_actor_user_id;
  if v_school is null or v_consent.school_id is distinct from v_school or v_consent.status is distinct from 'active'
    or v_consent.policy_version is distinct from 'reports-school-2026-10-27'
    or v_consent.student_assented_at is null or v_consent.student_assented_at > v_now
    or v_consent.age_band not in ('14_17','18_plus')
    or (v_consent.age_band='18_plus' and v_consent.consent_basis<>'adult_self')
    or (v_consent.age_band='14_17' and (v_consent.consent_basis<>'student_guardian'
      or v_consent.guardian_user_id is null or v_consent.guardian_consented_at is null or v_consent.guardian_consented_at>v_now
      or not exists(select 1 from public.guardian_student_links g join public.profiles gp on gp.id=g.guardian_user_id
        where g.student_user_id=p_actor_user_id and g.guardian_user_id=v_consent.guardian_user_id and g.school_id=v_school
          and g.status='active' and g.confirmed_by is not null and gp.role='家长'))) then
    raise exception 'report_access_denied' using errcode='42501';
  end if;
  v_expiry:=v_now+interval '2592000 seconds';
  if v_consent.age_band='14_17' then
    select e.id,least(v_expiry,e.valid_until) into v_proof,v_expiry from public.minor_eligibility_assertions e
    where e.student_user_id=p_actor_user_id and e.school_id=v_school
    order by e.verified_at desc,e.id limit 1;
    if v_proof is null or not exists(select 1 from public.minor_eligibility_assertions e where e.id=v_proof
      and e.revoked_at is null and e.verified_at<=v_now and e.valid_until>v_now) then
      raise exception 'report_access_denied' using errcode='42501';
    end if;
  end if;
  if p_recipient_type='teacher' then
    select a.id into v_relation from public.teacher_student_assignments a
      join public.school_members m on m.user_id=a.teacher_user_id and m.school_id=a.school_id
      join public.profiles p on p.id=a.teacher_user_id
    where a.student_user_id=p_actor_user_id and a.teacher_user_id=p_recipient_user_id and a.school_id=v_school
      and a.status='active' and m.status='active' and m.member_role='school_support'
      and p.role='学校支持人员' and p.school_id=v_school;
  else
    if v_consent.age_band<>'14_17' or v_consent.guardian_user_id is distinct from p_recipient_user_id then
      raise exception 'report_access_denied' using errcode='42501';
    end if;
    select g.id into v_relation from public.guardian_student_links g join public.profiles p on p.id=g.guardian_user_id
    where g.student_user_id=p_actor_user_id and g.guardian_user_id=p_recipient_user_id and g.school_id=v_school
      and g.status='active' and g.confirmed_by is not null and p.role='家长' and p.school_id=v_school;
  end if;
  if v_relation is null then raise exception 'report_access_denied' using errcode='42501'; end if;
  -- A new explicit grant for a recipient scope terminates the previous grant.
  with ended as (update public.report_authorizations set status='invalidated',invalidated_at=v_now
    where student_user_id=p_actor_user_id and recipient_type=p_recipient_type and status='active' returning id)
  insert into public.report_authorization_events(authorization_id,actor_user_id,event_type)
    select id,p_actor_user_id,'invalidated' from ended;
  insert into public.report_authorizations(student_user_id,recipient_user_id,recipient_type,relationship_id,school_id,
    minor_assertion_id,dimensions,policy_version,consent_snapshot,effective_at,expires_at,request_id)
  values(p_actor_user_id,p_recipient_user_id,p_recipient_type,v_relation,v_school,v_proof,p_dimensions,p_policy_version,
    pg_catalog.to_jsonb(v_consent)-array['created_at','updated_at'],v_now,v_expiry,p_request_id) returning id into v_id;
  insert into public.report_authorization_events(authorization_id,actor_user_id,event_type) values(v_id,p_actor_user_id,'authorized');
  return v_id;
end;
$$;

create function public.revoke_report_authorization(p_actor_user_id uuid,p_authorization_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_auth public.report_authorizations;
begin
  -- A pre-existing REPEATABLE READ snapshot cannot be refreshed by the mutex.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unsupported_report_transaction' using errcode='25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(73190428,20261027);
  select * into v_auth from public.report_authorizations where id=p_authorization_id and student_user_id=p_actor_user_id;
  if not found then raise exception 'report_access_denied' using errcode='42501'; end if;
  if v_auth.status='active' then
    update public.report_authorizations set status='revoked',revoked_at=pg_catalog.clock_timestamp() where id=v_auth.id;
    insert into public.report_authorization_events(authorization_id,actor_user_id,event_type) values(v_auth.id,p_actor_user_id,'revoked');
  end if;
  return true;
end;
$$;

create function public.lock_report_authorization(p_actor_user_id uuid,p_authorization_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_auth public.report_authorizations; v_consent public.student_consents; v_now timestamptz; v_valid boolean;
begin
  -- A pre-existing REPEATABLE READ snapshot cannot be refreshed by the mutex.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unsupported_report_transaction' using errcode='25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(73190428,20261027);
  v_now:=pg_catalog.clock_timestamp();
  select * into v_auth from public.report_authorizations where id=p_authorization_id;
  if not found or p_actor_user_id is null or p_actor_user_id not in (v_auth.student_user_id,v_auth.recipient_user_id)
    or not exists(select 1 from auth.users u where u.id=p_actor_user_id) then return false; end if;
  if v_auth.status<>'active' or v_now>=v_auth.expires_at or v_auth.effective_at>v_now then return false; end if;
  select * into v_consent from public.student_consents where student_user_id=v_auth.student_user_id;
  v_valid:=v_consent.status='active' and v_consent.school_id=v_auth.school_id
    and v_consent.policy_version='reports-school-2026-10-27'
    and (pg_catalog.to_jsonb(v_consent)-array['created_at','updated_at'])=v_auth.consent_snapshot
    and v_consent.student_assented_at<=v_auth.effective_at
    and exists(select 1 from public.profiles p join public.schools s on s.id=p.school_id
      where p.id=v_auth.student_user_id and p.school_id=v_auth.school_id and p.role='学生' and s.status='active');
  if v_consent.age_band='14_17' then
    v_valid:=v_valid and v_consent.consent_basis='student_guardian' and v_consent.guardian_consented_at<=v_auth.effective_at
      and exists(select 1 from public.guardian_student_links g join public.profiles gp on gp.id=g.guardian_user_id
        where g.student_user_id=v_auth.student_user_id and g.guardian_user_id=v_consent.guardian_user_id
          and g.school_id=v_auth.school_id and g.status='active' and g.confirmed_by is not null and gp.role='家长')
      and exists(select 1 from public.minor_eligibility_assertions e where e.id=v_auth.minor_assertion_id
        and e.student_user_id=v_auth.student_user_id and e.school_id=v_auth.school_id and e.revoked_at is null
        and e.verified_at<=v_auth.effective_at and e.valid_until>=v_auth.expires_at and e.valid_until>v_now);
  elsif v_consent.age_band='18_plus' then
    v_valid:=v_valid and v_consent.consent_basis='adult_self' and v_auth.recipient_type='teacher';
  else v_valid:=false; end if;
  if v_auth.recipient_type='teacher' then
    v_valid:=v_valid and exists(select 1 from public.teacher_student_assignments a
      join public.school_members m on m.user_id=a.teacher_user_id and m.school_id=a.school_id
      join public.profiles p on p.id=a.teacher_user_id
      where a.id=v_auth.relationship_id and a.student_user_id=v_auth.student_user_id and a.teacher_user_id=v_auth.recipient_user_id
        and a.school_id=v_auth.school_id and a.status='active' and m.status='active' and m.member_role='school_support'
        and p.role='学校支持人员' and p.school_id=v_auth.school_id);
  else
    v_valid:=v_valid and v_consent.age_band='14_17' and v_consent.guardian_user_id=v_auth.recipient_user_id
      and exists(select 1 from public.guardian_student_links g join public.profiles p on p.id=g.guardian_user_id
      where g.id=v_auth.relationship_id and g.student_user_id=v_auth.student_user_id and g.guardian_user_id=v_auth.recipient_user_id
        and g.school_id=v_auth.school_id and g.status='active' and g.confirmed_by is not null and p.role='家长' and p.school_id=v_auth.school_id);
  end if;
  if not coalesce(v_valid,false) then
    update public.report_authorizations set status='invalidated',invalidated_at=v_now where id=v_auth.id and status='active';
    insert into public.report_authorization_events(authorization_id,event_type) values(v_auth.id,'invalidated');
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.issue_report_minor_eligibility(uuid,uuid,uuid,text,text,timestamptz),
 public.create_report_authorization(uuid,uuid,text,text[],uuid,text),
 public.revoke_report_authorization(uuid,uuid),public.lock_report_authorization(uuid,uuid) from public,anon,authenticated;
grant execute on function public.issue_report_minor_eligibility(uuid,uuid,uuid,text,text,timestamptz),
 public.create_report_authorization(uuid,uuid,text,text[],uuid,text),
 public.revoke_report_authorization(uuid,uuid),public.lock_report_authorization(uuid,uuid) to service_role;

-- Ownership remains the only ordinary Data API path for original SWEET rows.
drop policy if exists "sweet_records_select_school_members" on public.sweet_records;
drop policy if exists "sweet_records_select_authorized_grantee" on public.sweet_records;
drop policy if exists "sweet_records_select_guardian" on public.sweet_records;

-- The invoker RPC only reads the two trusted Auth identity columns needed for
-- account existence and the existing platform-admin email allowlist.
grant usage on schema auth to service_role;
grant select(id,email) on auth.users to service_role;

-- Read-only aggregation behind the separately implemented, service-only lock helper.
-- No report bodies are persisted. The helper owns every authorization decision.
create or replace function public.read_report_summary(
  p_actor_user_id uuid,
  p_authorization_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_authorization public.report_authorizations;
  v_now timestamptz;
  v_completed bigint;
  v_start timestamptz;
  v_end timestamptz;
  v_source_start timestamptz;
  v_dimensions jsonb;
  v_result jsonb;
  v_actor uuid;
  v_version constant text := 'sweet-period-report-v1';
begin
  if not public.lock_report_authorization(p_actor_user_id, p_authorization_id) then
    select u.id into v_actor from auth.users u where u.id=p_actor_user_id;
    insert into public.report_access_audit(authorization_id,actor_user_id,outcome,summary_version)
      values(null,v_actor,'denied',v_version);
    return pg_catalog.jsonb_build_object('version',v_version,'status','invalid','dimensions','[]'::jsonb);
  end if;
  select * into v_authorization from public.report_authorizations where id=p_authorization_id;
  v_now := pg_catalog.clock_timestamp();

  if v_authorization.id is null
     or not pg_catalog.isfinite(v_authorization.effective_at)
     or not pg_catalog.isfinite(v_authorization.expires_at)
     or v_authorization.expires_at <= v_authorization.effective_at
     or v_now >= v_authorization.expires_at
     or v_authorization.dimensions is null
     or pg_catalog.cardinality(v_authorization.dimensions) = 0
     or exists (
       select 1 from pg_catalog.unnest(v_authorization.dimensions) d
       where d is null or not (d = any(array['sleep','wake','eat','exercise','task']::text[]))
     )
     or pg_catalog.cardinality(v_authorization.dimensions) <> (
       select pg_catalog.count(distinct d) from pg_catalog.unnest(v_authorization.dimensions) d
     ) then
    insert into public.report_access_audit(authorization_id,actor_user_id,outcome,summary_version)
      values(v_authorization.id,p_actor_user_id,'denied',v_version);
    return pg_catalog.jsonb_build_object('version',v_version,'status','invalid','dimensions','[]'::jsonb);
  end if;

  v_completed := pg_catalog.floor(extract(epoch from (v_now - v_authorization.effective_at)) / 604800)::bigint;
  if v_completed < 1 then
    v_result := pg_catalog.jsonb_build_object('version', v_version, 'status', 'waiting', 'dimensions', '[]'::jsonb);
  else
    -- Seconds, rather than calendar-day intervals, preserve the TS 7*24h rule in any DB timezone.
    v_start := v_authorization.effective_at + ((v_completed - 1) * interval '604800 seconds');
    v_end := v_start + interval '604800 seconds';
    v_source_start := case when v_completed >= 2 then v_start - interval '604800 seconds' else v_start end;

    with
    definitions(dimension, field_id, options, ordinal) as (
      values
      ('sleep', 'quality', '{"睡得很好":"sleep_very_good","比较好":"sleep_good","一般":"sleep_neutral","不太好":"sleep_poor","很不好":"sleep_very_poor"}'::jsonb, 1),
      ('wake', 'state', '{"很有精神":"wake_very_energized","比较有精神":"wake_energized","一般":"wake_neutral","有点疲惫":"wake_tired","很疲惫":"wake_very_tired"}'::jsonb, 2),
      ('eat', 'rhythm', '{"很规律":"eat_very_regular","比较规律":"eat_regular","一般":"eat_neutral","不太规律":"eat_irregular","很不规律":"eat_very_irregular"}'::jsonb, 3),
      ('exercise', 'duration', '{"0 分钟":"exercise_none","1–9 分钟":"exercise_one_to_nine","10–19 分钟":"exercise_ten_to_nineteen","20–29 分钟":"exercise_twenty_to_twenty_nine","30 分钟以上":"exercise_over_thirty","不太确定":"exercise_unsure"}'::jsonb, 4),
      ('task', 'engagement', '{"很顺利":"task_very_smooth","比较顺利":"task_smooth","一般":"task_neutral","不太顺利":"task_difficult","很不顺利":"task_very_difficult"}'::jsonb, 5)
    ),
    source_rows as materialized (
      select r.id, r.created_at, r.records
      from public.sweet_records r
      where r.user_id = v_authorization.student_user_id
        and r.school_id = v_authorization.school_id
        and r.created_at >= v_authorization.effective_at
        and r.created_at >= v_source_start and r.created_at < v_end
      order by r.created_at, r.id
      for share of r
    ),
    matching_steps as (
      select r.id, r.created_at, d.dimension, d.field_id, d.options,
             pg_catalog.jsonb_agg(s.step)->0 as step
      from source_rows r
      cross join definitions d
      cross join lateral pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(r.records) = 'array' then r.records else '[]'::jsonb end
      ) s(step)
      where pg_catalog.jsonb_array_length(
        case when pg_catalog.jsonb_typeof(r.records) = 'array' then r.records else '[]'::jsonb end
      ) = 5
        and pg_catalog.jsonb_typeof(s.step) = 'object'
        and s.step->'id' = pg_catalog.to_jsonb(d.dimension)
      group by r.id, r.created_at, d.dimension, d.field_id, d.options
      having pg_catalog.count(*) = 1
    ),
    matching_fields as (
      select s.id, s.created_at, s.dimension, s.options,
             pg_catalog.jsonb_agg(f.field)->0 as field
      from matching_steps s
      cross join lateral pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(s.step->'fields') = 'array' then s.step->'fields' else '[]'::jsonb end
      ) f(field)
      where pg_catalog.jsonb_typeof(f.field) = 'object'
        and f.field->'id' = pg_catalog.to_jsonb(s.field_id)
      group by s.id, s.created_at, s.dimension, s.options
      having pg_catalog.count(*) = 1
    ),
    mapped_fields as (
      select id, created_at, dimension, options->>(field->>'value') as category
      from matching_fields
      where pg_catalog.jsonb_typeof(field->'value') = 'string'
        and options ? (field->>'value')
    ),
    normalized as materialized (
      select id, created_at,
             (created_at at time zone 'Asia/Shanghai')::date as shanghai_day,
             case when created_at >= v_start then 'current' else 'previous' end as side,
             pg_catalog.jsonb_object_agg(dimension, category) as answers
      from mapped_fields
      group by id, created_at
      having pg_catalog.count(*) = 5
    ),
    instant_conflicts as (
      select side, shanghai_day, created_at, pg_catalog.count(distinct answers) > 1 as conflicted
      from normalized
      group by side, shanghai_day, created_at
    ),
    conflicted_days as (
      select side, shanghai_day
      from instant_conflicts
      group by side, shanghai_day
      having pg_catalog.bool_or(conflicted)
    ),
    daily as (
      select distinct on (n.side, n.shanghai_day) n.side, n.shanghai_day, n.answers
      from normalized n
      where not exists (
        select 1 from conflicted_days c where c.side = n.side and c.shanghai_day = n.shanghai_day
      )
      order by n.side, n.shanghai_day, n.created_at desc, n.id
    ),
    category_counts as (
      select day.side, d.dimension, day.answers->>d.dimension as category, pg_catalog.count(*) as count
      from daily day
      cross join definitions d
      where d.dimension = any(v_authorization.dimensions)
      group by day.side, d.dimension, day.answers->>d.dimension
    ),
    ranked_counts as (
      select *, pg_catalog.sum(count) over (partition by side, dimension) as total,
                pg_catalog.max(count) over (partition by side, dimension) as maximum
      from category_counts
    ),
    modes as (
      select side, dimension,
             case when pg_catalog.max(total) < 3 then 'insufficient'
                  when pg_catalog.count(*) filter (where count = maximum) <> 1 then 'mixed'
                  else 'category' end as state,
             pg_catalog.max(category) filter (where count = maximum) as category
      from ranked_counts
      group by side, dimension
    )
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'id', d.dimension,
        'state', coalesce(c.state, 'insufficient'),
        'category', case when c.state = 'category' then c.category end,
        'previousCategory', case when c.state = 'category' and p.state = 'category' then p.category end,
        'comparison', case when c.state = 'category' and p.state = 'category'
                           then case when c.category = p.category then 'same' else 'different' end
                           else 'unavailable' end
      )) order by d.ordinal
    ), '[]'::jsonb) into v_dimensions
    from definitions d
    left join modes c on c.dimension = d.dimension and c.side = 'current'
    left join modes p on p.dimension = d.dimension and p.side = 'previous'
    where d.dimension = any(v_authorization.dimensions);

    v_result := pg_catalog.jsonb_build_object(
      'version', v_version,
      'status', 'ready',
      'period', pg_catalog.jsonb_build_object(
        'start', pg_catalog.to_char(v_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.') ||
                 case when mod(extract(microseconds from v_start)::bigint, 1000) = 0
                      then pg_catalog.to_char(v_start at time zone 'UTC', 'MS')
                      else pg_catalog.to_char(v_start at time zone 'UTC', 'US') end || 'Z',
        'end', pg_catalog.to_char(v_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.') ||
               case when mod(extract(microseconds from v_end)::bigint, 1000) = 0
                    then pg_catalog.to_char(v_end at time zone 'UTC', 'MS')
                    else pg_catalog.to_char(v_end at time zone 'UTC', 'US') end || 'Z'
      ),
      'dimensions', v_dimensions
    );
  end if;

  -- Recheck real time after waiting on source locks; an expired authorization never yields a report.
  if pg_catalog.clock_timestamp() >= v_authorization.expires_at then
    insert into public.report_access_audit(authorization_id,actor_user_id,outcome,summary_version)
      values(v_authorization.id,p_actor_user_id,'denied',v_version);
    return pg_catalog.jsonb_build_object('version',v_version,'status','expired','dimensions','[]'::jsonb);
  end if;
  insert into public.report_access_audit(authorization_id, actor_user_id, outcome, summary_version,period_start,period_end)
  values (v_authorization.id, p_actor_user_id, v_result->>'status', v_version,v_start,v_end);
  return v_result;
end;
$$;

revoke all on function public.read_report_summary(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_report_summary(uuid, uuid) to service_role;
