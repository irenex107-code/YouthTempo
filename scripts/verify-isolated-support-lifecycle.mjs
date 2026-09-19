import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const [statusPath, sessionsPath, statePath] = process.argv.slice(2);
if (!statusPath || !sessionsPath || !statePath) {
  throw new Error("Usage: node scripts/verify-isolated-support-lifecycle.mjs status.json sessions.json state.json");
}
const status = JSON.parse(readFileSync(statusPath, "utf8"));
assert.equal(new URL(status.API_URL).origin, "http://127.0.0.1:54321");
const accounts = JSON.parse(readFileSync(sessionsPath, "utf8"));
const adult = accounts["adult-20"];
const minor = accounts["student-16"];
const admin = accounts.admin;
const primary = accounts["professional-applicant"];
const backup = accounts["backup-supporter"];
const outsider = accounts["guardian-unrelated"];
assert([adult, minor, admin, primary, backup, outsider].every((item) => item?.accessToken));

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
  assert.equal(result.status, expected, `${path} ${method}: ${JSON.stringify(result.data).slice(0, 200)}`);
  return result.data;
}
async function latestAssignment(account, caseId, role, statusWanted) {
  const data = await expectStatus("/api/support/staff-cases", account, "GET", undefined, 200);
  return data.assignments.find((item) => item.caseId === caseId && item.role === role && item.status === statusWanted);
}
const list = await expectStatus("/api/support/cases", adult, "GET", undefined, 200);
assert.equal(list.consultationAvailable, true, "only the synthetic allowlisted adult should have internal access");
assert.equal((await expectStatus("/api/support/cases", minor, "GET", undefined, 200)).consultationAvailable, false);
await expectStatus("/api/support/cases", minor, "POST", {
  type: "adult_consultation", needSummary: "Synthetic request", adultUserId: adult.id,
}, 403);
await expectStatus("/api/support/staff-cases", primary, "GET", undefined, 403);

const applicationBody = {
  category: "counselor",
  legalName: "Synthetic Backup Counselor",
  credentialType: "Synthetic credential",
  credentialNumber: "TEST-ONLY-002",
  serviceLanguages: ["zh-CN", "en"],
  ageScopes: ["18_plus"],
  serviceScope: "Local isolated support test",
  availability: "Synthetic appointment hours",
  boundariesConfirmed: true,
  crisisRulesConfirmed: true,
  privacyRulesConfirmed: true,
};
await expectStatus("/api/support/staff", backup, "POST", applicationBody, 200);
const fakePdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const uploaded = await app("/api/support/staff-evidence", backup, "POST", fakePdf, "application/pdf");
assert.equal(uploaded.status, 200);
for (const staff of [primary, backup]) {
  const result = await expectStatus("/api/admin/support/staff", admin, "POST", {
    action: "review", userId: staff.id, status: "approved", note: "Synthetic local approval",
  }, 200);
  assert.equal(result.status, "approved");
}

const created = await expectStatus("/api/support/cases", adult, "POST", {
  type: "adult_consultation",
  needSummary: "Synthetic adult request for local lifecycle verification",
  student_user_id: minor.id,
}, 201);
const caseId = created.id;
writeFileSync(statePath, JSON.stringify({ caseId }), { mode: 0o600 });
assert.equal(created.urgent, false);
await expectStatus("/api/admin/support/cases", outsider, "GET", undefined, 403);
await expectStatus("/api/admin/support/cases", admin, "POST", { caseId, action: "triage" }, 200);
await expectStatus("/api/admin/support/cases", admin, "POST", {
  caseId, action: "offer_primary", staffUserId: primary.id,
}, 200);
const offeredPrimary = await latestAssignment(primary, caseId, "primary", "offered");
assert(offeredPrimary?.id);
assert.equal(offeredPrimary.needSummary, null);
assert.equal((await expectStatus("/api/support/staff-cases", backup, "GET", undefined, 200)).assignments.length, 0);
await expectStatus("/api/support/staff-cases", primary, "POST", {
  assignmentId: offeredPrimary.id, decision: "accepted",
}, 200);
await expectStatus("/api/support/case-action", adult, "POST", { caseId, action: "accept_assignment" }, 200);
const activePrimary = await latestAssignment(primary, caseId, "primary", "accepted");
assert.equal(activePrimary.needSummary, "Synthetic adult request for local lifecycle verification");

await expectStatus("/api/admin/support/cases", admin, "POST", {
  caseId, action: "offer_backup", staffUserId: backup.id,
}, 200);
const offeredBackup = await latestAssignment(backup, caseId, "backup", "offered");
assert(offeredBackup?.id);
assert.equal(offeredBackup.needSummary, null, "inactive backup must not read the request body");
await expectStatus("/api/support/staff-cases", backup, "POST", {
  assignmentId: offeredBackup.id, decision: "accepted",
}, 200);
assert.equal((await latestAssignment(backup, caseId, "backup", "accepted")).needSummary, null);

const appointmentAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
await expectStatus("/api/admin/support/cases", admin, "POST", {
  caseId, action: "propose_appointment", appointmentAt,
}, 200);
await expectStatus("/api/support/case-action", adult, "POST", { caseId, action: "accept_appointment" }, 200);
await expectStatus("/api/support/case-action", adult, "POST", { caseId, action: "request_reschedule" }, 200);
await expectStatus("/api/admin/support/cases", admin, "POST", {
  caseId, action: "propose_appointment", appointmentAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
}, 200);
await expectStatus("/api/support/case-action", adult, "POST", { caseId, action: "cancel_appointment" }, 200);

await expectStatus("/api/support/case-action", adult, "POST", { caseId, action: "request_change" }, 200);
assert.equal((await latestAssignment(primary, caseId, "primary", "accepted")).needSummary, null);
await expectStatus("/api/admin/support/cases", admin, "POST", {
  caseId, action: "transfer", staffUserId: backup.id, note: "Synthetic structured handoff",
}, 200);
const replacement = await latestAssignment(backup, caseId, "primary", "offered");
assert(replacement?.id);
await expectStatus("/api/support/staff-cases", backup, "POST", {
  assignmentId: replacement.id, decision: "accepted",
}, 200);
await expectStatus("/api/support/case-action", adult, "POST", { caseId, action: "accept_assignment" }, 200);
assert.equal((await latestAssignment(backup, caseId, "primary", "accepted")).needSummary,
  "Synthetic adult request for local lifecycle verification");
const former = await expectStatus("/api/support/staff-cases", primary, "GET", undefined, 200);
assert(!former.assignments.some((item) => item.caseId === caseId), "former primary must lose access");

await expectStatus("/api/admin/support/cases", admin, "POST", {
  caseId, action: "refer", referralType: "community", note: "Synthetic referral",
}, 200);
assert.equal((await latestAssignment(backup, caseId, "primary", "accepted")).needSummary, null);
await expectStatus("/api/support/feedback", adult, "POST", {
  caseId, feltHeard: true, foundHelp: true, boundariesRespected: true,
  wouldChooseAgain: true, complaint: false, comment: "Synthetic feedback",
}, 201);
await expectStatus("/api/admin/support/feedback", admin, "POST", { caseId, note: "Reviewed synthetic feedback" }, 200);
await expectStatus("/api/admin/support/cases", admin, "POST", { caseId, action: "close" }, 200);
const closed = await expectStatus("/api/support/cases", adult, "GET", undefined, 200);
assert.equal(closed.cases.find((item) => item.id === caseId)?.status, "closed");
assert.equal((await latestAssignment(backup, caseId, "primary", "accepted")).needSummary, null);
console.log("isolated adult support: application, evidence, review, primary/backup offers, appointment, transfer, referral, feedback, close and access revocation passed");
