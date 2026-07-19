import type { SupabaseClient, User } from "@supabase/supabase-js";

export type SchoolInviteRole = "student" | "support_teacher" | "school_lead";

export function inviteRoleFromLabel(label: string): SchoolInviteRole {
  if (label === "学校负责人" || label === "学校管理员") return "school_lead";
  if (label === "支持老师" || label === "学校支持人员") return "support_teacher";
  return "student";
}

export function inviteRoleLabel(role: SchoolInviteRole | string) {
  if (role === "school_lead") return "学校负责人";
  if (role === "support_teacher") return "支持老师";
  return "学生";
}

export function memberRoleFromInvite(role: SchoolInviteRole) {
  if (role === "school_lead") return "school_admin";
  if (role === "support_teacher") return "school_support";
  return null;
}

export async function applySchoolInvitesForUser(supabase: SupabaseClient, user: User) {
  const email = user.email?.trim().toLowerCase();
  if (!email) return [];

  const { data: invites, error: inviteError } = await supabase
    .from("school_invites")
    .select("id,school_id,email,assignment_role,status")
    .eq("status", "active")
    .ilike("email", email);
  if (inviteError) throw inviteError;
  if (!invites?.length) return [];

  const appliedInvites = [];
  for (const invite of invites) {
    const assignmentRole = invite.assignment_role as SchoolInviteRole;
    const memberRole = memberRoleFromInvite(assignmentRole);
    const displayRole = assignmentRole === "student" ? "学生" : "学校支持人员";

    if (memberRole) {
      const { error: memberError } = await supabase.from("school_members").upsert({
        school_id: invite.school_id,
        user_id: user.id,
        email,
        member_role: memberRole,
        status: "active",
        revoked_at: null,
      }, { onConflict: "school_id,user_id" });
      if (memberError) throw memberError;
    }

    const { error: profileError } = await supabase.from("profiles").upsert({
      id: user.id,
      email,
      display_name: user.user_metadata?.display_name || email.split("@")[0],
      role: displayRole,
      school_id: invite.school_id,
      updated_at: new Date().toISOString(),
    });
    if (profileError) throw profileError;

    if (assignmentRole === "student") {
      const { error: recordsError } = await supabase
        .from("sweet_records")
        .update({ school_id: invite.school_id })
        .eq("user_id", user.id)
        .is("school_id", null);
      if (recordsError) throw recordsError;
    }

    const { error: updateInviteError } = await supabase
      .from("school_invites")
      .update({
        status: "applied",
        applied_user_id: user.id,
        applied_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", invite.id);
    if (updateInviteError) throw updateInviteError;

    appliedInvites.push(invite);
  }

  return appliedInvites;
}
