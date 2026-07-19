import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdmin } from "@/lib/adminAccess";

async function getCount(table: string) {
  const { supabase } = await import("@/lib/supabaseServer").then(({ getSupabaseAdmin }) => ({ supabase: getSupabaseAdmin() }));
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
    const { supabase, adminRole } = await requireAdmin(req);

    const [profileCount, sweetRecordCount, schoolCount, schoolMemberCount, wechatIdentityCount] = await Promise.all([
      getCount("profiles"),
      getCount("sweet_records"),
      getCount("schools"),
      getCount("school_members"),
      getCount("wechat_identities"),
    ]);

    const { data: recentRecords, error: recordsError } = await supabase
      .from("sweet_records")
      .select("id,user_id,school_id,summary,created_at")
      .order("created_at", { ascending: false })
      .limit(6);
    if (recordsError) throw recordsError;

    const { data: schools, error: schoolsError } = await supabase
      .from("schools")
      .select("id,name,status,created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (schoolsError) throw schoolsError;

    return res.status(200).json({
      admin: adminRole,
      counts: {
        profiles: profileCount,
        sweetRecords: sweetRecordCount,
        schools: schoolCount,
        schoolMembers: schoolMemberCount,
        wechatBindings: wechatIdentityCount,
      },
      schools: schools || [],
      recentRecords: recentRecords || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "管理员概览加载失败。";
    const status = message.includes("没有管理员权限") ? 403 : message.includes("请先登录") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}
