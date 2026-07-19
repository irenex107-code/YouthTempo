import type { NextApiRequest, NextApiResponse } from "next";
import { findAuthUserByEmail, requireAdmin } from "@/lib/adminAccess";

const roleLabels = ["学生", "学校支持人员"] as const;
type AssignmentRole = (typeof roleLabels)[number];

function normalizeRole(value: unknown): AssignmentRole {
  return value === "学校支持人员" ? "学校支持人员" : "学生";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { supabase } = await requireAdmin(req);
    const schoolId = typeof req.body?.schoolId === "string" ? req.body.schoolId.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const assignmentRole = normalizeRole(req.body?.role);

    if (!schoolId) return res.status(400).json({ error: "请选择学校空间。" });
    if (!email) return res.status(400).json({ error: "请输入已注册用户邮箱。" });

    const { data: school, error: schoolError } = await supabase
      .from("schools")
      .select("id,name,status")
      .eq("id", schoolId)
      .eq("status", "active")
      .maybeSingle();
    if (schoolError) throw schoolError;
    if (!school) return res.status(404).json({ error: "找不到这个学校空间。" });

    const authUser = await findAuthUserByEmail(supabase, email);
    if (!authUser) return res.status(404).json({ error: "这个邮箱还没有注册账号。请让对方先登录一次，再加入学校空间。" });

    if (assignmentRole === "学校支持人员") {
      const { error: memberError } = await supabase.from("school_members").upsert({
        school_id: schoolId,
        user_id: authUser.id,
        email,
        member_role: "school_support",
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
        role: assignmentRole,
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

    return res.status(200).json({ profile, school });
  } catch (error) {
    const message = error instanceof Error ? error.message : "学校空间分配失败。";
    const status = message.includes("没有管理员权限") ? 403 : message.includes("请先登录") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}
