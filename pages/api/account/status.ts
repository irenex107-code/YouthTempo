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
      inviteSyncError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "账户状态加载失败。";
    return res.status(500).json({ error: message });
  }
}
