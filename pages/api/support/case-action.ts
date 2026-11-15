import type { NextApiRequest, NextApiResponse } from "next";
import { getRequestLocale, getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { canCreateAdultConsultation, hasCurrentSupportStaffScope, isSupportTerminationAction, isUuid, requireSupportStudent, requireSupportTerminationStudent, terminateSupportCase, transitionSupportCase, type SupportCaseStatus } from "@/lib/supportWorkflow";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const locale = getRequestLocale(req);
  const t = getServerTranslator(locale);
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: t("supportFlow.errors.signIn") });
    const supabase = getSupabaseAdmin();
    const caseId = req.body?.caseId;
    const action = req.body?.action;
    if (!isUuid(caseId) || typeof action !== "string") {
      return res.status(400).json({ error: t("supportFlow.errors.invalid") });
    }
    const terminating = isSupportTerminationAction(action);
    // Never derive the actor, role or case type from the request body.
    if (!await requireSupportTerminationStudent(supabase, user.id)) {
      return res.status(403).json({ error: t("supportFlow.errors.noAccess") });
    }
    const { data: item, error: caseError } = await supabase.from("support_cases")
      .select("id,student_user_id,school_id,case_type,status,appointment_at,appointment_status,referral_type,student_authorization_active")
      .eq("id", caseId).eq("student_user_id", user.id).maybeSingle();
    if (caseError) throw caseError;
    if (!item) return res.status(404).json({ error: t("supportFlow.errors.noAccess") });
    if (!["youth_request", "adult_consultation"].includes(item.case_type)) {
      return res.status(403).json({ error: t("supportFlow.errors.noAccess") });
    }
    if (terminating) {
      const expectedStatus = req.body?.expectedStatus;
      const expectedRevision = action === "cancel_appointment" && typeof req.body?.expectedAppointmentRevision === "string"
        ? req.body.expectedAppointmentRevision.toLowerCase() : null;
      if (typeof expectedStatus !== "string" || (action === "cancel_appointment" && !isUuid(expectedRevision))) {
        return res.status(400).json({ error: t("supportFlow.errors.invalid") });
      }
      // Database lock + conditions remain authoritative. No stale appointment/referral inputs are sent.
      let result;
      try {
        result = await terminateSupportCase(supabase, {
          caseId: item.id, actorId: user.id, action, expectedStatus, expectedRevision,
        });
      } catch (caught) {
        const code = (caught as { code?: string })?.code;
        if (code === "42501") return res.status(403).json({ error: t("supportFlow.errors.noAccess") });
        if (code === "40001") return res.status(409).json({ error: t("supportFlow.errors.notReady") });
        if (code === "22023") return res.status(400).json({ error: t("supportFlow.errors.invalid") });
        throw caught;
      }
      const next = action === "cancel" ? "cancelled" : action === "withdraw_authorization" ? "paused"
        : action === "close" ? "closed" : "active";
      if (result?.case_id !== item.id || result.case_action !== action || result.case_status !== next
        || !isUuid(result.row_revision) || !isUuid(result.matched_revision)
        || result.row_revision === result.matched_revision
        || !["none", "proposed", "accepted", "reschedule_requested", "cancelled"].includes(result.appointment_status)
        || !(result.appointment_at === null || (typeof result.appointment_at === "string"
          && Number.isFinite(Date.parse(result.appointment_at))))
        || !(result.referral_type === null || ["school", "social_work", "medical", "professional", "community"].includes(result.referral_type))
        || typeof result.student_authorization_active !== "boolean"
        || (action !== "cancel_appointment" && result.student_authorization_active !== false)
        || (action === "cancel_appointment" && (result.matched_revision !== expectedRevision || result.appointment_status !== "cancelled"))) {
        throw new Error("support_termination_receipt_unavailable");
      }
      return res.status(200).json({ caseId: result.case_id, action: result.case_action, status: result.case_status,
        appointmentAt: result.appointment_at, appointmentStatus: result.appointment_status,
        referralType: result.referral_type, authorizationActive: result.student_authorization_active,
        matchedRevision: result.matched_revision, revision: result.row_revision });
    } else {
      const student = await requireSupportStudent(supabase, user.id);
      if (!student || item.student_authorization_active !== true || (item.case_type === "youth_request" && student.ageBand !== "14_17")
        || (item.case_type === "adult_consultation" && (student.ageBand !== "18_plus"
          || !await canCreateAdultConsultation(supabase, user)))) {
        return res.status(403).json({ error: t("supportFlow.errors.noAccess") });
      }
    }
    let nextStatus: SupportCaseStatus = item.status as SupportCaseStatus;
    let appointmentStatus: string | undefined;
    let authorizationActive: boolean | undefined;
    if (action === "cancel" && ["requested", "triage", "awaiting_assignment", "assigned"].includes(item.status)) {
      nextStatus = "cancelled";
      authorizationActive = false;
    } else if (action === "accept_assignment" && item.status === "assigned") {
      const { data: primary, error } = await supabase.from("support_case_assignments")
        .select("staff_user_id").eq("case_id", caseId).eq("assignment_role", "primary")
        .eq("status", "accepted").maybeSingle();
      if (error) throw error;
      if (!primary) return res.status(409).json({ error: t("supportFlow.errors.notReady") });
      const { data: staff, error: staffError } = await supabase.from("support_staff_applications")
        .select("status,category").eq("user_id", primary.staff_user_id).maybeSingle();
      if (staffError) throw staffError;
      if (staff?.status !== "approved") return res.status(409).json({ error: t("supportFlow.errors.notReady") });
      if (!await hasCurrentSupportStaffScope(supabase, primary.staff_user_id, staff.category, item)) {
        return res.status(409).json({ error: t("supportFlow.errors.notReady") });
      }
      nextStatus = "active";
    } else if (action === "reject_assignment" && item.status === "assigned") {
      nextStatus = "transfer_requested";
    } else if (action === "request_change" && item.status === "active") {
      nextStatus = "transfer_requested";
    } else if (action === "withdraw_authorization" && ["active", "paused", "transfer_requested"].includes(item.status)) {
      nextStatus = "paused";
      authorizationActive = false;
    } else if (action === "close" && ["active", "paused", "transfer_requested", "transferred", "referred"].includes(item.status)) {
      nextStatus = "closed";
      authorizationActive = false;
    } else if (action === "accept_appointment" && item.status === "active" && item.appointment_status === "proposed") {
      appointmentStatus = "accepted";
    } else if (action === "request_reschedule" && item.status === "active"
      && ["proposed", "accepted"].includes(item.appointment_status)) {
      appointmentStatus = "reschedule_requested";
    } else if (action === "cancel_appointment" && item.status === "active"
      && ["proposed", "accepted"].includes(item.appointment_status)) {
      appointmentStatus = "cancelled";
    } else {
      return res.status(409).json({ error: t("supportFlow.errors.notReady") });
    }
    await transitionSupportCase(supabase, item, {
      actorId: user.id, actorRole: "student", action, nextStatus,
      appointmentStatus, authorizationActive,
    });
    return res.status(200).json({ status: nextStatus, appointmentStatus: appointmentStatus || item.appointment_status });
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 403) return res.status(403).json({ error: t("supportFlow.errors.noAccess") });
    await reportOperationalError({ req, area: "save", operation: "support_case_student_action", error, statusCode: 503 });
    return res.status(503).json({ error: t("supportFlow.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "3kb" } } };
