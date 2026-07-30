import type { NextApiRequest, NextApiResponse } from "next";
import { applySchoolInvitesForUser } from "@/lib/schoolInvites";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

function profileRoleLabel(value?: string | null) {
  if (value === "家长") return "家长";
  if (value === "学校支持人员") return "支持老师";
  return "学生";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user?.email) return res.status(401).json({ error: "请先登录。" });

    const supabase = getSupabaseAdmin();
    let inviteSyncError: string | null = null;

    try {
      await applySchoolInvitesForUser(supabase, user);
    } catch (error) {
      inviteSyncError = error instanceof Error ? error.message : "学校邀请同步失败。";
    }

    const email = user.email.trim().toLowerCase();
    const [{ data: profile, error: profileError }, { data: platformAdmin, error: platformError }, { data: memberships, error: membershipError }] = await Promise.all([
      supabase.from("profiles").select("id,email,display_name,role,school_id").eq("id", user.id).maybeSingle(),
      supabase.from("admin_roles").select("email,role,status").eq("email", email).eq("status", "active").maybeSingle(),
      supabase.from("school_members").select("school_id,member_role,status").eq("user_id", user.id).eq("status", "active"),
    ]);
    if (profileError) throw profileError;
    if (platformError) throw platformError;
    if (membershipError) throw membershipError;

    const activeMemberships = memberships || [];
    const isSchoolLead = activeMemberships.some((membership) => membership.member_role === "school_admin");
    const isSupportTeacher = activeMemberships.some((membership) => membership.member_role === "school_support");
    const baseRole = profileRoleLabel(profile?.role as string | null | undefined);
    const displayRole = platformAdmin ? "平台管理员" : isSchoolLead ? "学校负责人" : isSupportTeacher ? "支持老师" : baseRole;
    const { data: guardianLinks, error: guardianLinkError } = baseRole === "家长"
      ? await supabase
          .from("guardian_student_links")
          .select("school_id,student_user_id")
          .eq("guardian_user_id", user.id)
          .eq("status", "active")
      : { data: [], error: null };
    if (guardianLinkError) throw guardianLinkError;

    const supportSchoolIds = activeMemberships
      .filter((membership) => membership.member_role === "school_support")
      .map((membership) => membership.school_id as string);
    const { data: teacherAssignments, error: teacherAssignmentError } = supportSchoolIds.length
      ? await supabase
          .from("teacher_student_assignments")
          .select("school_id,student_user_id")
          .eq("teacher_user_id", user.id)
          .eq("status", "active")
          .in("school_id", supportSchoolIds)
      : { data: [], error: null };
    if (teacherAssignmentError) throw teacherAssignmentError;

    const [{ data: studentTeacherLinks, error: studentTeacherError }, { data: studentGuardianLinks, error: studentGuardianError }] =
      baseRole === "学生"
        ? await Promise.all([
            supabase
              .from("teacher_student_assignments")
              .select("school_id,teacher_user_id")
              .eq("student_user_id", user.id)
              .eq("status", "active"),
            supabase
              .from("guardian_student_links")
              .select("school_id,guardian_user_id")
              .eq("student_user_id", user.id)
              .eq("status", "active"),
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
          ];
    if (studentTeacherError) throw studentTeacherError;
    if (studentGuardianError) throw studentGuardianError;

    const linkedStudentIds = (guardianLinks || []).map((link) => link.student_user_id as string);
    const assignedStudentIds = (teacherAssignments || []).map((assignment) => assignment.student_user_id as string);
    const teacherIds = (studentTeacherLinks || []).map((assignment) => assignment.teacher_user_id as string);
    const guardianIds = (studentGuardianLinks || []).map((link) => link.guardian_user_id as string);
    const relatedUserIds = Array.from(new Set([...linkedStudentIds, ...assignedStudentIds, ...teacherIds, ...guardianIds]));
    const { data: linkedProfiles, error: linkedProfileError } = relatedUserIds.length
      ? await supabase
          .from("profiles")
          .select("id,display_name,school_id")
          .in("id", relatedUserIds)
      : { data: [], error: null };
    if (linkedProfileError) throw linkedProfileError;

    const linkedProfileById = new Map(
      (linkedProfiles || []).map((linkedProfile) => [linkedProfile.id as string, linkedProfile]),
    );
    const linkedChildren = (guardianLinks || []).map((link) => {
      const linkedProfile = linkedProfileById.get(link.student_user_id as string);
      return {
        id: link.student_user_id as string,
        display_name: linkedProfile?.display_name || "孩子",
        school_id: link.school_id as string,
      };
    });
    const assignedStudents = (teacherAssignments || []).map((assignment) => {
      const assignedProfile = linkedProfileById.get(assignment.student_user_id as string);
      return {
        id: assignment.student_user_id as string,
        display_name: assignedProfile?.display_name || "学生",
        school_id: assignment.school_id as string,
      };
    });
    const assignedTeachers = (studentTeacherLinks || []).map((assignment) => {
      const teacherProfile = linkedProfileById.get(assignment.teacher_user_id as string);
      return {
        id: assignment.teacher_user_id as string,
        display_name: teacherProfile?.display_name || "老师",
        school_id: assignment.school_id as string,
      };
    });
    const linkedGuardians = (studentGuardianLinks || []).map((link) => {
      const guardianProfile = linkedProfileById.get(link.guardian_user_id as string);
      return {
        id: link.guardian_user_id as string,
        display_name: guardianProfile?.display_name || "家长",
        school_id: link.school_id as string,
      };
    });

    return res.status(200).json({
      profile,
      displayRole,
      adminAccess: platformAdmin
        ? { role: "平台管理员", scope: "platform" }
        : isSchoolLead
          ? { role: "学校负责人", scope: "school" }
          : isSupportTeacher
            ? { role: "支持老师", scope: "school" }
            : null,
      schoolMemberships: activeMemberships,
      hasSchool: Boolean(profile?.school_id || activeMemberships.length),
      linkedChildren,
      assignedStudents,
      assignedTeachers,
      linkedGuardians,
      inviteSyncError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "账户状态加载失败。";
    return res.status(500).json({ error: message });
  }
}
