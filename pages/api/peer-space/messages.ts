import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { isPeerSpaceAccessApiEnabled } from "@/lib/peerSpaceAccess";
import { isUuid, loadPeerSpaceRoomAccess, roomNickname } from "@/lib/peerSpaceChat";
import { classifyPeerSpaceMessage, classifyPeerSpaceMessageWithAi } from "@/lib/peerSpaceSafety";
import { enforceUserRateLimit } from "@/lib/rateLimit";
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
      const messageId = req.body?.messageId;
      if (!isUuid(messageId)) return res.status(400).json({ error: t("peerSpaceChat.errors.invalidMessage") });
      const { data, error } = await supabase.from("peer_space_messages")
        .update({ moderation_status: "deleted", deleted_at: new Date().toISOString() })
        .eq("id", messageId).eq("author_user_id", user.id)
        .in("moderation_status", ["visible", "safety_review", "hidden"])
        .select("id").maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: t("peerSpaceChat.errors.invalidMessage") });
      return res.status(200).json({ deleted: true });
    }

    const roomId = req.method === "GET" ? req.query.roomId : req.body?.roomId;
    if (!isUuid(roomId)) return res.status(400).json({ error: t("peerSpaceChat.errors.invalidRoom") });
    const access = await loadPeerSpaceRoomAccess(supabase, user.id, roomId);
    if (!access) return res.status(403).json({ error: t("peerSpaceChat.errors.noRoomAccess") });

    if (req.method === "POST") {
      const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
      if (!body || body.length > 600) return res.status(400).json({ error: t("peerSpaceChat.errors.bodyLength") });
      const deterministic = classifyPeerSpaceMessage(body, locale);
      if (access.room.status !== "staffed_open") {
        return res.status(409).json({ error: t("peerSpaceChat.errors.roomReadOnly"), urgent: deterministic.urgent });
      }
      const { data: dutyShift, error: dutyError } = await supabase.from("peer_space_duty_shifts")
        .select("id").eq("room_id", roomId)
        .in("status", ["active", "handoff_pending"])
        .gt("lease_expires_at", new Date().toISOString())
        .limit(1).maybeSingle();
      if (dutyError) throw dutyError;
      if (!dutyShift) return res.status(409).json({ error: t("peerSpaceChat.errors.roomReadOnly"), urgent: deterministic.urgent });
      if (!deterministic.urgent && !(await enforceUserRateLimit({
        supabase, req, userId: user.id, action: "peer_space_message",
        limit: 20, windowSeconds: 10 * 60, res,
        message: t("peerSpaceChat.errors.tooMany"),
        area: "community",
        unavailableMessage: t("peerSpaceChat.errors.unavailable"),
      }))) return;
      const safety = deterministic.status === "safety_review"
        ? deterministic : await classifyPeerSpaceMessageWithAi(body, locale);
      const { data: message, error } = await supabase.from("peer_space_messages").insert({
        room_id: roomId,
        room_membership_id: access.membership.id,
        author_user_id: user.id,
        body,
        moderation_status: safety.status,
        risk_priority: safety.priority,
        risk_source: safety.source,
        risk_category: safety.category,
      }).select("id,created_at,moderation_status").single();
      if (error) {
        if (error.code === "42501") return res.status(409).json({ error: t("peerSpaceChat.errors.roomReadOnly"), urgent: safety.urgent });
        throw error;
      }
      return res.status(201).json({
        message: { id: message.id, createdAt: message.created_at, status: message.moderation_status },
        safetyNotice: safety.urgent,
        reviewPending: safety.status === "safety_review",
      });
    }

    const [{ data: rows, error: messagesError }, { data: controls, error: controlsError }] = await Promise.all([
      supabase.from("peer_space_messages")
        .select("id,room_membership_id,author_user_id,body,moderation_status,created_at")
        .eq("room_id", roomId)
        .gte("created_at", access.membership.visible_from)
        .order("created_at", { ascending: false }).limit(100),
      supabase.from("peer_space_user_controls")
        .select("actor_user_id,target_user_id,control_type")
        .eq("room_id", roomId)
        .or(`actor_user_id.eq.${user.id},target_user_id.eq.${user.id}`),
    ]);
    if (messagesError) throw messagesError;
    if (controlsError) throw controlsError;
    const hiddenAuthors = new Set((controls || []).flatMap((control) => {
      if (control.actor_user_id === user.id) return [control.target_user_id as string];
      if (control.target_user_id === user.id && control.control_type === "block") return [control.actor_user_id as string];
      return [];
    }));
    const messages = (access.room.status === "paused" || access.room.status === "closed" ? [] : (rows || [])).filter((message) => (
      !hiddenAuthors.has(message.author_user_id as string)
      && (message.moderation_status === "visible"
        || (message.author_user_id === user.id && message.moderation_status === "safety_review"))
    )).reverse().map((message) => ({
      id: message.id,
      body: message.body,
      createdAt: message.created_at,
      authorLabel: roomNickname(message.room_membership_id as string, locale),
      own: message.author_user_id === user.id,
      status: message.moderation_status,
    }));
    return res.status(200).json({ messages, roomStatus: access.room.status });
  } catch (error) {
    await reportOperationalError({ req, area: "community", operation: "peer_room_messages", error, statusCode: 503 });
    return res.status(503).json({ error: t("peerSpaceChat.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "8kb" } } };
