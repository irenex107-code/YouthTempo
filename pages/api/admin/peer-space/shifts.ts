import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import {
  isPeerSpaceStaffApiEnabled,
  loadPeerSpaceStaffContext,
  parsePeerSpaceDutyAction,
  publicPeerSpaceStaffContext,
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

    const supabase = getSupabaseAdmin();
    const context = await loadPeerSpaceStaffContext(supabase, user.id);
    if (!context.available) {
      return res.status(403).json({
        error: locale === "en" ? "You do not have access to this workspace." : "当前账号没有这个工作台的权限。",
      });
    }

    let action;
    try {
      action = parsePeerSpaceDutyAction(req.body);
    } catch (error) {
      const incomplete = error instanceof Error && error.message === "duty_checklist_incomplete";
      return res.status(400).json({
        error: locale === "en"
          ? incomplete
            ? "Complete every current pre-shift check before signing in."
            : "The duty action is invalid."
          : incomplete
            ? "请完成当前版本的全部班前核对后再签到。"
            : "值班操作无效。",
      });
    }

    const assignment = context.assignments.find((item) => item.id === action.assignmentId);
    const shift = context.shifts.find((item) => item.id === action.shiftId);
    if (
      !assignment
      || assignment.capability !== "room_duty"
      || !shift
      || shift.primary_staff_user_id !== user.id
      || shift.primary_assignment_id !== assignment.id
    ) {
      return res.status(403).json({
        error: locale === "en" ? "This duty shift is not available." : "当前班次不可用。",
      });
    }

    const rpc = action.action === "sign_in"
      ? await supabase.rpc("start_peer_space_duty_shift", {
          p_shift_id: action.shiftId,
          p_user_id: user.id,
          p_assignment_id: action.assignmentId,
          p_checklist_version: action.checklistVersion,
          p_device_network_confirmed: action.checks.deviceNetwork,
          p_backup_confirmed: action.checks.backupContact,
          p_safety_path_confirmed: action.checks.safetyPath,
          p_rules_resources_confirmed: action.checks.rulesResources,
          p_handoff_reviewed: action.checks.handoffReviewed,
        })
      : action.action === "heartbeat"
        ? await supabase.rpc("renew_peer_space_duty_lease", {
            p_shift_id: action.shiftId,
            p_user_id: user.id,
            p_assignment_id: action.assignmentId,
          })
        : await supabase.rpc("transition_peer_space_duty_shift", {
            p_shift_id: action.shiftId,
            p_user_id: user.id,
            p_assignment_id: action.assignmentId,
            p_action: action.action,
          });

    if (rpc.error) {
      if (databaseErrorCode(rpc.error) === "42501") {
        return res.status(403).json({
          error: locale === "en" ? "This duty shift is not available." : "当前班次不可用。",
        });
      }
      if (["22023", "23505", "55000"].includes(databaseErrorCode(rpc.error) || "")) {
        return res.status(409).json({
          error: locale === "en"
            ? "The duty shift changed or is not ready for this action. Refresh and check it again."
            : "班次状态已变化或尚未满足操作条件，请刷新后重新核对。",
        });
      }
      throw rpc.error;
    }

    const updated = await loadPeerSpaceStaffContext(supabase, user.id);
    if (!updated.available) {
      return res.status(403).json({
        error: locale === "en" ? "You do not have access to this workspace." : "当前账号没有这个工作台的权限。",
      });
    }
    return res.status(200).json({
      result: Array.isArray(rpc.data) ? rpc.data[0] || null : rpc.data,
      context: publicPeerSpaceStaffContext(updated, user.id),
    });
  } catch (error) {
    await reportOperationalError({
      req,
      area: "save",
      operation: "peer_space_duty_shift",
      error,
      statusCode: 503,
    });
    return res.status(503).json({
      error: locale === "en"
        ? "The duty shift could not be updated. Please try again later."
        : "值班状态暂时无法更新，请稍后再试。",
    });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "8kb" } } };
