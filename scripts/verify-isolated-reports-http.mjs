import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, lstatSync, realpathSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";

const [statusFile, sessionsFile, stateFile] = process.argv.slice(2);
const app = "http://127.0.0.1:3214";
const container = "supabase_db_youthtempo-isolated-reports-20261028";
let assertions = 0;
function ensure(condition, label) { assertions += 1; if (!condition) throw new Error(label); }
function uuid(value) { ensure(typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value), "Invalid synthetic identifier"); return value; }
const privateRoot = dirname(resolve(statusFile || ""));
ensure(privateRoot.startsWith("/private/tmp/") && basename(privateRoot) === "youthtempo-isolated-reports-integration-20261028", "Only this batch's disposable private directory is allowed");
for (const name of [statusFile, sessionsFile, stateFile]) {
  ensure(typeof name === "string" && dirname(realpathSync(name)) === privateRoot, "All inputs must belong to the disposable directory");
  const stat = lstatSync(name);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0, "Private inputs must be single-link mode0600 files");
}
const status = JSON.parse(readFileSync(statusFile, "utf8"));
const accounts = JSON.parse(readFileSync(sessionsFile, "utf8"));
const state = JSON.parse(readFileSync(stateFile, "utf8"));
ensure(status.API_URL === "http://127.0.0.1:55321", "Only the batch local API is allowed");
for (const [name, account] of Object.entries(accounts)) {
  uuid(account.id);
  ensure(account.email === `yt-reports-${name}@example.invalid`, "Only reports-only synthetic identities are allowed");
}
function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function sql(statement) {
  try {
    return execFileSync("docker", ["--context", "colima-youthtempo-e2e", "exec", container,
      "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq", "-c", statement],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 }).trim();
  } catch { throw new Error("A controlled local fixture statement failed; SQL details withheld"); }
}
async function local(path, token, method = "GET", body) {
  const response = await fetch(new URL(path, status.API_URL), { method, signal: AbortSignal.timeout(20_000),
    headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  ensure(response.ok, "A controlled local fixture request failed; response details withheld");
  return data;
}
async function api(path, actor, method = "GET", body, origin = app) {
  let response;
  try {
    response = await fetch(new URL(path, app), { method, signal: AbortSignal.timeout(30_000),
      headers: { ...(actor ? { Authorization: `Bearer ${accounts[actor].accessToken}` } : {}), Origin: origin, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new Error("A local report HTTP request failed; credentials withheld"); }
  ensure(response.headers.get("cache-control")?.includes("no-store"), "Every report HTTP result must be no-store");
  const data = await response.json();
  ensure(!JSON.stringify(data).includes("REPORTS_HTTP_PRIVATE"), "A report HTTP result leaked private source text");
  return { status: response.status, data };
}
function success(result, label) { ensure(result.status >= 200 && result.status < 300, label); return result.data; }
function rejected(result, label) { ensure([400, 401, 403, 404, 409].includes(result.status), label); }
async function current(id, actor) { return api(`/api/reports/current?authorizationId=${uuid(id)}`, actor); }
const createBody = (id = randomUUID()) => ({ recipientId: accounts["teacher-a"].id, recipientType: "teacher", dimensions: ["sleep"], requestId: id, confirmed: true });
function unavailable(result, label) {
  if (result.status >= 400) rejected(result, label);
  else ensure(["invalid", "expired"].includes(result.data.summary?.status) && !result.data.summary?.period, label);
}

try {
  ensure(sql(`select count(*) from auth.users where id in (${Object.values(accounts).map((a) => `${literal(uuid(a.id))}::uuid`).join(",")})`) === "11", "The selected container must hold this exact synthetic identity set");
  ensure((await api("/api/reports/access", null)).status === 401, "Missing bearer must be denied");
  ensure((await api("/api/reports/access", "student-a1", "POST", {})).status === 405, "Unsupported method must be denied");
  const old = success(await api("/api/reports/access", "student-a2"), "Existing self-pilot state must be readable");
  ensure(old.eligibility === "school_consent_required" && old.candidates.length === 0, "Existing self-pilot must not become school report consent");
  const adult = success(await api("/api/reports/access", "adult-a"), "Adult closed state must be safe");
  ensure(adult.eligibility === "not_available" && adult.candidates.length === 0 && adult.received.length === 0, "Adult sharing must remain unavailable in this application batch");
  rejected(await api("/api/reports/authorizations", "adult-a", "POST", createBody()), "Adult application authorization must stay closed");
  const until = new Date(Date.now() + 35 * 86400_000).toISOString();
  await local("/rest/v1/rpc/issue_report_minor_eligibility", status.SERVICE_ROLE_KEY, "POST", {
    p_actor_user_id: accounts.admin.id, p_student_user_id: accounts["student-a1"].id, p_school_id: state.schoolA,
    p_verification_basis: "school_verified", p_source_reference: "isolated-http-minor", p_valid_until: until,
  });
  const access = success(await api("/api/reports/access", "student-a1"), "Eligible student context failed");
  ensure(access.eligibility === "eligible" && access.candidates.some((c) => c.id === accounts["teacher-a"].id), "Current assigned teacher must be the trusted candidate");
  ensure(access.candidates.every((c) => c.type === "teacher" && !Object.hasOwn(c, "email")), "Guardian candidates and emails must remain absent");
  const body = createBody();
  rejected(await api("/api/reports/authorizations", "student-a1", "POST", { ...body, ownerId: accounts["student-b1"].id }), "Client owner must never be accepted");
  rejected(await api("/api/reports/authorizations", "student-a1", "POST", body, "https://unrelated.example.invalid"), "Cross-origin mutation must be denied");
  rejected(await api("/api/reports/authorizations", "student-a1", "POST", { ...body, recipientId: accounts["teacher-b"].id }), "Cross-school candidate must be denied");
  rejected(await api("/api/reports/authorizations", "student-a1", "POST", { ...body, recipientType: "guardian", recipientId: accounts["guardian-linked"].id }), "Guardian application creation must remain closed");
  const id = uuid(success(await api("/api/reports/authorizations", "student-a1", "POST", body), "Teacher authorization failed").authorizationId);
  ensure(success(await api("/api/reports/authorizations", "student-a1", "POST", body), "Idempotent retry failed").authorizationId === id, "Idempotent HTTP retry must retain the authorization ID");
  for (const actor of ["student-a1", "teacher-a"]) ensure(success(await current(id, actor), "Current authorized state failed").summary.status === "waiting", "New authorization must wait for its first complete period");
  for (const actor of ["student-a2", "teacher-b", "guardian-linked", "guardian-unrelated", "admin", "school-lead"]) unavailable(await current(id, actor), "Other roles must not gain report access");
  for (const actor of ["admin", "school-lead", "guardian-linked"]) {
    const result = await api("/api/reports/access", actor);
    if (result.status === 200) ensure(result.data.received.length === 0 && result.data.candidates.length === 0, "A privileged or guardian role must not obtain a report list");
    else rejected(result, "Closed role must fail safely");
  }
  ensure(success(await api("/api/reports/access", "teacher-a"), "Teacher list failed").received.some((g) => g.id === id), "Explicit recipient must see its grant");
  rejected(await api(`/api/reports/authorizations/${id}`, "teacher-a", "DELETE", {}), "Recipient must not revoke on behalf of owner");
  success(await api(`/api/reports/authorizations/${id}`, "student-a1", "DELETE", {}), "Owner revoke failed");
  success(await api(`/api/reports/authorizations/${id}`, "student-a1", "DELETE", {}), "Repeated owner revoke failed");
  unavailable(await current(id, "teacher-a"), "Revoked grant remained readable over HTTP");

  // Historical inputs are explicit synthetic fixture history, never a runtime
  // shortcut for creating/backdating a real user's authorization.
  // Use school B, which has no later verification history. A newly revoked
  // school A proof must never be bypassed by inserting an older proof.
  const owner = uuid(accounts["student-b1"].id);
  const recipient = uuid(accounts["teacher-b"].id);
  const effective = new Date(Date.now() - 15 * 86400_000).toISOString();
  const assent = new Date(Date.now() - 18 * 86400_000).toISOString();
  sql(`update public.student_consents set student_assented_at=${literal(assent)}::timestamptz,guardian_consented_at=${literal(assent)}::timestamptz where student_user_id=${literal(owner)}::uuid;
    update public.minor_eligibility_assertions set revoked_at=clock_timestamp() where student_user_id=${literal(owner)}::uuid and revoked_at is null;`);
  const proofId = randomUUID();
  sql(`insert into public.minor_eligibility_assertions(id,student_user_id,school_id,verified_by,verification_basis,source_reference,verified_at,valid_until)
    values(${literal(proofId)}::uuid,${literal(owner)}::uuid,${literal(uuid(state.schoolB))}::uuid,${literal(uuid(accounts.admin.id))}::uuid,'school_verified','isolated-http-historical',${literal(assent)}::timestamptz,clock_timestamp()+interval '35 days');`);
  function historicalGrant() {
    const grantId = randomUUID();
    sql(`insert into public.report_authorizations(id,student_user_id,recipient_user_id,recipient_type,relationship_id,school_id,minor_assertion_id,dimensions,policy_version,consent_snapshot,effective_at,expires_at,request_id)
      select ${literal(grantId)}::uuid,c.student_user_id,${literal(recipient)}::uuid,'teacher',${literal(uuid(state.assignmentB1))}::uuid,c.school_id,${literal(proofId)}::uuid,array['sleep'],'reports-2026-10-27',to_jsonb(c)-array['created_at','updated_at'],${literal(effective)}::timestamptz,${literal(effective)}::timestamptz+interval '30 days',${literal(randomUUID())}::uuid
      from public.student_consents c where c.student_user_id=${literal(owner)}::uuid;`);
    return grantId;
  }
  let historicalId = historicalGrant();
  for (const day of [8, 9, 10]) {
    const answers = [
      { id: "sleep", fields: [{ id: "quality", value: "比较好" }, { id: "note", value: "REPORTS_HTTP_PRIVATE_NOTE" }] },
      { id: "wake", fields: [{ id: "state", value: "比较有精神" }] },
      { id: "eat", fields: [{ id: "rhythm", value: "比较规律" }] },
      { id: "exercise", fields: [{ id: "duration", value: "10–19 分钟" }] },
      { id: "task", fields: [{ id: "engagement", value: "比较顺利" }] },
    ];
    const stamp = new Date(new Date(effective).getTime() + day * 86400_000).toISOString();
    sql(`insert into public.sweet_records(user_id,school_id,records,summary,created_at) values(${literal(owner)}::uuid,${literal(uuid(state.schoolB))}::uuid,${literal(JSON.stringify(answers))}::jsonb,'REPORTS_HTTP_PRIVATE_SUMMARY',${literal(stamp)}::timestamptz);`);
  }
  const ready = success(await current(historicalId, "teacher-b"), "Historical HTTP aggregate failed").summary;
  ensure(ready.status === "ready" && ready.dimensions.length === 1 && ready.dimensions[0].id === "sleep" && ready.dimensions[0].category === "sleep_good", "HTTP aggregate must return only the approved exact category");
  ensure(Object.keys(ready).every((k) => ["version", "status", "period", "dimensions"].includes(k)), "HTTP aggregate contained extra envelope fields");
  sql(`update public.student_consents set status='withdrawn' where student_user_id=${literal(owner)}::uuid;`);
  unavailable(await current(historicalId, "teacher-b"), "Consent withdrawal failed over HTTP");
  sql(`update public.student_consents set status='active' where student_user_id=${literal(owner)}::uuid;`);
  unavailable(await current(historicalId, "teacher-b"), "Consent reactivation revived an old HTTP authorization");
  historicalId = historicalGrant();
  ensure(success(await current(historicalId, "teacher-b"), "Fresh synthetic historical grant failed").summary.status === "ready", "Fresh grant must remain independent from invalidated history");
  state.httpHistoricalGrantId = historicalId;
  state.httpHistoricalOwnerName = "student-b1";
  state.httpHistoricalRecipientName = "teacher-b";
  writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  writeFileSync(new URL("../deliverables/reports-integration-2026-10-28/http-verification.json", import.meta.url), JSON.stringify({
    date: "2026-10-28", scope: "Actual local HTTP server to actual local Auth, RPC and database", assertions,
    remoteProject: false, externalMail: false, constraintsDisabled: false, newDatabaseObjects: false,
    syntheticAccounts: 11, migrationCount: 57, historicalFixtureExplicit: true,
    coverage: ["bearer and method", "current self-pilot remains ineligible", "adult and guardian application gates", "server-owned UID and current teacher relationship", "cross-origin mutation", "idempotent create and revoke", "other roles and cross-school denial", "restricted ready aggregate", "consent withdrawal and no resurrection"],
  }, null, 2) + "\n");
  console.log(`isolated report HTTP acceptance passed: ${assertions} controlled assertions; actual local server/Auth/RPC, no remote project or mail`);
} catch (error) {
  console.error(`isolated report HTTP check failed: ${error instanceof Error ? error.message : "controlled failure"}`);
  process.exitCode = 1;
}
