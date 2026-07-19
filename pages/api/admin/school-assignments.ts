import type { NextApiRequest, NextApiResponse } from "next";
import { canManageSchool, findAuthUserByEmail, getAdminContext } from "@/lib/adminAccess";

const roleLabels = ["学生", "学校支持人员", "学校管理员"] as const;
type AssignmentRole = (typeof roleLabels)[number];

function normalizeRole(value: unknown): AssignmentRole {
  if (value === "学校管理员") return "学校管理员";
  if (value === "学校支持人员") return "学校支持人员";
  return "学生";
}

function memberRoleForAssignment(role: AssignmentRole) {
  if (role === "学校管理员") return "school_admin";
  if (role === "学校支持人员") return "school_support";
  return null;
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

    if (!schoolId) return res.status(400).json({ error: "请选择学校空间。" });
    if (!email) return res.status(400).json({ error: "请输入对方登录 YouthTempo 使用的邮箱。" });
    if (!canManageSchool(context, schoolId)) return res.status(403).json({ error: "你只能管理自己学校空间里的成员。" });
    if (context.kind === "school" && assignmentRole === "学校管理员") {
      return res.status(403).json({ error: "学校管理员不能新增其他学校管理员。如需新增，请联系平台管理员。" });
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
    if (!authUser) return res.status(404).json({ error: "这个邮箱还没有登录过 YouthTempo。请让对方先用邮箱登录一次，再加入学校空间。" });

    const memberRole = memberRoleForAssignment(assignmentRole);
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

    return res.status(200).json({ profile, school, assignmentRole });
  } catch (error) {
    const message = error instanceof Error ? error.message : "学校空间分配失败。";
    const status = message.includes("没有") || message.includes("只能") || message.includes("不能") ? 403 : message.includes("请先登录") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}
