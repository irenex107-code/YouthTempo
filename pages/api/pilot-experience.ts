import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { detectCrisis } from "@/lib/safety/crisisDetection";
import { requireActiveStudentConsent } from "@/lib/studentConsent";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

const features = ["quick_check_in", "sweet", "peer_space", "support", "mood_journal", "worry_time"] as const;

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
    if (!user) return res.status(401).json({ error: t("microFeedback.errors.signIn") });
    const supabase = getSupabaseAdmin();
    const consent = await requireActiveStudentConsent(supabase, user.id);
    if (!consent || !["14_17", "18_plus"].includes(consent.age_band)) {
      return res.status(403).json({ error: t("microFeedback.errors.unavailable") });
    }
    const feature = req.method === "GET" ? req.query.feature : req.body?.feature;
    if (typeof feature !== "string" || !features.includes(feature as typeof features[number])) {
      return res.status(400).json({ error: t("microFeedback.errors.invalid") });
    }
    const { data: previous, error: previousError } = await supabase.from("pilot_experience_feedback")
      .select("created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (previousError) throw previousError;
    const eligible = !previous || Date.now() - Date.parse(previous.created_at) >= 7 * 24 * 60 * 60 * 1000;
    if (req.method === "GET") return res.status(200).json({ eligible });
    if (!eligible) return res.status(409).json({ error: t("microFeedback.errors.cooldown") });
    const outcome = req.body?.outcome;
    if (!["dismissed", "submitted"].includes(outcome)) {
      return res.status(400).json({ error: t("microFeedback.errors.invalid") });
    }
    const answers = [req.body?.helpful, req.body?.wouldReturn, req.body?.wantsHumanSupport];
    if (outcome === "submitted" && answers.some((answer) => answer !== null && answer !== undefined && typeof answer !== "boolean")) {
      return res.status(400).json({ error: t("microFeedback.errors.invalid") });
    }
    const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
    if (comment.length > 500 || (outcome === "dismissed" && (comment || answers.some((answer) => answer != null)))) {
      return res.status(400).json({ error: t("microFeedback.errors.invalid") });
    }
    const urgent = outcome === "submitted" && detectCrisis(comment, locale).isUrgent;
    const { error } = await supabase.from("pilot_experience_feedback").insert({
      user_id: user.id,
      age_band: consent.age_band,
      feature,
      outcome,
      helpful: outcome === "submitted" ? req.body?.helpful ?? null : null,
      would_return: outcome === "submitted" ? req.body?.wouldReturn ?? null : null,
      wants_human_support: outcome === "submitted" ? req.body?.wantsHumanSupport ?? null : null,
      comment: outcome === "submitted" ? comment || null : null,
      safety_review: urgent,
    });
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: t("microFeedback.errors.cooldown") });
      throw error;
    }
    return res.status(201).json({ saved: true, urgent });
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 403) return res.status(403).json({ error: t("microFeedback.errors.unavailable") });
    await reportOperationalError({ req, area: "save", operation: "pilot_experience_feedback", error, statusCode: 503 });
    return res.status(503).json({ error: t("microFeedback.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "3kb" } } };
