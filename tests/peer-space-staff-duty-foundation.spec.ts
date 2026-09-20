import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  PEER_SPACE_DUTY_CHECKLIST_VERSION,
  assignmentCoversPeerSpaceRoom,
  canAccessPeerSpaceDutyShift,
  isCurrentPeerSpaceStaffAssignment,
  parsePeerSpaceDutyAction,
  publicPeerSpaceStaffContext,
} from "@/lib/peerSpaceStaff";

const assignment = {
  id: "00000000-0000-4000-8000-000000000101",
  user_id: "00000000-0000-4000-8000-000000000102",
  space_id: "00000000-0000-4000-8000-000000000018",
  room_id: "00000000-0000-4000-8000-000000001800",
  capability: "room_duty" as const,
  status: "active" as const,
  starts_at: "2026-09-17T00:00:00.000Z",
  ends_at: "2026-09-18T00:00:00.000Z",
};

const shift = {
  id: "00000000-0000-4000-8000-000000000201",
  space_id: assignment.space_id,
  room_id: assignment.room_id,
  primary_assignment_id: assignment.id,
  primary_staff_user_id: assignment.user_id,
  backup_assignment_id: "00000000-0000-4000-8000-000000000103",
  backup_staff_user_id: "00000000-0000-4000-8000-000000000104",
  scheduled_start_at: "2026-09-17T08:00:00.000Z",
  scheduled_end_at: "2026-09-17T10:00:00.000Z",
  status: "active" as const,
  actual_start_at: "2026-09-17T08:00:00.000Z",
  actual_end_at: null,
  last_heartbeat_at: "2026-09-17T08:00:30.000Z",
  lease_expires_at: "2026-09-17T08:02:30.000Z",
};

test("工作人员能力必须同时满足有效期和明确 space/room scope", () => {
  const now = new Date("2026-09-17T08:00:00.000Z");
  expect(isCurrentPeerSpaceStaffAssignment(assignment, now)).toBe(true);
  expect(isCurrentPeerSpaceStaffAssignment({ ...assignment, status: "revoked" }, now)).toBe(false);
  expect(isCurrentPeerSpaceStaffAssignment({ ...assignment, starts_at: "2026-09-18T00:00:00.000Z" }, now)).toBe(false);
  expect(isCurrentPeerSpaceStaffAssignment({ ...assignment, ends_at: "2026-09-17T07:59:59.000Z" }, now)).toBe(false);

  expect(assignmentCoversPeerSpaceRoom(assignment, assignment.space_id, assignment.room_id)).toBe(true);
  expect(assignmentCoversPeerSpaceRoom({ ...assignment, room_id: null }, assignment.space_id, "another-room")).toBe(true);
  expect(assignmentCoversPeerSpaceRoom(assignment, "another-space", assignment.room_id)).toBe(false);
  expect(assignmentCoversPeerSpaceRoom(assignment, assignment.space_id, "another-room")).toBe(false);
  expect(canAccessPeerSpaceDutyShift(shift, assignment.user_id, [assignment])).toBe(true);
  expect(canAccessPeerSpaceDutyShift(shift, assignment.user_id, [{ ...assignment, id: "00000000-0000-4000-8000-000000000105" }])).toBe(false);
  expect(canAccessPeerSpaceDutyShift(shift, assignment.user_id, [{ ...assignment, capability: "content_moderator" }])).toBe(false);
  expect(canAccessPeerSpaceDutyShift(shift, "00000000-0000-4000-8000-000000000106", [assignment])).toBe(false);
});

test("签到必须提交当前版本的五项完整确认，其他动作只接受固定枚举", () => {
  const base = {
    shiftId: "00000000-0000-4000-8000-000000000201",
    assignmentId: assignment.id,
  };
  expect(parsePeerSpaceDutyAction({
    ...base,
    action: "sign_in",
    checklistVersion: PEER_SPACE_DUTY_CHECKLIST_VERSION,
    checks: {
      deviceNetwork: true,
      backupContact: true,
      safetyPath: true,
      rulesResources: true,
      handoffReviewed: true,
    },
  })).toMatchObject({ action: "sign_in", checklistVersion: PEER_SPACE_DUTY_CHECKLIST_VERSION });
  expect(() => parsePeerSpaceDutyAction({
    ...base,
    action: "sign_in",
    checklistVersion: PEER_SPACE_DUTY_CHECKLIST_VERSION,
    checks: { deviceNetwork: true },
  })).toThrow("duty_checklist_incomplete");
  expect(parsePeerSpaceDutyAction({ ...base, action: "heartbeat" })).toMatchObject({ action: "heartbeat" });
  expect(() => parsePeerSpaceDutyAction({ ...base, action: "open_room" })).toThrow("invalid_duty_action");
});

test("公开工作人员上下文不返回其他工作人员账号或联系方式", () => {
  const userId = assignment.user_id;
  const result = publicPeerSpaceStaffContext({
    available: true,
    assignments: [assignment],
    shifts: [shift],
  }, userId);
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain("primary_staff_user_id");
  expect(serialized).not.toContain("backup_staff_user_id");
  expect(serialized).not.toContain("00000000-0000-4000-8000-000000000104");
  expect(result.shifts[0]).toMatchObject({ role: "primary", assignmentId: assignment.id });
});

test("工作人员和值班迁移保持 server-only、可撤销授权、原子租约和审计", async () => {
  const migrationPath = path.join(
    process.cwd(),
    "supabase/migrations/20260917020225_add_peer_space_staff_duty_foundation.sql",
  );
  const [migration, schema] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(path.join(process.cwd(), "supabase/schema.sql"), "utf8"),
  ]);

  for (const table of [
    "peer_space_staff_assignments",
    "peer_space_staff_assignment_events",
    "peer_space_duty_shifts",
    "peer_space_duty_shift_events",
  ]) {
    expect(migration).toContain(`create table public.${table}`);
    expect(migration).toContain(`alter table public.${table} enable row level security`);
    expect(migration).toContain(`revoke all on table public.${table} from public, anon, authenticated, service_role`);
  }
  expect(migration).toContain("capability in ('room_duty', 'content_moderator', 'safety_duty', 'config_admin')");
  expect(migration).toContain("create trigger protect_peer_space_staff_assignment_before_update");
  expect(migration).toContain("create trigger audit_peer_space_staff_assignment_after_revoke");
  expect(migration).toContain("peer_space_staff_assignment_immutable");
  expect(migration).toContain("primary_staff_user_id <> backup_staff_user_id");
  expect(migration).toContain("create unique index peer_space_duty_one_active_shift_per_room_idx");
  expect(migration).toContain("create unique index peer_space_duty_one_handoff_shift_per_room_idx");
  expect(migration).toContain("where status = 'active'");
  expect(migration).toContain("where status = 'handoff_pending'");
  expect(migration).toContain("interval '120 seconds'");
  expect(migration).toContain("least(v_now + interval '120 seconds', v_shift.scheduled_end_at)");
  expect(migration).toContain("if v_shift.lease_expires_at <= v_now or v_shift.scheduled_end_at <= v_now then");
  const transitionBody = migration.split("create or replace function public.transition_peer_space_duty_shift(")[1]?.split("$$;")[0] || "";
  const handoffBranch = transitionBody.split("if p_action = 'begin_handoff' then")[1]?.split("  else\n    v_next_status := 'ended';")[0] || "";
  expect(handoffBranch).toContain("assignment.id = v_shift.backup_assignment_id");
  expect(handoffBranch).toContain("assignment.status = 'active'");
  expect(handoffBranch).toContain("assignment.capability in ('room_duty', 'safety_duty')");
  expect(handoffBranch).toContain("assignment.room_id = v_shift.room_id");
  expect(handoffBranch).toContain("peer_space_duty_backup_unavailable");
  expect(migration).toContain("create or replace function public.expire_peer_space_duty_leases()");
  expect(migration).toContain("create or replace function public.peer_space_room_has_live_duty(");
  expect(migration).toContain("shift.status in ('active', 'handoff_pending')");
  expect(migration).toContain("shift.lease_expires_at > p_now");
  expect(migration).toContain("shift.scheduled_end_at > p_now");
  expect(migration).toContain("primary_assignment.status = 'active'");
  expect(migration).toContain("backup_assignment.status = 'active'");
  expect(migration).toContain("and not public.peer_space_room_has_live_duty(v_shift.room_id, v_now)");
  expect(migration.match(/and not public\.peer_space_room_has_live_duty\(v_shift\.room_id, v_now\)/g)).toHaveLength(2);
  for (const functionName of [
    "start_peer_space_duty_shift",
    "renew_peer_space_duty_lease",
    "transition_peer_space_duty_shift",
  ]) {
    const body = migration.split(`create or replace function public.${functionName}(`)[1]?.split("$$;")[0] || "";
    const roomLock = body.indexOf("where room.id = v_room_id\n  for update;");
    const shiftLock = body.indexOf("where shift.id = p_shift_id and shift.room_id = v_room_id\n  for update;");
    expect(roomLock).toBeGreaterThan(-1);
    expect(shiftLock).toBeGreaterThan(roomLock);
  }
  const sweepBody = migration.split("create or replace function public.expire_peer_space_duty_leases()")[1]?.split("$$;")[0] || "";
  const sweepRoomLock = sweepBody.indexOf("where room.id = v_candidate.room_id\n    for update skip locked;");
  const sweepShiftLock = sweepBody.indexOf("where shift.id = v_candidate.id and shift.room_id = v_candidate.room_id\n    for update skip locked;");
  expect(sweepRoomLock).toBeGreaterThan(-1);
  expect(sweepShiftLock).toBeGreaterThan(sweepRoomLock);
  expect(sweepBody).toContain("or (v_shift.lease_expires_at > v_now and v_shift.scheduled_end_at > v_now)");
  expect(migration).toContain("status = 'read_only'");
  expect(migration).toContain("for update skip locked");
  expect(migration).toContain("security invoker");
  expect(migration).toContain("set search_path = ''");
  expect(migration).toContain("grant execute on function public.start_peer_space_duty_shift");
  expect(migration).toContain("to service_role;");
  expect(migration).not.toMatch(/grant\s+(?:select|insert|update|delete|all).*peer_space_(?:staff|duty).*authenticated/i);
  expect(migration).not.toContain("create table public.peer_space_messages");
  expect(migration).not.toContain("realtime.messages");
  expect(migration).toContain("revoke all on function public.peer_space_room_has_live_duty(uuid, timestamptz)");
  expect(schema).toContain(migration);
});

test("工作人员 API 先认证再检查默认关闭的服务端开关", async () => {
  const [contextSource, shiftsSource] = await Promise.all([
    readFile(path.join(process.cwd(), "pages/api/admin/peer-space/context.ts"), "utf8"),
    readFile(path.join(process.cwd(), "pages/api/admin/peer-space/shifts.ts"), "utf8"),
  ]);
  for (const source of [contextSource, shiftsSource]) {
    expect(source.indexOf("getAuthenticatedUser(req)")).toBeGreaterThan(-1);
    expect(source.indexOf("getAuthenticatedUser(req)")).toBeLessThan(source.indexOf("isPeerSpaceStaffApiEnabled()"));
    expect(source).toContain("loadPeerSpaceStaffContext");
    expect(source).not.toContain("requirePlatformAdmin");
    expect(source).not.toContain("profiles.role");
  }
  expect(shiftsSource).toContain('"23505"');
});

test("未登录不能读取工作人员上下文或提交值班动作", async ({ request }) => {
  const context = await request.get("/api/admin/peer-space/context");
  expect(context.status()).toBe(401);

  const shift = await request.post("/api/admin/peer-space/shifts", {
    data: {
      action: "heartbeat",
      shiftId: "00000000-0000-4000-8000-000000000201",
      assignmentId: assignment.id,
    },
  });
  expect(shift.status()).toBe(401);
});
