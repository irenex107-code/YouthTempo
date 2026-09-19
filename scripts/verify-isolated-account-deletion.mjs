import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [statusPath, sessionsPath, phase = "full"] = process.argv.slice(2);
if (!statusPath || !sessionsPath) throw new Error("Pass local status.json and synthetic-sessions.json");
assert(["full", "verify-after"].includes(phase));
const status = JSON.parse(readFileSync(statusPath, "utf8"));
assert.equal(new URL(status.API_URL).origin, "http://127.0.0.1:54321");
const sessions = JSON.parse(readFileSync(sessionsPath, "utf8"));
const account = sessions["adult-20"];
assert(account?.id && account?.accessToken && account?.email?.endsWith("@example.invalid"));

async function app(method, body) {
  const response = await fetch("http://127.0.0.1:3000/api/account/data", {
    method,
    headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
if (phase === "full") {
  const exported = await app("GET");
  assert.equal(exported.status, 200);
  assert.equal(exported.data.account.id, account.id);
  assert(exported.data.data.sweetRecords.length >= 1);
  assert(exported.data.data.supportCases.length >= 1);
  assert(exported.data.data.pilotExperienceFeedback.length >= 1);
  assert(exported.data.data.peerSpaceMessages.length >= 1);
  const wrong = await app("DELETE", { confirmationEmail: `wrong-${account.email}`, acknowledge: true });
  assert.equal(wrong.status, 400);
  const correct = await app("DELETE", { confirmationEmail: account.email, acknowledge: true });
  assert.equal(correct.status, 200, JSON.stringify(correct.data));
  assert.equal(correct.data.deleted, true);
  assert.equal(correct.data.cleanupPending, undefined);
}
assert.equal((await app("GET")).status, 401, "old access token must lose account access after deletion");

async function count(table, column) {
  const response = await fetch(new URL(`/rest/v1/${table}?select=${column}&${column}=eq.${account.id}`, status.API_URL), {
    headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}` },
  });
  assert.equal(response.status, 200, `${table} service count`);
  return (await response.json()).length;
}
for (const [table, column] of [
  ["profiles", "id"], ["sweet_records", "user_id"], ["student_consents", "student_user_id"],
  ["support_cases", "student_user_id"], ["peer_space_memberships", "user_id"],
  ["pilot_experience_feedback", "user_id"],
]) assert.equal(await count(table, column), 0, `${table} must be removed with the account`);
const subjectHash = createHash("sha256").update(account.id).digest("hex");
const audit = await fetch(new URL(`/rest/v1/account_deletion_audits?select=status,email_hash&subject_hash=eq.${subjectHash}`, status.API_URL), {
  headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}` },
});
assert.equal(audit.status, 200);
const auditRows = await audit.json();
assert.equal(auditRows[0]?.status, "completed");
assert.match(auditRows[0]?.email_hash || "", /^[0-9a-f]{64}$/);
console.log(phase === "full"
  ? "isolated account deletion: rich export, wrong-confirmation denial, Auth session revocation, private-row cascade and hashed completed audit passed"
  : "isolated account deletion follow-up: old token denied, private rows absent and hashed audit completed");
