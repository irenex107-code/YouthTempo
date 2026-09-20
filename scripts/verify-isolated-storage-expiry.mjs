import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const [statusPath, sessionsPath] = process.argv.slice(2);
if (!statusPath || !sessionsPath) throw new Error("Pass local status.json and synthetic-sessions.json");
const status = JSON.parse(readFileSync(statusPath, "utf8"));
assert.equal(new URL(status.API_URL).origin, "http://127.0.0.1:54321");
const accounts = JSON.parse(readFileSync(sessionsPath, "utf8"));
const response = await fetch(new URL(`/api/admin/support/staff?evidence=1&userId=${accounts["professional-applicant"].id}`, "http://127.0.0.1:3000"), {
  headers: { Authorization: `Bearer ${accounts.admin.accessToken}` },
});
assert.equal(response.status, 200);
const payload = await response.json();
assert.equal(payload.expiresIn, 60);
const signed = new URL(payload.url, status.API_URL);
assert.equal(signed.origin, "http://127.0.0.1:54321");
assert.equal((await fetch(signed)).status, 200);
await delay(66_000);
const expired = await fetch(signed);
assert([400, 401, 403, 404].includes(expired.status), `expired signed URL still returned HTTP ${expired.status}`);
console.log("isolated Storage: 60-second reviewer signed URL served synthetic material, then expired as expected");
