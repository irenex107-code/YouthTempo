import type { NextApiRequest, NextApiResponse } from "next";
import { getAdminContext } from "@/lib/adminAccess";

async function getCount(query: PromiseLike<{ count: number | null; error: unknown }>) {
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const context = await getAdminContext(req);
    const { supabase } = context;

    const schoolsQuery = supabase
      .from("schools")
      .select("id,name,status,created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: schools, error: schoolsError } = context.kind === "school"
      ? await schoolsQuery.in("id", context.managedSchoolIds)
      : await schoolsQuery;
    if (schoolsError) throw schoolsError;

    const schoolIds = (schools || []).map((school) => school.id as string);
    const hasScopedSchools = context.kind === "platform" || schoolIds.length > 0;

    const profileCountQuery = context.kind === "school"
      ? supabase.from("profiles").select("id", { count: "exact", head: true }).in("school_id", schoolIds)
      : supabase.from("profiles").select("id", { count: "exact", head: true });
    const recordCountQuery = context.kind === "school"
      ? supabase.from("sweet_records").select("id", { count: "exact", head: true }).in("school_id", schoolIds)
      : supabase.from("sweet_records").select("id", { count: "exact", head: true });
    const memberCountQuery = context.kind === "school"
      ? supabase.from("school_members").select("id", { count: "exact", head: true }).in("school_id", schoolIds).eq("status", "active")
      : supabase.from("school_members").select("id", { count: "exact", head: true });
    const wechatCountQuery = supabase.from("wechat_identities").select("id", { count: "exact", head: true });

    const [profileCount, sweetRecordCount, schoolMemberCount, wechatIdentityCount] = hasScopedSchools
      ? await Promise.all([
          getCount(profileCountQuery),
          getCount(recordCountQuery),
          getCount(memberCountQuery),
          getCount(wechatCountQuery),
        ])
      : [0, 0, 0, 0];

    const recentRecordsQuery = supabase
      .from("sweet_records")
      .select("id,user_id,school_id,summary,created_at")
      .order("created_at", { ascending: false })
      .limit(6);
    const { data: recentRecords, error: recordsError } = context.kind === "school"
      ? await recentRecordsQuery.in("school_id", schoolIds)
      : await recentRecordsQuery;
    if (recordsError) throw recordsError;

    return res.status(200).json({
      admin: {
        email: context.email,
        role: context.roleLabel,
        status: "active",
        scope: context.kind,
      },
      counts: {
        profiles: profileCount,
        sweetRecords: sweetRecordCount,
        schools: schools?.length || 0,
        schoolMembers: schoolMemberCount,
        wechatBindings: context.kind === "platform" ? wechatIdentityCount : 0,
      },
      schools: schools || [],
      recentRecords: recentRecords || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "管理员概览加载失败。";
    const status = message.includes("没有") ? 403 : message.includes("请先登录") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}
