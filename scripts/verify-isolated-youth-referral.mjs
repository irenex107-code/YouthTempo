import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [statusPath, sessionsPath] = process.argv.slice(2);
if (!statusPath || !sessionsPath) throw new Error("Pass local status.json and synthetic-sessions.json");
const status = JSON.parse(readFileSync(statusPath, "utf8"));
assert.equal(new URL(status.API_URL).origin, "http://127.0.0.1:54321");
const accounts = JSON.parse(readFileSync(sessionsPath, "utf8"));
const admin = accounts.admin;
const student = accounts["student-16"];
const guardian = accounts["guardian-unrelated"];
assert(admin?.accessToken && student?.accessToken && guardian?.accessToken);

async function app(path, account, method = "GET", body) {
  const response = await fetch(new URL(path, "http://127.0.0.1:3000"), {
    method,
    headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
const queue = await app("/api/admin/support/cases", admin);
assert.equal(queue.status, 200);
const item = queue.data.cases.find((candidate) => candidate.student_user_id === student.id
  && candidate.case_type === "youth_request" && candidate.status === "requested");
assert(item?.id, "a synthetic youth request must be waiting for review");
const unrelated = await app("/api/admin/support/cases", guardian);
assert.equal(unrelated.status, 403);
const triaged = await app("/api/admin/support/cases", admin, "POST", { caseId: item.id, action: "triage" });
assert.equal(triaged.status, 200);
assert.equal(triaged.data.status, "triage");
const referred = await app("/api/admin/support/cases", admin, "POST", {
  caseId: item.id, action: "refer", referralType: "school", note: "Synthetic school support path",
});
assert.equal(referred.status, 200);
assert.equal(referred.data.status, "referred");
const studentList = await app("/api/support/cases", student);
assert.equal(studentList.status, 200);
const visible = studentList.data.cases.find((candidate) => candidate.id === item.id);
assert.equal(visible?.status, "referred");
assert.equal(visible?.referral_type, "school");
const eventsResponse = await fetch(new URL(`/rest/v1/support_case_events?select=action,next_status,note&case_id=eq.${item.id}`, status.API_URL), {
  headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}` },
});
assert.equal(eventsResponse.status, 200);
const events = await eventsResponse.json();
assert(events.some((event) => event.action === "triage"));
assert(events.some((event) => event.action === "refer"));
assert(events.every((event) => !JSON.stringify(event).includes("Synthetic request to a trusted human supporter")),
  "audit events must not copy the request body");
console.log("isolated youth support: admin triage and school referral succeeded; unrelated guardian denied; request body absent from audit events");
