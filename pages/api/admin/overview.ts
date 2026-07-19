import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

async function getCount(table: string) {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (error) throw error;
  return count || 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user?.email) return res.status(401).json({ error: "请先登录管理员账号。" });

    const supabase = getSupabaseAdmin();
    const email = user.email.trim().toLowerCase();
    const { data: adminRole, error: roleError } = await supabase
      .from("admin_roles")
      .select("email,role,status")
      .eq("email", email)
      .eq("status", "active")
      .maybeSingle();
    if (roleError) throw roleError;
    if (!adminRole) return res.status(403).json({ error: "当前账号没有管理员权限。" });

    const [profileCount, sweetRecordCount, permissionCount, wechatIdentityCount] = await Promise.all([
      getCount("profiles"),
      getCount("sweet_records"),
      getCount("user_permissions"),
      getCount("wechat_identities"),
    ]);

    const { data: recentPermissions, error: permissionsError } = await supabase
      .from("user_permissions")
      .select("id,grantee_email,permission_type,status,created_at")
      .order("created_at", { ascending: false })
      .limit(6);
    if (permissionsError) throw permissionsError;

    return res.status(200).json({
      admin: adminRole,
      counts: {
        profiles: profileCount,
        sweetRecords: sweetRecordCount,
        permissions: permissionCount,
        wechatBindings: wechatIdentityCount,
      },
      recentPermissions: recentPermissions || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "管理员概览加载失败。";
    return res.status(500).json({ error: message });
  }
}
