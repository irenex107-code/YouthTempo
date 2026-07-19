import type { NextApiRequest, NextApiResponse } from "next";
import { canManageSchool, findAuthUserByEmail, getAdminContext } from "@/lib/adminAccess";
import { inviteRoleFromLabel, memberRoleFromInvite } from "@/lib/schoolInvites";

const roleLabels = ["学生", "支持老师", "学校负责人"] as const;
type AssignmentRole = (typeof roleLabels)[number];

function normalizeRole(value: unknown): AssignmentRole {
  if (value === "学校负责人" || value === "学校管理员") return "学校负责人";
  if (value === "支持老师" || value === "学校支持人员") return "支持老师";
  return "学生";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const context = await getAdminContext(req);
    const { supabase } = context;
    const schoolId = typeof req.body?.schoolId === "string" ? req.body.schoolId.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const assignmentRole = normalizeRole(req.body?.role);
    const inviteRole = inviteRoleFromLabel(assignmentRole);

    if (!schoolId) return res.status(400).json({ error: "请选择学校空间。" });
    if (!email) return res.status(400).json({ error: "请输入对方登录 YouthTempo 使用的邮箱。" });
    if (!canManageSchool(context, schoolId)) return res.status(403).json({ error: "你只能管理自己学校空间里的成员。" });
    if (context.kind === "school" && assignmentRole === "学校负责人") {
      return res.status(403).json({ error: "学校负责人不能新增其他学校负责人。如需新增，请联系平台管理员。" });
    }

    const { data: school, error: schoolError } = await supabase
      .from("schools")
      .select("id,name,status")
      .eq("id", schoolId)
      .eq("status", "active")
      .maybeSingle();
    if (schoolError) throw schoolError;
    if (!school) return res.status(404).json({ error: "找不到这个学校空间。" });

    const authUser = await findAuthUserByEmail(supabase, email);
    if (!authUser) {
      const { data: invite, error: inviteError } = await supabase
        .from("school_invites")
        .upsert({
          school_id: schoolId,
          email,
          assignment_role: inviteRole,
          status: "active",
          invited_by: context.user.id,
          updated_at: new Date().toISOString(),
          applied_user_id: null,
          applied_at: null,
          revoked_at: null,
        }, { onConflict: "email,school_id,assignment_role" })
        .select("id,email,assignment_role,status")
        .single();
      if (inviteError) throw inviteError;
      return res.status(200).json({ school, invite, assignmentRole, status: "invited" });
    }

    const memberRole = memberRoleFromInvite(inviteRole);
    if (memberRole) {
      const { error: memberError } = await supabase.from("school_members").upsert({
        school_id: schoolId,
        user_id: authUser.id,
        email,
        member_role: memberRole,
        status: "active",
        revoked_at: null,
      }, { onConflict: "school_id,user_id" });
      if (memberError) throw memberError;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .upsert({
        id: authUser.id,
        email,
        display_name: authUser.user_metadata?.display_name || email.split("@")[0],
        role: assignmentRole === "学生" ? "学生" : "学校支持人员",
        school_id: schoolId,
        updated_at: new Date().toISOString(),
      })
      .select("id,email,display_name,role,school_id")
      .single();
    if (profileError) throw profileError;

    if (assignmentRole === "学生") {
      const { error: recordsError } = await supabase
        .from("sweet_records")
        .update({ school_id: schoolId })
        .eq("user_id", authUser.id)
        .is("school_id", null);
      if (recordsError) throw recordsError;
    }

    return res.status(200).json({ profile, school, assignmentRole, status: "active" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "学校空间分配失败。";
    const status = message.includes("没有") || message.includes("只能") || message.includes("不能") ? 403 : message.includes("请先登录") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}
