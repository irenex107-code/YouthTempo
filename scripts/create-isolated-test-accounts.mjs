import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [statusPath, sessionsPath] = process.argv.slice(2);
if (!statusPath || !sessionsPath) {
  throw new Error("Usage: node scripts/create-isolated-test-accounts.mjs local-status.json /private/tmp/youthtempo-isolated-.../sessions.json");
}
const source = resolve(statusPath);
const target = resolve(sessionsPath);
assert(source.startsWith("/private/tmp/youthtempo-isolated-")
  && target.startsWith("/private/tmp/youthtempo-isolated-"), "use only disposable private-tmp files");
const status = JSON.parse(readFileSync(source, "utf8"));
assert.equal(new URL(status.API_URL).origin, "http://127.0.0.1:54321", "never create accounts outside local Supabase");
const names = [
  "student-16", "adult-20", "guardian-linked", "guardian-unrelated",
  "professional-applicant", "professional-approved", "social-worker",
  "listener", "school-duty-teacher", "reviewer", "admin",
  "adult-uninvited", "adult-invited", "adult-exited",
  "primary-supporter", "backup-supporter",
];
const accounts = {};
for (const name of names) {
  const email = `yt-${name}@example.invalid`;
  const password = `Local-only-${randomBytes(18).toString("hex")}`;
  const created = await fetch(new URL("/auth/v1/admin/users", status.API_URL), {
    method: "POST",
    headers: {
      apikey: status.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: `Synthetic ${name}` } }),
  });
  assert.equal(created.status, 200, `synthetic ${name} creation failed`);
  const user = await created.json();
  const signed = await fetch(new URL("/auth/v1/token?grant_type=password", status.API_URL), {
    method: "POST",
    headers: { apikey: status.ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(signed.status, 200, `synthetic ${name} sign-in failed`);
  const session = await signed.json();
  accounts[name] = { id: user.id, email, accessToken: session.access_token, refreshToken: session.refresh_token };
}
writeFileSync(target, JSON.stringify(accounts), { mode: 0o600 });
chmodSync(target, 0o600);
console.log(`isolated synthetic accounts created and signed in: ${names.length}; sessions saved with mode 0600`);
