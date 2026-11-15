import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { openSupport, controlSupport, supportState } from "./fixtures/support-history-local-browser";
const A = "00000000-0000-4000-8000-000000000011", B = "00000000-0000-4000-8000-000000000012";
async function shot(page: Page, name: string, project: string) {
  const dir = "audit-records/2026-11-03/product01_support_history/screenshots";
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${project}-${name}.png`, fullPage: true, animations: "disabled" });
}
async function history(page: Page, owner = "A") { await expect(page.locator("article")).toHaveCount(3); await expect(page.locator("article").first()).toContainText(`${owner} PRIVATE`); }
async function readonly(page: Page) {
  await expect(page.getByTestId("support-history-only")).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.locator("article button:enabled")).toHaveCount(0);
  await expect(page.locator("article textarea")).toHaveCount(0);
  await expect(page.getByTestId("micro-feedback")).toHaveCount(0);
}
for (const [locale, copy] of [["zh-CN", zh], ["en", en]] as const) {
  for (const mode of ["youth", "adult"] as const) for (const consent of ["active", "withdrawn", "error"] as const) {
    test(`UI ${locale} ${mode} ${consent} history and service separation`, async ({ page }, info) => {
      const f = await openSupport(page, { locale, mode, consent }); await history(page);
      await expect(page.locator("#support-immediate-help")).toBeVisible();
      if (consent !== "active") await readonly(page);
      else { await expect(page.locator("form")).toBeVisible(); await expect(page.locator("article button:enabled").first()).toBeVisible(); await expect(page.locator("article textarea")).toHaveCount(1); }
      await page.locator("article details").first().locator("summary").click();
      await expect(page.locator("article ol").first()).toContainText(copy.supportFlow.portal.eventLabels.requested);
      await shot(page, `${locale}-${mode}-${consent}`, info.project.name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.locator("html").getAttribute("lang")).toBe(locale);
      const state = await supportState(page); expect(state.calls.every((c) => c.method === "GET")).toBe(true);
      expect(state.unexpected).toEqual([]); expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
      expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    });
  }
  test(`UI ${locale} never-consented empty history preserves original first-use confirmation`, async ({ page }) => {
    await openSupport(page, { locale, consent: "not_started", empty: true });
    await expect(page.getByTestId("inline-student-consent")).toBeVisible();
    await expect(page.getByText(copy.supportFlow.portal.empty, { exact: true })).toBeVisible();
    expect((await supportState(page)).calls.every((c) => c.method === "GET")).toBe(true);
  });
  test(`UI ${locale} other historical type stays visible but service actions remain disabled`, async ({ page }) => {
    await openSupport(page, { locale, consent: "active", hold: "read" });
    await expect.poll(async () => (await supportState(page)).pending).toBeGreaterThan(0);
    await controlSupport(page, "set", "crossType", true); await controlSupport(page, "set", "hold", "");
    await controlSupport(page, "consent", "withdrawn"); await history(page);
    await controlSupport(page, "consent", "active"); await history(page);
    await expect(page.locator("form")).toBeVisible();
    await expect(page.locator("article button:enabled")).toHaveCount(0);
    await expect(page.locator("article textarea")).toHaveCount(0);
    await controlSupport(page, "release");
    await expect(page.locator("article button:enabled")).toHaveCount(0);
  });
  test(`UI ${locale} adult closed and empty history remain readonly`, async ({ page }, info) => {
    await openSupport(page, { locale, mode: "adult", adultClosed: true, consent: "active", empty: true });
    await expect(page.getByText(copy.supportFlow.portal.empty, { exact: true })).toBeVisible(); await readonly(page);
    await shot(page, `${locale}-adult-closed-empty`, info.project.name);
    expect((await supportState(page)).calls.every((c) => c.method === "GET")).toBe(true);
  });
  for (const readFailure of [401, 403, 503]) {
    test(`UI ${locale} read ${readFailure} clears old body and independently reloads`, async ({ page }, info) => {
      await openSupport(page, { locale, consent: "withdrawn" }); await history(page);
      await controlSupport(page, "set", "readFailure", readFailure);
      await controlSupport(page, "consent", "error");
      await expect(page.getByTestId("support-history-error")).toBeVisible(); await expect(page.locator("article")).toHaveCount(0);
      await shot(page, `${locale}-read-${readFailure}`, info.project.name);
      await controlSupport(page, "set", "readFailure", 0);
      await page.getByRole("button", { name: copy.supportFlow.portal.historyRetry, exact: true }).click();
      await history(page); await readonly(page);
      expect((await supportState(page)).calls.every((c) => c.method === "GET")).toBe(true);
    });
  }
  test(`UI ${locale} identity failure independently verifies, never asks assent`, async ({ page }, info) => {
    await openSupport(page, { locale, consent: "error", identityFailure: true });
    await expect(page.getByRole("button", { name: copy.supportFlow.portal.historyVerify, exact: true })).toBeVisible();
    await expect(page.locator("article")).toHaveCount(0);
    await shot(page, `${locale}-identity`, info.project.name);
    await controlSupport(page, "set", "identityFailure", false);
    await page.getByRole("button", { name: copy.supportFlow.portal.historyVerify, exact: true }).click();
    await history(page); await readonly(page);
  });
  test(`UI ${locale} identity lost after visible history clears private display`, async ({ page }) => {
    await openSupport(page, { locale, consent: "withdrawn" }); await history(page);
    await controlSupport(page, "sessionError", true);
    await expect(page.getByTestId("support-history-error")).toBeVisible(); await expect(page.locator("article")).toHaveCount(0);
    await controlSupport(page, "sessionError", false);
    await history(page); await readonly(page);
  });
  test(`UI ${locale} pre-withdrawal late GET cannot restore service actions`, async ({ page }) => {
    await openSupport(page, { locale, consent: "active", hold: "read" });
    await expect.poll(async () => (await supportState(page)).pending).toBeGreaterThan(0);
    await controlSupport(page, "set", "hold", ""); await controlSupport(page, "consent", "withdrawn");
    await history(page); await readonly(page); await controlSupport(page, "release");
    await readonly(page); expect((await supportState(page)).calls.every((c) => c.method === "GET")).toBe(true);
  });
  test(`UI ${locale} A-B-A and late GET cannot restore old data, signout clears`, async ({ page }) => {
    await openSupport(page, { locale, consent: "withdrawn", hold: "read" });
    await expect.poll(async () => (await supportState(page)).pending).toBeGreaterThan(0);
    await controlSupport(page, "actor", B); await history(page, "B");
    await expect(page.locator("article")).not.toContainText(["A PRIVATE", "A PRIVATE", "A PRIVATE"]);
    await controlSupport(page, "set", "hold", ""); await controlSupport(page, "set", "marker", "FRESH ");
    await controlSupport(page, "actor", A); await history(page); await expect(page.locator("article").first()).toContainText("FRESH");
    await controlSupport(page, "release"); await expect(page.locator("article").first()).toContainText("FRESH");
    await controlSupport(page, "actor", ""); await expect(page.locator("article")).toHaveCount(0);
    await expect(page.locator("#support-immediate-help")).toBeVisible();
  });
  test(`UI ${locale} signout with pending GET cannot restore private content`, async ({ page }) => {
    await openSupport(page, { locale, consent: "withdrawn", hold: "read" });
    await expect.poll(async () => (await supportState(page)).pending).toBeGreaterThan(0);
    await controlSupport(page, "actor", ""); await controlSupport(page, "release");
    await expect(page.locator("article")).toHaveCount(0); await expect(page.locator("form textarea")).toHaveCount(0);
    await expect(page.locator("article button:enabled")).toHaveCount(0);
  });
  test(`UI ${locale} original create urgent and feedback urgent sources remain`, async ({ page }, info) => {
    await openSupport(page, { locale, consent: "active" }); await history(page);
    await controlSupport(page, "set", "urgent", true);
    await page.locator("form textarea").fill("Synthetic request"); await page.locator("form button[type=submit]").click();
    await expect(page.locator("#support-immediate-help [role=alert]")).toBeVisible();
    await page.getByRole("button", { name: copy.supportFlow.portal.feedbackSubmit, exact: true }).click();
    await expect(page.locator('article a[href="#support-immediate-help"]')).toBeVisible();
    await shot(page, `${locale}-urgent`, info.project.name);
    await controlSupport(page, "actor", B); await history(page, "B");
    await expect(page.locator("#support-immediate-help [role=alert]")).toHaveCount(0);
  });
  test(`UI ${locale} late creation on withdrawal cannot restore urgent or new actions`, async ({ page }) => {
    await openSupport(page, { locale, consent: "active", hold: "write" }); await history(page);
    await controlSupport(page, "set", "urgent", true);
    await page.locator("form textarea").fill("Synthetic request"); await page.locator("form button[type=submit]").click();
    await expect.poll(async () => (await supportState(page)).pending).toBe(1);
    await controlSupport(page, "consent", "withdrawn"); await readonly(page);
    await controlSupport(page, "release"); await readonly(page);
    await expect(page.locator("#support-immediate-help [role=alert]")).toHaveCount(0);
    expect((await supportState(page)).calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
}
