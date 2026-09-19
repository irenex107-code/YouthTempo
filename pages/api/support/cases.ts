import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { detectCrisis } from "@/lib/safety/crisisDetection";
import { canCreateAdultConsultation, requireSupportStudent } from "@/lib/supportWorkflow";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const locale = normalizeLocale(
    typeof req.body?.locale === "string" ? req.body.locale
      : typeof req.query.locale === "string" ? req.query.locale : req.cookies.NEXT_LOCALE,
  );
  const t = getServerTranslator(locale);
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: t("supportFlow.errors.signIn") });
    const supabase = getSupabaseAdmin();
    const student = await requireSupportStudent(supabase, user.id);
    if (!student) return res.status(403).json({ error: t("supportFlow.errors.noAccess") });
    const adultAvailable = student.ageBand === "18_plus" && await canCreateAdultConsultation(supabase, user);
    if (req.method === "GET") {
      const caseType = student.ageBand === "14_17" ? "youth_request" : "adult_consultation";
      const { data: cases, error } = adultAvailable || student.ageBand === "14_17"
        ? await supabase.from("support_cases")
          .select("id,case_type,status,risk_priority,need_summary,availability,appointment_at,appointment_status,referral_type,student_authorization_active,created_at,updated_at,closed_at")
          .eq("student_user_id", user.id).eq("case_type", caseType)
          .order("created_at", { ascending: false }).limit(50)
        : { data: [], error: null };
      if (error) throw error;
      const caseIds = (cases || []).map((item) => item.id);
      const { data: assignments, error: assignmentError } = caseIds.length
        ? await supabase.from("support_case_assignments")
          .select("case_id,staff_user_id,assignment_role,status")
          .in("case_id", caseIds).in("status", ["offered", "accepted"])
        : { data: [], error: null };
      if (assignmentError) throw assignmentError;
      const [{ data: events, error: eventsError }, { data: feedback, error: feedbackError }] = await Promise.all([
        caseIds.length ? supabase.from("support_case_events")
          .select("case_id,action,next_status,created_at").in("case_id", caseIds)
          .order("created_at", { ascending: true }).limit(500)
          : Promise.resolve({ data: [], error: null }),
        caseIds.length ? supabase.from("support_case_feedback")
          .select("case_id").eq("student_user_id", user.id).in("case_id", caseIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (eventsError) throw eventsError;
      if (feedbackError) throw feedbackError;
      const staffIds = [...new Set((assignments || []).map((item) => item.staff_user_id))];
      const { data: staff, error: staffError } = staffIds.length
        ? await supabase.from("support_staff_applications")
          .select("user_id,legal_name,category,status").in("user_id", staffIds)
        : { data: [], error: null };
      if (staffError) throw staffError;
      const staffById = new Map((staff || []).filter((item) => item.status === "approved")
        .map((item) => [item.user_id, item]));
      return res.status(200).json({
        consultationAvailable: adultAvailable,
        ageBand: student.ageBand,
        cases: (cases || []).map((item) => ({
          ...item,
          assignments: (assignments || []).filter((assignment) => assignment.case_id === item.id)
            .map((assignment) => ({
              role: assignment.assignment_role,
              status: assignment.status,
              name: assignment.status === "accepted"
                ? staffById.get(assignment.staff_user_id)?.legal_name || null : null,
              category: staffById.get(assignment.staff_user_id)?.category || null,
            })),
          events: (events || []).filter((event) => event.case_id === item.id).map((event) => ({
            action: event.action, status: event.next_status, createdAt: event.created_at,
          })),
          feedbackSubmitted: (feedback || []).some((record) => record.case_id === item.id),
        })),
      });
    }
    const type = req.body?.type;
    if ((type === "adult_consultation" && !adultAvailable)
      || (type === "youth_request" && student.ageBand !== "14_17")
      || !["adult_consultation", "youth_request"].includes(type)) {
      return res.status(403).json({ error: t("supportFlow.errors.noAccess") });
    }
    const needSummary = typeof req.body?.needSummary === "string" ? req.body.needSummary.trim() : "";
    const availability = typeof req.body?.availability === "string" ? req.body.availability.trim() : "";
    if (!needSummary || needSummary.length > 1000 || availability.length > 500) {
      return res.status(400).json({ error: t("supportFlow.errors.invalid") });
    }
    if (!(await enforceUserRateLimit({
      supabase, req, userId: user.id, action: "support_case_create",
      limit: 3, windowSeconds: 24 * 60 * 60, res,
      message: t("supportFlow.errors.tooMany"), area: "save",
      unavailableMessage: t("supportFlow.errors.unavailable"),
    }))) return;
    const urgent = detectCrisis(needSummary, locale).isUrgent;
    const { data: item, error } = await supabase.from("support_cases").insert({
      student_user_id: user.id,
      case_type: type,
      status: urgent ? "triage" : "requested",
      risk_priority: urgent ? "urgent" : "standard",
      need_summary: needSummary,
      availability: availability || null,
    }).select("id,status").single();
    if (error) {
      if (error.code === "42501") return res.status(403).json({ error: t("supportFlow.errors.noAccess") });
      throw error;
    }
    return res.status(201).json({ id: item.id, status: item.status, urgent });
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 403) return res.status(403).json({ error: t("supportFlow.errors.noAccess") });
    await reportOperationalError({ req, area: "save", operation: "support_case_self", error, statusCode: 503 });
    return res.status(503).json({ error: t("supportFlow.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
