import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { parsePeerSpaceRoomAction } from "@/lib/peerSpaceStaff";

const roomId = "00000000-0000-4000-8000-000000001800";
const assignmentId = "00000000-0000-4000-8000-000000000101";

test("房间状态动作只接受固定枚举与非正文原因", () => {
  const base = { roomId, assignmentId };
  expect(parsePeerSpaceRoomAction({ ...base, action: "open" })).toMatchObject({
    action: "open", reasonCode: null,
  });
  expect(parsePeerSpaceRoomAction({ ...base, action: "pause", reasonCode: "safety_concern" })).toMatchObject({
    action: "pause", reasonCode: "safety_concern",
  });
  expect(() => parsePeerSpaceRoomAction({ ...base, action: "pause", reasonCode: "student message body" })).toThrow();
  expect(() => parsePeerSpaceRoomAction({ ...base, action: "read_only" })).toThrow();
  expect(() => parsePeerSpaceRoomAction({ ...base, action: "resume_read_only", reasonCode: "operational_issue" })).toThrow();
  expect(() => parsePeerSpaceRoomAction({ ...base, action: "open", reasonCode: "staffing_gap" })).toThrow();
  expect(() => parsePeerSpaceRoomAction({ ...base, action: "send_message" })).toThrow();
});

test("房间开闭由数据库原子校验有效当班、独立备班及安全确认", async () => {
  const migration = await readFile(path.join(
    process.cwd(), "supabase/migrations/20260919065043_add_peer_space_room_state_controls.sql",
  ), "utf8");
  const schema = await readFile(path.join(process.cwd(), "supabase/schema.sql"), "utf8");
  expect(schema).toContain(migration);
  expect(migration).toContain("create table public.peer_space_room_state_events");
  expect(migration).toContain("alter table public.peer_space_room_state_events enable row level security");
  expect(migration).toContain("revoke all on table public.peer_space_room_state_events from public, anon, authenticated, service_role");
  expect(migration).toContain("grant select, insert on table public.peer_space_room_state_events to service_role");
  expect(migration).toContain("create or replace function public.transition_peer_space_room_state(");
  expect(migration).toContain("security invoker");
  expect(migration).toContain("set search_path = ''");
  expect(migration).toContain("and shift.lease_expires_at > v_now");
  expect(migration).toContain("and shift.scheduled_end_at > v_now");
  expect(migration).toContain("and shift.safety_path_confirmed_at is not null");
  expect(migration).toContain("v_shift.primary_staff_user_id = v_shift.backup_staff_user_id");
  expect(migration).toContain("assignment.id = v_shift.backup_assignment_id");
  expect(migration).toContain("assignment.status = 'active'");
  expect(migration).toContain("v_assignment.capability <> 'safety_duty'");
  expect(migration).toContain("v_next_status := 'read_only'");
  expect(migration).toContain("to service_role;");
  expect(migration).not.toContain("create table public.peer_space_messages");
  expect(migration).not.toContain("cron.schedule");
});

test("房间操作只传登录用户、显式工作人员能力和固定参数", async () => {
  const source = await readFile(path.join(process.cwd(), "pages/api/admin/peer-space/rooms.ts"), "utf8");
  expect(source.indexOf("getAuthenticatedUser(req)")).toBeLessThan(source.indexOf("isPeerSpaceStaffApiEnabled()"));
  expect(source).toContain("loadPeerSpaceStaffContext(supabase, user.id)");
  expect(source).toContain("p_actor_user_id: user.id");
  expect(source).toContain("assignmentCoversPeerSpaceRoom");
  expect(source).not.toContain("requirePlatformAdmin");
  expect(source).not.toContain("req.body?.userId");
});

test("未登录无法提交房间状态变更", async ({ request }) => {
  const response = await request.post("/api/admin/peer-space/rooms", {
    data: { roomId, assignmentId, action: "open" },
  });
  expect(response.status()).toBe(401);
});
