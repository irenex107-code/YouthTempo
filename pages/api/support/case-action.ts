import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { isUuid, requireSupportStudent, transitionSupportCase, type SupportCaseStatus } from "@/lib/supportWorkflow";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const locale = normalizeLocale(typeof req.body?.locale === "string" ? req.body.locale : req.cookies.NEXT_LOCALE);
  const t = getServerTranslator(locale);
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: t("supportFlow.errors.signIn") });
    const supabase = getSupabaseAdmin();
    if (!await requireSupportStudent(supabase, user.id)) {
      return res.status(403).json({ error: t("supportFlow.errors.noAccess") });
    }
    const caseId = req.body?.caseId;
    const action = req.body?.action;
    if (!isUuid(caseId) || typeof action !== "string") {
      return res.status(400).json({ error: t("supportFlow.errors.invalid") });
    }
    const { data: item, error: caseError } = await supabase.from("support_cases")
      .select("id,status,appointment_at,appointment_status,referral_type,student_authorization_active")
      .eq("id", caseId).eq("student_user_id", user.id).maybeSingle();
    if (caseError) throw caseError;
    if (!item) return res.status(404).json({ error: t("supportFlow.errors.noAccess") });
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
        .select("status").eq("user_id", primary.staff_user_id).maybeSingle();
      if (staffError) throw staffError;
      if (staff?.status !== "approved") return res.status(409).json({ error: t("supportFlow.errors.notReady") });
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
