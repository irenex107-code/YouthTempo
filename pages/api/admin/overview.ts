import type { NextApiRequest, NextApiResponse } from "next";
import { getAdminContext } from "@/lib/adminAccess";
import { assessSweetRecord } from "@/lib/attentionSignals";

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

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const attentionRecordsQuery = supabase
      .from("sweet_records")
      .select("id,user_id,school_id,records,summary,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);
    const { data: attentionRecords, error: attentionError } = context.kind === "school"
      ? await attentionRecordsQuery.in("school_id", schoolIds)
      : await attentionRecordsQuery;
    if (attentionError) throw attentionError;

    const latestAttentionByUser = new Map<string, {
      id: string;
      user_id: string;
      school_id: string;
      summary: string | null;
      created_at: string;
      level: "priority" | "check_in";
      reasons: string[];
    }>();
    (attentionRecords || []).forEach((record) => {
      if (!record.school_id || latestAttentionByUser.has(record.user_id)) return;
      const assessment = assessSweetRecord(record.records);
      if (assessment.level === "routine") return;
      latestAttentionByUser.set(record.user_id, {
        id: record.id,
        user_id: record.user_id,
        school_id: record.school_id,
        summary: record.summary,
        created_at: record.created_at,
        level: assessment.level,
        reasons: assessment.reasons,
      });
    });

    const attentionItems = Array.from(latestAttentionByUser.values());
    const attentionUserIds = attentionItems.map((item) => item.user_id);
    const attentionRecordIds = attentionItems.map((item) => item.id);
    const { data: attentionProfiles, error: profileError } = attentionUserIds.length
      ? await supabase.from("profiles").select("id,email,display_name").in("id", attentionUserIds)
      : { data: [], error: null };
    if (profileError) throw profileError;
    const { data: followups, error: followupError } = attentionRecordIds.length
      ? await supabase
          .from("school_followups")
          .select("record_id,status,note,updated_at")
          .in("record_id", attentionRecordIds)
      : { data: [], error: null };
    if (followupError) throw followupError;

    const profileById = new Map((attentionProfiles || []).map((profile) => [profile.id, profile]));
    const followupByRecordId = new Map((followups || []).map((followup) => [followup.record_id, followup]));
    const attentionQueue = attentionItems.map((item) => {
      const profile = profileById.get(item.user_id);
      const followup = followupByRecordId.get(item.id);
      return {
        ...item,
        student_name: profile?.display_name || profile?.email || "未命名学生",
        student_email: profile?.email || null,
        followup_status: followup?.status || "new",
        followup_note: followup?.note || "",
        followup_updated_at: followup?.updated_at || null,
      };
    });

    return res.status(200).json({
      admin: {
        email: context.email,
        role: context.roleLabel,
        status: "active",
        scope: context.kind,
        canManageMembers:
          context.kind === "platform" ||
          Object.values(context.schoolRoles).includes("school_admin"),
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
      attentionQueue,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "管理员概览加载失败。";
    const status = message.includes("没有") ? 403 : message.includes("请先登录") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}
