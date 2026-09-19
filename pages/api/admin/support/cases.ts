import type { NextApiRequest, NextApiResponse } from "next";
import { requirePlatformAdmin } from "@/lib/adminAccess";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { isUuid, transitionSupportCase, type SupportCaseStatus } from "@/lib/supportWorkflow";

const referralTypes = ["school", "social_work", "medical", "professional", "community"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const locale = normalizeLocale(typeof req.body?.locale === "string" ? req.body.locale : req.cookies.NEXT_LOCALE);
  const t = getServerTranslator(locale);
  try {
    const { supabase, user } = await requirePlatformAdmin(req);
    if (req.method === "GET") {
      const { data, error } = await supabase.from("support_cases")
        .select("id,student_user_id,case_type,status,risk_priority,need_summary,availability,appointment_at,appointment_status,referral_type,student_authorization_active,created_at,updated_at")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      const ids = (data || []).map((item) => item.id);
      const { data: assignments, error: assignmentError } = ids.length
        ? await supabase.from("support_case_assignments")
          .select("id,case_id,staff_user_id,assignment_role,status").in("case_id", ids)
        : { data: [], error: null };
      if (assignmentError) throw assignmentError;
      return res.status(200).json({
        cases: (data || []).map((item) => ({
          ...item,
          assignments: (assignments || []).filter((assignment) => assignment.case_id === item.id),
        })),
      });
    }
    const caseId = req.body?.caseId;
    const action = req.body?.action;
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!isUuid(caseId) || typeof action !== "string" || note.length > 500) {
      return res.status(400).json({ error: t("supportFlow.errors.invalid") });
    }
    const { data: item, error: caseError } = await supabase.from("support_cases")
      .select("id,status,case_type,appointment_at,appointment_status,referral_type,student_authorization_active")
      .eq("id", caseId).maybeSingle();
    if (caseError) throw caseError;
    if (!item) return res.status(404).json({ error: t("supportFlow.errors.notReady") });
    const terminal = ["closed", "cancelled", "referred"].includes(item.status);
    if (terminal && !["close"].includes(action)) {
      return res.status(409).json({ error: t("supportFlow.errors.notReady") });
    }
    if (action === "offer_primary" || action === "offer_backup" || action === "transfer") {
      const staffUserId = req.body?.staffUserId;
      if (!isUuid(staffUserId)) return res.status(400).json({ error: t("supportFlow.errors.invalid") });
      if (action === "offer_backup" && item.status !== "active") {
        return res.status(409).json({ error: t("supportFlow.errors.notReady") });
      }
      if (action === "offer_primary" && !["requested", "triage", "awaiting_assignment", "transfer_requested"].includes(item.status)) {
        return res.status(409).json({ error: t("supportFlow.errors.notReady") });
      }
      if (action === "transfer" && (!["active", "transfer_requested", "assigned"].includes(item.status) || !note)) {
        return res.status(409).json({ error: t("supportFlow.errors.notReady") });
      }
      if (action === "transfer") {
        const { error: revokeError } = await supabase.from("support_case_assignments")
          .update({ status: "revoked", revoked_at: new Date().toISOString(), updated_by: user.id })
          .eq("case_id", caseId).eq("assignment_role", "primary").in("status", ["offered", "accepted"]);
        if (revokeError) throw revokeError;
        await transitionSupportCase(supabase, item, {
          actorId: user.id, actorRole: "admin", action: "structured_handoff",
          nextStatus: "transfer_requested", note,
        });
      } else if (action === "offer_primary" && item.status !== "awaiting_assignment") {
        await transitionSupportCase(supabase, item, {
          actorId: user.id, actorRole: "admin", action: "ready_for_assignment",
          nextStatus: "awaiting_assignment", note,
        });
      }
      const role = action === "offer_backup" ? "backup" : "primary";
      const { error } = await supabase.from("support_case_assignments").insert({
        case_id: caseId, staff_user_id: staffUserId, assignment_role: role,
        status: "offered", offered_by: user.id,
      });
      if (error) {
        if (["42501", "23505"].includes(error.code || "")) {
          return res.status(409).json({ error: t("supportFlow.errors.staffScope") });
        }
        throw error;
      }
      return res.status(200).json({ offered: true });
    }
    let nextStatus: SupportCaseStatus = item.status as SupportCaseStatus;
    let appointmentAt: string | null | undefined;
    let appointmentStatus: string | undefined;
    let referralType: string | null | undefined;
    let authorizationActive: boolean | undefined;
    if (action === "triage" && item.status === "requested") nextStatus = "triage";
    else if (action === "ready_for_assignment" && ["requested", "triage", "transfer_requested"].includes(item.status)) {
      nextStatus = "awaiting_assignment";
    } else if (action === "propose_appointment" && item.status === "active") {
      const proposed = req.body?.appointmentAt;
      if (typeof proposed !== "string" || !Number.isFinite(Date.parse(proposed))
        || Date.parse(proposed) <= Date.now()) return res.status(400).json({ error: t("supportFlow.errors.invalid") });
      appointmentAt = proposed;
      appointmentStatus = "proposed";
    } else if (action === "pause" && item.status === "active") nextStatus = "paused";
    else if (action === "resume" && item.status === "paused" && item.student_authorization_active) {
      const { data: primary, error } = await supabase.from("support_case_assignments")
        .select("staff_user_id").eq("case_id", caseId).eq("assignment_role", "primary")
        .eq("status", "accepted").maybeSingle();
      if (error) throw error;
      if (!primary) return res.status(409).json({ error: t("supportFlow.errors.notReady") });
      const { data: staff, error: staffError } = await supabase.from("support_staff_applications")
        .select("status").eq("user_id", primary.staff_user_id).maybeSingle();
      if (staffError) throw staffError;
      if (staff?.status !== "approved") return res.status(409).json({ error: t("supportFlow.errors.notReady") });
      nextStatus = "active";
    } else if (action === "refer" && ["triage", "awaiting_assignment", "assigned", "active", "paused", "transfer_requested"].includes(item.status)) {
      if (!referralTypes.includes(req.body?.referralType)) return res.status(400).json({ error: t("supportFlow.errors.invalid") });
      nextStatus = "referred";
      referralType = req.body.referralType;
      authorizationActive = false;
    } else if (action === "close" && !["closed", "cancelled"].includes(item.status)) {
      nextStatus = "closed";
      authorizationActive = false;
    } else return res.status(409).json({ error: t("supportFlow.errors.notReady") });
    await transitionSupportCase(supabase, item, {
      actorId: user.id, actorRole: "admin", action, nextStatus, note,
      appointmentAt, appointmentStatus, referralType, authorizationActive,
    });
    return res.status(200).json({ status: nextStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("请先登录") ? 401 : message.includes("只有平台管理员") ? 403 : 503;
    if (status === 503) await reportOperationalError({ req, area: "save", operation: "support_case_admin_action", error, statusCode: 503 });
    return res.status(status).json({ error: t("supportFlow.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
