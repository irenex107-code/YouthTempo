import type { NextApiRequest, NextApiResponse } from "next";
import { getServerTranslator } from "@/lib/i18n/server";
import { normalizeLocale } from "@/lib/i18n/config";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { requireActiveStudentConsent } from "@/lib/studentConsent";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { gardenSummary } from "@/lib/tempoGarden";

const feelings = new Set(["steady", "mixed", "heavy", "unsure"]);
const reminderModes = new Set(["off", "daily", "weekly"]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST", "PATCH"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const locale = normalizeLocale(
    typeof req.body?.locale === "string" ? req.body.locale
      : typeof req.query.locale === "string" ? req.query.locale : req.cookies.NEXT_LOCALE,
  );
  const t = getServerTranslator(locale);
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: t("garden.errors.signIn") });
    const supabase = getSupabaseAdmin();
    const consent = await requireActiveStudentConsent(supabase, user.id);
    if (!consent || !["14_17", "18_plus"].includes(consent.age_band)) {
      return res.status(403).json({ error: t("garden.errors.notAvailable") });
    }

    if (req.method === "POST") {
      const feeling = typeof req.body?.feeling === "string" ? req.body.feeling : "";
      if (!feelings.has(feeling)) {
        return res.status(400).json({ error: t("garden.errors.invalidFeeling") });
      }
      if (!(await enforceUserRateLimit({
        supabase, req, userId: user.id, action: "tempo_check_in",
        limit: 10, windowSeconds: 24 * 60 * 60, res,
        message: t("garden.errors.tooMany"),
        unavailableMessage: t("garden.errors.unavailable"),
      }))) return;
      const { data, error } = await supabase
        .from("tempo_check_ins")
        .insert({ user_id: user.id, feeling })
        .select("id,created_at")
        .single();
      if (error) throw error;
      return res.status(201).json({ checkIn: data });
    }

    if (req.method === "PATCH") {
      const mode = typeof req.body?.reminderMode === "string" ? req.body.reminderMode : "";
      if (!reminderModes.has(mode)) {
        return res.status(400).json({ error: t("garden.errors.invalidReminder") });
      }
      const { error } = await supabase
        .from("tempo_reminder_preferences")
        .upsert({ user_id: user.id, mode, updated_at: new Date().toISOString() });
      if (error) throw error;
      return res.status(200).json({ reminderMode: mode });
    }

    const [quick, sweet, preference] = await Promise.all([
      supabase.from("tempo_check_ins").select("created_at").eq("user_id", user.id)
        .order("created_at", { ascending: false }).limit(1000),
      supabase.from("sweet_records").select("created_at,summary").eq("user_id", user.id)
        .order("created_at", { ascending: false }).limit(1000),
      supabase.from("tempo_reminder_preferences").select("mode")
        .eq("user_id", user.id).maybeSingle(),
    ]);
    if (quick.error) throw quick.error;
    if (sweet.error) throw sweet.error;
    if (preference.error) throw preference.error;
    return res.status(200).json({
      ...gardenSummary(quick.data || [], sweet.data || []),
      recentRhythm: sweet.data?.find((record) => typeof record.summary === "string" && record.summary.trim())?.summary || null,
      reminderMode: preference.data?.mode || "off",
    });
  } catch (error) {
    const statusCode = error && typeof error === "object" && "statusCode" in error
      ? Number(error.statusCode) : 503;
    if (statusCode >= 500) {
      await reportOperationalError({ req, area: "save", operation: "tempo_garden", error, statusCode });
    }
    return res.status(statusCode).json({
      error: statusCode === 403 ? t("garden.errors.notAvailable") : t("garden.errors.unavailable"),
    });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
