-- Approved local-only comprehensive report implementation. No remote apply.
create table public.school_report_enrollments (
 id uuid primary key default gen_random_uuid(),
 student_user_id uuid not null references auth.users(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 minor_assertion_id uuid references public.minor_eligibility_assertions(id) on delete set null,
 issued_by uuid references auth.users(id) on delete set null,
 policy_version text not null default 'school-reports-2026-10-28' check(policy_version='school-reports-2026-10-28'),
 history_scope text not null default 'all_retained_history' check(history_scope='all_retained_history'),
 basis_reference text not null check(basis_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
 notice_reference text not null check(notice_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
 base_consent_snapshot jsonb not null,
 school_registered_until timestamptz not null,
 basis_valid_until timestamptz not null,
 effective_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 status text not null default 'active' check(status in('active','withdrawn','invalidated')),
 terminal_at timestamptz,
 terminal_reason text check(terminal_reason in('withdrawn','dependency','expired','replaced')),
 request_id uuid not null,
 recipient_epoch bigint not null default 0 check(recipient_epoch>=0),
 recipient_fingerprint text not null default '',
 source_revision bigint not null default 0 check(source_revision>=0),
 created_at timestamptz not null default clock_timestamp(),
 unique(student_user_id,request_id),
 check(isfinite(effective_at) and isfinite(expires_at) and isfinite(school_registered_until) and isfinite(basis_valid_until)
  and expires_at>effective_at and expires_at<=effective_at+interval '2592000 seconds'
  and expires_at<=school_registered_until and expires_at<=basis_valid_until),
 check((status='active' and terminal_at is null and terminal_reason is null)
   or(status<>'active' and terminal_at is not null and terminal_reason is not null))
);
create unique index school_report_one_active_student on public.school_report_enrollments(student_user_id) where status='active';
create index school_report_enrollment_school on public.school_report_enrollments(school_id);
create index school_report_enrollment_proof on public.school_report_enrollments(minor_assertion_id);
create index school_report_enrollment_issuer on public.school_report_enrollments(issued_by);
create index school_report_enrollment_retention on public.school_report_enrollments(expires_at,terminal_at);
create table public.school_report_detail_states (
 enrollment_id uuid primary key references public.school_report_enrollments(id) on delete cascade,
 enabled boolean not null default false,
 detail_revision bigint not null default 0 check(detail_revision>=0),
 enabled_by uuid references auth.users(id) on delete set null,
 enabled_at timestamptz,
 notice_version text not null default 'sweet-details-2026-10-28' check(notice_version='sweet-details-2026-10-28'),
 enabled_recipient_epoch bigint
);
create index school_report_detail_actor on public.school_report_detail_states(enabled_by);
create table public.school_report_sharing_events (
 id uuid primary key default gen_random_uuid(),
 enrollment_id uuid references public.school_report_enrollments(id) on delete set null,
 actor_user_id uuid references auth.users(id) on delete set null,
 event_type text not null check(event_type in('issued','withdrawn','invalidated','recipients_changed','details_on','details_off')),
 policy_version text not null default 'school-reports-2026-10-28' check(policy_version='school-reports-2026-10-28'),
 request_id uuid,
 command_fingerprint text,
 detail_revision bigint,
 recipient_epoch bigint,
 created_at timestamptz not null default clock_timestamp(),
 unique(enrollment_id,actor_user_id,request_id)
);
create index school_report_event_enrollment on public.school_report_sharing_events(enrollment_id,created_at);
create index school_report_event_actor on public.school_report_sharing_events(actor_user_id);
create index school_report_event_retention on public.school_report_sharing_events(created_at);
create table public.school_report_mode_access_audit (
 id uuid primary key default gen_random_uuid(),
 enrollment_id uuid references public.school_report_enrollments(id) on delete set null,
 actor_user_id uuid references auth.users(id) on delete set null,
 mode text not null check(mode in('trend','detail')),
 outcome text not null check(outcome in('ready','denied','expired','refresh_required')),
 source_revision bigint, recipient_epoch bigint, detail_revision bigint,
 created_at timestamptz not null default clock_timestamp()
);
create index school_report_audit_enrollment on public.school_report_mode_access_audit(enrollment_id,created_at);
create index school_report_audit_actor on public.school_report_mode_access_audit(actor_user_id);
create index school_report_audit_retention on public.school_report_mode_access_audit(created_at);
do $$ declare t text; begin
 foreach t in array array['school_report_enrollments','school_report_detail_states','school_report_sharing_events','school_report_mode_access_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select,insert,delete on table public.%I to service_role',t);
 end loop;
end $$;
grant update on public.school_report_enrollments,public.school_report_detail_states to service_role;
grant usage on schema private to service_role;
-- No client original-SWEET policy is added. The only source read is a bounded DTO RPC.
create index if not exists school_report_source_owner_time on public.sweet_records(user_id,created_at desc,id);

create function private.school_report_base_valid(p_consent public.student_consents,p_now timestamptz)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce((p_consent).status='active' and (p_consent).policy_version='2026-08-28' and (p_consent).age_band='14_17'
 and (p_consent).student_assented_at is not null and isfinite((p_consent).student_assented_at) and (p_consent).student_assented_at<=p_now
 and ((p_consent).consent_basis='student_self_pilot' or ((p_consent).consent_basis='student_guardian'
  and (p_consent).guardian_user_id is not null and (p_consent).guardian_consented_at is not null
  and isfinite((p_consent).guardian_consented_at) and (p_consent).guardian_consented_at<=p_now)),false)
$$;
create function private.school_report_guard() returns void language plpgsql security invoker set search_path='' as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'unsupported_report_transaction' using errcode='25000'; end if;
 perform pg_catalog.pg_advisory_xact_lock(73190428,20261027);
end $$;
create function private.school_report_teachers(p_student uuid,p_school uuid)
returns table(recipient_id uuid,relationship_id uuid) language sql stable security invoker set search_path='' as $$
 select a.teacher_user_id,a.id from public.teacher_student_assignments a
 join public.school_members m on m.user_id=a.teacher_user_id and m.school_id=a.school_id
 join public.profiles p on p.id=a.teacher_user_id
 where a.student_user_id=p_student and a.school_id=p_school and a.status='active'
 and m.status='active' and m.member_role='school_support' and p.role='学校支持人员' and p.school_id=p_school
$$;
create function private.school_report_terminate(p_id uuid,p_status text,p_reason text,p_actor uuid default null,p_request uuid default null)
returns void language plpgsql security invoker set search_path='' as $$
declare e public.school_report_enrollments;
begin
 select * into e from public.school_report_enrollments where id=p_id;
 if e.id is null or e.status<>'active' then return; end if;
 update public.school_report_enrollments set status=p_status,terminal_reason=p_reason,
  terminal_at=least(clock_timestamp(),expires_at) where id=p_id;
 update public.school_report_detail_states set enabled=false,detail_revision=detail_revision+1,
  enabled_by=null,enabled_at=null,enabled_recipient_epoch=null where enrollment_id=p_id;
 insert into public.school_report_sharing_events(enrollment_id,actor_user_id,event_type,request_id,detail_revision,recipient_epoch)
 select p_id,p_actor,case when p_status='withdrawn' then 'withdrawn' else 'invalidated' end,p_request,d.detail_revision,e.recipient_epoch
 from public.school_report_detail_states d where d.enrollment_id=p_id;
end $$;
create function private.school_report_reconcile(p_id uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare e public.school_report_enrollments;c public.student_consents;v_fp text;v_now timestamptz:=clock_timestamp();v_latest uuid;
begin
 select * into e from public.school_report_enrollments where id=p_id;
 if e.id is null or e.status<>'active' then return false; end if;
 if v_now>=e.expires_at then perform private.school_report_terminate(p_id,'invalidated','expired');return false;end if;
 select * into c from public.student_consents where student_user_id=e.student_user_id;
 select id into v_latest from public.minor_eligibility_assertions where student_user_id=e.student_user_id and school_id=e.school_id order by verified_at desc,id limit 1;
 if not private.school_report_base_valid(c,v_now)
 or (to_jsonb(c)-array['created_at','updated_at']) is distinct from e.base_consent_snapshot
 or not exists(select 1 from public.profiles p join public.schools s on s.id=p.school_id where p.id=e.student_user_id and p.role='学生' and p.school_id=e.school_id and s.status='active')
 or e.minor_assertion_id is distinct from v_latest
 or not exists(select 1 from public.minor_eligibility_assertions q where q.id=e.minor_assertion_id and q.revoked_at is null
   and q.student_user_id=e.student_user_id and q.school_id=e.school_id and q.verified_at<=e.effective_at and q.valid_until>=e.expires_at and q.valid_until>v_now)
 then perform private.school_report_terminate(p_id,'invalidated','dependency');return false;end if;
 select md5(coalesce(string_agg(t.recipient_id::text||':'||t.relationship_id::text,',' order by t.recipient_id,t.relationship_id),'')) into v_fp
 from private.school_report_teachers(e.student_user_id,e.school_id) t;
 if e.recipient_fingerprint is distinct from v_fp then
  update public.school_report_enrollments set recipient_fingerprint=v_fp,recipient_epoch=recipient_epoch+1 where id=p_id;
  update public.school_report_detail_states set enabled=false,detail_revision=detail_revision+1,enabled_by=null,enabled_at=null,enabled_recipient_epoch=null where enrollment_id=p_id;
  insert into public.school_report_sharing_events(enrollment_id,event_type,detail_revision,recipient_epoch)
  select p_id,'recipients_changed',d.detail_revision,n.recipient_epoch from public.school_report_detail_states d join public.school_report_enrollments n on n.id=d.enrollment_id where n.id=p_id;
 end if;
 return true;
end $$;
create function private.school_report_context(p_actor uuid,p_id uuid,p_mode text,p_as_of timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.school_report_enrollments;d public.school_report_detail_states;v_asof timestamptz:=coalesce(p_as_of,clock_timestamp());
begin
 perform private.school_report_guard();
 if p_mode is null or p_mode not in('trend','detail') or not isfinite(v_asof) or v_asof>clock_timestamp() or v_asof<clock_timestamp()-interval '5 minutes'
 then return jsonb_build_object('status','refresh_required');end if;
 if not private.school_report_reconcile(p_id) then
  select * into e from public.school_report_enrollments where id=p_id;
  return jsonb_build_object('status',case when e.expires_at<=clock_timestamp() then 'expired' else 'denied' end);
 end if;
 select * into e from public.school_report_enrollments where id=p_id;
 select * into d from public.school_report_detail_states where enrollment_id=p_id;
 if p_actor is null or not exists(select 1 from auth.users where id=p_actor)
 or (p_actor<>e.student_user_id and not exists(select 1 from private.school_report_teachers(e.student_user_id,e.school_id) t where t.recipient_id=p_actor))
 or (p_mode='detail' and p_actor<>e.student_user_id and not(d.enabled and d.enabled_recipient_epoch=e.recipient_epoch))
 then return jsonb_build_object('status','denied');end if;
 return jsonb_build_object('status','ready','context',jsonb_build_object('enrollmentId',e.id,'studentId',e.student_user_id,'actorId',p_actor,
 'asOf',private.school_report_iso(v_asof),'sourceRevision',e.source_revision,'recipientEpoch',e.recipient_epoch,
 'detailRevision',d.detail_revision,'expiresAt',private.school_report_iso(e.expires_at)),'detailsEnabled',d.enabled);
end $$;
create function private.school_report_audit(p_actor uuid,p_id uuid,p_mode text,p_result jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.school_report_mode_access_audit(enrollment_id,actor_user_id,mode,outcome,source_revision,recipient_epoch,detail_revision)
 select e.id,u.id,p_mode,coalesce(p_result->>'status','denied'),(p_result#>>'{context,sourceRevision}')::bigint,
 (p_result#>>'{context,recipientEpoch}')::bigint,(p_result#>>'{context,detailRevision}')::bigint
 from (select 1) seed left join public.school_report_enrollments e on e.id=p_id left join auth.users u on u.id=p_actor;
end $$;

create function public.issue_school_report_enrollment(p_actor_user_id uuid,p_student_user_id uuid,p_school_id uuid,
 p_basis_reference text,p_notice_reference text,p_school_registered_until timestamptz,p_basis_valid_until timestamptz,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.student_consents;e public.school_report_enrollments;q public.minor_eligibility_assertions;v_now timestamptz;v_id uuid;v_exp timestamptz;
begin
 perform private.school_report_guard();v_now:=clock_timestamp();
 if p_request_id is null or p_basis_reference is null or p_notice_reference is null
 or p_basis_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' or p_notice_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
 or not coalesce(isfinite(p_school_registered_until) and isfinite(p_basis_valid_until) and p_school_registered_until>v_now and p_basis_valid_until>v_now,false)
 or not (exists(select 1 from public.school_members m where m.user_id=p_actor_user_id and m.school_id=p_school_id and m.member_role='school_admin' and m.status='active' and exists(select 1 from public.profiles operator_profile where operator_profile.id=m.user_id and operator_profile.role='学校支持人员' and operator_profile.school_id=m.school_id))
 or exists(select 1 from auth.users u join public.admin_roles a on lower(a.email)=lower(u.email) where u.id=p_actor_user_id and a.status='active'))
 then return jsonb_build_object('status','denied');end if;
 select * into e from public.school_report_enrollments where student_user_id=p_student_user_id and request_id=p_request_id;
 if found then
  if (e.school_id,e.basis_reference,e.notice_reference,e.school_registered_until,e.basis_valid_until,e.issued_by)
   is distinct from(p_school_id,p_basis_reference,p_notice_reference,p_school_registered_until,p_basis_valid_until,p_actor_user_id)
  then return jsonb_build_object('status','denied');end if;
  return jsonb_build_object('status','ready','enrollmentId',e.id,'replayed',true);
 end if;
 select * into c from public.student_consents where student_user_id=p_student_user_id;
 select * into q from public.minor_eligibility_assertions where student_user_id=p_student_user_id and school_id=p_school_id order by verified_at desc,id limit 1;
 if not private.school_report_base_valid(c,v_now)
 or not exists(select 1 from public.profiles p join public.schools s on s.id=p.school_id where p.id=p_student_user_id and p.role='学生' and p.school_id=p_school_id and s.status='active')
 or q.id is null or q.revoked_at is not null or q.verified_at>v_now or q.valid_until<=v_now
 then return jsonb_build_object('status','denied');end if;
 v_exp:=least(v_now+interval '2592000 seconds',q.valid_until,p_school_registered_until,p_basis_valid_until);
 for e in select * from public.school_report_enrollments where student_user_id=p_student_user_id and status='active' loop
  perform private.school_report_terminate(e.id,'invalidated','replaced',p_actor_user_id);
 end loop;
 insert into public.school_report_enrollments(student_user_id,school_id,minor_assertion_id,issued_by,basis_reference,notice_reference,
 base_consent_snapshot,school_registered_until,basis_valid_until,effective_at,expires_at,request_id)
 values(p_student_user_id,p_school_id,q.id,p_actor_user_id,p_basis_reference,p_notice_reference,to_jsonb(c)-array['created_at','updated_at'],
 p_school_registered_until,p_basis_valid_until,v_now,v_exp,p_request_id) returning id into v_id;
 insert into public.school_report_detail_states(enrollment_id) values(v_id);
 perform private.school_report_reconcile(v_id);
 insert into public.school_report_sharing_events(enrollment_id,actor_user_id,event_type,request_id) values(v_id,p_actor_user_id,'issued',p_request_id);
 return jsonb_build_object('status','ready','enrollmentId',v_id,'replayed',false);
end $$;
create function public.end_school_report_enrollment(p_actor_user_id uuid,p_enrollment_id uuid,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.school_report_enrollments;
begin
 perform private.school_report_guard();select * into e from public.school_report_enrollments where id=p_enrollment_id;
 if e.id is null or p_request_id is null or not (p_actor_user_id=e.student_user_id
 or exists(select 1 from public.school_members m where m.user_id=p_actor_user_id and m.school_id=e.school_id and m.member_role='school_admin' and m.status='active' and exists(select 1 from public.profiles operator_profile where operator_profile.id=m.user_id and operator_profile.role='学校支持人员' and operator_profile.school_id=m.school_id))
 or exists(select 1 from auth.users u join public.admin_roles a on lower(a.email)=lower(u.email) where u.id=p_actor_user_id and a.status='active'))
 then return jsonb_build_object('status','denied');end if;
 if exists(select 1 from public.school_report_sharing_events where enrollment_id=e.id and actor_user_id=p_actor_user_id and request_id=p_request_id and event_type<>'withdrawn') then return jsonb_build_object('status','denied');end if;
 perform private.school_report_terminate(e.id,'withdrawn','withdrawn',p_actor_user_id,p_request_id);
 return jsonb_build_object('status','ready','ended',true);
end $$;
create function public.set_school_report_details(p_actor_user_id uuid,p_enrollment_id uuid,p_enabled boolean,
 p_expected_detail_revision bigint default null,p_expected_recipient_epoch bigint default null,p_request_id uuid default null,
 p_notice_version text default 'sweet-details-2026-10-28',p_confirmed boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.school_report_enrollments;d public.school_report_detail_states;v_fingerprint text;v_old text;v_replayed boolean:=false;
begin
 perform private.school_report_guard();select * into e from public.school_report_enrollments where id=p_enrollment_id;
 if e.id is null or e.student_user_id is distinct from p_actor_user_id or p_enabled is null or p_request_id is null then return jsonb_build_object('status','denied');end if;
 perform private.school_report_reconcile(e.id);
 select * into e from public.school_report_enrollments where id=p_enrollment_id;
 select * into d from public.school_report_detail_states where enrollment_id=e.id;
 v_fingerprint:=md5(jsonb_build_array(p_enabled,p_expected_detail_revision,p_expected_recipient_epoch,p_notice_version,p_confirmed)::text);
 select command_fingerprint into v_old from public.school_report_sharing_events where enrollment_id=e.id and actor_user_id=p_actor_user_id and request_id=p_request_id;
 if found then
  if v_old is distinct from v_fingerprint then return jsonb_build_object('status','denied');end if;
  v_replayed:=true;
 else
  if p_enabled and (e.status<>'active' or not coalesce(p_confirmed,false) or p_notice_version is distinct from 'sweet-details-2026-10-28'
   or p_expected_detail_revision is distinct from d.detail_revision or p_expected_recipient_epoch is distinct from e.recipient_epoch
   or not exists(select 1 from private.school_report_teachers(e.student_user_id,e.school_id)))
  then return jsonb_build_object('status','refresh_required');end if;
  update public.school_report_detail_states set enabled=p_enabled,detail_revision=detail_revision+1,
   enabled_by=case when p_enabled then p_actor_user_id end,enabled_at=case when p_enabled then clock_timestamp() end,
   enabled_recipient_epoch=case when p_enabled then e.recipient_epoch end where enrollment_id=e.id returning * into d;
  insert into public.school_report_sharing_events(enrollment_id,actor_user_id,event_type,request_id,command_fingerprint,detail_revision,recipient_epoch)
  values(e.id,p_actor_user_id,case when p_enabled then 'details_on' else 'details_off' end,p_request_id,v_fingerprint,d.detail_revision,e.recipient_epoch);
 end if;
 return jsonb_build_object('status','ready','enabled',d.enabled,'detailRevision',d.detail_revision,'recipientEpoch',e.recipient_epoch,'replayed',v_replayed);
end $$;
create function public.validate_school_report_view(p_actor_user_id uuid,p_enrollment_id uuid,p_mode text,p_student_id uuid,
 p_as_of timestamptz,p_source_revision bigint,p_recipient_epoch bigint,p_detail_revision bigint,p_expires_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb;
begin
 v:=private.school_report_context(p_actor_user_id,p_enrollment_id,p_mode,p_as_of);
 if v->>'status'='ready' and ((v#>>'{context,studentId}')::uuid is distinct from p_student_id
 or (v#>>'{context,sourceRevision}')::bigint is distinct from p_source_revision
 or (v#>>'{context,recipientEpoch}')::bigint is distinct from p_recipient_epoch
 or (v#>>'{context,detailRevision}')::bigint is distinct from p_detail_revision
 or (v#>>'{context,expiresAt}')::timestamptz is distinct from p_expires_at)
 then v:=jsonb_build_object('status','refresh_required');end if;
 return v;
end $$;

create function private.school_report_enrollment_integrity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (to_jsonb(new)-array['status','terminal_at','terminal_reason','recipient_epoch','recipient_fingerprint','source_revision','minor_assertion_id','issued_by'])
   is distinct from(to_jsonb(old)-array['status','terminal_at','terminal_reason','recipient_epoch','recipient_fingerprint','source_revision','minor_assertion_id','issued_by'])
 or (new.minor_assertion_id is distinct from old.minor_assertion_id and new.minor_assertion_id is not null)
 or (new.issued_by is distinct from old.issued_by and new.issued_by is not null)
 or (old.status<>'active' and new.status is distinct from old.status)
 or new.recipient_epoch<old.recipient_epoch or new.source_revision<old.source_revision
 then raise exception 'immutable_school_report_basis' using errcode='22023';end if;
 return new;
end $$;
create trigger school_report_enrollment_integrity before update on public.school_report_enrollments for each row execute function private.school_report_enrollment_integrity();
-- Maintenance runs as the table owner so GoTrue's deletion role needs no new grants.
create function private.school_report_anonymize_deleted_enrollment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.school_report_sharing_events set enrollment_id=null,actor_user_id=null,request_id=null,command_fingerprint=null where enrollment_id=old.id;
 update public.school_report_mode_access_audit set enrollment_id=null,actor_user_id=null where enrollment_id=old.id;
 return old;
end $$;
create trigger school_report_anonymize_deleted_enrollment before delete on public.school_report_enrollments for each row execute function private.school_report_anonymize_deleted_enrollment();
create function private.school_report_dependency_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare v_old jsonb:=to_jsonb(old);v_new jsonb:=case when tg_op='DELETE' then null else to_jsonb(new) end; e record; k text:=tg_table_name;
begin
 if k='sweet_records' then
  update public.school_report_enrollments set source_revision=source_revision+1 where status='active'
   and student_user_id in((v_old->>'user_id')::uuid,(v_new->>'user_id')::uuid);
 else
  for e in select n.id from public.school_report_enrollments n where n.status='active' and case k
   when 'profiles' then n.student_user_id in((v_old->>'id')::uuid,(v_new->>'id')::uuid) or exists(select 1 from public.teacher_student_assignments a where a.student_user_id=n.student_user_id and a.teacher_user_id in((v_old->>'id')::uuid,(v_new->>'id')::uuid))
   when 'schools' then n.school_id in((v_old->>'id')::uuid,(v_new->>'id')::uuid)
   when 'school_members' then n.school_id in((v_old->>'school_id')::uuid,(v_new->>'school_id')::uuid)
   when 'teacher_student_assignments' then n.student_user_id in((v_old->>'student_user_id')::uuid,(v_new->>'student_user_id')::uuid)
   when 'student_consents' then n.student_user_id in((v_old->>'student_user_id')::uuid,(v_new->>'student_user_id')::uuid)
   when 'minor_eligibility_assertions' then (tg_op='DELETE' and n.minor_assertion_id=(v_old->>'id')::uuid) or(tg_op<>'DELETE' and n.student_user_id in((v_old->>'student_user_id')::uuid,(v_new->>'student_user_id')::uuid))
   else false end
  loop
   if k='minor_eligibility_assertions' and tg_op='DELETE' then perform private.school_report_terminate(e.id,'invalidated','dependency');
   else perform private.school_report_reconcile(e.id);end if;
  end loop;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
do $$declare t text;begin
 foreach t in array array['profiles','schools','school_members','teacher_student_assignments','student_consents'] loop
  execute format('create trigger school_report_dependency_changed after insert or update or delete on public.%I for each row execute function private.school_report_dependency_changed()',t);
 end loop;
end $$;
create trigger school_report_proof_changed after insert or update on public.minor_eligibility_assertions for each row execute function private.school_report_dependency_changed();
create trigger school_report_proof_deleted before delete on public.minor_eligibility_assertions for each row execute function private.school_report_dependency_changed();
create trigger school_report_source_changed after insert or update or delete on public.sweet_records for each row execute function private.school_report_dependency_changed();
do $$declare t text;begin
 foreach t in array array['school_report_enrollments','school_report_detail_states','school_report_sharing_events','school_report_mode_access_audit'] loop
  execute format('create trigger report_dependency_write_lock before insert or update or delete on public.%I for each statement execute function public.report_dependency_write_lock()',t);
 end loop;
end $$;

create function public.purge_expired_school_report_metadata() returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();v_e bigint;v_events bigint;v_audit bigint;v_more bigint;v_ids uuid[];
begin
 perform private.school_report_guard();
 select coalesce(array_agg(id),'{}'::uuid[]) into v_ids from public.school_report_enrollments
 where least(coalesce(terminal_at,expires_at),expires_at)<v_now-interval '24 months' and(status<>'active' or expires_at<=v_now);
 delete from public.school_report_sharing_events where enrollment_id=any(v_ids);get diagnostics v_events=row_count;
 delete from public.school_report_mode_access_audit where enrollment_id=any(v_ids);get diagnostics v_audit=row_count;
 delete from public.school_report_enrollments where id=any(v_ids);get diagnostics v_e=row_count;
 delete from public.school_report_sharing_events where enrollment_id is null and created_at<v_now-interval '24 months';get diagnostics v_more=row_count;v_events:=v_events+v_more;
 delete from public.school_report_mode_access_audit where enrollment_id is null and created_at<v_now-interval '24 months';get diagnostics v_more=row_count;v_audit:=v_audit+v_more;
 return jsonb_build_object('status','ready','enrollmentsDeleted',v_e,'eventsDeleted',v_events,'auditsDeleted',v_audit);
end $$;
-- Replace only the old age-verification prerequisite; it still confers no reporting right.
create or replace function public.issue_report_minor_eligibility(
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
      where p.id=p_student_user_id and p.role='学生' and p.school_id=p_school_id
      and c.age_band='14_17' and c.status='active' and c.consent_basis in ('student_self_pilot','student_guardian')
      and c.policy_version='2026-08-28' and private.school_report_base_valid(c,v_now))
    or not (exists(select 1 from auth.users u join public.admin_roles a on lower(a.email)=lower(u.email)
      where u.id=p_actor_user_id and a.status='active') or exists(select 1 from public.school_members m
      where m.user_id=p_actor_user_id and m.school_id=p_school_id and m.member_role='school_admin' and m.status='active' and exists(select 1 from public.profiles operator_profile where operator_profile.id=m.user_id and operator_profile.role='学校支持人员' and operator_profile.school_id=m.school_id))) then
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

create function private.school_report_iso(p_time timestamptz) returns text language sql immutable security invoker set search_path='' as $$
 select to_char(p_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.')||case when mod(extract(microseconds from p_time)::bigint,1000)=0 then to_char(p_time at time zone 'UTC','MS') else to_char(p_time at time zone 'UTC','US') end||'Z'
$$;
create function private.school_report_blank(p_value text) returns boolean language sql immutable security invoker set search_path='' as $$
 select translate(p_value,E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279),'')=''
$$;
create function private.school_report_normalize(p_records jsonb,p_summary text) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare defs constant jsonb:='[{"id":"sleep","fields":[{"id":"quality","kind":"single","required":true,"options":["睡得很好","比较好","一般","不太好","很不好"]},{"id":"duration","kind":"single","options":["少于 5 小时","5 小时以上、不足 6 小时","6 小时以上、不足 7 小时","7 小时以上、不足 8 小时","8 小时以上","不太确定"]},{"id":"factors","kind":"multi","options":["睡前想太多","作业或任务压力","手机使用时间较长","家庭或人际压力","身体不舒服","不太确定"]},{"id":"note","kind":"text"}],"categories":["sleep_very_good","sleep_good","sleep_neutral","sleep_poor","sleep_very_poor"]},{"id":"wake","fields":[{"id":"state","kind":"single","required":true,"options":["很有精神","比较有精神","一般","有点疲惫","很疲惫"]},{"id":"factors","kind":"multi","options":["没睡够","一醒来就想到很多事","早上任务压力大","身体有点累","情绪影响","不太确定"]},{"id":"note","kind":"text"}],"categories":["wake_very_energized","wake_energized","wake_neutral","wake_tired","wake_very_tired"]},{"id":"eat","fields":[{"id":"rhythm","kind":"single","required":true,"options":["很规律","比较规律","一般","不太规律","很不规律"]},{"id":"mealCount","kind":"single","options":["3 餐或以上","2 餐","1 餐","没有吃正餐","不太确定"]},{"id":"foodDetails","kind":"text"},{"id":"factors","kind":"multi","options":["太忙了","没胃口","作息太乱","情绪影响","忘记吃饭","家里或学校选择有限","不太确定"]}],"categories":["eat_very_regular","eat_regular","eat_neutral","eat_irregular","eat_very_irregular"]},{"id":"exercise","fields":[{"id":"duration","kind":"single","required":true,"options":["0 分钟","1–9 分钟","10–19 分钟","20–29 分钟","30 分钟以上","不太确定"]},{"id":"activityTypes","kind":"multi","options":["步行、通勤或上下楼","拉伸或轻量活动","体育课","跑步、球类或跳操等运动","家务或日常活动","其他"]},{"id":"activityNote","kind":"text"},{"id":"bodyState","kind":"single","options":["很有活力","比较有活力","一般","有点疲惫","很疲惫"]},{"id":"factors","kind":"multi","options":["太累了","没有时间","没有动力","一直坐着学习或工作","情绪影响","身体不舒服","不太确定"]}],"categories":["exercise_none","exercise_one_to_nine","exercise_ten_to_nineteen","exercise_twenty_to_twenty_nine","exercise_over_thirty","exercise_unsure"]},{"id":"task","fields":[{"id":"engagement","kind":"single","required":true,"options":["很顺利","比较顺利","一般","不太顺利","很不顺利"]},{"id":"difficultyReasons","kind":"multi","options":["任务太多","不知道从哪里开始","担心做不好","被催促后更抗拒","情绪很累","不太确定"]},{"id":"completedSmallTask","kind":"text"}],"categories":["task_very_smooth","task_smooth","task_neutral","task_difficult","task_very_difficult"]}]'::jsonb;
 dim jsonb;def jsonb;matches jsonb;step jsonb;fm jsonb;value jsonb;fields jsonb;dims jsonb:='[]';answers jsonb:='{}';malformed boolean:=false;
 recognized int:=0;available int:=0;ok boolean;txt text;canonical jsonb;summary_state text:='missing';summary_value text:=null;
begin
 if jsonb_typeof(p_records) is distinct from 'array' then return jsonb_build_object('answers','{}'::jsonb,'dimensions','[]'::jsonb,'summary',null,'summaryState','unsupported','state','unsupported');end if;
 malformed:=jsonb_array_length(p_records)<>5 or exists(select 1 from jsonb_array_elements(p_records) s where jsonb_typeof(s)<>'object' or not exists(select 1 from jsonb_array_elements(defs) d where s->'id'=d->'id'));
 for dim in select v from jsonb_array_elements(defs) v loop
  fields:='[]';select coalesce(jsonb_agg(s),'[]') into matches from jsonb_array_elements(p_records) s where jsonb_typeof(s)='object' and s->'id'=dim->'id';
  if jsonb_array_length(matches)<>1 or jsonb_typeof(matches#>'{0,fields}') is distinct from 'array' then
   fields:=jsonb_build_array(jsonb_build_object('id',dim#>>'{fields,0,id}','state','unsupported'));malformed:=true;
  else
   recognized:=recognized+1;step:=matches->0;
   if exists(select 1 from jsonb_array_elements(step->'fields') f where jsonb_typeof(f)<>'object' or not exists(select 1 from jsonb_array_elements(dim->'fields') k where k->'id'=f->'id')) then malformed:=true;end if;
   for def in select v from jsonb_array_elements(dim->'fields') v loop
    select coalesce(jsonb_agg(f),'[]') into fm from jsonb_array_elements(step->'fields') f where jsonb_typeof(f)='object' and f->'id'=def->'id';
    if jsonb_array_length(fm)=0 and not coalesce((def->>'required')::boolean,false) then continue;end if;
    ok:=jsonb_array_length(fm)=1;value:=fm#>'{0,value}';
    if ok and not coalesce((def->>'required')::boolean,false) and ((def->>'kind'='multi' and value='[]'::jsonb) or(def->>'kind'='single' and value='""'::jsonb) or(def->>'kind'='text' and jsonb_typeof(value)='string' and private.school_report_blank(value#>>'{}'))) then continue;end if;
    if def->>'kind'='text' then ok:=ok and coalesce(jsonb_typeof(value)='string' and char_length(value#>>'{}')<=8192 and not private.school_report_blank(value#>>'{}'),false);canonical:=value;
    elsif def->>'kind'='single' then ok:=ok and coalesce(jsonb_typeof(value)='string' and (def->'options')@>jsonb_build_array(value),false);canonical:=value;
    else
     if jsonb_typeof(value) is distinct from 'array' then ok:=false;else
      ok:=ok and jsonb_array_length(value)>0 and jsonb_array_length(value)=(select count(distinct v) from jsonb_array_elements(value) v)
       and not exists(select 1 from jsonb_array_elements(value) v where jsonb_typeof(v)<>'string' or not(def->'options')@>jsonb_build_array(v));
      select coalesce(jsonb_agg(o order by ord),'[]') into canonical from jsonb_array_elements(def->'options') with ordinality a(o,ord) where value@>jsonb_build_array(o);
     end if;
    end if;
    if not coalesce(ok,false) then fields:=fields||jsonb_build_array(jsonb_build_object('id',def->>'id','state','unsupported'));malformed:=true;
    else
     available:=available+1;fields:=fields||jsonb_build_array(jsonb_build_object('id',def->>'id','state','available','value',canonical));
     if coalesce((def->>'required')::boolean,false) then
      select dim->'categories'->(ord::int-1) into canonical from jsonb_array_elements(def->'options') with ordinality a(o,ord) where o=value;
      answers:=answers||jsonb_build_object(dim->>'id',canonical);
     end if;
    end if;
   end loop;
  end if;
  dims:=dims||jsonb_build_array(jsonb_build_object('id',dim->>'id','fields',fields));
 end loop;
 if recognized=0 then return jsonb_build_object('answers','{}'::jsonb,'dimensions','[]'::jsonb,'summary',null,'summaryState','unsupported','state','unsupported');end if;
 if p_summary is not null and p_summary<>'' then
  if char_length(p_summary)>8192 then summary_state:='unsupported';malformed:=true;
  elsif not private.school_report_blank(p_summary) then summary_state:='available';summary_value:=p_summary;end if;
 end if;
 return jsonb_build_object('answers',answers,'dimensions',dims,'summary',summary_value,'summaryState',summary_state,
 'state',case when not malformed and (select count(*) from jsonb_object_keys(answers))=5 then 'available' when available>0 or summary_state='available' then 'partial' else 'unsupported' end);
end $$;
create function private.school_report_daily(p_student uuid,p_asof timestamptz)
returns table(source_id uuid,day date,instant timestamptz,normalized jsonb,conflict boolean)
language sql stable security invoker set search_path='' as $$
 with source as materialized(
  select r.id,r.created_at,r.records,r.summary,
   case when isfinite(r.created_at) then abs(extract(epoch from r.created_at)*1000000)<=9007199254740991 else false end as valid_time
  from public.sweet_records r where r.user_id=p_student and (not isfinite(r.created_at) or r.created_at<p_asof)
 ), dated as materialized(
  select *, (created_at at time zone 'Asia/Shanghai')::date as local_day,
   max(created_at) over(partition by (created_at at time zone 'Asia/Shanghai')::date) as latest
  from source where valid_time
 ), normalized_source as materialized(
  select id,created_at,local_day,summary,private.school_report_normalize(records,summary) as norm from dated where created_at=latest
 ), mapped as materialized(
  select id,created_at,local_day,norm,jsonb_build_object('normalized',norm,'originalSummary',summary) as fingerprint from normalized_source
 ), grouped as (
  select min(id::text)::uuid as source_id,local_day,max(created_at) as instant,
   (jsonb_agg(norm order by id))->0 as norm,count(distinct fingerprint)>1 as conflict
  from mapped group by local_day
 )
 select source_id,local_day,instant,norm,conflict from grouped
 union all
 select id,null,created_at,null,false from source where not valid_time
$$;
create function private.school_report_daily_page(p_student uuid,p_asof timestamptz,p_before_day date,p_limit integer)
returns table(source_id uuid,day date,instant timestamptz,normalized jsonb,conflict boolean)
language sql stable security invoker set search_path='' as $$
 with source as materialized(
  select r.id,r.created_at,r.records,r.summary,
   case when isfinite(r.created_at) then abs(extract(epoch from r.created_at)*1000000)<=9007199254740991 else false end as valid_time
  from public.sweet_records r where r.user_id=p_student and (not isfinite(r.created_at) or r.created_at<p_asof)
 ), dated as materialized(
  select *, (created_at at time zone 'Asia/Shanghai')::date as local_day,
   max(created_at) over(partition by (created_at at time zone 'Asia/Shanghai')::date) as latest
  from source where valid_time
 ), page_days as materialized(select distinct local_day from dated where p_before_day is null or local_day<p_before_day order by local_day desc limit p_limit), normalized_source as materialized(
  select id,created_at,local_day,summary,private.school_report_normalize(records,summary) as norm from dated where created_at=latest and local_day in(select local_day from page_days)
 ), mapped as materialized(
  select id,created_at,local_day,norm,jsonb_build_object('normalized',norm,'originalSummary',summary) as fingerprint from normalized_source
 ), grouped as (
  select min(id::text)::uuid as source_id,local_day,max(created_at) as instant,
   (jsonb_agg(norm order by id))->0 as norm,count(distinct fingerprint)>1 as conflict
  from mapped group by local_day
 )
 select source_id,local_day,instant,norm,conflict from grouped
$$;
create function private.school_report_window(p_days jsonb,p_start timestamptz,p_end timestamptz,p_undated boolean default false)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare dim text;v_n bigint;v_unknown boolean;v_max bigint;v_leaders bigint;v_cat text;v_dims jsonb:='[]';
begin
 foreach dim in array array['sleep','wake','eat','exercise','task'] loop
  with rows as(select v from jsonb_array_elements(p_days) v where (p_start is null or (v->>'instant')::timestamptz>=p_start) and (v->>'instant')::timestamptz<p_end),
  counts as(select v#>>array['answers',dim] as cat,count(*) as n from rows where not(v->>'conflict')::boolean and v#>>array['answers',dim] is not null group by 1)
  select coalesce((select sum(n) from counts),0),p_undated or coalesce((select bool_or((v->>'conflict')::boolean or v#>>array['answers',dim] is null) from rows),false),
   (select max(n) from counts) into v_n,v_unknown,v_max;
  if v_n<3 then v_dims:=v_dims||jsonb_build_array(jsonb_build_object('id',dim,'state',case when v_n=0 and v_unknown then 'unsupported' else 'insufficient' end));
  else
   with rows as(select v from jsonb_array_elements(p_days) v where(p_start is null or(v->>'instant')::timestamptz>=p_start) and(v->>'instant')::timestamptz<p_end),
   counts as(select v#>>array['answers',dim] as cat,count(*) as n from rows where not(v->>'conflict')::boolean and v#>>array['answers',dim] is not null group by 1)
   select count(*),max(cat) into v_leaders,v_cat from counts where n=v_max;
   v_dims:=v_dims||jsonb_build_array(case when v_leaders=1 then jsonb_build_object('id',dim,'state','category','category',v_cat) else jsonb_build_object('id',dim,'state','mixed') end);
  end if;
 end loop;
 return jsonb_build_object('start',case when p_start is not null then private.school_report_iso(p_start) end,'end',private.school_report_iso(p_end),'dimensions',v_dims);
end $$;
create function private.school_report_recent(p_days jsonb,p_asof timestamptz,p_length integer)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare a jsonb;b jsonb;v_comp jsonb:='[]';i int;x jsonb;y jsonb;d text;
begin
 a:=private.school_report_window(p_days,p_asof-p_length*interval '86400 seconds',p_asof);
 b:=private.school_report_window(p_days,p_asof-2*p_length*interval '86400 seconds',p_asof-p_length*interval '86400 seconds');
 for i in 0..4 loop
  x:=a->'dimensions'->i;y:=b->'dimensions'->i;d:=x->>'id';
  v_comp:=v_comp||jsonb_build_array(jsonb_build_object('id',d,'state',case when x->>'state'='category' and y->>'state'='category'
   and not(d='exercise' and (x->>'category'='exercise_unsure' or y->>'category'='exercise_unsure'))
   then case when x->>'category'=y->>'category' then 'same' else 'different' end else 'unavailable' end));
 end loop;
 return jsonb_build_object('current',a,'previous',b,'comparisons',v_comp);
end $$;
create function public.read_school_report_trend(p_actor_user_id uuid,p_enrollment_id uuid,p_as_of timestamptz default null,p_before_bin timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb;ctx jsonb;asof timestamptz;sid uuid;days jsonb;oldest timestamptz;v_unknown boolean;v_known boolean;v_undated boolean;v_unit text;
 v_start timestamp;v_finish timestamp;bstart timestamptz;bend timestamptz;bins jsonb:='[]';page jsonb;v_total bigint;v_report jsonb;
begin
 v:=private.school_report_context(p_actor_user_id,p_enrollment_id,'trend',p_as_of);
 if v->>'status'<>'ready' then perform private.school_report_audit(p_actor_user_id,p_enrollment_id,'trend',v);return v;end if;
 if p_before_bin is not null and not isfinite(p_before_bin) then return jsonb_build_object('status','refresh_required');end if;
 ctx:=v->'context';asof:=(ctx->>'asOf')::timestamptz;sid:=(ctx->>'studentId')::uuid;
 with daily as materialized(select * from private.school_report_daily(sid,asof))
 select coalesce(jsonb_agg(jsonb_build_object('instant',private.school_report_iso(instant),'answers',normalized->'answers','state',normalized->>'state','conflict',conflict))filter(where day is not null),'[]'),
 min(instant)filter(where day is not null),coalesce(bool_or(day is null or conflict or normalized->>'state'<>'available'),false),
 coalesce(bool_or(day is not null and not conflict and normalized->'answers'<>'{}'::jsonb),false),coalesce(bool_or(day is null),false)
 into days,oldest,v_unknown,v_known,v_undated from daily;
 v_unit:=case when oldest is null or (asof at time zone 'Asia/Shanghai')::date-(oldest at time zone 'Asia/Shanghai')::date+1<=90 then 'week' else 'month' end;
 if oldest is not null then
  v_start:=date_trunc(v_unit,oldest at time zone 'Asia/Shanghai');
  while v_start at time zone 'Asia/Shanghai'<asof loop
   v_finish:=v_start+case when v_unit='week' then interval '7 days' else interval '1 month' end;
   bstart:=v_start at time zone 'Asia/Shanghai';bend:=v_finish at time zone 'Asia/Shanghai';
   bins:=jsonb_build_array(private.school_report_window(days,bstart,bend)||jsonb_build_object('partial',bstart<oldest or bend>asof))||bins;
   v_start:=v_finish;
  end loop;
 end if;
 select count(*) into v_total from jsonb_array_elements(bins) b where p_before_bin is null or(b->>'start')::timestamptz<p_before_bin;
 select coalesce(jsonb_agg(b order by ord),'[]') into page from(select b,ord from jsonb_array_elements(bins)with ordinality q(b,ord)
 where p_before_bin is null or(b->>'start')::timestamptz<p_before_bin order by ord limit 24)t;
 v_report:=jsonb_build_object('version','sweet-comprehensive-report-v2','asOf',private.school_report_iso(asof),
 'coverage',jsonb_build_object('start',case when oldest is not null then private.school_report_iso(oldest) end,'end',private.school_report_iso(asof),'state',case when not v_unknown then 'complete' when v_known then 'partial' else 'unsupported' end),
 'overview',private.school_report_window(days,oldest,asof,v_undated),'recent',jsonb_build_object('days7',private.school_report_recent(days,asof,7),'days30',private.school_report_recent(days,asof,30)),
 'longTerm',jsonb_build_object('unit',v_unit,'bins',page,'hasMore',v_total>24,'nextBinStart',case when v_total>24 then page->23->>'start' end),
 'detailsState',case when (v->>'detailsEnabled')::boolean then 'available' else 'off' end);
 v:=jsonb_build_object('status','ready','report',v_report,'context',ctx);perform private.school_report_audit(p_actor_user_id,p_enrollment_id,'trend',v);return v;
end $$;
create function public.read_school_report_details(p_actor_user_id uuid,p_enrollment_id uuid,p_as_of timestamptz default null,p_phase text default 'dated',p_before_day date default null,p_before_id uuid default null,p_limit integer default 25)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb;ctx jsonb;asof timestamptz;sid uuid;items jsonb;v_total bigint;v_undated bigint;v_position jsonb:=null;lastday date;lastid uuid;v_report jsonb;
begin
 v:=private.school_report_context(p_actor_user_id,p_enrollment_id,'detail',p_as_of);
 if v->>'status'<>'ready' then perform private.school_report_audit(p_actor_user_id,p_enrollment_id,'detail',v);return v;end if;
 if p_phase is null or p_phase not in('dated','undated') or p_limit is null or p_limit<1 or p_limit>25 or(p_before_day is not null and not isfinite(p_before_day)) then return jsonb_build_object('status','refresh_required');end if;
 ctx:=v->'context';asof:=(ctx->>'asOf')::timestamptz;sid:=(ctx->>'studentId')::uuid;
 if p_phase='dated' then
  with times as(select created_at,case when isfinite(created_at) then abs(extract(epoch from created_at)*1000000)<=9007199254740991 else false end valid_time
   from public.sweet_records where user_id=sid and(not isfinite(created_at)or created_at<asof))
  select count(distinct (created_at at time zone 'Asia/Shanghai')::date)filter(where valid_time and(p_before_day is null or(created_at at time zone 'Asia/Shanghai')::date<p_before_day)),count(*)filter(where not valid_time)
   into v_total,v_undated from times;
  select coalesce(jsonb_agg(item order by day desc),'[]'),min(day) into items,lastday from(
   select day,case when conflict then jsonb_build_object('key',source_id,'date',day,'state','conflict')
    when normalized->>'state'='unsupported' then jsonb_build_object('key',source_id,'date',day,'state','unsupported')
    else jsonb_build_object('key',source_id,'date',day,'state',normalized->>'state','dimensions',normalized->'dimensions','summary',normalized->'summary','summaryState',normalized->>'summaryState')end item
   from private.school_report_daily_page(sid,asof,p_before_day,p_limit) where day is not null order by day desc)t;
  if v_total>0 then
   if v_total>p_limit then v_position:=jsonb_build_object('phase','dated','beforeDate',lastday);
   elsif v_undated>0 then v_position:=jsonb_build_object('phase','undated','afterId',null);end if;
  end if;
 end if;
 if p_phase='undated' or coalesce(v_total,0)=0 then
  select count(*) into v_total from public.sweet_records where user_id=sid and(not isfinite(created_at)or(created_at<asof and abs(extract(epoch from created_at)*1000000)>9007199254740991)) and(p_before_id is null or id>p_before_id);
  select coalesce(jsonb_agg(item order by source_id),'[]'),max(source_id::text)::uuid into items,lastid from(
   select id as source_id,jsonb_build_object('key',id,'date',null,'state','unsupported') item from public.sweet_records
   where user_id=sid and(not isfinite(created_at)or(created_at<asof and abs(extract(epoch from created_at)*1000000)>9007199254740991)) and(p_before_id is null or id>p_before_id) order by id limit p_limit)t;
  if v_total>p_limit then v_position:=jsonb_build_object('phase','undated','afterId',lastid);end if;
 end if;
 v_report:=jsonb_build_object('version','sweet-history-details-v1','asOf',private.school_report_iso(asof),'items',items,'hasMore',v_position is not null,'nextPosition',v_position);
 v:=jsonb_build_object('status','ready','report',v_report,'context',ctx);perform private.school_report_audit(p_actor_user_id,p_enrollment_id,'detail',v);return v;
end $$;
create function public.read_school_report_access(p_actor_user_id uuid,p_after_id uuid default null,p_section text default 'received',p_enrollment_id uuid default null,p_limit integer default 30,p_expected_recipient_epoch bigint default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.profiles;e public.school_report_enrollments;d public.school_report_detail_states;v_owner jsonb:=null;v_received jsonb:='[]';v_recipients jsonb:='[]';v_ctx jsonb;v_name text;r record;n int:=0;v_next uuid;v_recnext uuid;v_role text:='unavailable';v_elig text:='not_available';
begin
 perform private.school_report_guard();
 if p_limit is null or p_limit<1 or p_limit>30 or p_section is null or p_section not in('received','recipients') then return jsonb_build_object('status','denied');end if;
 select * into p from public.profiles where id=p_actor_user_id;
 if p.id is null or not exists(select 1 from auth.users where id=p_actor_user_id) then return jsonb_build_object('status','denied');end if;
 if p.role='学生' then
  v_role:='student';v_elig:='not_enrolled';
  select * into e from public.school_report_enrollments where student_user_id=p_actor_user_id order by created_at desc,id desc limit 1;
  if p_enrollment_id is not null and e.id is distinct from p_enrollment_id then return jsonb_build_object('status','denied');end if;
  if e.id is not null then
   perform private.school_report_reconcile(e.id);select * into e from public.school_report_enrollments where id=e.id;
   select * into d from public.school_report_detail_states where enrollment_id=e.id;
   v_elig:=case when e.status='active' then 'enrolled' when e.terminal_reason='expired' then 'expired' else 'not_enrolled' end;
   if p_section='recipients' and p_expected_recipient_epoch is not null and e.recipient_epoch<>p_expected_recipient_epoch then return jsonb_build_object('status','refresh_required');end if;
   if e.status='active' then
    for r in select t.recipient_id from private.school_report_teachers(e.student_user_id,e.school_id)t
     where p_section<>'recipients' or p_after_id is null or t.recipient_id>p_after_id order by t.recipient_id limit p_limit+1 loop
     n:=n+1;if n>p_limit then v_recnext:=(v_recipients->(p_limit-1)->>'id')::uuid;exit;end if;
     select left(coalesce(display_name,''),80) into v_name from public.profiles where id=r.recipient_id;
     v_recipients:=v_recipients||jsonb_build_array(jsonb_build_object('id',r.recipient_id,'type','teacher','displayName',coalesce(v_name,'')));
    end loop;
   end if;
   select left(coalesce(display_name,''),80) into v_name from public.profiles where id=p_actor_user_id;
   v_owner:=jsonb_build_object('enrollmentId',e.id,'displayName',coalesce(v_name,''),'effectiveAt',private.school_report_iso(e.effective_at),'expiresAt',private.school_report_iso(e.expires_at),
   'status',case when e.terminal_reason='expired' then 'expired' else e.status end,'detailsEnabled',d.enabled,'detailRevision',d.detail_revision,'recipientEpoch',e.recipient_epoch,'recipients',v_recipients);
  end if;
 elsif p.role='学校支持人员' then
  v_role:='teacher';v_elig:='not_available';n:=0;
  for r in select q.id from public.school_report_enrollments q where q.status='active' and q.expires_at>clock_timestamp()
   and(p_after_id is null or q.id>p_after_id) and exists(select 1 from private.school_report_teachers(q.student_user_id,q.school_id)t where t.recipient_id=p_actor_user_id) order by q.id loop
   v_ctx:=private.school_report_context(p_actor_user_id,r.id,'trend');
   if v_ctx->>'status'<>'ready' then continue;end if;
   n:=n+1;if n>p_limit then v_next:=(v_received->(p_limit-1)->>'enrollmentId')::uuid;exit;end if;
   select * into e from public.school_report_enrollments where id=r.id;
   select left(coalesce(display_name,''),80) into v_name from public.profiles where id=e.student_user_id;
   v_received:=v_received||jsonb_build_array(jsonb_build_object('enrollmentId',e.id,'displayName',coalesce(v_name,''),'effectiveAt',private.school_report_iso(e.effective_at),'expiresAt',private.school_report_iso(e.expires_at)));
  end loop;
 end if;
 return jsonb_build_object('status','ready','version','school-report-access-v2','viewerRole',v_role,'eligibility',v_elig,'owner',v_owner,'received',v_received,'nextAfterId',v_next,'recipientNextAfterId',v_recnext);
end $$;
create function private.school_report_event_integrity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if(to_jsonb(new)-array['enrollment_id','actor_user_id','request_id','command_fingerprint']) is distinct from(to_jsonb(old)-array['enrollment_id','actor_user_id','request_id','command_fingerprint'])
 or(new.enrollment_id is distinct from old.enrollment_id and new.enrollment_id is not null)
 or(new.actor_user_id is distinct from old.actor_user_id and new.actor_user_id is not null)
 or(new.request_id is distinct from old.request_id and new.request_id is not null)
 or(new.command_fingerprint is distinct from old.command_fingerprint and new.command_fingerprint is not null)
 then raise exception 'immutable_school_report_event' using errcode='22023';end if;
 return new;
end $$;
create trigger school_report_event_integrity before update on public.school_report_sharing_events for each row execute function private.school_report_event_integrity();
create function private.school_report_audit_integrity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if(to_jsonb(new)-array['enrollment_id','actor_user_id'])is distinct from(to_jsonb(old)-array['enrollment_id','actor_user_id'])
 or(new.enrollment_id is distinct from old.enrollment_id and new.enrollment_id is not null)
 or(new.actor_user_id is distinct from old.actor_user_id and new.actor_user_id is not null)
 then raise exception 'immutable_school_report_audit' using errcode='22023';end if;return new;
end $$;
create trigger school_report_audit_integrity before update on public.school_report_mode_access_audit for each row execute function private.school_report_audit_integrity();
create function private.school_report_detail_integrity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.enrollment_id<>old.enrollment_id or new.notice_version<>old.notice_version or new.detail_revision<old.detail_revision
 or (new.enabled and new.enabled_by is not null and not exists(select 1 from public.school_report_enrollments e where e.id=new.enrollment_id and e.student_user_id=new.enabled_by and e.recipient_epoch=new.enabled_recipient_epoch))
 then raise exception 'invalid_school_report_details' using errcode='22023';end if;return new;
end $$;
create trigger school_report_detail_integrity before update on public.school_report_detail_states for each row execute function private.school_report_detail_integrity();

-- Historical opt-in grants remain history and cannot act as v2 access.
with ended as(update public.report_authorizations set status='invalidated',invalidated_at=clock_timestamp() where status='active' returning id)
insert into public.report_authorization_events(authorization_id,event_type)select id,'invalidated' from ended;
revoke all on function public.create_report_authorization(uuid,uuid,text,text[],uuid,text),public.revoke_report_authorization(uuid,uuid),
 public.lock_report_authorization(uuid,uuid),public.read_report_summary(uuid,uuid) from public,anon,authenticated,service_role;
-- Harden every new function's default execution ACL. Pure/transaction helpers
-- need service execution because all business RPCs remain SECURITY INVOKER.
do $$declare f record;begin
 for f in select p.oid::regprocedure as signature,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where(n.nspname='private' and p.proname like 'school_report_%')or(n.nspname='public' and p.proname in(
 'issue_school_report_enrollment','end_school_report_enrollment','read_school_report_access','set_school_report_details',
 'read_school_report_trend','read_school_report_details','validate_school_report_view','purge_expired_school_report_metadata'))loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname not in('school_report_enrollment_integrity','school_report_anonymize_deleted_enrollment','school_report_dependency_changed',
   'school_report_event_integrity','school_report_audit_integrity','school_report_detail_integrity')then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
