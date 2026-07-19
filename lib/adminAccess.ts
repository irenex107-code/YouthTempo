import type { NextApiRequest } from "next";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { applySchoolInvitesForUser } from "@/lib/schoolInvites";

type PlatformAdminRole = {
  email: string;
  role: string;
  status: string;
};

export type AdminContext = {
  supabase: SupabaseClient;
  user: User;
  kind: "platform" | "school";
  email: string;
  roleLabel: string;
  platformAdminRole: PlatformAdminRole | null;
  managedSchoolIds: string[];
};

export async function getAdminContext(req: NextApiRequest): Promise<AdminContext> {
  const user = await getAuthenticatedUser(req);
  if (!user?.email) throw new Error("请先登录管理员账号。");

  const supabase = getSupabaseAdmin();
  const email = user.email.trim().toLowerCase();
  const { data: platformAdminRole, error: platformError } = await supabase
    .from("admin_roles")
    .select("email,role,status")
    .eq("email", email)
    .eq("status", "active")
    .maybeSingle();
  if (platformError) throw platformError;

  if (platformAdminRole) {
    return {
      supabase,
      user,
      kind: "platform",
      email,
      roleLabel: "平台管理员",
      platformAdminRole: platformAdminRole as PlatformAdminRole,
      managedSchoolIds: [],
    };
  }

  await applySchoolInvitesForUser(supabase, user);

  const { data: memberships, error: membershipError } = await supabase
    .from("school_members")
    .select("school_id,member_role,status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .eq("member_role", "school_admin");
  if (membershipError) throw membershipError;

  const managedSchoolIds = (memberships || [])
    .map((membership) => membership.school_id as string)
    .filter(Boolean);

  if (managedSchoolIds.length === 0) throw new Error("当前账号没有试点管理权限。请确认你是平台管理员或学校负责人。");

  return {
    supabase,
    user,
    kind: "school",
    email,
    roleLabel: "学校负责人",
    platformAdminRole: null,
    managedSchoolIds,
  };
}

export async function requirePlatformAdmin(req: NextApiRequest) {
  const context = await getAdminContext(req);
  if (context.kind !== "platform") throw new Error("只有平台管理员可以创建或管理学校空间。");
  return context;
}

export async function requireAdmin(req: NextApiRequest) {
  return getAdminContext(req);
}

export function canManageSchool(context: AdminContext, schoolId: string) {
  return context.kind === "platform" || context.managedSchoolIds.includes(schoolId);
}

export async function findAuthUserByEmail(supabase: SupabaseClient, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("请输入邮箱。");

  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;

  return data.users.find((candidate) => candidate.email?.trim().toLowerCase() === normalizedEmail) || null;
}
