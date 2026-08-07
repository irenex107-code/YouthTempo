import type { NextApiRequest, NextApiResponse } from "next";
import { getAdminContext, requirePlatformAdmin } from "@/lib/adminAccess";
import { SCHOOL_EXIT_POLICY_VERSION } from "@/lib/schoolExitPolicy";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "PATCH") {
    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (req.method === "PATCH") {
      const { supabase, user } = await requirePlatformAdmin(req);
      const schoolId = typeof req.body?.schoolId === "string" ? req.body.schoolId.trim() : "";
      const confirmationName = typeof req.body?.confirmationName === "string" ? req.body.confirmationName.trim() : "";
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!schoolId) return res.status(400).json({ error: "请选择要退出试点的学校。" });
      if (reason.length < 10 || reason.length > 500) {
        return res.status(400).json({ error: "请填写 10–500 个字符的退出原因。" });
      }

      const { data: school, error: schoolError } = await supabase
        .from("schools")
        .select("id,name,status")
        .eq("id", schoolId)
        .maybeSingle();
      if (schoolError) throw schoolError;
      if (!school || school.status !== "active") {
        return res.status(404).json({ error: "找不到仍在试点中的学校。" });
      }
      if (confirmationName !== school.name) {
        return res.status(400).json({ error: "请输入完整学校名称确认退出。" });
      }

      const { data: rawData, error } = await supabase.rpc("exit_school_pilot", {
        p_school_id: schoolId,
        p_actor_user_id: user.id,
        p_reason: reason,
        p_policy_version: SCHOOL_EXIT_POLICY_VERSION,
      }).single();
      if (error) throw error;
      const data = rawData as { event_id?: string; affected_counts?: Record<string, number> } | null;
      return res.status(200).json({
        school: { ...school, status: "archived" },
        eventId: data?.event_id,
        affectedCounts: data?.affected_counts || {},
      });
    }

    if (req.method === "POST") {
      const { supabase } = await requirePlatformAdmin(req);
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!name) return res.status(400).json({ error: "请输入学校名称。" });

      const { data, error } = await supabase
        .from("schools")
        .insert({ name, status: "active" })
        .select("id,name,status,created_at")
        .single();
      if (error) throw error;
      return res.status(201).json({ school: data });
    }

    const context = await getAdminContext(req);
    let query = context.supabase
      .from("schools")
      .select("id,name,status,created_at")
      .order("created_at", { ascending: false });

    if (context.kind === "school") query = query.in("id", context.managedSchoolIds);

    const { data, error } = await query;
    if (error) throw error;

    return res.status(200).json({ schools: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "学校空间操作失败。";
    const status = message.includes("没有") || message.includes("只有") || message.includes("required")
      ? 403
      : message.includes("请先登录")
        ? 401
        : 500;
    return res.status(status).json({ error: status >= 500 ? "学校空间操作暂时无法完成，请稍后再试。" : message });
  }
}
