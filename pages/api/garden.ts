import type { NextApiRequest, NextApiResponse } from "next";
import { getServerTranslator } from "@/lib/i18n/server";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { shanghaiDateKey } from "@/lib/tempoGarden";
import {
  gardenLocale,
  loadGardenParticipation,
  methodNotAllowed,
  requireGardenContext,
  sendGardenError,
} from "@/pages/api/garden/_shared";

const feelings = new Set(["steady", "mixed", "heavy", "unsure"]);
const reminderModes = new Set(["off", "daily", "weekly"]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST", "PATCH"].includes(req.method || "")) {
    return methodNotAllowed(res, ["GET", "POST", "PATCH"]);
  }

  const t = getServerTranslator(gardenLocale(req));
  try {
    const context = await requireGardenContext(req, res);
    if (!context) return;
    const { supabase, user } = context;

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

    const [participation, preference, care, layout, keepsakes] = await Promise.all([
      loadGardenParticipation(supabase, user.id),
      supabase.from("tempo_reminder_preferences").select("mode")
        .eq("user_id", user.id).maybeSingle(),
      supabase.from("tempo_garden_care_events").select("care_date,action")
        .eq("user_id", user.id).order("care_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("tempo_garden_layout_items").select("slot,item_key")
        .eq("user_id", user.id),
      supabase.from("tempo_garden_keepsakes").select("id,keepsake_date,keepsake_type")
        .eq("user_id", user.id).order("keepsake_date", { ascending: false }),
    ]);
    if (preference.error) throw preference.error;
    if (care.error) throw care.error;
    if (layout.error) throw layout.error;
    if (keepsakes.error) throw keepsakes.error;
    const today = shanghaiDateKey(new Date());
    const todayCare = care.data && care.data.care_date === today
      ? { date: care.data.care_date, action: care.data.action }
      : null;
    return res.status(200).json({
      ...participation.summary,
      reminderMode: preference.data?.mode || "off",
      canCareToday: participation.summary.todayParticipated && !todayCare,
      canAddKeepsakeToday: participation.summary.todayParticipated
        && !(keepsakes.data || []).some((item) => item.keepsake_date === today),
      todayCare,
      layout: Object.fromEntries((layout.data || []).map((item) => [item.slot, item.item_key])),
      keepsakes: (keepsakes.data || []).map((item) => ({
        id: item.id,
        date: item.keepsake_date,
        type: item.keepsake_type,
      })),
    });
  } catch (error) {
    return sendGardenError({ req, res, error, t, operation: "tempo_garden" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
