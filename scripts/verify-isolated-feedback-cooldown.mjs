import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [statusPath, sessionsPath] = process.argv.slice(2);
if (!statusPath || !sessionsPath) {
  throw new Error("Usage: node scripts/verify-isolated-feedback-cooldown.mjs status.json sessions.json");
}
const status = JSON.parse(readFileSync(statusPath, "utf8"));
assert.equal(new URL(status.API_URL).origin, "http://127.0.0.1:54321");
const sessions = JSON.parse(readFileSync(sessionsPath, "utf8"));
const adult = sessions["adult-20"];
const student = sessions["student-16"];
assert(adult?.id && adult?.accessToken && student?.id);
const app = new URL("http://127.0.0.1:3000");

async function endpoint(method, body) {
  const response = await fetch(new URL("/api/pilot-experience?feature=sweet", app), {
    method,
    headers: { Authorization: `Bearer ${adult.accessToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
const first = await endpoint("GET");
assert.equal(first.status, 200);
assert.equal(first.data.eligible, true, "fresh adult fixture must be eligible");

const submitted = await Promise.all([1, 2].map(() => endpoint("POST", {
  feature: "sweet",
  outcome: "dismissed",
  user_id: student.id,
  age_band: "14_17",
})));
assert.deepEqual(submitted.map((item) => item.status).sort(), [201, 409], "concurrent requests must save only once");
const after = await endpoint("GET");
assert.equal(after.status, 200);
assert.equal(after.data.eligible, false);

const serviceResponse = await fetch(new URL(`/rest/v1/pilot_experience_feedback?select=user_id,age_band,outcome&user_id=eq.${adult.id}`, status.API_URL), {
  headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}` },
});
assert.equal(serviceResponse.status, 200);
const rows = await serviceResponse.json();
assert.equal(rows.length, 1);
assert.equal(rows[0].user_id, adult.id, "forged user_id must be ignored");
assert.equal(rows[0].age_band, "18_plus", "age band must come from server consent");
assert.equal(rows[0].outcome, "dismissed");

const directResponse = await fetch(new URL(`/rest/v1/pilot_experience_feedback?select=id&user_id=eq.${adult.id}`, status.API_URL), {
  headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${adult.accessToken}` },
});
assert([401, 403].includes(directResponse.status), "browser token must not read raw feedback rows");
console.log("isolated feedback: 2 concurrent requests yielded one save and one cooldown, server-owned identity/age, raw Data API denied");
