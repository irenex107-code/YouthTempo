import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { isPeerSpaceAccessApiEnabled } from "@/lib/peerSpaceAccess";
import { isUuid, loadPeerSpaceRoomAccess } from "@/lib/peerSpaceChat";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const locale = normalizeLocale(typeof req.body?.locale === "string" ? req.body.locale : req.cookies.NEXT_LOCALE);
  const t = getServerTranslator(locale);
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: t("peerSpaceChat.errors.signIn") });
    if (!isPeerSpaceAccessApiEnabled()) return res.status(404).json({ error: t("peerSpaceChat.errors.unavailable") });
    const roomId = req.body?.roomId;
    const messageId = req.body?.messageId;
    const reasonCode = req.body?.reasonCode;
    if (!isUuid(roomId) || !isUuid(messageId)
      || !["privacy", "harassment", "safety", "other"].includes(reasonCode)) {
      return res.status(400).json({ error: t("peerSpaceChat.errors.invalidReport") });
    }
    const supabase = getSupabaseAdmin();
    const access = await loadPeerSpaceRoomAccess(supabase, user.id, roomId);
    if (!access) return res.status(403).json({ error: t("peerSpaceChat.errors.noRoomAccess") });
    const { data: target, error: targetError } = await supabase.from("peer_space_messages")
      .select("id,author_user_id,created_at,moderation_status")
      .eq("id", messageId).eq("room_id", roomId).maybeSingle();
    if (targetError) throw targetError;
    if (!target || target.author_user_id === user.id || target.moderation_status !== "visible"
      || Date.parse(target.created_at) < Date.parse(access.membership.visible_from)) {
      return res.status(404).json({ error: t("peerSpaceChat.errors.invalidMessage") });
    }
    if (!(await enforceUserRateLimit({
      supabase, req, userId: user.id, action: "peer_space_report",
      limit: 10, windowSeconds: 24 * 60 * 60, res,
      message: t("peerSpaceChat.errors.tooMany"),
      area: "community",
      unavailableMessage: t("peerSpaceChat.errors.unavailable"),
    }))) return;
    const { error: quarantineError } = await supabase.from("peer_space_messages")
      .update({
        moderation_status: "safety_review",
        risk_priority: reasonCode === "safety" ? "urgent" : "high",
        risk_category: "report",
      }).eq("id", messageId).eq("moderation_status", "visible");
    if (quarantineError) throw quarantineError;
    const { error } = await supabase.from("peer_space_message_reports").insert({
      message_id: messageId,
      room_id: roomId,
      reporter_user_id: user.id,
      reason_code: reasonCode,
    });
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: t("peerSpaceChat.errors.alreadyReported") });
      throw error;
    }
    return res.status(201).json({ reported: true, safetyNotice: reasonCode === "safety" });
  } catch (error) {
    await reportOperationalError({ req, area: "community", operation: "peer_room_report", error, statusCode: 503 });
    return res.status(503).json({ error: t("peerSpaceChat.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
