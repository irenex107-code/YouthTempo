import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import fixture from "./fixtures/permission-boundary.json";
import protectedProjects from "./fixtures/protected-supabase-projects.json";

// Destructive only to the existing disposable guardianOne fixture. The guarded
// runner must reset the virtual-school fixture before this AND the next suite.
const enabled = process.env.E2E_ISOLATED_INLINE_ROLE_LIFECYCLE === "true";
const databaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const password = process.env.E2E_PERMISSION_TEST_PASSWORD || "";
type Actor = { client: SupabaseClient; session: Session; id: string };
type JsonObject = Record<string, unknown>;

test.describe.configure({ mode: "serial" });
test.skip(!enabled, "Requires the explicitly enabled disposable local lifecycle runner.");

function object(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function localOrigin(value: string, port: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Explicit disposable loopback origin is required"); }
  expect(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port === port
    && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash,
  "Only this batch's exact disposable loopback origin is allowed").toBe(true);
  expect(!Object.values(protectedProjects).includes(url.hostname.split(".")[0]),
    "Production and registered recovery projects are forbidden").toBe(true);
  return url.origin;
}
function guardedFetch(origin: string): typeof fetch {
  return async (input, init) => {
    try {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.origin !== origin) throw new Error("origin rejected");
      return await fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
    } catch {
      // Never retain a cause or a Request: those can contain the real test JWT,
      // password or receipt. No Playwright request fixture is used in this file.
      throw new Error("Disposable local HTTP transport failed; request details withheld");
    }
  };
}
function client(origin: string, key: string) {
  return createClient(origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: guardedFetch(origin) },
  });
}
async function signIn(name: "guardianOne" | "studentOne", origin: string): Promise<Actor> {
  expect(fixture.users[name].email.endsWith("@youthtempo.test"), "Only existing virtual-school accounts are allowed").toBe(true);
  const current = client(origin, anonKey);
  const result = await current.auth.signInWithPassword({ email: fixture.users[name].email, password });
  if (result.error || !result.data.session || !result.data.user
    || result.data.user.email !== fixture.users[name].email) {
    throw new Error("Existing disposable fixture password sign-in failed; details withheld");
  }
  return { client: current, session: result.data.session, id: result.data.user.id };
}
async function api(origin: string, path: "/api/account/data" | "/api/account/deletion-status", method: "DELETE" | "POST", body: unknown, session?: Session) {
  try {
    const response = await guardedFetch(origin)(new URL(path, origin), {
      method, headers: { "content-type": "application/json",
        ...(session ? { authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json() as unknown };
  } catch { throw new Error("Disposable account API request failed; response and request details withheld"); }
}
async function consentSnapshot(admin: SupabaseClient, studentId: string) {
  const result = await admin.from("student_consents").select("*").eq("student_user_id", studentId).maybeSingle();
  if (result.error || !result.data) throw new Error("Disposable student consent lookup failed; details withheld");
  return result.data as JsonObject;
}
async function auditById(admin: SupabaseClient, id: string) {
  const result = await admin.from("account_deletion_audits").select("*").eq("id", id).maybeSingle();
  if (result.error) throw new Error("Disposable audit lookup failed; details withheld");
  return result.data as JsonObject | null;
}
function minimalState(body: unknown, expected: "completed" | "unknown") {
  // Only booleans reach matchers: a buggy response must not cause a reporter to
  // serialize any unexpected secret, email, private body or provider error.
  expect(object(body) && body.state === expected && Object.keys(body).length === 1,
    "Receipt status exposes only the expected minimal state").toBe(true);
}

test("真实本机guardian注销后凭回执查询，错误能力和B账号均不能改写原申请", async ({ baseURL }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Run this fixed-account destructive HTTP flow once in desktop-chromium after fixture reset.");
  test.setTimeout(180_000);
  const databaseOrigin = localOrigin(databaseUrl, "56321");
  const appOrigin = localOrigin(baseURL || "", "3270");
  expect(process.env.ALLOW_E2E_FIXTURE_MUTATION === "true" && Boolean(anonKey && serviceKey && password),
    "Explicit disposable fixture mutation authorization and credentials are required").toBe(true);
  expect(testInfo.config.workers === 1 && testInfo.project.retries === 0 && testInfo.retry === 0,
    "This fixed-account destructive suite requires one worker and no retries").toBe(true);
  const trace = testInfo.project.use.trace;
  expect(trace === "off" || (typeof trace === "object" && trace?.mode === "off"),
    "Real credentials and receipt capabilities require runner trace=off").toBe(true);
  testInfo.annotations.push({ type: "scope", description: "Deletes only existing virtual guardianOne; reset fixture before every following suite. No accounts or active guardian relationships are created." });

  const admin = client(databaseOrigin, serviceKey);
  const receipt = { operationId: randomUUID(), secret: randomBytes(32).toString("base64url") };
  let guardian: Actor | undefined;
  let student: Actor | undefined;
  let guardianAbsent = false;
  let auditMayExist = false;
  try {
    guardian = await signIn("guardianOne", databaseOrigin);
    student = await signIn("studentOne", databaseOrigin);
    const subjectId = guardian.id;
    const studentId = student.id;
    expect(subjectId !== studentId, "A and B must be distinct existing fixture users").toBe(true);
    const beforeConsent = await consentSnapshot(admin, studentId);
    expect(beforeConsent.status === "active" && beforeConsent.consent_basis === "student_self_pilot"
      && beforeConsent.guardian_user_id === null,
    "The runner must reset the standard self-pilot fixture; this suite does not activate guardian consent").toBe(true);
    const consentFingerprint = hash(JSON.stringify(beforeConsent));
    expect((await auditById(admin, receipt.operationId)) === null, "The operation must be new before any destructive request").toBe(true);

    const deleted = await test.step("原A经实际账户API注销，确认Auth明确404而非未知故障", async () => {
      auditMayExist = true;
      const result = await api(appOrigin, "/api/account/data", "DELETE", {
        confirmationEmail: fixture.users.guardianOne.email, acknowledge: true, receipt,
      }, guardian!.session);
      expect(result.status).toBe(200);
      expect(object(result.body) && result.body.deleted === true && result.body.cleanupPending !== true,
        "The actual API must finish deletion and cleanup").toBe(true);
      const absent = await admin.auth.admin.getUserById(subjectId);
      guardianAbsent = absent.data.user === null && absent.error?.status === 404 && absent.error.code === "user_not_found";
      expect(guardianAbsent, "Only Auth 404/user_not_found proves the original UUID is absent").toBe(true);
      return result;
    });
    expect(Boolean(deleted.cacheControl?.includes("no-store")), "Deletion responses must not be cached").toBe(true);

    await test.step("原Auth已消失，无Bearer仍可查询completed，audit只有摘要和能力hash", async () => {
      const status = await api(appOrigin, "/api/account/deletion-status", "POST", { subjectUserId: subjectId, ...receipt });
      expect(status.status).toBe(200);
      minimalState(status.body, "completed");
      expect(Boolean(status.cacheControl?.includes("no-store")), "Capability status must not be cached").toBe(true);
      const audit = await auditById(admin, receipt.operationId);
      if (!audit) throw new Error("Only this operation's expected audit is missing");
      const summary = object(audit.deletion_summary) ? audit.deletion_summary : null;
      const metadata = summary && object(summary.receipt) ? summary.receipt : null;
      expect(audit.subject_hash === hash(subjectId) && audit.email_hash === hash(fixture.users.guardianOne.email)
        && audit.status === "completed" && typeof audit.completed_at === "string" && Number.isFinite(Date.parse(audit.completed_at))
        && typeof audit.expires_at === "string" && Date.parse(audit.expires_at) > Date.now(),
      "Audit subject/email are hashes and completion has a real timestamp").toBe(true);
      expect(metadata !== null && metadata.secretHash === hash(receipt.secret) && typeof metadata.expiresAt === "string"
        && Date.parse(metadata.expiresAt) > Date.now() && Date.parse(metadata.expiresAt) <= Date.now() + 86_400_000
        && Object.keys(metadata).every((key) => ["version", "secretHash", "expiresAt", "attemptId", "leaseUntil"].includes(key)),
      "Only hashed receipt capability and bounded expiry/attempt metadata are retained").toBe(true);
      const serialized = JSON.stringify(audit);
      expect([receipt.secret, subjectId, studentId, fixture.users.guardianOne.email, password, serviceKey, anonKey,
        guardian!.session.access_token, guardian!.session.refresh_token, student!.session.access_token]
        .every((value) => !serialized.includes(value)), "Audit contains no raw receipt, email or session credentials").toBe(true);
    });

    await test.step("错误secret、subject或operation只得unknown，能力不能代替DELETE认证", async () => {
      for (const body of [
        { subjectUserId: subjectId, ...receipt, secret: randomBytes(32).toString("base64url") },
        { subjectUserId: studentId, ...receipt },
        { subjectUserId: subjectId, ...receipt, operationId: randomUUID() },
      ]) {
        const response = await api(appOrigin, "/api/account/deletion-status", "POST", body);
        expect(response.status).toBe(200);
        minimalState(response.body, "unknown");
      }
      const unauthenticated = await api(appOrigin, "/api/account/data", "DELETE", {
        confirmationEmail: fixture.users.guardianOne.email, acknowledge: true, receipt,
      });
      expect(unauthenticated.status).toBe(401);
    });

    await test.step("B可只读核对A，但不能把A的已完成operation改写为B注销", async () => {
      const auditBefore = await auditById(admin, receipt.operationId);
      const status = await api(appOrigin, "/api/account/deletion-status", "POST", { subjectUserId: subjectId, ...receipt }, student!.session);
      expect(status.status).toBe(200);
      minimalState(status.body, "completed");
      const attempt = await api(appOrigin, "/api/account/data", "DELETE", {
        confirmationEmail: fixture.users.studentOne.email, acknowledge: true, receipt,
      }, student!.session);
      expect(attempt.status).toBe(409);
      const bAuth = await student!.client.auth.getUser();
      expect(!bAuth.error && bAuth.data.user?.id === studentId,
        "B's original authenticated session remains valid after receipt reads and rejected reuse").toBe(true);
      const afterConsent = await consentSnapshot(admin, studentId);
      expect(hash(JSON.stringify(afterConsent)) === consentFingerprint,
        "B's self-pilot consent remains unchanged after deleting A and rejecting B's operation reuse").toBe(true);
      const auditAfter = await auditById(admin, receipt.operationId);
      expect(auditBefore !== null && auditAfter !== null && hash(JSON.stringify(auditBefore)) === hash(JSON.stringify(auditAfter)),
        "A's completed audit is not overwritten or downgraded by B").toBe(true);
    });
  } finally {
    let cleanupFailed = false;
    if (auditMayExist) {
      try {
        const removed = await admin.from("account_deletion_audits").delete().eq("id", receipt.operationId);
        cleanupFailed = Boolean(removed.error) || (await auditById(admin, receipt.operationId)) !== null;
      } catch { cleanupFailed = true; }
    }
    for (const actor of [student, guardianAbsent ? undefined : guardian]) {
      if (!actor) continue;
      try {
        const result = await actor.client.auth.signOut({ scope: "local" });
        if (result.error) cleanupFailed = true;
      } catch { cleanupFailed = true; }
    }
    expect(!cleanupFailed, "Cleanup is limited to this generated audit ID and this test's newly issued local sessions").toBe(true);
  }
});
