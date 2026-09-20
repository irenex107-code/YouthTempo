import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [statusPath, sessionsPath] = process.argv.slice(2);
if (!statusPath || !sessionsPath) {
  throw new Error("Usage: node scripts/verify-isolated-dark-launch.mjs status.json sessions.json");
}
const status = JSON.parse(readFileSync(statusPath, "utf8"));
assert.equal(new URL(status.API_URL).origin, "http://127.0.0.1:54321");
const accounts = JSON.parse(readFileSync(sessionsPath, "utf8"));
const student = accounts["student-16"];
const adult = accounts["adult-20"];
const guardian = accounts["guardian-linked"];
const outsider = accounts["guardian-unrelated"];
assert(student?.accessToken && adult?.accessToken && guardian?.accessToken && outsider?.accessToken);

async function appRequest(path, account, method = "GET", body) {
  const response = await fetch(new URL(path, "http://127.0.0.1:3000"), {
    method,
    headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
const [studentList, adultList, guardianList] = await Promise.all([
  appRequest("/api/support/cases", student),
  appRequest("/api/support/cases", adult),
  appRequest("/api/support/cases", guardian),
]);
assert.equal(studentList.status, 200);
assert.equal(studentList.data.ageBand, "14_17");
assert.equal(studentList.data.consultationAvailable, false);
assert.equal(adultList.status, 200);
assert.equal(adultList.data.ageBand, "18_plus");
assert.equal(adultList.data.consultationAvailable, false);
assert.equal(guardianList.status, 403);
for (const path of ["/api/admin/support/cases", "/api/admin/support/feedback"]) {
  const denied = await appRequest(path, outsider);
  assert.equal(denied.status, 403, `${path} must deny an unrelated guardian as an authorization failure`);
}

for (const account of [student, adult]) {
  const denied = await appRequest("/api/support/cases", account, "POST", {
    type: "adult_consultation",
    needSummary: "Synthetic support need",
    student_user_id: adult.id,
  });
  assert.equal(denied.status, 403, "formal consultation must remain closed");
  const room = await appRequest("/api/peer-space/rooms", account);
  assert.equal(room.status, 404, "adult peer space must remain closed");
}

const youth = await appRequest("/api/support/cases", student, "POST", {
  type: "youth_request",
  needSummary: "Synthetic request to a trusted human supporter",
  student_user_id: adult.id,
});
assert.equal(youth.status, 201, "a minor may submit a youth support request");
assert.equal(youth.data.urgent, false);
const caseId = youth.data.id;
const service = await fetch(new URL(`/rest/v1/support_cases?select=student_user_id,case_type,status&id=eq.${caseId}`, status.API_URL), {
  headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}` },
});
assert.equal(service.status, 200);
const rows = await service.json();
assert.equal(rows.length, 1);
assert.equal(rows[0].student_user_id, student.id, "forged student_user_id must be ignored");
assert.equal(rows[0].case_type, "youth_request");

const raw = await fetch(new URL(`/rest/v1/support_cases?select=id&id=eq.${caseId}`, status.API_URL), {
  headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${student.accessToken}` },
});
assert([401, 403].includes(raw.status), "support case rows must remain server-only");
console.log("isolated dark launch: youth request allowed; adult consultation, peer rooms, guardian and raw support rows denied");
