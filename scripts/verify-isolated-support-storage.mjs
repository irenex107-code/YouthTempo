import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [statusPath, sessionsPath] = process.argv.slice(2);
if (!statusPath || !sessionsPath) {
  throw new Error("Usage: node scripts/verify-isolated-support-storage.mjs status.json sessions.json");
}
const status = JSON.parse(readFileSync(statusPath, "utf8"));
assert.equal(new URL(status.API_URL).origin, "http://127.0.0.1:54321");
const sessions = JSON.parse(readFileSync(sessionsPath, "utf8"));
const applicant = sessions["professional-applicant"];
const admin = sessions.admin;
const unrelated = sessions["guardian-unrelated"];
assert(applicant?.id && admin?.id && unrelated?.id);
const app = "http://127.0.0.1:3000";

async function appRequest(path, account, method = "GET", body, contentType = "application/json") {
  const response = await fetch(new URL(path, app), {
    method,
    headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": contentType },
    body: body === undefined ? undefined : contentType === "application/json" ? JSON.stringify(body) : body,
  });
  return { status: response.status, data: await response.json() };
}
async function service(table, method, body, filter = "select=*") {
  const response = await fetch(new URL(`/rest/v1/${table}?${filter}`, status.API_URL), {
    method,
    headers: {
      apikey: status.ANON_KEY,
      Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert(response.ok, `${table} service request failed with HTTP ${response.status}`);
  return data;
}

await service("admin_roles", "POST", { email: admin.email, role: "管理员", status: "active" }, "on_conflict=email");
const application = await appRequest("/api/support/staff", applicant, "POST", {
  category: "counselor",
  legalName: "Synthetic Counselor",
  credentialType: "Synthetic credential",
  credentialNumber: "TEST-ONLY-001",
  serviceLanguages: ["zh-CN", "en"],
  ageScopes: ["18_plus"],
  serviceScope: "Local isolated support test",
  availability: "Synthetic appointment hours",
  boundariesConfirmed: true,
  crisisRulesConfirmed: true,
  privacyRulesConfirmed: true,
});
assert.equal(application.status, 200);
const fakePdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const uploaded = await appRequest("/api/support/staff-evidence", applicant, "POST", fakePdf, "application/pdf");
assert.equal(uploaded.status, 200);
assert.equal(uploaded.data.uploaded, true);
const [row] = await service("support_staff_applications", "GET", undefined,
  `select=evidence_path,status&user_id=eq.${applicant.id}`);
assert.equal(row.status, "pending");
assert(row.evidence_path?.startsWith(`${applicant.id}/`));
assert(!row.evidence_path.includes("@"), "object path must not contain an email address");

const raw = new URL(`/storage/v1/object/support-staff-evidence/${row.evidence_path}`, status.API_URL);
for (const account of [applicant, unrelated]) {
  const response = await fetch(raw, {
    headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${account.accessToken}` },
  });
  assert([400, 401, 403, 404].includes(response.status), "direct private-object read must be denied");
}
const outsider = await appRequest(`/api/admin/support/staff?evidence=1&userId=${applicant.id}`, unrelated);
assert.equal(outsider.status, 403);
const signed = await appRequest(`/api/admin/support/staff?evidence=1&userId=${applicant.id}`, admin);
assert.equal(signed.status, 200, JSON.stringify(signed.data));
assert.equal(signed.data.expiresIn, 60);
const signedUrl = new URL(signed.data.url, status.API_URL);
assert.equal(signedUrl.origin, "http://127.0.0.1:54321");
const downloaded = await fetch(signedUrl);
assert.equal(downloaded.status, 200);
assert(Buffer.from(await downloaded.arrayBuffer()).equals(fakePdf));
console.log("isolated Storage: private bucket upload, two direct denies, reviewer-only 60-second signed URL and synthetic PDF download passed");
