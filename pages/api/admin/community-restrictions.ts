import type { NextApiRequest, NextApiResponse } from "next";
import { requirePlatformAdmin } from "@/lib/adminAccess";

const allowedDurations = [1440, 10080, 43200];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST", "DELETE"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { supabase, user } = await requirePlatformAdmin(req);

    if (req.method === "GET") {
      const now = new Date().toISOString();
      const { data: restrictions, error } = await supabase
        .from("community_restrictions")
        .select("id,user_id,reason,starts_at,ends_at,created_by,created_at")
        .eq("restriction_type", "mute")
        .eq("status", "active")
        .or(`ends_at.is.null,ends_at.gt.${now}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const userIds = Array.from(new Set((restrictions || []).map((item) => item.user_id as string)));
      const { data: profiles, error: profileError } = userIds.length
        ? await supabase.from("profiles").select("id,display_name,email,role").in("id", userIds)
        : { data: [], error: null };
      if (profileError) throw profileError;
      const profileById = new Map((profiles || []).map((profile) => [profile.id as string, profile]));
      return res.status(200).json({
        restrictions: (restrictions || []).map((item) => {
          const profile = profileById.get(item.user_id as string);
          return {
            ...item,
            user_name: profile?.display_name || profile?.email || "社区成员",
            user_role: profile?.role || "社区成员",
          };
        }),
      });
    }

    const targetUserId = typeof req.body?.targetUserId === "string" ? req.body.targetUserId.trim() : "";
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!targetUserId) return res.status(400).json({ error: "请选择需要限制的社区成员。" });
    if (targetUserId === user.id) return res.status(400).json({ error: "不能限制当前管理员账号。" });
    if (!reason) return res.status(400).json({ error: "请填写处理原因。" });
    if (reason.length > 500) return res.status(400).json({ error: "处理原因请控制在 500 字以内。" });

    const { data: target, error: targetError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", targetUserId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return res.status(404).json({ error: "找不到这名社区成员。" });

    if (req.method === "POST") {
      const durationMinutes = req.body?.durationMinutes;
      if (durationMinutes !== null && !allowedDurations.includes(durationMinutes)) {
        return res.status(400).json({ error: "请选择有效的禁言时长。" });
      }
      const { data, error } = await supabase.rpc("apply_community_restriction", {
        p_user_id: targetUserId,
        p_action: "mute",
        p_duration_minutes: durationMinutes,
        p_reason: reason,
        p_actor_user_id: user.id,
      });
      if (error) throw error;
      return res.status(200).json({
        restriction: Array.isArray(data) ? data[0] : data,
        notice: "账号已禁言。对方仍可查看社区、删除自己的内容和提交举报。",
      });
    }

    const { data, error } = await supabase.rpc("apply_community_restriction", {
      p_user_id: targetUserId,
      p_action: "unmute",
      p_duration_minutes: null,
      p_reason: reason,
      p_actor_user_id: user.id,
    });
    if (error) throw error;
    return res.status(200).json({ action: Array.isArray(data) ? data[0] : data, notice: "禁言已解除。" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "社区账号限制暂时无法保存。";
    const status = message.includes("只有平台管理员")
      ? 403
      : message.includes("请先登录")
        ? 401
        : message.includes("invalid_")
          ? 400
          : 500;
    return res.status(status).json({ error: status >= 500 ? "社区账号限制暂时无法保存，请稍后再试。" : message });
  }
}
