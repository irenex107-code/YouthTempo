import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { isPeerSpaceAccessApiEnabled } from "@/lib/peerSpaceAccess";
import { isUuid, loadPeerSpaceChatContext } from "@/lib/peerSpaceChat";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST", "DELETE"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const locale = normalizeLocale(
    typeof req.body?.locale === "string" ? req.body.locale
      : typeof req.query.locale === "string" ? req.query.locale : req.cookies.NEXT_LOCALE,
  );
  const t = getServerTranslator(locale);
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: t("peerSpaceChat.errors.signIn") });
    if (!isPeerSpaceAccessApiEnabled()) return res.status(404).json({ error: t("peerSpaceChat.errors.unavailable") });
    const supabase = getSupabaseAdmin();
    const context = await loadPeerSpaceChatContext(supabase, user.id);
    if (!context.available) return res.status(403).json({ error: t("peerSpaceChat.errors.noInvitation") });

    if (req.method === "GET") {
      return res.status(200).json({
        rulesAccepted: context.rulesAccepted,
        rooms: context.rooms.map((room) => ({
          id: room.id,
          code: room.room_code,
          type: room.room_type,
          title: locale === "en" ? room.title_en : room.title_zh,
          description: locale === "en" ? room.description_en : room.description_zh,
          guidelines: locale === "en" ? room.guidelines_en : room.guidelines_zh,
          status: room.status,
          joined: Boolean(room.membership),
        })),
      });
    }

    const roomId = req.body?.roomId;
    if (!isUuid(roomId)) return res.status(400).json({ error: t("peerSpaceChat.errors.invalidRoom") });
    if (!context.rulesAccepted) return res.status(403).json({ error: t("peerSpaceChat.errors.rulesFirst") });
    const room = context.rooms.find((candidate) => candidate.id === roomId);
    if (!room) return res.status(404).json({ error: t("peerSpaceChat.errors.invalidRoom") });
    if (req.method === "POST") {
      if (room.membership) return res.status(200).json({ joined: true });
      const { error } = await supabase.from("peer_space_room_memberships").insert({
        space_id: room.space_id,
        room_id: room.id,
        membership_id: context.membershipId,
        status: "active",
        auto_join_suppressed: false,
      });
      if (error && error.code !== "23505") throw error;
      const updated = await loadPeerSpaceChatContext(supabase, user.id);
      if (!updated.available || !updated.rooms.some((candidate) => candidate.id === room.id && candidate.membership)) {
        throw new Error("peer_room_join_unconfirmed");
      }
      return res.status(200).json({ joined: true });
    }

    if (!room.membership) return res.status(200).json({ left: true });
    const visibleUntil = new Date(Math.max(Date.now(), Date.parse(room.membership.visible_from) + 1)).toISOString();
    const { error } = await supabase.from("peer_space_room_memberships")
      .update({
        status: "left",
        visible_until: visibleUntil,
        auto_join_suppressed: room.room_type === "everyone",
        updated_at: visibleUntil,
      })
      .eq("id", room.membership.id)
      .eq("membership_id", context.membershipId)
      .eq("status", "active");
    if (error) throw error;
    return res.status(200).json({ left: true });
  } catch (error) {
    await reportOperationalError({ req, area: "community", operation: "peer_room_membership", error, statusCode: 503 });
    return res.status(503).json({ error: t("peerSpaceChat.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
