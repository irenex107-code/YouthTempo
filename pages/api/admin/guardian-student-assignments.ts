import type { NextApiRequest, NextApiResponse } from "next";
import {
  canManageSchool,
  canManageSchoolMembers,
  getAdminContext,
} from "@/lib/adminAccess";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const context = await getAdminContext(req);
    const schoolId = String(req.body?.schoolId || "").trim();
    const guardianUserId = String(req.body?.guardianUserId || "").trim();
    const studentUserIds = Array.from(
      new Set(
        (Array.isArray(req.body?.studentUserIds) ? req.body.studentUserIds : [])
          .map((value: unknown) => String(value).trim())
          .filter(Boolean),
      ),
    );

    if (!schoolId || !canManageSchool(context, schoolId)) {
      return res.status(403).json({ error: "你只能管理自己负责的学校。" });
    }
    if (!canManageSchoolMembers(context, schoolId)) {
      return res.status(403).json({ error: "只有学校负责人可以确认家长与孩子的关系。" });
    }
    if (!guardianUserId) return res.status(400).json({ error: "请选择家长。" });

    const { data: guardian, error: guardianError } = await context.supabase
      .from("profiles")
      .select("id")
      .eq("id", guardianUserId)
      .eq("school_id", schoolId)
      .eq("role", "家长")
      .maybeSingle();
    if (guardianError) throw guardianError;
    if (!guardian) return res.status(400).json({ error: "所选账号不是本校登记的家长。" });

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
      .from("guardian_student_links")
      .update({ status: "revoked", revoked_at: now, updated_at: now })
      .eq("school_id", schoolId)
      .eq("guardian_user_id", guardianUserId)
      .eq("status", "active");
    if (revokeError) throw revokeError;

    if (studentUserIds.length > 0) {
      const { error: upsertError } = await context.supabase
        .from("guardian_student_links")
        .upsert(
          studentUserIds.map((studentUserId) => ({
            school_id: schoolId,
            guardian_user_id: guardianUserId,
            student_user_id: studentUserId,
            confirmed_by: context.user.id,
            status: "active",
            updated_at: now,
            revoked_at: null,
          })),
          { onConflict: "school_id,guardian_user_id,student_user_id" },
        );
      if (upsertError) throw upsertError;
    }

    const { data: guardianAssignments, error: assignmentError } = await context.supabase
      .from("guardian_student_links")
      .select("guardian_user_id,student_user_id")
      .eq("school_id", schoolId)
      .eq("status", "active");
    if (assignmentError) throw assignmentError;

    return res.status(200).json({ guardianAssignments: guardianAssignments || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "亲子关系保存失败。";
    const status =
      message.includes("只有") || message.includes("只能")
        ? 403
        : message.includes("请先登录")
          ? 401
          : 500;
    return res.status(status).json({ error: status >= 500 ? "亲子关系暂时无法保存，请稍后再试。" : message });
  }
}
