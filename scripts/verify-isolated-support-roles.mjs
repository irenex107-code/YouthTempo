import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [statusPath, sessionsPath, roleStatePath] = process.argv.slice(2);
if (!statusPath || !sessionsPath || !roleStatePath) throw new Error("Pass local status, sessions and role state files");
const status = JSON.parse(readFileSync(statusPath, "utf8"));
assert.equal(new URL(status.API_URL).origin, "http://127.0.0.1:54321");
const accounts = JSON.parse(readFileSync(sessionsPath, "utf8"));
const roleState = JSON.parse(readFileSync(roleStatePath, "utf8"));
const admin = accounts.admin;
const student = accounts["student-16"];
const adult = accounts["adult-20"];
const teacher = accounts["school-duty-teacher"];
const social = accounts["social-worker"];
const listener = accounts.listener;
const counselor = accounts["professional-applicant"];
const outsider = accounts["adult-uninvited"];
assert([admin, student, adult, teacher, social, listener, counselor, outsider].every((item) => item?.accessToken));

async function app(path, account, method = "GET", body, contentType = "application/json") {
  const response = await fetch(new URL(path, "http://127.0.0.1:3000"), {
    method,
    headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": contentType },
    body: body === undefined ? undefined : contentType === "application/json" ? JSON.stringify(body) : body,
  });
  return { status: response.status, data: await response.json() };
}
async function expectStatus(path, account, method, body, expected) {
  const result = await app(path, account, method, body);
  assert.equal(result.status, expected, `${path}: ${JSON.stringify(result.data).slice(0, 160)}`);
  return result.data;
}
const staffBody = (category, legalName) => ({
  category, legalName, credentialType: category === "listening_volunteer" ? "" : "Synthetic credential",
  serviceLanguages: ["zh-CN"], ageScopes: ["14_17"],
  serviceScope: "Assigned local support only", availability: "Synthetic hours",
  boundariesConfirmed: true, crisisRulesConfirmed: true, privacyRulesConfirmed: true,
});
const fakePdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
await expectStatus("/api/support/staff", teacher, "POST", staffBody("school_duty_teacher", "Synthetic Duty Teacher"), 400);
await expectStatus("/api/admin/support/staff", admin, "POST", {
  action: "invite_school_teacher", userId: outsider.id, schoolId: roleState.schoolId, legalName: "Unassigned adult",
}, 403);
await expectStatus("/api/admin/support/staff", admin, "POST", {
  action: "invite_school_teacher", userId: teacher.id, schoolId: roleState.schoolId, legalName: "Synthetic Duty Teacher",
}, 201);
await expectStatus("/api/support/staff", teacher, "POST", {
  action: "confirm_invitation", boundariesConfirmed: true,
  crisisRulesConfirmed: true, privacyRulesConfirmed: true,
}, 200);
await expectStatus("/api/admin/support/staff", admin, "POST", {
  action: "review", userId: teacher.id, status: "approved",
}, 200);

for (const [account, category, name] of [
  [social, "social_worker", "Synthetic Social Worker"],
  [listener, "listening_volunteer", "Synthetic Listener"],
]) {
  await expectStatus("/api/support/staff", account, "POST", staffBody(category, name), 200);
  const uploaded = await app("/api/support/staff-evidence", account, "POST", fakePdf, "application/pdf");
  assert.equal(uploaded.status, 200);
  await expectStatus("/api/admin/support/staff", admin, "POST", {
    action: "review", userId: account.id, status: "approved",
  }, 200);
  const unassigned = await expectStatus("/api/support/staff-cases", account, "GET", undefined, 200);
  assert.deepEqual(unassigned.assignments, []);
}
const queue = await expectStatus("/api/admin/support/cases", admin, "GET", undefined, 200);
const youth = queue.cases.filter((item) => item.student_user_id === student.id
  && item.case_type === "youth_request" && item.status === "requested");
assert(youth.length >= 2, "two synthetic youth requests are needed for distinct staff assignments");
const teacherCaseId = youth[0].id;
const socialCaseId = youth[1].id;
await expectStatus("/api/admin/support/cases", admin, "POST", {
  caseId: teacherCaseId, action: "offer_primary", staffUserId: counselor.id,
}, 409);
await expectStatus("/api/admin/support/cases", admin, "POST", {
  caseId: teacherCaseId, action: "offer_primary", staffUserId: teacher.id,
}, 200);
const teacherOffers = await expectStatus("/api/support/staff-cases", teacher, "GET", undefined, 200);
const teacherOffer = teacherOffers.assignments.find((item) => item.caseId === teacherCaseId && item.role === "primary");
assert(teacherOffer?.id);
assert.equal(teacherOffer.needSummary, null);
await expectStatus("/api/support/staff-cases", teacher, "POST", {
  assignmentId: teacherOffer.id, decision: "accepted",
}, 200);
await expectStatus("/api/support/case-action", student, "POST", {
  caseId: teacherCaseId, action: "accept_assignment",
}, 200);
const teacherActive = await expectStatus("/api/support/staff-cases", teacher, "GET", undefined, 200);
assert(teacherActive.assignments.some((item) => item.caseId === teacherCaseId && item.needSummary));

await expectStatus("/api/admin/support/cases", admin, "POST", {
  caseId: teacherCaseId, action: "offer_backup", staffUserId: listener.id,
}, 200);
const listenerCases = await expectStatus("/api/support/staff-cases", listener, "GET", undefined, 200);
const listenerOffer = listenerCases.assignments.find((item) => item.caseId === teacherCaseId);
assert(listenerOffer?.id);
assert.equal(listenerOffer.needSummary, null);
await expectStatus("/api/support/staff-cases", listener, "POST", {
  assignmentId: listenerOffer.id, decision: "accepted",
}, 200);
const listenerAfter = await expectStatus("/api/support/staff-cases", listener, "GET", undefined, 200);
assert.equal(listenerAfter.assignments.find((item) => item.caseId === teacherCaseId)?.needSummary, null);
await expectStatus("/api/admin/support/cases", listener, "POST", {
  caseId: teacherCaseId, action: "close",
}, 403);

await expectStatus("/api/admin/support/cases", admin, "POST", {
  caseId: socialCaseId, action: "offer_primary", staffUserId: social.id,
}, 200);
const socialCases = await expectStatus("/api/support/staff-cases", social, "GET", undefined, 200);
const socialOffer = socialCases.assignments.find((item) => item.caseId === socialCaseId);
assert(socialOffer?.id);
await expectStatus("/api/support/staff-cases", social, "POST", {
  assignmentId: socialOffer.id, decision: "accepted",
}, 200);
await expectStatus("/api/support/case-action", student, "POST", {
  caseId: socialCaseId, action: "accept_assignment",
}, 200);
assert((await expectStatus("/api/support/staff-cases", social, "GET", undefined, 200))
  .assignments.some((item) => item.caseId === socialCaseId && item.needSummary));

const adultCase = await expectStatus("/api/support/cases", adult, "POST", {
  type: "adult_consultation", needSummary: "Synthetic age scope rejection case",
}, 201);
await expectStatus("/api/admin/support/cases", admin, "POST", {
  caseId: adultCase.id, action: "offer_primary", staffUserId: social.id,
}, 409);
console.log("isolated support roles: invited teacher, social worker, listener and counselor age/scope boundaries passed");
