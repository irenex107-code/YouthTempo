import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { isUuid, requireSupportStudent } from "@/lib/supportWorkflow";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const locale = normalizeLocale(typeof req.body?.locale === "string" ? req.body.locale : req.cookies.NEXT_LOCALE);
  const t = getServerTranslator(locale);
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: t("supportFlow.errors.signIn") });
    const supabase = getSupabaseAdmin();
    const { data: staff, error: staffError } = await supabase.from("support_staff_applications")
      .select("status,category").eq("user_id", user.id).maybeSingle();
    if (staffError) throw staffError;
    if (staff?.status !== "approved") return res.status(403).json({ error: t("supportFlow.errors.staffScope") });
    if (req.method === "POST") {
      const assignmentId = req.body?.assignmentId;
      const decision = req.body?.decision;
      if (!isUuid(assignmentId) || !["accepted", "rejected"].includes(decision)) {
        return res.status(400).json({ error: t("supportFlow.errors.invalid") });
      }
      const { data, error } = await supabase.from("support_case_assignments")
        .update({
          status: decision,
          updated_by: user.id,
          accepted_at: decision === "accepted" ? new Date().toISOString() : null,
        })
        .eq("id", assignmentId).eq("staff_user_id", user.id).eq("status", "offered")
        .select("id,status").maybeSingle();
      if (error) {
        if (error.code === "42501") return res.status(409).json({ error: t("supportFlow.errors.notReady") });
        throw error;
      }
      if (!data) return res.status(404).json({ error: t("supportFlow.errors.notReady") });
      return res.status(200).json({ status: data.status });
    }
    const { data: assignments, error: assignmentError } = await supabase.from("support_case_assignments")
      .select("id,case_id,assignment_role,status,offered_at,accepted_at")
      .eq("staff_user_id", user.id).in("status", ["offered", "accepted"])
      .order("offered_at", { ascending: false }).limit(50);
    if (assignmentError) throw assignmentError;
    const ids = (assignments || []).map((item) => item.case_id);
    const { data: cases, error: caseError } = ids.length
      ? await supabase.from("support_cases")
        .select("id,student_user_id,case_type,status,need_summary,availability,appointment_at,appointment_status,student_authorization_active,created_at")
        .in("id", ids)
      : { data: [], error: null };
    if (caseError) throw caseError;
    const caseById = new Map((cases || []).map((item) => [item.id, item]));
    const eligibility = new Map<string, boolean>();
    await Promise.all([...new Set((cases || []).map((item) => item.student_user_id))].map(async (studentId) => {
      try { eligibility.set(studentId, Boolean(await requireSupportStudent(supabase, studentId))); }
      catch { eligibility.set(studentId, false); }
    }));
    return res.status(200).json({
      assignments: (assignments || []).map((assignment) => {
        const item = caseById.get(assignment.case_id);
        const canRead = Boolean(item && assignment.assignment_role === "primary"
          && assignment.status === "accepted" && item.status === "active"
          && item.student_authorization_active && eligibility.get(item.student_user_id));
        return {
          id: assignment.id,
          caseId: assignment.case_id,
          role: assignment.assignment_role,
          status: assignment.status,
          caseType: item?.case_type || null,
          caseStatus: item?.status || null,
          createdAt: item?.created_at || assignment.offered_at,
          needSummary: canRead ? item?.need_summary : null,
          availability: canRead ? item?.availability : null,
          appointmentAt: canRead ? item?.appointment_at : null,
          appointmentStatus: canRead ? item?.appointment_status : null,
        };
      }),
    });
  } catch (error) {
    await reportOperationalError({ req, area: "save", operation: "support_staff_case_access", error, statusCode: 503 });
    return res.status(503).json({ error: t("supportFlow.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "3kb" } } };
