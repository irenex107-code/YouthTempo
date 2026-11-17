import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { CONSENT_ACTOR, CONSENT_OTHER, CONSENT_DIAGNOSTIC, consentRpcFixture } from "./fixtures/consent-rpc-transport";

const OP = "60000000-0000-4000-8000-000000000117";
const revision = "2026-11-02T00:00:00.000Z";
const body = (expectedUpdatedAt: string | null = revision) => ({ action: "student_assent", ageBand: "14_17", operationId: OP, expectedUpdatedAt });

for (const scenario of ["first_assent", "withdrawal", "reassent"] as const) {
  test(`S06 ${scenario}: RPC audit-error response cannot succeed or fall back to table writes (synthetic)`, async ({}, info) => {
    const initial = scenario === "first_assent" ? undefined : scenario === "withdrawal" ? "active" : "withdrawn";
    const f = consentRpcFixture(initial); f.faults.rpcError = true;
    const before = f.snapshot();
    const result = await f.request(scenario === "withdrawal" ? "DELETE" : "POST", body(initial ? revision : null));
    expect(result.status).toBe(500); expect(JSON.stringify(result.body)).not.toContain(CONSENT_DIAGNOSTIC);
    expect(f.mutations()).toHaveLength(1); expect(f.mutations()[0].table).toBe("rpc/apply_student_consent");
    expect(f.snapshot()).toBe(before);
    await info.attach("synthetic-RPC-error-contract-NOT-SQL", { body: JSON.stringify({ result, calls: f.calls, before, after: f.snapshot() }), contentType: "application/json" });
  });
}
test("S06 unavailable RPC has no old two-request fallback", async () => {
  const f = consentRpcFixture(); f.faults.missingRpc = true;
  expect((await f.request("POST", body(null))).status).toBe(500);
  expect(f.mutations()).toHaveLength(1); expect(f.tables.student_consents).toHaveLength(0);
});
test("S06 new caller contracts: first, withdraw and re-assent each issue one RPC with server-owned identity", async () => {
  const f = consentRpcFixture();
  expect((await f.request("GET")).body.consentRevision).toBeNull();
  const first = await f.request("POST", { ...body(null), actorUserId: CONSENT_ACTOR, role: "管理员" });
  expect(first.status).toBe(200); expect(first.body.operation).toMatchObject({ outcome: "applied", operationId: OP, studentUserId: CONSENT_ACTOR });
  expect(f.mutations()[0].body).toMatchObject({ p_actor_user_id: CONSENT_ACTOR, p_student_user_id: CONSENT_ACTOR, p_expected_updated_at: null });
  const withdrawn = await f.request("DELETE", { operationId: "60000000-0000-4000-8000-000000000118", expectedUpdatedAt: first.body.consentRevision });
  expect(withdrawn.status).toBe(200); expect(withdrawn.body.consent).toMatchObject({ status: "withdrawn" });
  const again = await f.request("POST", { ...body(withdrawn.body.consentRevision as string), operationId: "60000000-0000-4000-8000-000000000119", ageBand: "18_plus" });
  expect(again.status).toBe(200); expect(again.body.consent).toMatchObject({ status: "active", consentBasis: "adult_self", withdrawnAt: null });
  expect(f.mutations()).toHaveLength(3); expect(f.tables.student_consent_events).toHaveLength(3);
});
for (const [outcome, code] of [["denied", 403], ["invalid", 400], ["not_found", 404], ["conflict", 409], ["operation_mismatch", 409]] as const) {
  test(`S06 explicit ${outcome} RPC contract is a non-committed ${code}`, async () => {
    const f = consentRpcFixture("active"); f.faults.outcome = outcome; const before = f.snapshot();
    const result = await f.request("POST", body());
    expect(result.status).toBe(code); expect(result.body.writeOutcome).toBe("not_committed");
    expect(f.snapshot()).toBe(before); expect(f.mutations()).toHaveLength(1);
  });
}
test("S06 unauthenticated, forged cross-user, missing revision and closed guardian requests never call RPC", async () => {
  const f = consentRpcFixture("active");
  expect((await f.request("POST", body(), false)).status).toBe(401);
  for (const method of ["POST", "DELETE"] as const) expect((await f.request(method, { ...body(), studentUserId: CONSENT_OTHER })).status).toBe(403);
  expect((await f.request("POST", { action: "student_assent", ageBand: "14_17", operationId: OP })).status).toBe(400);
  expect((await f.request("POST", { action: "guardian_consent", studentUserId: CONSENT_ACTOR })).status).toBe(403);
  expect(f.mutations()).toHaveLength(0);
});
test("S06 replay receipt describes the old intent while the current withdrawn snapshot stays withdrawn", async () => {
  const f = consentRpcFixture("withdrawn"); f.faults.outcome = "replayed"; const before = f.snapshot();
  const result = await f.request("POST", body());
  expect(result.status).toBe(200); expect(result.body.operation).toMatchObject({ outcome: "replayed", eventId: OP });
  expect(result.body.consent).toMatchObject({ status: "withdrawn" }); expect(f.snapshot()).toBe(before);
});
test("S06 commit receipt followed by read failure is UNKNOWN-safe 500, never a second write", async () => {
  const f = consentRpcFixture("withdrawn"); f.faults.finalRead = true;
  expect((await f.request("POST", body())).status).toBe(500);
  expect(f.mutations()).toHaveLength(1); expect(f.tables.student_consent_events).toHaveLength(1);
});
test("S06 SQL source has one invoker function and scoped execution ACL, not an executed atomicity/RLS test", () => {
  const sql = readFileSync("supabase/migrations/20261116183058_student_consent_atomic_rpc.sql", "utf8");
  const clean = sql.replace(/--[^\n]*/g, "");
  expect(clean.match(/create function/gi)).toHaveLength(1);
  expect(clean).toContain("security invoker\nset search_path = ''");
  expect(clean).not.toMatch(/security definer|alter table|create policy|alter default privileges|exception\s+when/i);
  expect(clean).toContain("current_user <> 'service_role'");
  expect(clean).toContain("p_actor_user_id is distinct from p_student_user_id");
  expect(clean.indexOf("pg_advisory_xact_lock")).toBeLessThan(clean.indexOf("for update"));
  expect(clean).toContain("p_expected_updated_at is distinct from v_consent.updated_at");
  expect(clean).toContain("v_consent.updated_at + interval '1 microsecond'");
  expect(clean).toContain("from public, anon, authenticated");
  expect(clean).toContain("to service_role");
  const api = readFileSync("pages/api/account/consent.ts", "utf8");
  expect(api).toContain('supabase.rpc("apply_student_consent"');
  expect(api).not.toMatch(/\.from\("(?:student_consents|student_consent_events)"\)\s*\.(?:upsert|update|insert|delete)\(/);
  expect(readFileSync("supabase/schema.sql", "utf8").endsWith(sql)).toBe(true);
});
