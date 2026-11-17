import { expect, test } from "@playwright/test";
import { CONSENT_ACTOR, CONSENT_OTHER, consentRpcFixture } from "./fixtures/consent-rpc-transport";
const OP = "67000000-0000-4000-8000-000000000017";
const event = () => ({ id: OP, student_user_id: CONSENT_ACTOR, actor_user_id: CONSENT_ACTOR,
  event_type: "student_assented", age_band: "14_17", consent_basis: "student_self_pilot", policy_version: "2026-08-28" });
test("S06 UNKNOWN read requires this operation's own audit, preserves current withdrawn state, and never writes", async () => {
  const f = consentRpcFixture("withdrawn"); f.tables.student_consent_events.push(event()); const before = f.snapshot();
  const r = await f.request("GET", {}, true, { operationId: OP });
  expect(r.status).toBe(200); expect(r.body.consent).toMatchObject({ status: "withdrawn" });
  expect(r.body.verification).toMatchObject({ operationId: OP, event: { operationId: OP, studentUserId: CONSENT_ACTOR,
    actorUserId: CONSENT_ACTOR, action: "student_assent", ageBand: "14_17", consentBasis: "student_self_pilot", policyVersion: "2026-08-28" } });
  expect(f.mutations()).toEqual([]); expect(f.snapshot()).toBe(before);
});
test("S06 UNKNOWN an absent or another user's event is not evidence, even when current state is active", async () => {
  const f = consentRpcFixture("active");
  for (const owner of [null, CONSENT_OTHER]) {
    f.tables.student_consent_events = owner ? [{ ...event(), student_user_id: owner, actor_user_id: owner }] : [];
    const before = f.snapshot(); const r = await f.request("GET", {}, true, { operationId: OP });
    expect(r.status).toBe(200); expect(r.body.verification).toEqual({ operationId: OP, event: null });
    expect(f.snapshot()).toBe(before);
  }
  expect(f.mutations()).toEqual([]);
});
test("S06 UNKNOWN audit read errors cannot turn into a verified 200 snapshot", async () => {
  const f = consentRpcFixture("active"); f.faults.eventRead = true;
  const r = await f.request("GET", {}, true, { operationId: OP });
  expect(r.status).toBe(500); expect(r.body.verification).toBeUndefined(); expect(f.mutations()).toEqual([]);
});
test("S06 UNKNOWN malformed operation lookup refuses before audit query", async () => {
  const f = consentRpcFixture("active");
  for (const operationId of ["bad", [OP, OP]]) expect((await f.request("GET", {}, true, { operationId })).status).toBe(400);
  expect(f.calls.filter(c => c.table === "student_consent_events")).toEqual([]); expect(f.mutations()).toEqual([]);
});
