import type { NextApiRequest, NextApiResponse } from "next";
import {
  gardenItems,
  gardenLayoutSlots,
  type GardenItemKey,
  type GardenLayoutSlot,
} from "@/lib/gardenCatalog";
import { getServerTranslator } from "@/lib/i18n/server";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import {
  gardenLocale,
  loadGardenParticipation,
  methodNotAllowed,
  requireGardenContext,
  sendGardenError,
} from "@/pages/api/garden/_shared";

const allowedSlots = new Set<string>(gardenLayoutSlots.map((slot) => slot.key));
const itemsByKey = new Map(gardenItems.map((item) => [item.key, item]));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "PUT") return methodNotAllowed(res, ["PUT"]);
  const t = getServerTranslator(gardenLocale(req));

  try {
    const context = await requireGardenContext(req, res);
    if (!context) return;
    const slot = typeof req.body?.slot === "string" ? req.body.slot : "";
    const itemKey = typeof req.body?.itemKey === "string" ? req.body.itemKey : "";
    const item = itemsByKey.get(itemKey as GardenItemKey);
    if (!allowedSlots.has(slot) || !item || item.slot !== slot) {
      return res.status(400).json({ error: context.t("garden.errors.invalidLayout") });
    }
    if (!(await enforceUserRateLimit({
      supabase: context.supabase,
      req,
      userId: context.user.id,
      action: "tempo_garden_layout",
      limit: 60,
      windowSeconds: 24 * 60 * 60,
      res,
      message: context.t("garden.errors.tooManyInteractions"),
      unavailableMessage: context.t("garden.errors.unavailable"),
    }))) return;

    const participation = await loadGardenParticipation(context.supabase, context.user.id);
    if (
      !participation.summary.unlockedPositions.includes(slot as GardenLayoutSlot)
      || !participation.summary.unlockedItems.includes(itemKey as GardenItemKey)
    ) {
      return res.status(409).json({ error: context.t("garden.errors.layoutLocked") });
    }

    const saved = await context.supabase
      .from("tempo_garden_layout_items")
      .upsert({
        user_id: context.user.id,
        slot,
        item_key: itemKey,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,slot" })
      .select("slot,item_key,updated_at")
      .single();
    if (saved.error) throw saved.error;
    return res.status(200).json({
      layoutItem: {
        slot: saved.data.slot as GardenLayoutSlot,
        itemKey: saved.data.item_key as GardenItemKey,
      },
    });
  } catch (error) {
    return sendGardenError({ req, res, error, t, operation: "tempo_garden_layout" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
