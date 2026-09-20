import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import {
  isPeerSpaceAccessApiEnabled,
  loadPeerSpaceAccess,
  publicPeerSpaceAccess,
} from "@/lib/peerSpaceAccess";
import {
  claimAdultPeerSpaceInvitation,
  PEER_SPACE_INVITATIONS_API_ENABLED,
} from "@/lib/peerSpaceInvitations";
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
      return res.status(401).json({
        error: locale === "en" ? "Please sign in first." : "请先登录。",
      });
    }
    if (!isPeerSpaceAccessApiEnabled()) {
      return res.status(404).json({
        error: locale === "en"
          ? "Peer Space is not available."
          : "解忧室目前不可用。",
      });
    }

    const supabase = getSupabaseAdmin();
    if (PEER_SPACE_INVITATIONS_API_ENABLED) {
      await claimAdultPeerSpaceInvitation(supabase, user);
    }
    const decision = await loadPeerSpaceAccess(supabase, user.id);
    return res.status(200).json(publicPeerSpaceAccess(decision));
  } catch (error) {
    await reportOperationalError({
      req,
      area: "save",
      operation: "peer_space_access",
      error,
      statusCode: 503,
    });
    return res.status(503).json({
      error: locale === "en"
        ? "Peer Space is temporarily unavailable. Please try again later."
        : "解忧室暂时不可用，请稍后再试。",
    });
  }
}
