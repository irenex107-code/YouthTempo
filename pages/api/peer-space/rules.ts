import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import {
  isPeerSpaceAccessApiEnabled,
  loadPeerSpaceAccess,
  publicPeerSpaceAccess,
} from "@/lib/peerSpaceAccess";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

function requestLocale(req: NextApiRequest) {
  return normalizeLocale(
    typeof req.body?.locale === "string" ? req.body.locale : req.cookies.NEXT_LOCALE,
  );
}

function safeDatabaseCode(error: unknown) {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
  return typeof code === "string" ? code : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const locale = requestLocale(req);
  const unavailable = locale === "en"
    ? "This Peer Space invitation is not available."
    : "这个解忧室邀请目前不可用。";

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({
        error: locale === "en" ? "Please sign in first." : "请先登录。",
      });
    }
    if (!isPeerSpaceAccessApiEnabled()) {
      return res.status(404).json({ error: unavailable });
    }

    const accepted = req.body?.accepted === true;
    const rulesVersion = typeof req.body?.rulesVersion === "string"
      ? req.body.rulesVersion.trim()
      : "";
    if (!accepted || !rulesVersion || rulesVersion.length > 40) {
      return res.status(400).json({
        error: locale === "en"
          ? "Read and accept the current Peer Space rules before entering."
          : "请先阅读并确认当前解忧室规则。",
      });
    }

    const supabase = getSupabaseAdmin();
    const decision = await loadPeerSpaceAccess(supabase, user.id);
    if (!decision.available) return res.status(403).json({ error: unavailable });
    if (decision.rulesVersion !== rulesVersion) {
      return res.status(409).json({
        error: locale === "en"
          ? "The Peer Space rules have been updated. Read the latest version before continuing."
          : "解忧室规则已经更新，请阅读最新版本后再继续。",
        rulesVersion: decision.rulesVersion,
      });
    }

    const { error } = await supabase.rpc("accept_peer_space_rules", {
      p_user_id: user.id,
      p_membership_id: decision.membershipId,
      p_rules_version: rulesVersion,
    });
    if (error) {
      const code = safeDatabaseCode(error);
      if (code === "42501") return res.status(403).json({ error: unavailable });
      if (code === "22023") {
        return res.status(409).json({
          error: locale === "en"
            ? "The Peer Space rules have been updated. Read the latest version before continuing."
            : "解忧室规则已经更新，请阅读最新版本后再继续。",
        });
      }
      throw error;
    }

    const updated = await loadPeerSpaceAccess(supabase, user.id);
    if (!updated.available || !updated.rulesAccepted) {
      throw new Error("Peer Space rule acceptance did not produce an active room membership.");
    }
    return res.status(200).json(publicPeerSpaceAccess(updated));
  } catch (error) {
    await reportOperationalError({
      req,
      area: "save",
      operation: "peer_space_rules_accept",
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

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
