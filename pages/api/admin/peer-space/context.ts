import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import {
  isPeerSpaceStaffApiEnabled,
  loadPeerSpaceStaffContext,
  publicPeerSpaceStaffContext,
} from "@/lib/peerSpaceStaff";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

function requestLocale(req: NextApiRequest) {
  const queryLocale = Array.isArray(req.query.locale) ? req.query.locale[0] : req.query.locale;
  return normalizeLocale(queryLocale || req.cookies.NEXT_LOCALE);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const locale = requestLocale(req);
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: locale === "en" ? "Please sign in first." : "请先登录。" });
    }
    if (!isPeerSpaceStaffApiEnabled()) {
      return res.status(404).json({
        error: locale === "en" ? "The Peer Space workspace is not available." : "解忧室工作台目前不可用。",
      });
    }

    const context = await loadPeerSpaceStaffContext(getSupabaseAdmin(), user.id);
    if (!context.available) {
      return res.status(403).json({
        error: locale === "en" ? "You do not have access to this workspace." : "当前账号没有这个工作台的权限。",
      });
    }
    return res.status(200).json(publicPeerSpaceStaffContext(context, user.id));
  } catch (error) {
    await reportOperationalError({
      req,
      area: "save",
      operation: "peer_space_staff_context",
      error,
      statusCode: 503,
    });
    return res.status(503).json({
      error: locale === "en"
        ? "The Peer Space workspace is temporarily unavailable. Please try again later."
        : "解忧室工作台暂时不可用，请稍后再试。",
    });
  }
}
