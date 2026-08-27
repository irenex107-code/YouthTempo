import type { NextApiRequest, NextApiResponse } from "next";
import { requirePlatformAdmin } from "@/lib/adminAccess";
import {
  isPilotDutyEmailConfigured,
  isPilotDutyEnabled,
  sendPilotDutyAlert,
} from "@/lib/pilotDutyAlerts";

const dutyStatuses = ["new", "in_progress", "resolved"] as const;
type DutyStatus = (typeof dutyStatuses)[number];

type DutyMessageRow = {
  id: string;
  sender_user_id: string;
  recipient_type: "teacher" | "guardian" | "self" | "pilot_duty";
  body: string;
  moderation_status: "sent" | "safety_review";
  moderation_reason: string | null;
  duty_status: DutyStatus;
  duty_updated_at: string | null;
  duty_updated_by: string | null;
  alert_delivery_status: "not_requested" | "pending" | "sent" | "failed" | "not_configured";
  alert_last_attempt_at: string | null;
  created_at: string;
};

type DutyActionRow = {
  id: string;
  message_id: string;
  previous_status: DutyStatus;
  new_status: DutyStatus;
  note: string;
  actor_user_id: string | null;
  created_at: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST", "PATCH"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { supabase, user } = await requirePlatformAdmin(req);

    if (req.method === "PATCH") {
      const messageId = typeof req.body?.messageId === "string" ? req.body.messageId.trim() : "";
      const status = req.body?.status;
      const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
      if (!messageId) return res.status(400).json({ error: "请选择要处理的值班留言。" });
      if (!dutyStatuses.includes(status as DutyStatus)) {
        return res.status(400).json({ error: "请选择有效的处理状态。" });
      }
      if (!note || note.length > 500) {
        return res.status(400).json({ error: "请填写 1–500 字的处理记录。" });
      }

      const { data, error } = await supabase.rpc("apply_student_message_duty_action", {
        p_message_id: messageId,
        p_new_status: status,
        p_note: note,
        p_actor_user_id: user.id,
      });
      if (error) throw error;
      return res.status(200).json({
        message: Array.isArray(data) ? data[0] : data,
        notice: status === "resolved" ? "处理记录已保存并标记为已完成。" : "值班处理状态已保存。",
      });
    }

    if (req.method === "POST") {
      const messageId = typeof req.body?.messageId === "string" ? req.body.messageId.trim() : "";
      if (!messageId) return res.status(400).json({ error: "请选择要重新提醒的值班留言。" });
      const { data: message, error: messageError } = await supabase
        .from("student_messages")
        .select("id,created_at,moderation_status,duty_status")
        .eq("id", messageId)
        .neq("duty_status", "not_applicable")
        .maybeSingle();
      if (messageError) throw messageError;
      if (!message) return res.status(404).json({ error: "这条值班留言不存在或已不可处理。" });

      const deliveryStatus = await sendPilotDutyAlert({
        messageId: message.id as string,
        createdAt: message.created_at as string,
        kind: message.moderation_status === "safety_review" ? "safety_review" : "student_request",
      });
      const { error: updateError } = await supabase
        .from("student_messages")
        .update({
          alert_delivery_status: deliveryStatus,
          alert_last_attempt_at: new Date().toISOString(),
        })
        .eq("id", messageId);
      if (updateError) throw updateError;

      return res.status(deliveryStatus === "sent" ? 200 : 503).json({
        deliveryStatus,
        notice: deliveryStatus === "sent"
          ? "不含学生身份和正文的值班提醒邮件已发送。"
          : "提醒邮件未确认发送成功；留言仍保留在值班队列中。",
      });
    }

    const [messagesResult, actionsResult] = await Promise.all([
      supabase
        .from("student_messages")
        .select("id,sender_user_id,recipient_type,body,moderation_status,moderation_reason,duty_status,duty_updated_at,duty_updated_by,alert_delivery_status,alert_last_attempt_at,created_at")
        .neq("duty_status", "not_applicable")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("student_message_duty_actions")
        .select("id,message_id,previous_status,new_status,note,actor_user_id,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    if (messagesResult.error) throw messagesResult.error;
    if (actionsResult.error) throw actionsResult.error;

    const messages = (messagesResult.data || []) as DutyMessageRow[];
    const actions = (actionsResult.data || []) as DutyActionRow[];
    const profileIds = Array.from(new Set([
      ...messages.map((message) => message.sender_user_id),
      ...messages.flatMap((message) => message.duty_updated_by ? [message.duty_updated_by] : []),
      ...actions.flatMap((action) => action.actor_user_id ? [action.actor_user_id] : []),
    ]));
    const { data: profiles, error: profilesError } = profileIds.length
      ? await supabase.from("profiles").select("id,display_name,email").in("id", profileIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const profileById = new Map((profiles || []).map((profile) => [profile.id as string, profile]));
    const actionsByMessage = new Map<string, DutyActionRow[]>();
    for (const action of actions) {
      actionsByMessage.set(action.message_id, [...(actionsByMessage.get(action.message_id) || []), action]);
    }

    return res.status(200).json({
      enabled: isPilotDutyEnabled(),
      emailConfigured: isPilotDutyEmailConfigured(),
      counts: {
        total: messages.length,
        new: messages.filter((message) => message.duty_status === "new").length,
        inProgress: messages.filter((message) => message.duty_status === "in_progress").length,
        safetyReview: messages.filter((message) => message.moderation_status === "safety_review" && message.duty_status !== "resolved").length,
        alertProblems: messages.filter((message) => ["failed", "not_configured"].includes(message.alert_delivery_status)).length,
      },
      messages: messages.map((message) => {
        const sender = profileById.get(message.sender_user_id);
        return {
          ...message,
          sender_name: sender?.display_name || "未命名学生",
          sender_email: sender?.email || null,
          actions: (actionsByMessage.get(message.id) || []).map((action) => {
            const actor = action.actor_user_id ? profileById.get(action.actor_user_id) : null;
            return {
              ...action,
              actor_name: actor?.display_name || actor?.email || "已停用的管理员账号",
            };
          }),
        };
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "值班留言暂时无法处理。";
    const status = message.includes("请先登录")
      ? 401
      : message.includes("只有平台管理员")
        ? 403
        : message.includes("duty_message_not_found")
          ? 404
          : message.includes("invalid_duty_")
            ? 400
            : 500;
    return res.status(status).json({ error: status >= 500 ? "值班留言暂时无法处理，请稍后再试。" : message });
  }
}
