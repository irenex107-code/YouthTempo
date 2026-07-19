import type { NextApiRequest } from "next";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

type AdminRole = {
  email: string;
  role: string;
  status: string;
};

export async function requireAdmin(req: NextApiRequest): Promise<{
  supabase: SupabaseClient;
  user: User;
  adminRole: AdminRole;
}> {
  const user = await getAuthenticatedUser(req);
  if (!user?.email) throw new Error("请先登录管理员账号。");

  const supabase = getSupabaseAdmin();
  const email = user.email.trim().toLowerCase();
  const { data: adminRole, error } = await supabase
    .from("admin_roles")
    .select("email,role,status")
    .eq("email", email)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw error;
  if (!adminRole) throw new Error("当前账号没有管理员权限。");

  return { supabase, user, adminRole: adminRole as AdminRole };
}

export async function findAuthUserByEmail(supabase: SupabaseClient, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("请输入邮箱。");

  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;

  return data.users.find((candidate) => candidate.email?.trim().toLowerCase() === normalizedEmail) || null;
}
