import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { moderateStudentMessage } from "@/lib/messageSafety";
import { requireActiveStudentConsent } from "@/lib/studentConsent";
import { normalizeLocale } from "@/lib/i18n/config";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import {
  isPilotDutyEmailConfigured,
  isPilotDutyEnabled,
  sendPilotDutyAlert,
} from "@/lib/pilotDutyAlerts";
import { reportOperationalError } from "@/lib/operationalMonitoring";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST", "PATCH"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录。" });
    const supabase = getSupabaseAdmin();

    if (req.method === "POST") {
      await requireActiveStudentConsent(supabase, user.id);
      if (!(await enforceUserRateLimit({
        supabase,
        req,
        userId: user.id,
        action: "message_send",
        limit: 20,
        windowSeconds: 10 * 60,
        res,
        message: "发送得有些频繁，请稍等一会儿再试。",
        area: "save",
        unavailableMessage: "留言服务暂时不可用，请稍后再试。",
      }))) return;
      const locale = normalizeLocale(typeof req.body?.locale === "string" ? req.body.locale : undefined);
      const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
      const recipientType = req.body?.recipientType;
      const requestedRecipientId =
        typeof req.body?.recipientUserId === "string" ? req.body.recipientUserId.trim() : "";
      const anonymous = recipientType === "teacher" && req.body?.anonymous === true;
      const pilotDutyEnabled = isPilotDutyEnabled();

      if (!body) return res.status(400).json({ error: "请先写下你想说的话。" });
      if (body.length > 1000) return res.status(400).json({ error: "请把内容控制在 1000 字以内。" });
      if (!["teacher", "guardian", "self", "pilot_duty"].includes(recipientType)) {
        return res.status(400).json({ error: "请选择这段话要写给谁。" });
      }
      if (recipientType === "pilot_duty" && !pilotDutyEnabled) {
        return res.status(503).json({ error: "试点值班联系入口暂时没有开放。" });
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role,school_id")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (profile?.role !== "学生") return res.status(403).json({ error: "这个入口只用于学生写下想说的话。" });

      let recipientUserId: string | null = user.id;
      let schoolId = profile.school_id as string | null;
      if (recipientType === "teacher") {
        const { data: relationship, error } = await supabase
          .from("teacher_student_assignments")
          .select("school_id,teacher_user_id")
          .eq("student_user_id", user.id)
          .eq("teacher_user_id", requestedRecipientId)
          .eq("status", "active")
          .maybeSingle();
        if (error) throw error;
        if (!relationship) return res.status(403).json({ error: "只能发送给学校为你安排的负责老师。" });
        recipientUserId = relationship.teacher_user_id as string;
        schoolId = relationship.school_id as string;
      } else if (recipientType === "guardian") {
        const { data: relationship, error } = await supabase
          .from("guardian_student_links")
          .select("school_id,guardian_user_id")
          .eq("student_user_id", user.id)
          .eq("guardian_user_id", requestedRecipientId)
          .eq("status", "active")
          .maybeSingle();
        if (error) throw error;
        if (!relationship) return res.status(403).json({ error: "只能发送给学校确认关联的家长。" });
        recipientUserId = relationship.guardian_user_id as string;
        schoolId = relationship.school_id as string;
      } else if (recipientType === "pilot_duty") {
        recipientUserId = null;
        schoolId = null;
      }

      const result = moderateStudentMessage(body, locale);
      if (result.status === "blocked") {
        return res.status(422).json({ error: result.reason, blocked: true });
      }

      const needsPilotDuty = pilotDutyEnabled && (
        recipientType === "pilot_duty"
        || (result.status === "safety_review" && schoolId === null)
      );

      const { data: message, error: insertError } = await supabase
        .from("student_messages")
        .insert({
          school_id: schoolId,
          sender_user_id: user.id,
          recipient_type: recipientType,
          recipient_user_id: recipientUserId,
          anonymous_to_recipient: anonymous,
          body,
          moderation_status: result.status,
          moderation_reason: result.reason,
          duty_status: needsPilotDuty ? "new" : "not_applicable",
          alert_delivery_status: needsPilotDuty ? "pending" : "not_requested",
        })
        .select("id,created_at,moderation_status")
        .single();
      if (insertError) throw insertError;

      let dutyAlertStatus: "sent" | "failed" | "not_configured" | null = null;
      if (needsPilotDuty) {
        dutyAlertStatus = await sendPilotDutyAlert({
          messageId: message.id as string,
          createdAt: message.created_at as string,
          kind: result.status === "safety_review" ? "safety_review" : "student_request",
        });
        const { error: alertStatusError } = await supabase
          .from("student_messages")
          .update({
            alert_delivery_status: dutyAlertStatus,
            alert_last_attempt_at: new Date().toISOString(),
          })
          .eq("id", message.id);
        if (alertStatusError) {
          reportOperationalError({
            req,
            area: "save",
            operation: "pilot_duty_alert_status",
            error: alertStatusError,
          });
        }
        if (dutyAlertStatus !== "sent") {
          reportOperationalError({
            req,
            area: "save",
            operation: "pilot_duty_alert_delivery",
            error: new Error(`pilot_duty_alert_${dutyAlertStatus}`),
            statusCode: 503,
          });
        }
      }

      return res.status(201).json({
        message,
        safetyNotice: result.status === "safety_review",
        dutyEscalated: needsPilotDuty,
        dutyAlertStatus,
      });
    }

    if (req.method === "PATCH") {
      const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
      if (!id) return res.status(400).json({ error: "请选择要标记的留言。" });
      const { error } = await supabase
        .from("student_messages")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .eq("recipient_user_id", user.id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    const normalizedEmail = user.email?.trim().toLowerCase() || "";
    const [{ data: profile, error: profileError }, { data: memberships, error: membershipError }, { data: platformAdmin, error: platformAdminError }] =
      await Promise.all([
        supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
        supabase
          .from("school_members")
          .select("school_id,member_role")
          .eq("user_id", user.id)
          .eq("member_role", "school_admin")
          .eq("status", "active"),
        normalizedEmail
          ? supabase
              .from("admin_roles")
              .select("id")
              .eq("email", normalizedEmail)
              .eq("status", "active")
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
    if (profileError) throw profileError;
    if (membershipError) throw membershipError;
    if (platformAdminError) throw platformAdminError;

    const schoolAdminIds = (memberships || []).map((membership) => membership.school_id as string);
    let query = supabase
      .from("student_messages")
      .select("id,school_id,sender_user_id,recipient_type,recipient_user_id,anonymous_to_recipient,body,moderation_status,duty_status,alert_delivery_status,read_at,created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (platformAdmin) {
      query = query.neq("duty_status", "not_applicable");
    } else if (schoolAdminIds.length) {
      query = query.in("school_id", schoolAdminIds).eq("moderation_status", "safety_review");
    } else if (profile?.role === "学生") {
      query = query.eq("sender_user_id", user.id);
    } else {
      query = query.eq("recipient_user_id", user.id).in("moderation_status", ["sent", "safety_review"]);
    }

    const { data: messages, error: messagesError } = await query;
    if (messagesError) throw messagesError;
    const profileIds = Array.from(new Set((messages || []).flatMap((message) => [
      message.sender_user_id as string,
      message.recipient_user_id as string | null,
    ]).filter((id): id is string => Boolean(id))));
    const { data: profiles, error: profilesError } = profileIds.length
      ? await supabase.from("profiles").select("id,display_name,email").in("id", profileIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const profileById = new Map((profiles || []).map((item) => [item.id as string, item]));

    return res.status(200).json({
      messages: (messages || []).map((message) => {
        const sender = profileById.get(message.sender_user_id as string);
        const recipient = profileById.get(message.recipient_user_id as string);
        const hideSender =
          message.anonymous_to_recipient &&
          message.recipient_user_id === user.id &&
          !schoolAdminIds.length
          && !platformAdmin;
        return {
          ...message,
          sender_name: hideSender ? "匿名学生" : sender?.display_name || sender?.email || "学生",
          recipient_name:
            message.recipient_type === "self"
              ? "写给自己"
              : message.recipient_type === "pilot_duty"
                ? "试点值班负责人"
              : recipient?.display_name || recipient?.email || "收件人",
          canRevealSender: Boolean(platformAdmin || (schoolAdminIds.length && message.moderation_status === "safety_review")),
        };
      }),
      pilotDutyAvailable: isPilotDutyEnabled(),
      pilotDutyEmailConfigured: isPilotDutyEmailConfigured(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "留言服务暂时不可用。";
    const statusCode = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 500;
    return res.status(statusCode).json({ error: statusCode >= 500 ? "留言服务暂时不可用，请稍后再试。" : message });
  }
}
