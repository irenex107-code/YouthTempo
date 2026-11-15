import type { NextApiRequest, NextApiResponse } from "next";
import { getAdminContext } from "@/lib/adminAccess";
import { getServerTranslator } from "@/lib/i18n/server";

async function getCount(query: PromiseLike<{ count: number | null; error: unknown }>) {
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const t = getServerTranslator(req.cookies?.NEXT_LOCALE);

  try {
    const context = await getAdminContext(req);
    const { supabase } = context;
    const isSupportOnly =
      context.kind === "school" &&
      !Object.values(context.schoolRoles).includes("school_admin");
    const assignedStudentIds = context.assignedStudentIds;

    const schoolsQuery = supabase
      .from("schools")
      .select("id,name,status,created_at")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    const { data: schools, error: schoolsError } = context.kind === "school"
      ? await schoolsQuery.in("id", context.managedSchoolIds)
      : await schoolsQuery;
    if (schoolsError) throw schoolsError;

    const schoolIds = (schools || []).map((school) => school.id as string);
    const hasScopedSchools = context.kind === "platform" || schoolIds.length > 0;
    const canManageMembers =
      context.kind === "platform" ||
      Object.values(context.schoolRoles).includes("school_admin");
    const directorySchoolIds =
      context.kind === "platform"
        ? schoolIds
        : schoolIds.filter((schoolId) => context.schoolRoles[schoolId] === "school_admin");

    let schoolDirectories: Array<{
      school_id: string;
      leaders: Array<{ id: string; email: string; display_name: string }>;
      teachers: Array<{ id: string; email: string; display_name: string }>;
      students: Array<{ id: string; email: string; display_name: string }>;
      guardians: Array<{ id: string; email: string; display_name: string }>;
      professionals: Array<{ id: string; email: string; display_name: string }>;
      assignments: Array<{ teacher_user_id: string; student_user_id: string }>;
      guardianAssignments: Array<{ guardian_user_id: string; student_user_id: string }>;
    }> = [];

    if (canManageMembers && directorySchoolIds.length > 0) {
      const [
        { data: memberships, error: membershipDirectoryError },
        { data: students, error: studentDirectoryError },
        { data: guardians, error: guardianDirectoryError },
        { data: professionals, error: professionalDirectoryError },
        { data: assignments, error: assignmentDirectoryError },
        { data: guardianAssignments, error: guardianAssignmentDirectoryError },
      ] = await Promise.all([
        supabase
          .from("school_members")
          .select("school_id,user_id,email,member_role")
          .in("school_id", directorySchoolIds)
          .in("member_role", ["school_admin", "school_support"])
          .eq("status", "active"),
        supabase
          .from("profiles")
          .select("id,email,display_name,school_id")
          .in("school_id", directorySchoolIds)
          .eq("role", "学生"),
        supabase
          .from("profiles")
          .select("id,email,display_name,school_id")
          .in("school_id", directorySchoolIds)
          .eq("role", "家长"),
        supabase
          .from("profiles")
          .select("id,email,display_name,school_id")
          .in("school_id", directorySchoolIds)
          .eq("role", "专业支持者"),
        supabase
          .from("teacher_student_assignments")
          .select("school_id,teacher_user_id,student_user_id")
          .in("school_id", directorySchoolIds)
          .eq("status", "active"),
        supabase
          .from("guardian_student_links")
          .select("school_id,guardian_user_id,student_user_id")
          .in("school_id", directorySchoolIds)
          .eq("status", "active"),
      ]);
      if (membershipDirectoryError) throw membershipDirectoryError;
      if (studentDirectoryError) throw studentDirectoryError;
      if (guardianDirectoryError) throw guardianDirectoryError;
      if (professionalDirectoryError) throw professionalDirectoryError;
      if (assignmentDirectoryError) throw assignmentDirectoryError;
      if (guardianAssignmentDirectoryError) throw guardianAssignmentDirectoryError;

      const memberUserIds = Array.from(
        new Set((memberships || []).map((membership) => membership.user_id as string)),
      );
      const { data: memberProfiles, error: memberProfileError } = memberUserIds.length
        ? await supabase
            .from("profiles")
            .select("id,email,display_name")
            .in("id", memberUserIds)
        : { data: [], error: null };
      if (memberProfileError) throw memberProfileError;

      const memberProfileById = new Map(
        (memberProfiles || []).map((profile) => [profile.id as string, profile]),
      );
      schoolDirectories = directorySchoolIds.map((schoolId) => {
        const schoolMemberships = (memberships || []).filter(
          (membership) => membership.school_id === schoolId,
        );
        const peopleForRole = (memberRole: "school_admin" | "school_support") =>
          schoolMemberships
            .filter((membership) => membership.member_role === memberRole)
            .map((membership) => {
              const profile = memberProfileById.get(membership.user_id as string);
              return {
                id: membership.user_id as string,
                email: profile?.email || membership.email || "",
                display_name: profile?.display_name || "",
              };
            });

        return {
          school_id: schoolId,
          leaders: peopleForRole("school_admin"),
          teachers: peopleForRole("school_support"),
          students: (students || [])
            .filter((student) => student.school_id === schoolId)
            .map((student) => ({
              id: student.id as string,
              email: student.email || "",
              display_name: student.display_name || "",
            })),
          guardians: (guardians || [])
            .filter((guardian) => guardian.school_id === schoolId)
            .map((guardian) => ({
              id: guardian.id as string,
              email: guardian.email || "",
              display_name: guardian.display_name || "",
            })),
          professionals: (professionals || [])
            .filter((professional) => professional.school_id === schoolId)
            .map((professional) => ({
              id: professional.id as string,
              email: professional.email || "",
              display_name: professional.display_name || "",
            })),
          assignments: (assignments || [])
            .filter((assignment) => assignment.school_id === schoolId)
            .map((assignment) => ({
              teacher_user_id: assignment.teacher_user_id as string,
              student_user_id: assignment.student_user_id as string,
            })),
          guardianAssignments: (guardianAssignments || [])
            .filter((assignment) => assignment.school_id === schoolId)
            .map((assignment) => ({
              guardian_user_id: assignment.guardian_user_id as string,
              student_user_id: assignment.student_user_id as string,
            })),
        };
      });
    }

    let profileCountQuery = context.kind === "school"
      ? supabase.from("profiles").select("id", { count: "exact", head: true }).in("school_id", schoolIds)
      : supabase.from("profiles").select("id", { count: "exact", head: true });
    let schoolUserCountQuery = context.kind === "school"
      ? supabase.from("profiles").select("id", { count: "exact", head: true }).in("school_id", schoolIds)
      : supabase.from("profiles").select("id", { count: "exact", head: true }).not("school_id", "is", null);
    const memberCountQuery = context.kind === "school"
      ? supabase.from("school_members").select("id", { count: "exact", head: true }).in("school_id", schoolIds).eq("status", "active")
      : supabase.from("school_members").select("id", { count: "exact", head: true });
    if (isSupportOnly && assignedStudentIds.length > 0) {
      profileCountQuery = profileCountQuery.in("id", assignedStudentIds);
      schoolUserCountQuery = schoolUserCountQuery.in("id", assignedStudentIds);
    }
    const [profileCount, schoolUserCount, schoolMemberCount] = hasScopedSchools
      ? isSupportOnly && assignedStudentIds.length === 0
        ? [0, 0, 0]
        : await Promise.all([getCount(profileCountQuery), getCount(schoolUserCountQuery), getCount(memberCountQuery)])
      : [0, 0, 0];
    const wechatIdentityCount = context.kind === "platform"
      ? await getCount(supabase.from("wechat_identities").select("id", { count: "exact", head: true }))
      : 0;

    // Ordinary administration does not authorize reading private SWEET records or
    // deriving participation and attention monitoring. Independent safety-case
    // workflows remain separate; the empty legacy arrays are not a risk finding.
    return res.status(200).json({
      privateRecordsRestricted: true,
      admin: {
        email: context.email,
        role: context.roleLabel,
        status: "active",
        scope: context.kind,
        canManageMembers,
      },
      counts: {
        profiles: profileCount,
        schoolUsers: schoolUserCount,
        sweetRecords: null,
        schools: schools?.length || 0,
        schoolMembers: schoolMemberCount,
        wechatBindings: wechatIdentityCount,
      },
      schools: schools || [],
      schoolDirectories,
      recentRecords: [],
      attentionQueue: [],
      teacherWeeklySummaries: [],
      schoolMonthlyTrends: [],
      studentParticipationStats: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "请先登录管理员账号。" ? 401 : message === "当前账号没有学校工作台权限。" ? 403 : 500;
    return res.status(status).json({ error: t(status === 401 ? "adminPrivateRecords.signIn" : status === 403 ? "adminPrivateRecords.noAdminAccess" : "adminPrivateRecords.unavailable") });
  }
}
