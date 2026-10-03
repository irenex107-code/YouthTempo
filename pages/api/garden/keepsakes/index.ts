import type { NextApiRequest, NextApiResponse } from "next";
import { gardenKeepsakeTypes, type GardenKeepsakeType } from "@/lib/gardenCatalog";
import { getServerTranslator } from "@/lib/i18n/server";
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

const allowedTypes = new Set<string>(gardenKeepsakeTypes);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  const t = getServerTranslator(gardenLocale(req));

  try {
    const context = await requireGardenContext(req, res);
    if (!context) return;
    const type = typeof req.body?.type === "string" ? req.body.type : "";
    const requestedDate = typeof req.body?.date === "string" ? req.body.date : shanghaiDateKey(new Date());
    if (!allowedTypes.has(type)) {
      return res.status(400).json({ error: context.t("garden.errors.invalidKeepsake") });
    }
    if (!datePattern.test(requestedDate)) {
      return res.status(400).json({ error: context.t("garden.errors.invalidDate") });
    }
    if (!(await enforceUserRateLimit({
      supabase: context.supabase,
      req,
      userId: context.user.id,
      action: "tempo_garden_keepsake",
      limit: 30,
      windowSeconds: 24 * 60 * 60,
      res,
      message: context.t("garden.errors.tooManyInteractions"),
      unavailableMessage: context.t("garden.errors.unavailable"),
    }))) return;

    const participation = await loadGardenParticipation(context.supabase, context.user.id);
    if (!participation.dateKeys.includes(requestedDate)) {
      return res.status(409).json({ error: context.t("garden.errors.keepsakeNeedsRecord") });
    }

    const inserted = await context.supabase
      .from("tempo_garden_keepsakes")
      .insert({ user_id: context.user.id, keepsake_date: requestedDate, keepsake_type: type })
      .select("id,keepsake_date,keepsake_type,created_at")
      .single();
    if (!inserted.error) {
      return res.status(201).json({
        keepsake: {
          id: inserted.data.id,
          date: inserted.data.keepsake_date,
          type: inserted.data.keepsake_type as GardenKeepsakeType,
        },
        created: true,
      });
    }
    if (!isUniqueViolation(inserted.error)) throw inserted.error;

    const existing = await context.supabase
      .from("tempo_garden_keepsakes")
      .select("id,keepsake_date,keepsake_type")
      .eq("user_id", context.user.id)
      .eq("keepsake_date", requestedDate)
      .single();
    if (existing.error) throw existing.error;
    return res.status(200).json({
      keepsake: {
        id: existing.data.id,
        date: existing.data.keepsake_date,
        type: existing.data.keepsake_type as GardenKeepsakeType,
      },
      created: false,
    });
  } catch (error) {
    return sendGardenError({ req, res, error, t, operation: "tempo_garden_keepsake_create" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
