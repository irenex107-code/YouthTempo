import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { controlGarden, gardenState, openGarden } from "./fixtures/garden-copy-local-browser";

async function pendingCount(page: Page) {
  return page.evaluate(() => (window as unknown as { __gardenCopy: { pending: () => number } }).__gardenCopy.pending());
}

async function capture(page: Page, info: TestInfo, label: string) {
  const directory = path.join(process.env.YT_COPY_ARTIFACTS || info.outputDir, info.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${label}.png`) });
}

for (const [locale, copy] of [["zh-CN", zh], ["en", en]] as const) {
  const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
  const feedback = (page: Page) => page.getByRole("region", { name: copy.garden.growth.savedTitle, exact: true });
  const dock = (page: Page) => page.getByRole("navigation", { name: copy.garden.actions.ariaLabel, exact: true });
  const invitation = (page: Page) => page.getByTestId("garden-care-invitation");
  async function submit(page: Page) {
    await button(page, copy.garden.actions.record).click();
    await page.getByRole("radio", { name: copy.garden.quick.heavy, exact: true }).check();
    await button(page, copy.garden.quick.submit).click();
  }
  async function water(page: Page) {
    await button(page, copy.garden.actions.care).click();
    await button(page, `${copy.garden.care.options.water.title} ${copy.garden.care.options.water.description}`).click();
  }
  async function noNewActions(page: Page) {
    await expect(invitation(page)).toHaveCount(0);
    await expect(dock(page)).toHaveCount(0);
  }
  async function safe(page: Page, observed: { network: string[]; errors: string[] }) {
    expect(observed.network).toEqual([]);
    expect(observed.errors).toEqual([]);
    expect((await gardenState(page)).unexpected).toEqual([]);
  }

  for (const consent of ["withdrawn", "error"] as const) {
    test(`${locale} presentation guard ${consent} cannot gain invitation or new actions`, async ({ page }, info) => {
      const observed = await openGarden(page, { locale, consent, total: 7 });
      await expect(page.getByTestId("garden-management-status")).toBeVisible();
      await noNewActions(page);
      await expect(feedback(page)).toHaveCount(0);
      expect((await gardenState(page)).calls.filter((call) => call.method !== "GET")).toEqual([]);
      await capture(page, info, `${locale}-${consent}`);
      await safe(page, observed);
    });
  }

  test(`${locale} presentation guard confirmed record and failed read retains saved meaning; GET recovery stays on page`, async ({ page }, info) => {
    const observed = await openGarden(page, { locale, total: 2, todayParticipated: false, readFailures: 1 });
    await submit(page);
    await expect(page.getByText(copy.garden.quick.savedRefreshPending, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.garden.quick.saveUnconfirmed, { exact: true })).toHaveCount(0);
    await noNewActions(page);
    await expect(feedback(page)).toHaveCount(0);
    await capture(page, info, `${locale}-confirmed-read-pending`);
    await button(page, copy.garden.quick.refreshGarden).click();
    await expect(feedback(page).getByText(copy.garden.growth.milestones.leaves, { exact: true })).toBeVisible();
    await expect(feedback(page).getByText(copy.garden.growth.sameDay, { exact: true })).toHaveCount(0);
    await expect(invitation(page)).toHaveText(copy.garden.care.available);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const state = await gardenState(page);
    expect(state.calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(state.calls.filter((call) => call.path === "/api/garden" && call.method === "GET")).toHaveLength(3);
    await safe(page, observed);
  });

  test(`${locale} presentation guard unknown record blocks invitation and re-read never invents this-record growth`, async ({ page }, info) => {
    const observed = await openGarden(page, { locale, total: 2, todayParticipated: false, recordFailure: "lost" });
    await submit(page);
    await expect(page.getByText(copy.garden.quick.saveUnconfirmed, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.garden.quick.saved, { exact: true })).toHaveCount(0);
    await noNewActions(page);
    await capture(page, info, `${locale}-unknown-record`);
    await button(page, copy.garden.quick.refreshGarden).click();
    await expect(page.getByText(copy.garden.quick.refreshedUnconfirmed, { exact: true })).toBeVisible();
    await expect(feedback(page)).toHaveCount(0);
    await expect(page.getByText(copy.garden.growth.milestones.leaves, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await gardenState(page)).calls.filter((call) => call.method === "POST")).toHaveLength(1);
    await safe(page, observed);
  });

  test(`${locale} presentation guard auxiliary unknown remains locked through GET until explicit acknowledgment`, async ({ page }, info) => {
    const observed = await openGarden(page, { locale, total: 28, auxFailure: "lost" });
    await expect(invitation(page)).toHaveText(copy.garden.care.available);
    await water(page);
    await expect(page.getByTestId("garden-aux-recovery")).toContainText(copy.garden.auxiliary.unknown);
    await noNewActions(page);
    await capture(page, info, `${locale}-aux-unknown-lock`);
    await page.getByTestId("garden-aux-read").click();
    await expect(page.getByTestId("garden-aux-ack")).toBeVisible();
    await expect(page.getByTestId("garden-aux-recovery")).toContainText(copy.garden.auxiliary.refreshed);
    await noNewActions(page);
    await page.getByTestId("garden-aux-ack").click();
    await expect(dock(page)).toBeVisible();
    await expect(invitation(page)).toHaveCount(0);
    await button(page, copy.garden.actions.care).click();
    for (const choice of await page.getByRole("dialog").locator(".garden-care-choice").all()) await expect(choice).toBeDisabled();
    expect((await gardenState(page)).calls.filter((call) => call.path === "/api/garden/care")).toHaveLength(1);
    await safe(page, observed);
  });

  test(`${locale} presentation guard auxiliary pending hides invitation and disables care without a second POST`, async ({ page }) => {
    const observed = await openGarden(page, { locale, total: 28, auxHold: true });
    await water(page);
    await expect.poll(() => pendingCount(page)).toBe(1);
    await noNewActions(page);
    for (const choice of await page.getByRole("dialog").locator(".garden-care-choice").all()) await expect(choice).toBeDisabled();
    await controlGarden(page, "release");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(invitation(page)).toHaveCount(0);
    expect((await gardenState(page)).calls.filter((call) => call.path === "/api/garden/care")).toHaveLength(1);
    await safe(page, observed);
  });

  test(`${locale} presentation guard identity failure removes invitation and private result`, async ({ page }) => {
    // Exercise the page's independent getUser verification, rather than a
    // same-account focus event that intentionally keeps the current metadata.
    const observed = await openGarden(page, { locale, total: 7, identityFailure: true });
    await expect(page.getByTestId("garden-read-identity")).toBeVisible();
    await noNewActions(page);
    await expect(feedback(page)).toHaveCount(0);
    expect((await gardenState(page)).calls.filter((call) => call.method !== "GET")).toEqual([]);
    await safe(page, observed);
  });

  test(`${locale} presentation guard late old POST cannot restore results or invitation after account switch`, async ({ page }) => {
    const observed = await openGarden(page, { locale, total: 2, todayParticipated: false, holdRecord: true });
    await submit(page);
    await expect.poll(() => pendingCount(page)).toBe(1);
    await controlGarden(page, "setActor", "B");
    await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("0");
    await expect(invitation(page)).toHaveCount(0);
    await controlGarden(page, "release");
    await expect(feedback(page)).toHaveCount(0);
    await expect(invitation(page)).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const calls = (await gardenState(page)).calls;
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls.filter((call) => call.path === "/api/garden" && call.method === "GET")).toHaveLength(2);
    await safe(page, observed);
  });

  test(`${locale} presentation guard late saved refresh cannot restore data after sign-out`, async ({ page }) => {
    const observed = await openGarden(page, { locale, total: 2, todayParticipated: false, holdRefresh: true });
    await submit(page);
    await expect.poll(() => pendingCount(page)).toBe(1);
    await controlGarden(page, "setActor", "");
    await expect(dock(page)).toHaveCount(0);
    await controlGarden(page, "release");
    await noNewActions(page);
    await expect(feedback(page)).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await gardenState(page)).calls.filter((call) => call.method === "POST")).toHaveLength(1);
    await safe(page, observed);
  });

  test(`${locale} presentation guard consent withdrawal retires a held record result`, async ({ page }) => {
    const observed = await openGarden(page, { locale, total: 2, todayParticipated: false, holdRecord: true });
    await submit(page);
    await expect.poll(() => pendingCount(page)).toBe(1);
    await controlGarden(page, "setConsent", "withdrawn");
    await expect(page.getByTestId("garden-management-status")).toBeVisible();
    await noNewActions(page);
    await controlGarden(page, "release");
    await expect(feedback(page)).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await noNewActions(page);
    expect((await gardenState(page)).calls.filter((call) => call.method === "POST")).toHaveLength(1);
    await safe(page, observed);
  });
}
