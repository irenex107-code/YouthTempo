-- TEMPLATE ONLY. DO NOT RUN IN THIS TASK.
-- Authorized operator must verify project ref, legal basis, affected student,
-- expected row count, evidence path, and rollback window before execution.
-- Replace both UUID placeholders with reviewed IDs. Keep the transaction open
-- to inspect returned counts; issue ROLLBACK instead of COMMIT on any mismatch.
begin;
set local app.guardian_repair_actor_id = '00000000-0000-4000-8000-000000000001';
create temporary table guardian_repair_target on commit drop as
select id, school_id, guardian_user_id, student_user_id
from public.guardian_student_links
where id = '00000000-0000-4000-8000-000000000002'::uuid
  and status = 'active'
for update;

do $$
begin
  if (select count(*) from guardian_repair_target) <> 1 then
    raise exception 'Unexpected active link count; roll back';
  end if;
end;
$$;

create temporary table guardian_repair_consent on commit drop as
select consent.student_user_id, consent.school_id, consent.guardian_user_id,
       consent.age_band, consent.consent_basis, consent.policy_version
from public.student_consents consent
join guardian_repair_target target
  on target.student_user_id = consent.student_user_id
 and target.guardian_user_id = consent.guardian_user_id
where consent.status = 'active' and consent.consent_basis = 'student_guardian'
for update;

update public.student_consents consent
set status = 'withdrawn', withdrawn_at = now(),
    withdrawn_by = current_setting('app.guardian_repair_actor_id')::uuid,
    updated_at = now()
from guardian_repair_consent target
where consent.student_user_id = target.student_user_id
  and consent.status = 'active' and consent.consent_basis = 'student_guardian';

insert into public.student_consent_events
  (student_user_id, school_id, guardian_user_id, actor_user_id,
   event_type, age_band, consent_basis, policy_version)
select student_user_id, school_id, guardian_user_id,
       current_setting('app.guardian_repair_actor_id')::uuid,
       'consent_withdrawn', age_band, consent_basis, policy_version
from guardian_repair_consent;

update public.guardian_student_links link
set status = 'revoked', revoked_at = now(), updated_at = now()
from guardian_repair_target target
where link.id = target.id and link.status = 'active';

select (select count(*) from guardian_repair_target) as links_targeted,
       (select count(*) from guardian_repair_consent) as consents_withdrawn,
       (select count(*) from public.guardian_student_links link
        join guardian_repair_target target on target.id = link.id
        where link.status = 'active') as remaining_active_links;
-- Operator: verify results and audit record before the authorized COMMIT.
-- commit;
-- rollback;
