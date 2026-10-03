import type { NextApiRequest, NextApiResponse } from "next";
import { gardenCareActions, type GardenCareAction } from "@/lib/gardenCatalog";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { shanghaiDateKey } from "@/lib/tempoGarden";
import {
  gardenLocale,
  isUniqueViolation,
  loadGardenParticipation,
  methodNotAllowed,
  requireGardenContext,
  sendGardenError,
} from "@/pages/api/garden/_shared";
import { getServerTranslator } from "@/lib/i18n/server";

const allowedActions = new Set<string>(gardenCareActions);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  const t = getServerTranslator(gardenLocale(req));

  try {
    const context = await requireGardenContext(req, res);
    if (!context) return;
    const action = typeof req.body?.action === "string" ? req.body.action : "";
    if (!allowedActions.has(action)) {
      return res.status(400).json({ error: context.t("garden.errors.invalidCare") });
    }
    const today = shanghaiDateKey(new Date());
    if (req.body?.date !== undefined && req.body.date !== today) {
      return res.status(400).json({ error: context.t("garden.errors.invalidDate") });
    }
    if (!(await enforceUserRateLimit({
      supabase: context.supabase,
      req,
      userId: context.user.id,
      action: "tempo_garden_care",
      limit: 20,
      windowSeconds: 24 * 60 * 60,
      res,
      message: context.t("garden.errors.tooManyInteractions"),
      unavailableMessage: context.t("garden.errors.unavailable"),
    }))) return;

    const participation = await loadGardenParticipation(context.supabase, context.user.id);
    if (!participation.summary.todayParticipated) {
      return res.status(409).json({ error: context.t("garden.errors.careNeedsRecord") });
    }

    const inserted = await context.supabase
      .from("tempo_garden_care_events")
      .insert({ user_id: context.user.id, care_date: today, action })
      .select("care_date,action,created_at")
      .single();
    if (!inserted.error) {
      return res.status(201).json({
        care: { date: inserted.data.care_date, action: inserted.data.action as GardenCareAction },
        created: true,
      });
    }
    if (!isUniqueViolation(inserted.error)) throw inserted.error;

    const existing = await context.supabase
      .from("tempo_garden_care_events")
      .select("care_date,action")
      .eq("user_id", context.user.id)
      .eq("care_date", today)
      .single();
    if (existing.error) throw existing.error;
    return res.status(200).json({
      care: { date: existing.data.care_date, action: existing.data.action as GardenCareAction },
      created: false,
    });
  } catch (error) {
    return sendGardenError({ req, res, error, t, operation: "tempo_garden_care" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
