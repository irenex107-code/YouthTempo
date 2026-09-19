import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [statusPath, sessionsPath, statePath] = process.argv.slice(2);
if (!statusPath || !sessionsPath || !statePath) throw new Error("Pass local status, sessions and state paths");
const status = JSON.parse(readFileSync(statusPath, "utf8"));
assert.equal(new URL(status.API_URL).origin, "http://127.0.0.1:54321");
const accounts = JSON.parse(readFileSync(sessionsPath, "utf8"));
const first = accounts["adult-20"];
const second = accounts["adult-invited"];
const exited = accounts["adult-exited"];
const uninvited = accounts["adult-uninvited"];
const minor = accounts["student-16"];
const admin = accounts.admin;
const moderator = accounts.reviewer;
assert([first, second, exited, uninvited, minor, admin, moderator].every((item) => item?.accessToken));

async function service(table, method = "GET", filter = "select=*", body) {
  const response = await fetch(new URL(`/rest/v1/${table}?${filter}`, status.API_URL), {
    method,
    headers: {
      apikey: status.ANON_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert(response.ok, `${table} ${method} failed: ${JSON.stringify(data).slice(0, 180)}`);
  return data;
}
async function app(path, account, method = "GET", body) {
  const response = await fetch(new URL(path, "http://127.0.0.1:3000"), {
    method,
    headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
async function expectStatus(path, account, method, body, expected) {
  const result = await app(path, account, method, body);
  assert.equal(result.status, expected, `${path}: ${JSON.stringify(result.data).slice(0, 160)}`);
  return result.data;
}
const [space] = await service("peer_spaces", "GET", "select=id,rules_version&code=eq.adult_peer_space");
const [room] = await service("peer_space_rooms", "GET", `select=id,status&space_id=eq.${space.id}&room_code=eq.everyone`);
assert.equal(room.status, "closed", "the seeded adult room must start closed");
const now = new Date();
for (const account of [first, second, exited, uninvited]) {
  await service("student_consents", "POST", "on_conflict=student_user_id", {
    student_user_id: account.id, age_band: "18_plus", consent_basis: "adult_self",
    policy_version: "2026-08-28", status: "active", student_assented_at: now.toISOString(),
  });
}
const [cohort] = await service("peer_space_cohorts", "POST", "select=id", {
  space_id: space.id, internal_name: "Synthetic adult pilot cohort", status: "active", created_by: admin.id,
});
for (const [account, memberStatus] of [[first, "invited"], [second, "invited"], [exited, "left"], [minor, "invited"]]) {
  await service("peer_space_memberships", "POST", "select=id", {
    space_id: space.id, cohort_id: cohort.id, user_id: account.id,
    status: memberStatus, invited_by: admin.id,
    ended_at: memberStatus === "left" ? now.toISOString() : null,
  });
}
writeFileSync(statePath, JSON.stringify({ spaceId: space.id, roomId: room.id, cohortId: cohort.id }), { mode: 0o600 });
for (const account of [minor, uninvited, exited]) {
  assert.equal((await expectStatus("/api/peer-space/access", account, "GET", undefined, 200)).available, false);
  await expectStatus(`/api/peer-space/messages?roomId=${room.id}`, account, "GET", undefined, 403);
}
for (const account of [first, second]) {
  const access = await expectStatus("/api/peer-space/access", account, "GET", undefined, 200);
  assert.equal(access.available, true);
  assert.equal(access.rulesAccepted, false);
  await expectStatus(`/api/peer-space/messages?roomId=${room.id}`, account, "GET", undefined, 403);
  const accepted = await expectStatus("/api/peer-space/rules", account, "POST", {
    accepted: true, rulesVersion: space.rules_version,
  }, 200);
  assert.equal(accepted.rulesAccepted, true);
}
await expectStatus("/api/peer-space/messages", first, "POST", { roomId: room.id, body: "Synthetic hello" }, 409);

const [roomDuty] = await service("peer_space_staff_assignments", "POST", "select=id", {
  user_id: moderator.id, space_id: space.id, capability: "room_duty", granted_by: admin.id,
});
const [contentDuty] = await service("peer_space_staff_assignments", "POST", "select=id", {
  user_id: moderator.id, space_id: space.id, capability: "content_moderator", granted_by: admin.id,
});
const [safetyDuty] = await service("peer_space_staff_assignments", "POST", "select=id", {
  user_id: admin.id, space_id: space.id, capability: "safety_duty", granted_by: admin.id,
});
assert(roomDuty.id && contentDuty.id && safetyDuty.id);
const started = new Date(Date.now() - 60_000).toISOString();
const ends = new Date(Date.now() + 30 * 60_000).toISOString();
const lease = new Date(Date.now() + 15 * 60_000).toISOString();
await service("peer_space_duty_shifts", "POST", "select=id", {
  space_id: space.id, room_id: room.id,
  primary_assignment_id: roomDuty.id, primary_staff_user_id: moderator.id,
  backup_assignment_id: safetyDuty.id, backup_staff_user_id: admin.id,
  scheduled_start_at: started, scheduled_end_at: ends, actual_start_at: started,
  status: "active", checklist_version: "2026-09-17",
  device_network_confirmed_at: started, backup_confirmed_at: started,
  safety_path_confirmed_at: started, rules_resources_confirmed_at: started,
  handoff_reviewed_at: started, last_heartbeat_at: now.toISOString(), lease_expires_at: lease,
  created_by: admin.id,
});
await expectStatus("/api/admin/peer-space/rooms", first, "POST", {
  roomId: room.id, assignmentId: roomDuty.id, action: "open",
}, 403);
const opened = await expectStatus("/api/admin/peer-space/rooms", moderator, "POST", {
  roomId: room.id, assignmentId: roomDuty.id, action: "open",
}, 200);
assert.equal(opened.room.status, "staffed_open");

const messageA = await expectStatus("/api/peer-space/messages", first, "POST", {
  roomId: room.id, body: "Synthetic ordinary message A",
}, 201);
assert.equal(messageA.message.status, "visible");
const messageB = await expectStatus("/api/peer-space/messages", second, "POST", {
  roomId: room.id, body: "Synthetic ordinary message B",
}, 201);
const listPath = `/api/peer-space/messages?roomId=${room.id}`;
const ids = (await expectStatus(listPath, first, "GET", undefined, 200)).messages.map((item) => item.id);
assert.deepEqual(ids, (await expectStatus(listPath, first, "GET", undefined, 200)).messages.map((item) => item.id));
assert(ids.includes(messageA.message.id) && ids.includes(messageB.message.id));

const muted = await expectStatus("/api/peer-space/controls", first, "POST", {
  roomId: room.id, messageId: messageB.message.id, controlType: "mute",
}, 200);
assert.equal(muted.applied, true);
assert(!(await expectStatus(listPath, first, "GET", undefined, 200)).messages.some((item) => item.id === messageB.message.id));
const controls = await expectStatus(`/api/peer-space/controls?roomId=${room.id}`, first, "GET", undefined, 200);
await expectStatus("/api/peer-space/controls", first, "DELETE", {
  controlId: controls.controls.find((item) => item.type === "mute")?.id,
}, 200);
await expectStatus("/api/peer-space/controls", first, "POST", {
  roomId: room.id, messageId: messageB.message.id, controlType: "block",
}, 200);
assert(!(await expectStatus(listPath, first, "GET", undefined, 200)).messages.some((item) => item.id === messageB.message.id));
const blocked = await expectStatus(`/api/peer-space/controls?roomId=${room.id}`, first, "GET", undefined, 200);
await expectStatus("/api/peer-space/controls", first, "DELETE", {
  controlId: blocked.controls.find((item) => item.type === "block")?.id,
}, 200);

await expectStatus("/api/peer-space/messages", first, "DELETE", { messageId: messageB.message.id }, 404);
const reported = await expectStatus("/api/peer-space/reports", second, "POST", {
  roomId: room.id, messageId: messageA.message.id, reasonCode: "harassment",
}, 201);
assert.equal(reported.reported, true);
assert(!(await expectStatus(listPath, second, "GET", undefined, 200)).messages.some((item) => item.id === messageA.message.id));
const reviewQueue = await expectStatus("/api/admin/peer-space/review", moderator, "GET", undefined, 200);
const reportCase = reviewQueue.cases.find((item) => item.messageStatus === "safety_review" && item.category === "report");
assert(reportCase?.id);
await expectStatus("/api/admin/peer-space/review", second, "POST", {
  caseId: reportCase.id, nextStatus: "resolved", messageAction: "hide", followUpRequired: false, escalated: false,
}, 403);
await expectStatus("/api/admin/peer-space/review", moderator, "POST", {
  caseId: reportCase.id, nextStatus: "resolved", messageAction: "hide", followUpRequired: false, escalated: false,
}, 200);

const urgent = await expectStatus("/api/peer-space/messages", first, "POST", {
  roomId: room.id, body: "我想自杀",
}, 201);
assert.equal(urgent.reviewPending, true);
assert.equal(urgent.safetyNotice, true);
assert(!(await expectStatus(listPath, second, "GET", undefined, 200)).messages.some((item) => item.id === urgent.message.id));
const safetyQueue = await expectStatus("/api/admin/peer-space/review", admin, "GET", undefined, 200);
const crisisCase = safetyQueue.cases.find((item) => item.category === "crisis" && item.priority === "urgent");
assert(crisisCase?.id);
const moderatorQueue = await expectStatus("/api/admin/peer-space/review", moderator, "GET", undefined, 200);
assert(!moderatorQueue.cases.some((item) => item.id === crisisCase.id));
await expectStatus("/api/admin/peer-space/review", admin, "POST", {
  caseId: crisisCase.id, nextStatus: "action_required", messageAction: "hide",
  followUpRequired: true, escalated: true,
}, 200);

await expectStatus("/api/peer-space/messages", second, "DELETE", { messageId: messageB.message.id }, 200);
const left = await expectStatus("/api/peer-space/rooms", second, "DELETE", { roomId: room.id }, 200);
assert.equal(left.left, true);
await expectStatus(listPath, second, "GET", undefined, 403);
await expectStatus("/api/peer-space/messages", second, "POST", { roomId: room.id, body: "After exit" }, 403);
const readOnly = await expectStatus("/api/admin/peer-space/rooms", moderator, "POST", {
  roomId: room.id, assignmentId: roomDuty.id, action: "read_only", reasonCode: "staffing_gap",
}, 200);
assert.equal(readOnly.room.status, "read_only");
await expectStatus("/api/peer-space/messages", first, "POST", { roomId: room.id, body: "After closing" }, 409);
console.log("isolated adult room: age/invite/rules, staffed opening, messages, mute/block/report, human review, crisis queue, own delete, old-session exit and read-only lock passed");
