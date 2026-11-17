import { expect, test, type Page } from "@playwright/test";
import { openTeacher } from "./fixtures/account-consent-local-browser";
import en from "../locales/en.json";
import zh from "../locales/zh-CN.json";
export const OWNER = "00000000-0000-4000-8000-000000000011";
export async function installUnknown(page: Page, initial: "not_started" | "active" | "withdrawn", eventMode = "absent") {
  await page.evaluate(({ initial, eventMode }) => {
    const owner = "00000000-0000-4000-8000-000000000011";
    const state = { posts: [] as Record<string, unknown>[], reads: [] as string[], eventMode, responseMode: "truncate",
      holds: [] as Array<() => void>,
      snapshot: { role: "student", policyVersion: "2026-08-28", children: [], consentRevision: initial === "not_started" ? null : "2026-11-17T01:00:00.000001Z",
        consent: { studentUserId: owner, studentName: "PUBLIC SYNTHETIC", ageBand: initial === "not_started" ? null : "14_17",
          consentBasis: initial === "not_started" ? null : "student_self_pilot", policyVersion: "2026-08-28", status: initial,
          studentAssentedAt: initial === "not_started" ? null : "2026-11-17T00:00:00Z", guardianUserId: null, guardianConsentedAt: null,
          withdrawnAt: initial === "withdrawn" ? "2026-11-17T01:00:00Z" : null, hasLinkedGuardian: false } } };
    Object.assign(window, { __s06Unknown: state }); const previous = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(String(input), "https://teacher-mock.invalid");
      if (url.pathname !== "/api/account/consent") return previous(input, init);
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (!init?.method || init.method === "GET") {
        state.reads.push(url.search);
        if (url.searchParams.has("operationId")) {
          if (state.eventMode === "error") return reply({ error: "PUBLIC SYNTHETIC" }, 503);
          const operationId = url.searchParams.get("operationId"); const post = state.posts.find(x => x.operationId === operationId);
          const event = state.eventMode !== "absent" && post ? { operationId, eventId: operationId, studentUserId: owner, actorUserId: owner,
            action: post.action || "withdraw", ageBand: "14_17", consentBasis: "student_self_pilot", policyVersion: "2026-08-28" } : null;
          return reply({ ...state.snapshot, verification: { operationId, event } });
        }
        return reply(state.snapshot);
      }
      const body = JSON.parse(String(init.body)); state.posts.push(body);
      Object.assign(state.snapshot, { consentRevision: "2026-11-17T02:00:00.000001Z" });
      Object.assign(state.snapshot.consent, { status: init.method === "DELETE" ? "withdrawn" : "active", ageBand: "14_17", consentBasis: "student_self_pilot",
        studentAssentedAt: "2026-11-17T00:00:00Z", withdrawnAt: init.method === "DELETE" ? "2026-11-17T02:00:00Z" : null });
      if (state.responseMode === "hold") {
        const result = { ...JSON.parse(JSON.stringify(state.snapshot)), operation: { outcome: "applied",
          operationId: body.operationId, eventId: body.operationId, action: init.method === "DELETE" ? "withdraw" : "student_assent",
          studentUserId: owner, actorUserId: owner } };
        return new Promise<Response>(resolve => state.holds.push(() => resolve(reply(result))));
      }
      // Public synthetic commit then invalid response; real commit proof belongs to the isolated run.
      return new Response('{"truncated":', { status: 200, headers: { "content-type": "application/json" } });
    };
  }, { initial, eventMode });
}
test("S06 UNKNOWN Account cannot release a committed-withdrawal lock from a current snapshot without its event", async ({ page }) => {
  const f = await openTeacher(page, { locale: "en", route: "account", role: "学生", consentState: "active", consentReadFail: true });
  await expect(page.getByRole("button", { name: en.account.consent.retry, exact: true })).toBeVisible();
  await installUnknown(page, "active"); await page.getByRole("button", { name: en.account.consent.retry, exact: true }).click();
  await page.getByRole("button", { name: en.account.consent.withdraw, exact: true }).click();
  const card = page.locator('[data-account-write-recovery="withdraw"]'); await expect(card).toBeVisible();
  await card.getByRole("button", { name: en.account.writeRecovery.check, exact: true }).click();
  await expect(card).toBeVisible(); await expect(card.getByRole("button", { name: en.account.writeRecovery.release, exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __s06Unknown: { posts: unknown[] } }).__s06Unknown.posts.length)).toBe(1);
  expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
});

async function account(page: Page, initial: "not_started" | "active" | "withdrawn", locale: "en" | "zh-CN" = "en", eventMode = "match") {
  const dict = locale === "en" ? en : zh;
  const f = await openTeacher(page, { locale, route: "account", role: "学生", consentState: "active", consentReadFail: true });
  await expect(page.getByRole("button", { name: dict.account.consent.retry, exact: true })).toBeVisible();
  await installUnknown(page, initial, eventMode);
  await page.getByRole("button", { name: dict.account.consent.retry, exact: true }).click();
  return { f, dict };
}
async function submit(page: Page, action: "assent" | "withdraw", dict = en) {
  if (action === "withdraw") await page.getByRole("button", { name: dict.account.consent.withdraw, exact: true }).click();
  else {
    await page.getByRole("combobox", { name: dict.account.consent.ageRange, exact: true }).selectOption("14_17");
    await page.getByRole("checkbox", { name: dict.account.consent.acknowledgement, exact: true }).check();
    await page.getByRole("button", { name: dict.account.consent.completeStudent, exact: true }).click();
  }
}
async function posts(page: Page) {
  return page.evaluate(() => (window as unknown as { __s06Unknown: { posts: Record<string, unknown>[] } }).__s06Unknown.posts);
}
for (const locale of ["en", "zh-CN"] as const) for (const initial of ["not_started", "active", "withdrawn"] as const) {
  test(`S06 UNKNOWN ${locale} Account ${initial}: lost response, own audit recovery, explicit release with no resend`, async ({ page }) => {
    const { f, dict } = await account(page, initial, locale);
    const action = initial === "active" ? "withdraw" : "assent";
    await submit(page, action, dict);
    const card = page.locator(`[data-account-write-recovery="${action}"]`); await expect(card).toBeVisible();
    await expect(card.getByRole("alert")).toHaveText(dict.account.writeRecovery.unknown);
    await expect(page.getByText(action === "withdraw" ? dict.account.errors.consentWithdrawFailed : dict.account.errors.studentAssentFailed, { exact: true })).toHaveCount(0);
    expect(await posts(page)).toHaveLength(1);
    await card.getByRole("button", { name: dict.account.writeRecovery.check, exact: true }).click();
    await expect(card.getByRole("alert")).toHaveText(dict.account.writeRecovery.consentVerified);
    expect(await posts(page)).toHaveLength(1);
    const reads = await page.evaluate(() => (window as unknown as { __s06Unknown: { reads: string[] } }).__s06Unknown.reads);
    const operationId = (await posts(page))[0].operationId;
    expect(reads.some(q => q.includes(String(operationId)))).toBe(true);
    await card.getByRole("button", { name: dict.account.writeRecovery.consentRelease, exact: true }).click();
    await expect(card).toHaveCount(0); expect(await posts(page)).toHaveLength(1);
    expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
  });
}
test("S06 UNKNOWN matching historical assent audit cannot restore active, and later explicit intent gets a new ID/revision", async ({ page }) => {
  await account(page, "not_started"); await submit(page, "assent");
  const card = page.locator('[data-account-write-recovery="assent"]'); await expect(card).toBeVisible();
  await page.evaluate(() => { const s = (window as unknown as { __s06Unknown: { snapshot: { consentRevision: string; consent: Record<string, unknown> } } }).__s06Unknown;
    s.snapshot.consentRevision = "2026-11-17T03:00:00.000001Z"; Object.assign(s.snapshot.consent, { status: "withdrawn", withdrawnAt: "2026-11-17T03:00:00Z" }); });
  await card.getByRole("button", { name: en.account.writeRecovery.check, exact: true }).click();
  await expect(card.getByRole("alert")).toHaveText(en.account.writeRecovery.consentVerified);
  await expect(page.getByRole("button", { name: en.account.consent.withdraw, exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: en.account.writeRecovery.consentRelease, exact: true }).click();
  expect(await posts(page)).toHaveLength(1);
  await submit(page, "assent");
  const p = await posts(page); expect(p).toHaveLength(2); expect(p[1].operationId).not.toBe(p[0].operationId);
  expect(p[1].expectedUpdatedAt).toBe("2026-11-17T03:00:00.000001Z");
});
test("S06 UNKNOWN late complete response after a consent generation change cannot restore state or release its hold", async ({ page }) => {
  await account(page, "not_started");
  await page.evaluate(() => { (window as unknown as { __s06Unknown: { responseMode: string } }).__s06Unknown.responseMode = "hold"; });
  await submit(page, "assent"); await expect.poll(async () => (await posts(page)).length).toBe(1);
  await page.evaluate(() => { const s = (window as unknown as { __s06Unknown: { snapshot: { consentRevision: string; consent: Record<string, unknown> } } }).__s06Unknown;
    s.snapshot.consentRevision = "2026-11-17T03:00:00.000001Z"; Object.assign(s.snapshot.consent, { status: "withdrawn", withdrawnAt: "2026-11-17T03:00:00Z" });
    window.dispatchEvent(new Event("youthtempo:consent-updated")); });
  const card = page.locator('[data-account-write-recovery="assent"]'); await expect(card).toBeVisible();
  await page.evaluate(() => (window as unknown as { __s06Unknown: { holds: Array<() => void> } }).__s06Unknown.holds.shift()!());
  await expect(card).toBeVisible(); await expect(card.getByRole("button", { name: en.account.writeRecovery.consentRelease, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.account.consent.completeStudent, exact: true })).toBeDisabled();
  expect(await posts(page)).toHaveLength(1);
});
test("S06 UNKNOWN audit verification failure retains the Account hold and never marks not committed", async ({ page }) => {
  await account(page, "active", "en", "error"); await submit(page, "withdraw");
  const card = page.locator('[data-account-write-recovery="withdraw"]'); await expect(card).toBeVisible();
  await card.getByRole("button", { name: en.account.writeRecovery.check, exact: true }).click();
  await expect(card.getByText(en.account.writeRecovery.checkFailed, { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: en.account.writeRecovery.consentRelease, exact: true })).toHaveCount(0);
  expect(await posts(page)).toHaveLength(1);
});
test("S06 UNKNOWN inline only an explicit matching audit check settles its pending intent", async ({ page }) => {
  const f = await openTeacher(page, { locale: "en", route: "messages", role: "学生", consentState: "active" });
  const card = page.getByTestId("inline-student-consent"); await expect(card.getByText(en.inlineConsent.ready, { exact: true })).toBeVisible();
  await installUnknown(page, "withdrawn", "error"); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await card.getByRole("combobox").selectOption("14_17"); await card.getByRole("checkbox").check();
  await card.getByRole("button", { name: en.account.consent.completeStudent, exact: true }).click();
  await expect(card.getByRole("alert")).toHaveText(en.inlineConsent.submitUnknown);
  await card.getByRole("button", { name: en.inlineConsent.checkStatus, exact: true }).click();
  await expect(card.getByRole("alert")).toHaveText(en.inlineConsent.submitUnknown); expect(await posts(page)).toHaveLength(1);
  await page.evaluate(() => { (window as unknown as { __s06Unknown: { eventMode: string } }).__s06Unknown.eventMode = "match"; });
  await card.getByRole("button", { name: en.inlineConsent.checkStatus, exact: true }).click();
  await expect(card.getByText(en.inlineConsent.ready, { exact: true })).toBeVisible(); expect(await posts(page)).toHaveLength(1);
  expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
});
test("S06 UNKNOWN Account A/B/A keeps the original intent locked and ignores its late complete response", async ({ page }) => {
  const { f } = await account(page, "not_started");
  await page.evaluate(() => { (window as unknown as { __s06Unknown: { responseMode: string } }).__s06Unknown.responseMode = "hold"; });
  await submit(page, "assent"); await expect.poll(async () => (await posts(page)).length).toBe(1);
  await page.evaluate(() => (window as unknown as { __teacher: { actor: (id: string) => void } }).__teacher.actor("00000000-0000-4000-8000-000000000012"));
  await expect.poll(() => page.locator("input").evaluateAll(inputs => inputs.some(input => input instanceof HTMLInputElement && input.value === "Synthetic B"))).toBe(true);
  await expect(page.locator('[data-account-write-recovery="assent"]')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __teacher: { actor: (id: string) => void } }).__teacher.actor("00000000-0000-4000-8000-000000000011"));
  const card = page.locator('[data-account-write-recovery="assent"]'); await expect(card).toBeVisible();
  await page.evaluate(() => (window as unknown as { __s06Unknown: { holds: Array<() => void> } }).__s06Unknown.holds.shift()!());
  await expect(card).toBeVisible(); await expect(card.getByRole("button", { name: en.account.writeRecovery.consentRelease, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.account.consent.withdraw, exact: true })).toBeDisabled();
  expect(await posts(page)).toHaveLength(1); expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
});
test("S06 UNKNOWN actual verifier rejects foreign, different-action and mismatched historical receipts", async ({ page }) => {
  const f = await openTeacher(page, { locale: "en", route: "helper", role: "学生", consentState: "active" });
  await expect(page.locator('[data-actor-probe="ready"]')).toBeVisible(); await installUnknown(page, "withdrawn", "match");
  const answers = await page.evaluate(() => {
    const g = window as unknown as { __teacher: { cloud: typeof import("../lib/cloudRecords") }; __s06Unknown: { snapshot: import("../lib/cloudRecords").StudentConsentResponse } };
    const intent = g.__teacher.cloud.createConsentWriteIntent(g.__s06Unknown.snapshot, "00000000-0000-4000-8000-000000000011");
    const event = { operationId: intent.operationId, eventId: intent.operationId, studentUserId: intent.ownerUserId, actorUserId: intent.ownerUserId,
      action: "student_assent" as const, ageBand: "14_17" as const, consentBasis: "student_self_pilot" as const, policyVersion: "2026-08-28" };
    const value = { ...g.__s06Unknown.snapshot, verification: { operationId: intent.operationId, event } };
    return [g.__teacher.cloud.isVerifiedConsentOperation(value, intent, "student_assent", "14_17"), ...[
      { operationId: "67000000-0000-4000-8000-000000000099" }, { eventId: "67000000-0000-4000-8000-000000000099" },
      { actorUserId: "00000000-0000-4000-8000-000000000012" }, { studentUserId: "00000000-0000-4000-8000-000000000012" },
      { action: "withdraw" }, { ageBand: "18_plus" }, { consentBasis: "adult_self" }, { policyVersion: "old" },
    ].map(patch => g.__teacher.cloud.isVerifiedConsentOperation({ ...value, verification: { ...value.verification, event: { ...event, ...patch } } }, intent, "student_assent", "14_17"))];
  });
  expect(answers).toEqual([true, false, false, false, false, false, false, false, false]);
  expect(await posts(page)).toHaveLength(0); expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
});
test("S06 UNKNOWN inline background refresh cannot settle a commit from active state alone", async ({ page }) => {
  const f = await openTeacher(page, { locale: "en", route: "messages", role: "学生", consentState: "active" });
  const card = page.getByTestId("inline-student-consent"); await expect(card.getByText(en.inlineConsent.ready, { exact: true })).toBeVisible();
  await installUnknown(page, "withdrawn"); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await card.getByRole("combobox").selectOption("14_17"); await card.getByRole("checkbox").check();
  await card.getByRole("button", { name: en.account.consent.completeStudent, exact: true }).click();
  await expect(card.getByRole("alert")).toHaveText(en.inlineConsent.submitUnknown);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card.getByRole("alert")).toHaveText(en.inlineConsent.submitUnknown);
  expect(await page.evaluate(() => (window as unknown as { __s06Unknown: { posts: unknown[] } }).__s06Unknown.posts.length)).toBe(1);
  expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
});
