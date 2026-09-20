-- A clean local Supabase database does not inherit the production project's
-- historical table grants. RLS alone cannot make a row visible without table
-- privileges. Keep the direct client surface limited to existing RLS policies.
grant select, insert, update, delete on
  public.admin_roles,
  public.guardian_student_links,
  public.profiles,
  public.school_followups,
  public.school_invites,
  public.school_members,
  public.schools,
  public.student_consent_events,
  public.student_consents,
  public.student_message_duty_actions,
  public.student_messages,
  public.sweet_records,
  public.teacher_student_assignments,
  public.user_permissions,
  public.wechat_bind_sessions,
  public.wechat_identities
to service_role;

grant select on
  public.admin_roles,
  public.profiles,
  public.school_invites,
  public.school_members,
  public.schools,
  public.teacher_student_assignments,
  public.wechat_bind_sessions,
  public.wechat_identities
to authenticated;
grant select, insert, delete on public.sweet_records to authenticated;
grant select, insert, update on public.user_permissions to authenticated;
