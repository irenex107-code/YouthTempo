import { expect, test, type Page } from "@playwright/test";
import { openTeacher } from "./fixtures/account-consent-local-browser";
import type { StudentConsentResponse } from "../lib/cloudRecords";
import en from "../locales/en.json";

const OWNER = "00000000-0000-4000-8000-000000000011";
const REV = "2026-11-17T00:00:00.000001Z";
function snapshot(status = "withdrawn"): StudentConsentResponse {
  return { role: "student", policyVersion: "2026-08-28", children: [], consentRevision: REV,
    consent: { studentUserId: OWNER, studentName: "Synthetic A", ageBand: "14_17", consentBasis: "student_self_pilot",
      policyVersion: "2026-08-28", status: status as "withdrawn" | "active", studentAssentedAt: "2026-11-01T00:00:00Z",
      guardianUserId: null, guardianConsentedAt: null, withdrawnAt: status === "withdrawn" ? "2026-11-02T00:00:00Z" : null, hasLinkedGuardian: false } };
}
async function install(page: Page, mode: string, state = snapshot()) {
  await page.evaluate(({ mode, state }) => {
    const mock = { mode, state, eventConfirmed: false, posts: [] as Array<Record<string, unknown>> };
    Object.assign(window, { __s06: mock });
    const previous = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(String(input), "https://teacher-mock.invalid");
      if (url.pathname !== "/api/account/consent") return previous(input, init);
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (!init?.method || init.method === "GET") {
        const operationId = url.searchParams.get("operationId");
        if (!operationId) return reply(mock.state);
        return reply({ ...mock.state, verification: { operationId, event: mock.eventConfirmed ? {
          operationId, eventId: operationId, studentUserId: mock.state.consent!.studentUserId,
          actorUserId: mock.state.consent!.studentUserId, action: "student_assent", ageBand: "14_17",
          consentBasis: "student_self_pilot", policyVersion: "2026-08-28",
        } : null } });
      }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>; mock.posts.push(body);
      if (mock.mode === "error") return reply({ error: "PUBLIC_SYNTHETIC_AUDIT_FAILURE" }, 500);
      if (mock.mode === "conflict") return reply({ error: "public synthetic", writeOutcome: "not_committed" }, 409);
      if (mock.mode !== "replayed_changed") {
        if (init.method === "DELETE") Object.assign(mock.state.consent!, { status: "withdrawn", withdrawnAt: "2026-11-17T01:00:00Z" });
        else Object.assign(mock.state.consent!, { status: "active", withdrawnAt: null });
      }
      return reply({ ...mock.state, operation: { outcome: mock.mode === "replayed_changed" ? "replayed" : "applied",
        operationId: body.operationId, eventId: body.operationId, action: init.method === "DELETE" ? "withdraw" : "student_assent",
        studentUserId: mock.state.consent!.studentUserId, actorUserId: mock.state.consent!.studentUserId } });
    };
  }, { mode, state });
}

for (const mode of ["applied", "error", "conflict", "replayed_changed"]) {
  test(`S06 actual client ${mode}: frozen revision, receipt checks and one dispatch`, async ({ page }, info) => {
    const f = await openTeacher(page, { locale: "en", route: "helper", role: "学生", consentState: "active" });
    await expect(page.locator('[data-actor-probe="ready"]')).toBeVisible(); await install(page, mode);
    const result = await page.evaluate(async ({ owner, state }) => {
      const cloud = (window as unknown as { __teacher: { cloud: typeof import("../lib/cloudRecords") } }).__teacher.cloud;
      const intent = cloud.createConsentWriteIntent(state, owner); state.consentRevision = "2099-01-01T00:00:00Z";
      try { await cloud.submitStudentAssent("14_17", owner, { current: () => true, intent }); return { outcome: "success", frozen: Object.isFrozen(intent) }; }
      catch (e) { return { outcome: (e as { outcome: string }).outcome, reason: (e as { reason: string }).reason, frozen: Object.isFrozen(intent) }; }
    }, { owner: OWNER, state: snapshot() });
    expect(result.outcome).toBe(mode === "applied" ? "success" : mode === "conflict" ? "rejected" : "unknown");
    expect(result.frozen).toBe(true);
    const posts = await page.evaluate(() => (window as unknown as { __s06: { posts: Array<Record<string, unknown>> } }).__s06.posts);
    expect(posts).toHaveLength(1); expect(posts[0].expectedUpdatedAt).toBe(REV);
    expect(posts[0].operationId).toMatch(/^[0-9a-f-]{36}$/); expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
    await info.attach("public-client-contract", { body: JSON.stringify({ result, posts }), contentType: "application/json" });
  });
}
test("S06 no frozen intent refuses before any POST; no legacy client fallback", async ({ page }) => {
  const f = await openTeacher(page, { locale: "en", route: "helper", role: "学生", consentState: "active" });
  await expect(page.locator('[data-actor-probe="ready"]')).toBeVisible(); await install(page, "applied");
  const outcome = await page.evaluate(async owner => {
    const cloud = (window as unknown as { __teacher: { cloud: typeof import("../lib/cloudRecords") } }).__teacher.cloud;
    try { await cloud.submitStudentAssent("14_17", owner, { current: () => true }); return "success"; }
    catch (e) { return (e as { outcome: string }).outcome; }
  }, OWNER);
  expect(outcome).toBe("not_dispatched");
  expect(await page.evaluate(() => (window as unknown as { __s06: { posts: unknown[] } }).__s06.posts.length)).toBe(0);
  expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
});
test("S06 actual inline UI keeps UNKNOWN read-only; a later explicit intent gets a fresh ID/revision", async ({ page }) => {
  const f = await openTeacher(page, { locale: "en", route: "messages", role: "学生", consentState: "active" });
  const card = page.getByTestId("inline-student-consent"); await expect(card.getByText(en.inlineConsent.ready, { exact: true })).toBeVisible();
  await install(page, "error"); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await card.getByRole("combobox", { name: en.account.consent.ageRange, exact: true }).selectOption("14_17");
  await card.getByRole("checkbox").check(); await card.getByRole("button", { name: en.account.consent.completeStudent, exact: true }).click();
  await expect(card.getByRole("alert")).toHaveText(en.inlineConsent.submitUnknown);
  await page.evaluate(() => { const m = (window as unknown as { __s06: { mode: string; state: StudentConsentResponse; eventConfirmed: boolean } }).__s06;
    m.mode = "applied"; m.eventConfirmed = true; m.state.consentRevision = "2026-11-17T00:01:00.000001Z"; });
  await card.getByRole("button", { name: en.inlineConsent.checkStatus, exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __s06: { posts: unknown[] } }).__s06.posts.length)).toBe(1);
  await card.getByRole("checkbox").check(); await card.getByRole("button", { name: en.account.consent.completeStudent, exact: true }).click();
  await expect(card.getByText(en.inlineConsent.ready, { exact: true })).toBeVisible();
  const posts = await page.evaluate(() => (window as unknown as { __s06: { posts: Array<Record<string, unknown>> } }).__s06.posts);
  expect(posts).toHaveLength(2); expect(posts[0].operationId).not.toBe(posts[1].operationId);
  expect(posts.map(p => p.expectedUpdatedAt)).toEqual([REV, "2026-11-17T00:01:00.000001Z"]);
  expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
});
test("S06 actual Account withdrawal sends the visible snapshot revision to the single API path", async ({ page }) => {
  const f = await openTeacher(page, { locale: "en", route: "account", role: "学生", consentState: "active", consentReadFail: true });
  await expect(page.getByRole("button", { name: en.account.consent.retry, exact: true })).toBeVisible();
  await install(page, "applied", snapshot("active"));
  await page.getByRole("button", { name: en.account.consent.retry, exact: true }).click();
  await page.getByRole("button", { name: en.account.consent.withdraw, exact: true }).click();
  await expect.poll(async () => await page.evaluate(() => (window as unknown as { __s06: { posts: unknown[] } }).__s06.posts.length)).toBe(1);
  const post = await page.evaluate(() => (window as unknown as { __s06: { posts: Array<Record<string, unknown>> } }).__s06.posts[0]);
  expect(post.expectedUpdatedAt).toBe(REV); expect(post.operationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
});

test("S06 an intent from actor A cannot dispatch as actor B", async ({ page }) => {
  const f = await openTeacher(page, { locale: "en", route: "helper", role: "学生", consentState: "active" });
  await expect(page.locator('[data-actor-probe="ready"]')).toBeVisible(); await install(page, "applied");
  const result = await page.evaluate(async state => {
    const cloud = (window as unknown as { __teacher: { cloud: typeof import("../lib/cloudRecords") } }).__teacher.cloud;
    const intent = cloud.createConsentWriteIntent(state, "00000000-0000-4000-8000-000000000011");
    try { await cloud.submitStudentAssent("14_17", "00000000-0000-4000-8000-000000000012", { current: () => true, intent }); return "success"; }
    catch (e) { return (e as { outcome: string }).outcome; }
  }, snapshot());
  expect(result).toBe("not_dispatched");
  expect(await page.evaluate(() => (window as unknown as { __s06: { posts: unknown[] } }).__s06.posts.length)).toBe(0);
  expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
});
