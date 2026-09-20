import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [statusPath, sessionsPath, statePath] = process.argv.slice(2);
if (!statusPath || !sessionsPath || !statePath) {
  throw new Error("Usage: node scripts/verify-isolated-role-rls.mjs status.json sessions.json state.json");
}
const status = JSON.parse(readFileSync(statusPath, "utf8"));
const api = new URL(status.API_URL);
assert.equal(api.origin, "http://127.0.0.1:54321", "only the disposable local Supabase instance is allowed");
const accounts = JSON.parse(readFileSync(sessionsPath, "utf8"));
assert.equal(Object.keys(accounts).length, 16, "the authorized synthetic account set must be complete");
const service = status.SERVICE_ROLE_KEY;

async function rest(table, token, method = "GET", params = "select=id", body) {
  const response = await fetch(new URL(`/rest/v1/${table}?${params}`, api), {
    method,
    headers: {
      apikey: status.ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : [] };
}
async function seed(table, body, params = "select=id") {
  const result = await rest(table, service, "POST", params, body);
  assert(result.status >= 200 && result.status < 300, `${table} seed failed: ${JSON.stringify(result.data).slice(0, 200)}`);
}

const schoolId = randomUUID();
const studentRecordId = randomUUID();
const adultRecordId = randomUUID();
const linkId = randomUUID();
await seed("schools", { id: schoolId, name: "Isolated role boundary school" });
for (const [name, account] of Object.entries(accounts)) {
  const role = name.startsWith("guardian-") ? "家长"
    : name === "school-duty-teacher" || name === "reviewer" ? "学校支持人员"
      : name.startsWith("professional-") || ["social-worker", "listener", "primary-supporter", "backup-supporter"].includes(name)
        ? "专业支持者" : "学生";
  await seed("profiles", {
    id: account.id,
    email: account.email,
    display_name: `Synthetic ${name}`,
    role,
    school_id: ["student-16", "guardian-linked", "school-duty-teacher"].includes(name) ? schoolId : null,
  }, "on_conflict=id");
}
const student = accounts["student-16"];
const adult = accounts["adult-20"];
const guardian = accounts["guardian-linked"];
const teacher = accounts["school-duty-teacher"];
for (const [account, ageBand, consentBasis] of [[student, "14_17", "student_self_pilot"], [adult, "18_plus", "adult_self"]]) {
  await seed("student_consents", {
    student_user_id: account.id,
    age_band: ageBand,
    consent_basis: consentBasis,
    policy_version: "2026-08-28",
    status: "active",
    student_assented_at: new Date().toISOString(),
  }, "on_conflict=student_user_id");
}
for (const account of [teacher, guardian]) {
  await seed("school_members", {
    school_id: schoolId,
    user_id: account.id,
    email: account.email,
    member_role: "school_support",
    status: "active",
  });
  await seed("teacher_student_assignments", {
    school_id: schoolId,
    teacher_user_id: account.id,
    student_user_id: student.id,
    status: "active",
  });
}
await seed("guardian_student_links", {
  id: linkId,
  school_id: schoolId,
  guardian_user_id: guardian.id,
  student_user_id: student.id,
  status: "revoked",
});
await seed("sweet_records", [
  { id: studentRecordId, user_id: student.id, school_id: schoolId, records: [{ id: "synthetic-student" }] },
  { id: adultRecordId, user_id: adult.id, school_id: null, records: [{ id: "synthetic-adult" }] },
]);
writeFileSync(statePath, JSON.stringify({ schoolId, studentRecordId, adultRecordId, linkId }), { mode: 0o600 });

let allowed = 0;
let denied = 0;
for (const [name, account] of Object.entries(accounts)) {
  const result = await rest("sweet_records", account.accessToken, "GET",
    `select=id&id=in.(${studentRecordId},${adultRecordId})`);
  assert.equal(result.status, 200, `${name} direct SWEET query status`);
  const actual = result.data.map((row) => row.id).sort();
  const expected = name === "student-16" || name === "school-duty-teacher" ? [studentRecordId]
    : name === "adult-20" ? [adultRecordId] : [];
  assert.deepEqual(actual, expected, `${name} SWEET visibility`);
  allowed += expected.length;
  denied += 2 - expected.length;
}
const guest = await rest("sweet_records", status.ANON_KEY, "GET", `select=id&id=eq.${studentRecordId}`);
assert([200, 401, 403].includes(guest.status), "guest must not be allowed to read SWEET");
if (guest.status === 200) assert.equal(guest.data.length, 0);
denied++;
for (const [name, expected] of [["student-16", 1], ["guardian-linked", 0], ["guardian-unrelated", 0]]) {
  const account = accounts[name];
  const result = await rest("guardian_student_links", account.accessToken, "GET", `select=id&id=eq.${linkId}`);
  assert.equal(result.status, 200);
  assert.equal(result.data.length, expected, `${name} relationship visibility`);
  if (expected) allowed++; else denied++;
}
const preserved = await rest("guardian_student_links", service, "GET", `select=id,status&id=eq.${linkId}`);
assert.equal(preserved.data[0]?.status, "revoked");
console.log(`isolated role RLS: ${Object.keys(accounts).length} signed-in accounts, ${allowed} allowed and ${denied} denied direct Data API assertions passed`);
