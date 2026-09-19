import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { detectCrisis } from "@/lib/safety/crisisDetection";
import { isUuid, requireSupportStudent } from "@/lib/supportWorkflow";
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
    const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
    const keys = ["feltHeard", "foundHelp", "boundariesRespected", "wouldChooseAgain"] as const;
    if (!isUuid(caseId) || comment.length > 500
      || keys.some((key) => req.body?.[key] != null && typeof req.body[key] !== "boolean")
      || typeof req.body?.complaint !== "boolean") {
      return res.status(400).json({ error: t("supportFlow.errors.invalid") });
    }
    const { data: item, error: caseError } = await supabase.from("support_cases")
      .select("id,status").eq("id", caseId).eq("student_user_id", user.id).maybeSingle();
    if (caseError) throw caseError;
    if (!item || !["closed", "referred"].includes(item.status)) {
      return res.status(403).json({ error: t("supportFlow.errors.notReady") });
    }
    const urgent = detectCrisis(comment, locale).isUrgent;
    const { error } = await supabase.from("support_case_feedback").insert({
      case_id: caseId, student_user_id: user.id,
      felt_heard: req.body.feltHeard ?? null,
      found_help: req.body.foundHelp ?? null,
      boundaries_respected: req.body.boundariesRespected ?? null,
      would_choose_again: req.body.wouldChooseAgain ?? null,
      complaint: req.body.complaint,
      safety_review: urgent,
      comment: comment || null,
    });
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: t("supportFlow.errors.locked") });
      throw error;
    }
    return res.status(201).json({ saved: true, urgent });
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 403) return res.status(403).json({ error: t("supportFlow.errors.noAccess") });
    await reportOperationalError({ req, area: "save", operation: "support_case_feedback", error, statusCode: 503 });
    return res.status(503).json({ error: t("supportFlow.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "3kb" } } };
