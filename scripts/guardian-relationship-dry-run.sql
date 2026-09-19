-- READ ONLY. Run only after separately confirming the intended production project.
-- Outputs counts/IDs, never message bodies or student mental-health answers.
select count(*) as active_guardian_links
from public.guardian_student_links where status = 'active';

select link.id as link_id, link.school_id,
       link.guardian_user_id, link.student_user_id,
       consent.status as consent_status, consent.consent_basis,
       consent.policy_version
from public.guardian_student_links link
left join public.student_consents consent
  on consent.student_user_id = link.student_user_id
where link.status = 'active'
order by link.created_at, link.id;

select count(*) as active_guardian_backed_consents
from public.student_consents
where status = 'active' and consent_basis = 'student_guardian';
