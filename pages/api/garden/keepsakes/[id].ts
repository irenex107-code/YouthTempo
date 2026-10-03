import type { NextApiRequest, NextApiResponse } from "next";
import { getServerTranslator } from "@/lib/i18n/server";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import {
  gardenLocale,
  methodNotAllowed,
  requireGardenContext,
  sendGardenError,
} from "@/pages/api/garden/_shared";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "DELETE") return methodNotAllowed(res, ["DELETE"]);
  const t = getServerTranslator(gardenLocale(req));

  try {
    const context = await requireGardenContext(req, res);
    if (!context) return;
    const id = typeof req.query.id === "string" ? req.query.id : "";
    if (!uuidPattern.test(id)) {
      return res.status(400).json({ error: context.t("garden.errors.invalidKeepsake") });
    }
    if (!(await enforceUserRateLimit({
      supabase: context.supabase,
      req,
      userId: context.user.id,
      action: "tempo_garden_keepsake_delete",
      limit: 30,
      windowSeconds: 24 * 60 * 60,
      res,
      message: context.t("garden.errors.tooManyInteractions"),
      unavailableMessage: context.t("garden.errors.unavailable"),
    }))) return;

    const deleted = await context.supabase
      .from("tempo_garden_keepsakes")
      .delete()
      .eq("id", id)
      .eq("user_id", context.user.id)
      .select("id")
      .maybeSingle();
    if (deleted.error) throw deleted.error;
    if (!deleted.data) {
      return res.status(404).json({ error: context.t("garden.errors.keepsakeNotFound") });
    }
    return res.status(200).json({ deleted: true, id });
  } catch (error) {
    return sendGardenError({ req, res, error, t, operation: "tempo_garden_keepsake_delete" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
