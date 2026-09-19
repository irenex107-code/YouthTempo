import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import {
  assignmentCoversPeerSpaceRoom,
  isPeerSpaceStaffApiEnabled,
  loadPeerSpaceStaffContext,
} from "@/lib/peerSpaceStaff";
import { isUuid } from "@/lib/peerSpaceChat";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

type ReviewCase = {
  id: string;
  message_id: string;
  room_id: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  follow_up_required: boolean;
  escalated: boolean;
};

function canReview(
  assignments: Extract<Awaited<ReturnType<typeof loadPeerSpaceStaffContext>>, { available: true }>["assignments"],
  room: { id: string; space_id: string },
  item: Pick<ReviewCase, "category" | "priority">,
) {
  return assignments.some((assignment) => (
    ["content_moderator", "safety_duty"].includes(assignment.capability)
    && assignmentCoversPeerSpaceRoom(assignment, room.space_id, room.id)
    && ((item.category !== "crisis" && item.priority !== "urgent")
      || assignment.capability === "safety_duty")
  ));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const locale = normalizeLocale(typeof req.body?.locale === "string" ? req.body.locale : req.cookies.NEXT_LOCALE);
  const t = getServerTranslator(locale);
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: t("peerSpaceChat.errors.signIn") });
    if (!isPeerSpaceStaffApiEnabled()) return res.status(404).json({ error: t("peerSpaceChat.errors.unavailable") });
    const supabase = getSupabaseAdmin();
    const context = await loadPeerSpaceStaffContext(supabase, user.id);
    if (!context.available || !context.assignments.some((assignment) =>
      ["content_moderator", "safety_duty"].includes(assignment.capability))) {
      return res.status(403).json({ error: t("peerSpaceChat.errors.noReviewAccess") });
    }
    const spaceIds = [...new Set(context.assignments.map((assignment) => assignment.space_id))];
    const { data: roomRows, error: roomError } = await supabase.from("peer_space_rooms")
      .select("id,space_id").in("space_id", spaceIds);
    if (roomError) throw roomError;
    const rooms = (roomRows || []) as { id: string; space_id: string }[];
    const allowedRoomIds = rooms.filter((room) => context.assignments.some((assignment) =>
      assignmentCoversPeerSpaceRoom(assignment, room.space_id, room.id))).map((room) => room.id);
    if (!allowedRoomIds.length) return res.status(200).json({ cases: [] });

    if (req.method === "GET") {
      const { data: cases, error: caseError } = await supabase.from("peer_space_review_cases")
        .select("id,message_id,room_id,category,priority,status,created_at,follow_up_required,escalated")
        .in("room_id", allowedRoomIds)
        .not("status", "in", "(closed,resolved)")
        .order("created_at", { ascending: true }).limit(100);
      if (caseError) throw caseError;
      const visibleCases = ((cases || []) as ReviewCase[]).filter((item) => {
        const room = rooms.find((candidate) => candidate.id === item.room_id);
        return Boolean(room && canReview(context.assignments, room, item));
      });
      const { data: messages, error: messagesError } = visibleCases.length
        ? await supabase.from("peer_space_messages").select("id,body,moderation_status")
          .in("id", visibleCases.map((item) => item.message_id))
        : { data: [], error: null };
      if (messagesError) throw messagesError;
      const messageById = new Map((messages || []).map((message) => [message.id, message]));
      return res.status(200).json({
        cases: visibleCases.map((item) => ({
          id: item.id,
          roomId: item.room_id,
          category: item.category,
          priority: item.priority,
          status: item.status,
          createdAt: item.created_at,
          followUpRequired: item.follow_up_required,
          escalated: item.escalated,
          message: messageById.get(item.message_id)?.body || null,
          messageStatus: messageById.get(item.message_id)?.moderation_status || null,
        })),
      });
    }

    const caseId = req.body?.caseId;
    const nextStatus = req.body?.nextStatus;
    const messageAction = req.body?.messageAction;
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!isUuid(caseId)
      || !["pending", "assigned", "reviewing", "action_required", "referred", "resolved", "closed"].includes(nextStatus)
      || !["none", "hide", "publish"].includes(messageAction)
      || note.length > 500
      || typeof req.body?.followUpRequired !== "boolean"
      || typeof req.body?.escalated !== "boolean") {
      return res.status(400).json({ error: t("peerSpaceChat.errors.invalidReview") });
    }
    const { data: item, error: caseError } = await supabase.from("peer_space_review_cases")
      .select("id,room_id,category,priority").eq("id", caseId).maybeSingle();
    if (caseError) throw caseError;
    const room = rooms.find((candidate) => candidate.id === item?.room_id);
    if (!item || !room || !canReview(context.assignments, room, item)) {
      return res.status(403).json({ error: t("peerSpaceChat.errors.noReviewAccess") });
    }
    const { data, error } = await supabase.rpc("process_peer_space_review_case", {
      p_case_id: caseId,
      p_actor_id: user.id,
      p_next_status: nextStatus,
      p_message_action: messageAction,
      p_note: note,
      p_follow_up_required: req.body.followUpRequired,
      p_escalated: req.body.escalated,
    });
    if (error) {
      if (error.code === "42501") return res.status(403).json({ error: t("peerSpaceChat.errors.noReviewAccess") });
      if (error.code === "22023") return res.status(400).json({ error: t("peerSpaceChat.errors.invalidReview") });
      throw error;
    }
    return res.status(200).json({ case: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    await reportOperationalError({ req, area: "community", operation: "peer_room_review", error, statusCode: 503 });
    return res.status(503).json({ error: t("peerSpaceChat.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
