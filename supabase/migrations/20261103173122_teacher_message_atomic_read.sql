-- Local source only. Not applied or executed; real ACL/RLS/transaction/concurrency validation remains pending.
create or replace function public.mark_teacher_message_read(
  p_message_id uuid,
  p_teacher_id uuid
)
returns table (message_id uuid, read_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  update public.student_messages as message
  set read_at = coalesce(message.read_at, now())
  where message.id = p_message_id
    and message.recipient_type = 'teacher'
    and message.recipient_user_id = p_teacher_id
    and message.moderation_status in ('sent', 'safety_review')
    and exists (
      select 1
      from public.profiles teacher
      join public.schools school on school.id = teacher.school_id and school.status = 'active'
      join public.school_members member on member.school_id = school.id
        and member.user_id = teacher.id and member.member_role = 'school_support' and member.status = 'active'
      join public.profiles student on student.id = message.sender_user_id
        and student.role = '学生' and student.school_id = school.id
      join public.teacher_student_assignments assignment on assignment.school_id = school.id
        and assignment.teacher_user_id = teacher.id and assignment.student_user_id = student.id
        and assignment.status = 'active'
      join public.student_consents consent on consent.student_user_id = student.id
      where teacher.id = p_teacher_id
        and teacher.role = '学校支持人员'
        and message.school_id = school.id
        and consent.status = 'active'
        and consent.policy_version = '2026-08-28'
        and consent.student_assented_at is not null
        and (
          (consent.age_band = '18_plus' and consent.consent_basis = 'adult_self')
          or (consent.age_band = '14_17' and consent.consent_basis = 'student_self_pilot')
          or (consent.age_band = '14_17' and consent.consent_basis = 'student_guardian'
            and consent.guardian_user_id is not null and consent.guardian_consented_at is not null)
        )
    )
  returning message.id, message.read_at;
$$;
revoke all on function public.mark_teacher_message_read(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_teacher_message_read(uuid, uuid) to service_role;
