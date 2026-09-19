-- Current student-led pilot: a historical active relationship is not a data grant.
-- Existing rows remain for audit and can be reviewed/revoked separately.
drop policy if exists "sweet_records_select_guardian" on public.sweet_records;

-- The old relationship itself contains a child's identifier. Keep it for
-- audited server workflows and the student's own record, not guardian Data API.
drop policy if exists "guardian_links_select_related" on public.guardian_student_links;
create policy "guardian_links_select_student_own"
on public.guardian_student_links for select
to authenticated
using (student_user_id = (select auth.uid()));

-- Service workflows also cannot create a new active relationship during this pilot.
-- NOT VALID preserves existing active rows without silently rewriting history.
alter table public.guardian_student_links
  drop constraint if exists pilot_guardian_links_inactive;
alter table public.guardian_student_links
  add constraint pilot_guardian_links_inactive check (status <> 'active') not valid;

-- An account with the guardian profile role must not inherit SWEET access from
-- a stale or overlapping school membership.
drop policy if exists "sweet_records_select_school_members" on public.sweet_records;
create policy "sweet_records_select_school_members"
on public.sweet_records for select
to authenticated
using (
  school_id is not null
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid()) and viewer.role <> '家长'
  )
  and exists (
    select 1 from public.school_members member
    where member.school_id = sweet_records.school_id
      and member.user_id = (select auth.uid())
      and member.status = 'active'
      and (
        member.member_role = 'school_admin'
        or (
          member.member_role = 'school_support'
          and exists (
            select 1 from public.teacher_student_assignments assignment
            where assignment.school_id = sweet_records.school_id
              and assignment.teacher_user_id = (select auth.uid())
              and assignment.student_user_id = sweet_records.user_id
              and assignment.status = 'active'
          )
        )
      )
  )
);
