import type { SupabaseClient } from "@supabase/supabase-js";

export const PEER_SPACE_DUTY_CHECKLIST_VERSION = "2026-09-17";

export type PeerSpaceStaffCapability =
  | "room_duty"
  | "content_moderator"
  | "safety_duty"
  | "config_admin";

export type PeerSpaceStaffAssignment = {
  id: string;
  user_id: string;
  space_id: string;
  room_id: string | null;
  capability: PeerSpaceStaffCapability;
  status: "active" | "revoked";
  starts_at: string;
  ends_at: string | null;
};

export type PeerSpaceDutyShift = {
  id: string;
  space_id: string;
  room_id: string;
  primary_assignment_id: string;
  primary_staff_user_id: string;
  backup_assignment_id: string;
  backup_staff_user_id: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  status: "scheduled" | "active" | "handoff_pending" | "ended" | "cancelled";
  actual_start_at: string | null;
  actual_end_at: string | null;
  last_heartbeat_at: string | null;
  lease_expires_at: string | null;
};

export type PeerSpaceStaffContext =
  | { available: false }
  | {
      available: true;
      assignments: PeerSpaceStaffAssignment[];
      shifts: PeerSpaceDutyShift[];
    };

export type PeerSpaceDutyAction =
  | {
      action: "sign_in";
      shiftId: string;
      assignmentId: string;
      checklistVersion: string;
      checks: {
        deviceNetwork: true;
        backupContact: true;
        safetyPath: true;
        rulesResources: true;
        handoffReviewed: true;
      };
    }
  | {
      action: "heartbeat" | "begin_handoff" | "end";
      shiftId: string;
      assignmentId: string;
    };

export type PeerSpaceRoomAction = {
  roomId: string;
  assignmentId: string;
  action: "open" | "read_only" | "pause" | "resume_read_only";
  reasonCode: "staffing_gap" | "safety_concern" | "operational_issue" | "resume_authorized" | null;
};

const assignmentFields = [
  "id",
  "user_id",
  "space_id",
  "room_id",
  "capability",
  "status",
  "starts_at",
  "ends_at",
].join(",");

const shiftFields = [
  "id",
  "space_id",
  "room_id",
  "primary_assignment_id",
  "primary_staff_user_id",
  "backup_assignment_id",
  "backup_staff_user_id",
  "scheduled_start_at",
  "scheduled_end_at",
  "status",
  "actual_start_at",
  "actual_end_at",
  "last_heartbeat_at",
  "lease_expires_at",
].join(",");

export function isPeerSpaceStaffApiEnabled() {
  return process.env.PEER_SPACE_STAFF_API_ENABLED === "true";
}

export function isCurrentPeerSpaceStaffAssignment(
  assignment: Pick<PeerSpaceStaffAssignment, "status" | "starts_at" | "ends_at">,
  now = new Date(),
) {
  const startsAt = Date.parse(assignment.starts_at);
  const endsAt = assignment.ends_at ? Date.parse(assignment.ends_at) : null;
  const nowMs = now.getTime();
  return (
    assignment.status === "active"
    && Number.isFinite(startsAt)
    && startsAt <= nowMs
    && (endsAt === null || (Number.isFinite(endsAt) && endsAt > nowMs))
  );
}

export function assignmentCoversPeerSpaceRoom(
  assignment: Pick<PeerSpaceStaffAssignment, "space_id" | "room_id">,
  spaceId: string,
  roomId: string,
) {
  return assignment.space_id === spaceId
    && (assignment.room_id === null || assignment.room_id === roomId);
}

export function canAccessPeerSpaceDutyShift(
  shift: PeerSpaceDutyShift,
  authenticatedUserId: string,
  assignments: PeerSpaceStaffAssignment[],
) {
  const assignmentId = shift.primary_staff_user_id === authenticatedUserId
    ? shift.primary_assignment_id
    : shift.backup_staff_user_id === authenticatedUserId
      ? shift.backup_assignment_id
      : null;
  if (!assignmentId) return false;
  const assignment = assignments.find((candidate) => candidate.id === assignmentId);
  if (!assignment || !assignmentCoversPeerSpaceRoom(assignment, shift.space_id, shift.room_id)) {
    return false;
  }
  return shift.primary_staff_user_id === authenticatedUserId
    ? assignment.capability === "room_duty"
    : ["room_duty", "safety_duty"].includes(assignment.capability);
}

export async function loadPeerSpaceStaffContext(
  supabase: SupabaseClient,
  authenticatedUserId: string,
  now = new Date(),
): Promise<PeerSpaceStaffContext> {
  const { data: assignmentRows, error: assignmentError } = await supabase
    .from("peer_space_staff_assignments")
    .select(assignmentFields)
    .eq("user_id", authenticatedUserId)
    .eq("status", "active")
    .order("starts_at", { ascending: true })
    .limit(50);
  if (assignmentError) throw assignmentError;

  const assignments = ((assignmentRows || []) as unknown as PeerSpaceStaffAssignment[])
    .filter((assignment) => isCurrentPeerSpaceStaffAssignment(assignment, now));
  if (!assignments.length) return { available: false };

  const { data: shiftRows, error: shiftError } = await supabase
    .from("peer_space_duty_shifts")
    .select(shiftFields)
    .or(`primary_staff_user_id.eq.${authenticatedUserId},backup_staff_user_id.eq.${authenticatedUserId}`)
    .in("status", ["scheduled", "active", "handoff_pending"])
    .order("scheduled_start_at", { ascending: true })
    .limit(50);
  if (shiftError) throw shiftError;

  const shifts = ((shiftRows || []) as unknown as PeerSpaceDutyShift[])
    .filter((shift) => canAccessPeerSpaceDutyShift(shift, authenticatedUserId, assignments));

  return {
    available: true,
    assignments,
    shifts,
  };
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parsePeerSpaceDutyAction(body: unknown): PeerSpaceDutyAction {
  if (!body || typeof body !== "object") throw new Error("invalid_duty_action");
  const input = body as Record<string, unknown>;
  if (!isUuid(input.shiftId) || !isUuid(input.assignmentId)) {
    throw new Error("invalid_duty_action");
  }

  if (input.action === "sign_in") {
    const checks = input.checks && typeof input.checks === "object"
      ? input.checks as Record<string, unknown>
      : {};
    if (
      input.checklistVersion !== PEER_SPACE_DUTY_CHECKLIST_VERSION
      || checks.deviceNetwork !== true
      || checks.backupContact !== true
      || checks.safetyPath !== true
      || checks.rulesResources !== true
      || checks.handoffReviewed !== true
    ) {
      throw new Error("duty_checklist_incomplete");
    }
    return {
      action: "sign_in",
      shiftId: input.shiftId,
      assignmentId: input.assignmentId,
      checklistVersion: input.checklistVersion,
      checks: {
        deviceNetwork: true,
        backupContact: true,
        safetyPath: true,
        rulesResources: true,
        handoffReviewed: true,
      },
    };
  }

  if (["heartbeat", "begin_handoff", "end"].includes(String(input.action))) {
    return {
      action: input.action as "heartbeat" | "begin_handoff" | "end",
      shiftId: input.shiftId,
      assignmentId: input.assignmentId,
    };
  }
  throw new Error("invalid_duty_action");
}

export function parsePeerSpaceRoomAction(body: unknown): PeerSpaceRoomAction {
  if (!body || typeof body !== "object") throw new Error("invalid_room_action");
  const input = body as Record<string, unknown>;
  if (!isUuid(input.roomId) || !isUuid(input.assignmentId)) {
    throw new Error("invalid_room_action");
  }
  const action = input.action;
  if (!["open", "read_only", "pause", "resume_read_only"].includes(String(action))) {
    throw new Error("invalid_room_action");
  }
  const reasonCode = input.reasonCode ?? null;
  if (action === "open" && reasonCode !== null) throw new Error("invalid_room_action");
  if (
    action === "resume_read_only"
      ? reasonCode !== "resume_authorized"
      : action !== "open" && !["staffing_gap", "safety_concern", "operational_issue"].includes(String(reasonCode))
  ) {
    throw new Error("invalid_room_action");
  }
  return {
    roomId: input.roomId,
    assignmentId: input.assignmentId,
    action: action as PeerSpaceRoomAction["action"],
    reasonCode: reasonCode as PeerSpaceRoomAction["reasonCode"],
  };
}

export function publicPeerSpaceStaffContext(
  context: Exclude<PeerSpaceStaffContext, { available: false }>,
  authenticatedUserId: string,
) {
  return {
    available: true as const,
    assignments: context.assignments.map((assignment) => ({
      id: assignment.id,
      capability: assignment.capability,
      spaceId: assignment.space_id,
      roomId: assignment.room_id,
      startsAt: assignment.starts_at,
      endsAt: assignment.ends_at,
    })),
    shifts: context.shifts.map((shift) => ({
      id: shift.id,
      spaceId: shift.space_id,
      roomId: shift.room_id,
      assignmentId: shift.primary_staff_user_id === authenticatedUserId
        ? shift.primary_assignment_id
        : shift.backup_assignment_id,
      role: shift.primary_staff_user_id === authenticatedUserId ? "primary" as const : "backup" as const,
      status: shift.status,
      scheduledStartAt: shift.scheduled_start_at,
      scheduledEndAt: shift.scheduled_end_at,
      actualStartAt: shift.actual_start_at,
      actualEndAt: shift.actual_end_at,
      lastHeartbeatAt: shift.primary_staff_user_id === authenticatedUserId ? shift.last_heartbeat_at : null,
      leaseExpiresAt: shift.primary_staff_user_id === authenticatedUserId ? shift.lease_expires_at : null,
    })),
  };
}
