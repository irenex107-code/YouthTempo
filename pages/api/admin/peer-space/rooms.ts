import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import {
  assignmentCoversPeerSpaceRoom,
  isPeerSpaceStaffApiEnabled,
  loadPeerSpaceStaffContext,
  parsePeerSpaceRoomAction,
} from "@/lib/peerSpaceStaff";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

function requestLocale(req: NextApiRequest) {
  return normalizeLocale(
    typeof req.body?.locale === "string" ? req.body.locale : req.cookies.NEXT_LOCALE,
  );
}

function databaseErrorCode(error: unknown) {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
  return typeof code === "string" ? code : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
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

    let action;
    try {
      action = parsePeerSpaceRoomAction(req.body);
    } catch {
      return res.status(400).json({
        error: locale === "en" ? "The room action is invalid." : "房间操作无效。",
      });
    }

    const supabase = getSupabaseAdmin();
    const context = await loadPeerSpaceStaffContext(supabase, user.id);
    if (!context.available) {
      return res.status(403).json({
        error: locale === "en" ? "This room is not available to you." : "当前账号无权操作这个房间。",
      });
    }

    const { data: room, error: roomError } = await supabase
      .from("peer_space_rooms")
      .select("id,space_id")
      .eq("id", action.roomId)
      .maybeSingle();
    if (roomError) throw roomError;
    const assignment = context.assignments.find((item) => item.id === action.assignmentId);
    const requiredCapabilities = action.action === "open"
      ? ["room_duty"]
      : action.action === "resume_read_only"
        ? ["safety_duty"]
        : ["room_duty", "safety_duty"];
    if (
      !room
      || !assignment
      || !assignmentCoversPeerSpaceRoom(assignment, room.space_id, room.id)
      || !requiredCapabilities.includes(assignment.capability)
    ) {
      return res.status(403).json({
        error: locale === "en" ? "This room is not available to you." : "当前账号无权操作这个房间。",
      });
    }

    const { data, error } = await supabase.rpc("transition_peer_space_room_state", {
      p_room_id: action.roomId,
      p_actor_user_id: user.id,
      p_assignment_id: assignment.id,
      p_action: action.action,
      p_reason_code: action.reasonCode,
    });
    if (error) {
      const code = databaseErrorCode(error);
      if (code === "42501") {
        return res.status(403).json({
          error: locale === "en" ? "This room is not available to you." : "当前账号无权操作这个房间。",
        });
      }
      if (code === "22023" || code === "55000") {
        return res.status(409).json({
          error: locale === "en"
            ? "The room is not ready for this action. Refresh and check the current duty state."
            : "房间尚未满足操作条件，请刷新并核对当前值班状态。",
        });
      }
      throw error;
    }

    const result = Array.isArray(data) ? data[0] : data;
    return res.status(200).json({
      room: result ? { id: result.changed_room_id, status: result.room_status } : null,
    });
  } catch (error) {
    await reportOperationalError({
      req,
      area: "save",
      operation: "peer_space_room_transition",
      error,
      statusCode: 503,
    });
    return res.status(503).json({
      error: locale === "en"
        ? "The room could not be updated. Please try again later."
        : "房间状态暂时无法更新，请稍后再试。",
    });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
