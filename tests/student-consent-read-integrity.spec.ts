import { expect, test, type Page } from "@playwright/test";
import { openTeacher, teacherState } from "./fixtures/account-consent-local-browser";
import en from "../locales/en.json";

async function replaceRead(page: Page, value: unknown) {
  await page.evaluate(value => {
    const original = window.fetch;
    window.fetch = async (input, init) => String(input) === "/api/account/consent" && (!init?.method || init.method === "GET")
      ? new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }) : original(input, init);
  }, value);
}
test("S06 invalid GET cannot become a confirmed Account consent snapshot", async ({ page }) => {
  const f = await openTeacher(page, { locale: "en", route: "helper", role: "学生", consentState: "active" });
  await expect(page.locator('[data-actor-probe="ready"]')).toBeVisible();
  await replaceRead(page, { role: "student", policyVersion: "2026-08-28", consent: null, children: [] });
  const result = await page.evaluate(async () => {
    const cloud = (window as unknown as { __teacher: { cloud: { getStudentConsentStatus: (id: string) => Promise<unknown> } } }).__teacher.cloud;
    try { await cloud.getStudentConsentStatus("00000000-0000-4000-8000-000000000011"); return "accepted"; }
    catch { return "unverified"; }
  });
  expect(result).toBe("unverified"); expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
});
test("S06 malformed inline read stays unavailable, never a usable non-student exemption", async ({ page }) => {
  const f = await openTeacher(page, { locale: "en", route: "messages", role: "学生", consentState: "active" });
  const card = page.getByTestId("inline-student-consent");
  await expect(card.getByText(en.inlineConsent.ready, { exact: true })).toBeVisible();
  await replaceRead(page, { role: "other", policyVersion: "obsolete", consent: null, children: [] });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card.getByRole("alert")).toHaveText(en.inlineConsent.loadFailed);
  expect((await teacherState(page)).operations).toHaveLength(0);
  expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
});
