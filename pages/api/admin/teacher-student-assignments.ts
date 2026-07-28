import type { NextApiRequest, NextApiResponse } from "next";
import {
  canManageSchool,
  canManageSchoolMembers,
  getAdminContext,
} from "@/lib/adminAccess";

async function loadRoster(
  context: Awaited<ReturnType<typeof getAdminContext>>,
  schoolId: string,
) {
  const { supabase } = context;
  const { data: students, error: studentError } = await supabase
    .from("profiles")
    .select("id,email,display_name")
    .eq("school_id", schoolId)
    .eq("role", "学生")
    .order("display_name", { ascending: true });
  if (studentError) throw studentError;

  const { data: guardians, error: guardianError } = await supabase
    .from("profiles")
    .select("id,email,display_name")
    .eq("school_id", schoolId)
    .eq("role", "家长")
    .order("display_name", { ascending: true });
  if (guardianError) throw guardianError;

  const { data: teacherMemberships, error: teacherError } = await supabase
    .from("school_members")
    .select("user_id,email")
    .eq("school_id", schoolId)
    .eq("member_role", "school_support")
    .eq("status", "active");
  if (teacherError) throw teacherError;

  const teacherIds = (teacherMemberships || []).map((member) => member.user_id as string);
  const { data: teacherProfiles, error: teacherProfileError } = teacherIds.length
    ? await supabase
        .from("profiles")
        .select("id,email,display_name")
        .in("id", teacherIds)
    : { data: [], error: null };
  if (teacherProfileError) throw teacherProfileError;

  const profileById = new Map((teacherProfiles || []).map((profile) => [profile.id, profile]));
  const teachers = (teacherMemberships || []).map((member) => {
    const profile = profileById.get(member.user_id);
    return {
      id: member.user_id,
      email: profile?.email || member.email || "",
      display_name: profile?.display_name || "",
    };
  });

  const { data: assignments, error: assignmentError } = await supabase
    .from("teacher_student_assignments")
    .select("teacher_user_id,student_user_id")
    .eq("school_id", schoolId)
    .eq("status", "active");
  if (assignmentError) throw assignmentError;

  const { data: guardianAssignments, error: guardianAssignmentError } = await supabase
    .from("guardian_student_links")
    .select("guardian_user_id,student_user_id")
    .eq("school_id", schoolId)
    .eq("status", "active");
  if (guardianAssignmentError) throw guardianAssignmentError;

  return {
    teachers,
    students: students || [],
    guardians: guardians || [],
    assignments: assignments || [],
    guardianAssignments: guardianAssignments || [],
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const context = await getAdminContext(req);
    const schoolId = String(
      req.method === "GET" ? req.query.schoolId || "" : req.body?.schoolId || "",
    ).trim();
    if (!schoolId || !canManageSchool(context, schoolId)) {
      return res.status(403).json({ error: "你只能管理自己负责的学校。" });
    }
    if (!canManageSchoolMembers(context, schoolId)) {
      return res.status(403).json({ error: "只有学校负责人可以分配老师负责的学生。" });
    }

    if (req.method === "GET") {
      return res.status(200).json(await loadRoster(context, schoolId));
    }

    const teacherUserId = String(req.body?.teacherUserId || "").trim();
    const studentUserIds = Array.from(
      new Set(
        (Array.isArray(req.body?.studentUserIds) ? req.body.studentUserIds : [])
          .map((value: unknown) => String(value).trim())
          .filter(Boolean),
      ),
    );
    if (!teacherUserId) return res.status(400).json({ error: "请选择支持老师。" });

    const { data: teacher, error: teacherError } = await context.supabase
      .from("school_members")
      .select("user_id")
      .eq("school_id", schoolId)
      .eq("user_id", teacherUserId)
      .eq("member_role", "school_support")
      .eq("status", "active")
      .maybeSingle();
    if (teacherError) throw teacherError;
    if (!teacher) return res.status(400).json({ error: "所选账号不是本校支持老师。" });

    if (studentUserIds.length > 0) {
      const { data: validStudents, error: studentError } = await context.supabase
        .from("profiles")
        .select("id")
        .eq("school_id", schoolId)
        .eq("role", "学生")
        .in("id", studentUserIds);
      if (studentError) throw studentError;
      if ((validStudents || []).length !== studentUserIds.length) {
        return res.status(400).json({ error: "学生名单中包含不属于本校的账号。" });
      }
    }

    const now = new Date().toISOString();
    const { error: revokeError } = await context.supabase
      .from("teacher_student_assignments")
      .update({ status: "revoked", revoked_at: now, updated_at: now })
      .eq("school_id", schoolId)
      .eq("teacher_user_id", teacherUserId)
      .eq("status", "active");
    if (revokeError) throw revokeError;

    if (studentUserIds.length > 0) {
      const { error: upsertError } = await context.supabase
        .from("teacher_student_assignments")
        .upsert(
          studentUserIds.map((studentUserId) => ({
            school_id: schoolId,
            teacher_user_id: teacherUserId,
            student_user_id: studentUserId,
            assigned_by: context.user.id,
            status: "active",
            updated_at: now,
            revoked_at: null,
          })),
          { onConflict: "school_id,teacher_user_id,student_user_id" },
        );
      if (upsertError) throw upsertError;
    }

    return res.status(200).json(await loadRoster(context, schoolId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "老师负责学生保存失败。";
    const status =
      message.includes("只有") || message.includes("只能")
        ? 403
        : message.includes("请先登录")
          ? 401
          : 500;
    return res.status(status).json({ error: message });
  }
}
