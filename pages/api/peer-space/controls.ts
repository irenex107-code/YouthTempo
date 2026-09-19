import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { isPeerSpaceAccessApiEnabled } from "@/lib/peerSpaceAccess";
import { isUuid, loadPeerSpaceRoomAccess, roomNickname } from "@/lib/peerSpaceChat";
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
    if (req.method === "DELETE") {
      const controlId = req.body?.controlId;
      if (!isUuid(controlId)) return res.status(400).json({ error: t("peerSpaceChat.errors.invalidControl") });
      const { data, error } = await supabase.from("peer_space_user_controls")
        .delete().eq("id", controlId).eq("actor_user_id", user.id)
        .select("id").maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: t("peerSpaceChat.errors.invalidControl") });
      return res.status(200).json({ removed: true });
    }
    const roomId = req.method === "GET" ? req.query.roomId : req.body?.roomId;
    if (!isUuid(roomId)) return res.status(400).json({ error: t("peerSpaceChat.errors.invalidRoom") });
    const access = await loadPeerSpaceRoomAccess(supabase, user.id, roomId);
    if (!access) return res.status(403).json({ error: t("peerSpaceChat.errors.noRoomAccess") });
    if (req.method === "GET") {
      const { data, error } = await supabase.from("peer_space_user_controls")
        .select("id,target_room_membership_id,control_type")
        .eq("room_id", roomId).eq("actor_user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({
        controls: (data || []).map((control) => ({
          id: control.id,
          type: control.control_type,
          targetLabel: roomNickname(control.target_room_membership_id as string, locale),
        })),
      });
    }
    const messageId = req.body?.messageId;
    const controlType = req.body?.controlType;
    if (!isUuid(messageId) || !["block", "mute"].includes(controlType)) {
      return res.status(400).json({ error: t("peerSpaceChat.errors.invalidControl") });
    }
    const { data: target, error: targetError } = await supabase.from("peer_space_messages")
      .select("id,room_id,room_membership_id,author_user_id,created_at,moderation_status")
      .eq("id", messageId).eq("room_id", roomId).maybeSingle();
    if (targetError) throw targetError;
    if (!target || target.author_user_id === user.id
      || target.moderation_status !== "visible"
      || Date.parse(target.created_at) < Date.parse(access.membership.visible_from)) {
      return res.status(404).json({ error: t("peerSpaceChat.errors.invalidMessage") });
    }
    const { error } = await supabase.from("peer_space_user_controls").insert({
      room_id: roomId,
      actor_user_id: user.id,
      target_user_id: target.author_user_id,
      target_room_membership_id: target.room_membership_id,
      control_type: controlType,
    });
    if (error && error.code !== "23505") throw error;
    return res.status(200).json({ applied: true });
  } catch (error) {
    await reportOperationalError({ req, area: "community", operation: "peer_room_controls", error, statusCode: 503 });
    return res.status(503).json({ error: t("peerSpaceChat.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
