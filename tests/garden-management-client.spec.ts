import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { openGarden, controlGarden, gardenState, type GardenOptions } from "./fixtures/garden-management-local-browser";

async function keepsakes(page: Page, copy: typeof zh | typeof en) {
  if ((await page.locator("[data-garden-options]").getAttribute("open")) === null) await page.locator("[data-garden-options] > summary").click();
  await page.getByRole("button", { name: copy.garden.keepsakes.open, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
const directory = "audit-records/2026-11-03/product01_garden_management/screenshots";
async function screenshot(page: Page, name: string, project: string) {
  await mkdir(directory, { recursive: true });
  await page.locator(".garden-scene img").evaluateAll(async (images) => { await Promise.all(images.map((image) => (image as HTMLImageElement).decode())); });
  await page.screenshot({ animations: "disabled", path: `${directory}/${project}-${name}.png`, fullPage: true });
}
async function noPrivateStorage(page: Page) {
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => !k.startsWith("youthtempo:garden:intro:v2:")))).toEqual([]);
}

for (const [locale, copy] of [["zh-CN", zh], ["en", en]] as const) {
  for (const consent of ["active", "withdrawn", "error"] as const) {
    test(`UI ${locale} ${consent} existing garden, own delete and new-use boundary`, async ({ page }, info) => {
      const f = await openGarden(page, { locale, consent });
      await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("7");
      if (consent !== "active") {
        await expect(page.getByTestId("garden-management-status")).toHaveText(copy.garden.management[consent === "withdrawn" ? "withdrawn" : "consentUnavailable"]);
        await expect(page.locator(".garden-action-dock")).toHaveCount(0);
        await expect(page.locator(".garden-hotspot")).toHaveCount(0);
        await expect(page.getByRole("button", { name: copy.garden.growth.viewPositions, exact: true })).toHaveCount(0);
      } else await expect(page.locator(".garden-action-dock")).toBeVisible();
      await screenshot(page, `${locale}-${consent}-garden`, info.project.name);
      await keepsakes(page, copy);
      if (consent !== "active") {
        await expect(page.getByRole("button", { name: copy.garden.keepsakes.types.flower, exact: true })).toHaveCount(0);
      } else await expect(page.getByRole("button", { name: copy.garden.keepsakes.types.flower, exact: true })).toBeEnabled();
      await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(1);
      await screenshot(page, `${locale}-${consent}-keepsakes`, info.project.name);
      await page.getByRole("button", { name: copy.garden.keepsakes.remove, exact: true }).click();
      await expect(page.getByText(copy.garden.keepsakes.removed, { exact: true })).toBeVisible();
      await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(0);
      await page.getByRole("button", { name: copy.garden.actions.close, exact: true }).click();
      if (consent !== "active") await expect(page.getByRole("combobox", { name: copy.garden.reminders.title })).toBeDisabled();
      else await expect(page.getByRole("combobox", { name: copy.garden.reminders.title })).toBeEnabled();
      await expect(page.getByRole("link", { name: copy.garden.support.help, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: copy.garden.support.urgent, exact: true })).toBeVisible();
      expect(await page.locator("html").getAttribute("lang")).toBe(locale);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const state = await gardenState(page); expect(state.deletes).toBe(1);
      expect(state.calls.filter((c) => c.method !== "GET")).toHaveLength(1);
      expect(state.unexpected).toEqual([]); expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
      await noPrivateStorage(page);
    });
  }
  test(`UI ${locale} empty withdrawn garden creates nothing`, async ({ page }, info) => {
    const f = await openGarden(page, { locale, consent: "withdrawn", empty: true });
    await expect(page.getByTestId("garden-management-empty")).toHaveText(copy.garden.management.empty);
    await expect(page.locator(".garden-scene")).toHaveCount(0);
    await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
    await screenshot(page, `${locale}-empty`, info.project.name);
    expect((await gardenState(page)).calls.every((c) => c.method === "GET")).toBe(true); expect(f.errors).toEqual([]);
  });
  for (const deletion of ["reject", "lost", "denied", "malformed"] as const) {
    test(`UI ${locale} delete ${deletion}: no false success or automatic repeat`, async ({ page }, info) => {
      await openGarden(page, { locale, consent: "withdrawn", deletion }); await keepsakes(page, copy);
      await page.getByRole("button", { name: copy.garden.keepsakes.remove, exact: true }).click();
      if (deletion === "lost" || deletion === "malformed") {
        await expect(page.getByText(copy.garden.management.deleteUnknown, { exact: true })).toBeVisible();
        await expect(page.getByTestId("inline-student-consent")).toHaveCount(0);
        await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
        await screenshot(page, `${locale}-delete-unknown`, info.project.name);
        expect((await gardenState(page)).deletes).toBe(1);
        await page.getByRole("button", { name: copy.garden.quick.refreshGarden, exact: true }).click();
        await expect(page.getByTestId("garden-management-status")).toBeVisible();
        await keepsakes(page, copy); await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(deletion === "lost" ? 0 : 1);
      } else if (deletion === "denied") {
        await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
        await expect(page.getByRole("dialog")).toHaveCount(0);
      } else {
        await expect(page.getByRole("alert")).toHaveText("Synthetic deletion rejected");
        await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(1);
      }
      await expect(page.getByText(copy.garden.keepsakes.removed, { exact: true })).toHaveCount(0);
      expect((await gardenState(page)).deletes).toBe(1);
    });
  }
  test(`UI ${locale} confirmed delete with read failure remains confirmed and refresh only`, async ({ page }) => {
    await openGarden(page, { locale, consent: "withdrawn" }); await keepsakes(page, copy);
    await controlGarden(page, "set", "readFailure", 503);
    await page.getByRole("button", { name: copy.garden.keepsakes.remove, exact: true }).click();
    await expect(page.getByText(copy.garden.management.deletedRefreshPending, { exact: true })).toBeVisible();
    await expect(page.getByTestId("inline-student-consent")).toHaveCount(0);
    await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
    await controlGarden(page, "set", "readFailure", 0);
    await page.getByTestId("garden-read-retry").click();
    await expect(page.getByTestId("garden-management-status")).toBeVisible();
    expect((await gardenState(page)).deletes).toBe(1);
  });
  for (const failure of ["identity", "read401", "read403", "read503"] as const) {
    test(`UI ${locale} ${failure} clears or refuses private display`, async ({ page }) => {
      const options: GardenOptions = { locale, consent: "withdrawn", identityFailure: failure === "identity" };
      if (failure.startsWith("read")) options.readFailure = Number(failure.slice(4));
      await openGarden(page, options);
      await expect(page.getByTestId(failure === "read503" ? "garden-read-unavailable" : failure === "read403" ? "garden-read-restricted" : "garden-read-identity")).toBeVisible();
      await expect(page.getByTestId("inline-student-consent")).toHaveCount(0);
      await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
      await expect(page.getByTestId("garden-management-status")).toHaveCount(0);
    });
  }
  for (const hold of ["read", "delete", "create"] as const) {
    test(`UI ${locale} held ${hold} + A→B→A and signout cannot replay old data`, async ({ page }) => {
      await openGarden(page, { locale, consent: hold === "create" ? "active" : "withdrawn", hold });
      if (hold !== "read") {
        await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("7");
        if (hold === "delete") { await keepsakes(page, copy); await page.getByRole("button", { name: copy.garden.keepsakes.remove, exact: true }).click(); }
        else {
          await page.getByRole("button", { name: copy.garden.actions.record, exact: true }).click();
          await page.getByRole("radio", { name: copy.garden.quick.heavy, exact: true }).check();
          await page.getByRole("button", { name: copy.garden.quick.submit, exact: true }).click();
        }
      }
      await expect.poll(async () => (await gardenState(page)).pending).toBe(1);
      await controlGarden(page, "setActor", "B");
      await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("2");
      const before = (await gardenState(page)).calls.length;
      await controlGarden(page, "set", "hold", "");
      await controlGarden(page, "changeGardenTotal", 15);
      await controlGarden(page, "setActor", "A");
      await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("15");
      const beforeRelease = (await gardenState(page)).calls.length;
      await controlGarden(page, "release");
      await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("15");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect((await gardenState(page)).calls.length).toBe(beforeRelease);
      expect(beforeRelease).toBeGreaterThan(before);
      await controlGarden(page, "setActor", "out");
      await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0); await noPrivateStorage(page);
    });
  }
  test(`UI ${locale} active→withdrawn→consent failure keeps only management`, async ({ page }) => {
    await openGarden(page, { locale, consent: "active" });
    await expect(page.locator(".garden-action-dock")).toBeVisible();
    await controlGarden(page, "setConsent", "withdrawn");
    await expect(page.getByTestId("garden-management-status")).toHaveText(copy.garden.management.withdrawn);
    await expect(page.locator(".garden-action-dock")).toHaveCount(0);
    await controlGarden(page, "setConsent", "error");
    await expect(page.getByTestId("garden-management-status")).toHaveText(copy.garden.management.consentUnavailable);
    await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("7");
  });
  for (const hold of ["read", "delete"] as const) {
    test(`UI ${locale} signout while ${hold} pending retires late result`, async ({ page }) => {
      await openGarden(page, { locale, consent: "withdrawn", hold });
      if (hold === "delete") {
        await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("7");
        await keepsakes(page, copy);
        await page.getByRole("button", { name: copy.garden.keepsakes.remove, exact: true }).click();
      }
      await expect.poll(async () => (await gardenState(page)).pending).toBe(1);
      await controlGarden(page, "setActor", "out");
      await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
      const before = (await gardenState(page)).calls.length;
      await controlGarden(page, "release");
      await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect((await gardenState(page)).calls.length).toBe(before);
      await noPrivateStorage(page);
    });
  }
  test(`UI ${locale} identity becomes unverified after display: old data is cleared`, async ({ page }) => {
    await openGarden(page, { locale, consent: "withdrawn" });
    await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("7");
    await controlGarden(page, "failIdentity");
    await expect(page.getByTestId("garden-read-identity")).toBeVisible();
    await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("garden-management-status")).toHaveCount(0);
    await noPrivateStorage(page);
  });
}

// PRODUCT-01/P01-13 same-batch correction. All evidence goes into a new
// directory; the prior 111 results, 32 images and failure history stay frozen.
const recoveryDirectory = process.env.GARDEN_RECOVERY_EVIDENCE_SCREENSHOTS || "audit-records/2026-11-03/product01_garden_management/recovery_correction_01/screenshots";
async function recoveryScreenshot(page: Page, name: string, project: string) {
  await mkdir(recoveryDirectory, { recursive: true });
  await page.locator(".garden-scene img").evaluateAll(async (images) => {
    await Promise.all(images.map((image) => (image as HTMLImageElement).decode()));
  });
  await page.screenshot({ animations: "disabled", path: `${recoveryDirectory}/${project}-${name}.png`, fullPage: true });
}
async function managementStillReadOnly(page: Page, copy: typeof zh | typeof en) {
  await expect(page.getByTestId("garden-management-status")).toBeVisible();
  await expect(page.locator(".garden-action-dock")).toHaveCount(0);
  await expect(page.locator(".garden-hotspot")).toHaveCount(0);
  await expect(page.getByTestId("inline-student-consent")).toHaveCount(0);
  await page.locator("[data-garden-options] > summary").click();
  await expect(page.getByRole("combobox", { name: copy.garden.reminders.title })).toBeDisabled();
  await expect(page.getByRole("button", { name: copy.garden.growth.viewPositions, exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await noPrivateStorage(page);
}

test.describe("Recovery correction", () => {
  for (const [locale, copy] of [["zh-CN", zh], ["en", en]] as const) {
    test(`${locale} first GET 503 retries independently without consent or writes`, async ({ page }, info) => {
      const f = await openGarden(page, { locale, consent: "withdrawn", readFailure: 503 });
      await expect(page.getByTestId("garden-read-unavailable")).toBeVisible();
      await expect(page.getByTestId("inline-student-consent")).toHaveCount(0);
      await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
      await recoveryScreenshot(page, `${locale}-initial-503`, info.project.name);
      const before = await gardenState(page);
      await controlGarden(page, "set", "readFailure", 0);
      await page.getByTestId("garden-read-retry").click();
      await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("7");
      await expect(page.getByTestId("garden-read-unavailable")).toHaveCount(0);
      await managementStillReadOnly(page, copy);
      const after = await gardenState(page);
      expect(after.reads).toBe(before.reads + 1); expect(after.identityReads).toBe(before.identityReads + 1);
      expect(after.calls.slice(before.calls.length)).toHaveLength(1);
      expect(after.calls.every((c) => c.method === "GET")).toBe(true);
      expect(after.unexpected).toEqual([]); expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
      await recoveryScreenshot(page, `${locale}-initial-503-recovered`, info.project.name);
    });

    test(`${locale} DELETE success then GET 403 recovers only after a fresh verified GET`, async ({ page }, info) => {
      const f = await openGarden(page, { locale, consent: "withdrawn" }); await keepsakes(page, copy);
      await controlGarden(page, "set", "readFailure", 403);
      await page.getByRole("button", { name: copy.garden.keepsakes.remove, exact: true }).click();
      await expect(page.getByText(copy.garden.management.deletedRefreshPending, { exact: true })).toBeVisible();
      await expect(page.getByTestId("garden-read-restricted")).toBeVisible();
      await expect(page.getByTestId("inline-student-consent")).toHaveCount(0);
      await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
      await recoveryScreenshot(page, `${locale}-deleted-get-403`, info.project.name);
      const before = await gardenState(page);
      await controlGarden(page, "set", "readFailure", 0);
      await controlGarden(page, "set", "hold", "read");
      await page.getByTestId("garden-read-retry").click();
      await expect.poll(async () => (await gardenState(page)).pending).toBe(1);
      await expect(page.getByTestId("garden-read-restricted")).toBeVisible();
      await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
      await controlGarden(page, "release");
      await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("7");
      await expect(page.getByTestId("garden-read-restricted")).toHaveCount(0);
      await expect(page.getByText(copy.garden.management.deletedRefreshPending, { exact: true })).toHaveCount(0);
      await expect(page.getByText(copy.garden.keepsakes.removed, { exact: true })).toBeVisible();
      await managementStillReadOnly(page, copy);
      await page.getByRole("button", { name: copy.garden.keepsakes.open, exact: true }).click();
      await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(0);
      const after = await gardenState(page); expect(after.deletes).toBe(1); expect(after.reads).toBe(before.reads + 1);
      expect(after.identityReads).toBe(before.identityReads + 1);
      expect(after.calls.filter((c) => c.method !== "GET")).toHaveLength(1);
      expect(after.unexpected).toEqual([]); expect(f.network).toEqual([]); expect(f.errors).toEqual([]);
      await recoveryScreenshot(page, `${locale}-deleted-get-403-recovered`, info.project.name);
    });
  }
});

test.describe("Recovery correction result and identity boundaries", () => {
  for (const [locale, copy] of [["zh-CN", zh], ["en", en]] as const) {
    test(`${locale} DELETE success then GET 401 preserves deletion and requires identity recovery`, async ({ page }, info) => {
      const f = await openGarden(page, { locale, consent: "withdrawn" }); await keepsakes(page, copy);
      await controlGarden(page, "set", "readFailure", 401);
      await page.getByRole("button", { name: copy.garden.keepsakes.remove, exact: true }).click();
      await expect(page.getByTestId("garden-read-identity")).toBeVisible();
      await expect(page.getByText(copy.garden.management.deletedRefreshPending, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.garden.management.deleteUnknown, { exact: true })).toHaveCount(0);
      await expect(page.getByTestId("inline-student-consent")).toHaveCount(0);
      await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
      await expect(page.getByTestId("garden-read-identity").getByRole("link")).toHaveAttribute("href", `${locale === "en" ? "/en" : ""}/account`);
      await recoveryScreenshot(page, `${locale}-deleted-get-401`, info.project.name);
      const before = await gardenState(page);
      // Local actor state alone is insufficient: a fresh identity failure must
      // stop before another garden GET and must retain the confirmed outcome.
      await controlGarden(page, "set", "identityFailure", true);
      await controlGarden(page, "set", "readFailure", 0);
      await page.getByTestId("garden-identity-retry").click();
      await expect(page.getByTestId("garden-identity-retry")).toBeEnabled();
      await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
      await expect(page.getByText(copy.garden.management.deletedRefreshPending, { exact: true })).toBeVisible();
      expect((await gardenState(page)).reads).toBe(before.reads);
      await controlGarden(page, "set", "identityFailure", false);
      await page.getByTestId("garden-identity-retry").click();
      await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("7");
      await expect(page.getByTestId("garden-read-identity")).toHaveCount(0);
      await expect(page.getByText(copy.garden.keepsakes.removed, { exact: true })).toBeVisible();
      await managementStillReadOnly(page, copy);
      const after = await gardenState(page); expect(after.deletes).toBe(1);
      expect(after.reads).toBe(before.reads + 1); expect(after.identityReads).toBe(before.identityReads + 2);
      expect(after.calls.filter((c) => c.method !== "GET")).toHaveLength(1);
      expect(f.errors).toEqual([]); expect(f.network).toEqual([]); expect(after.unexpected).toEqual([]);
      await recoveryScreenshot(page, `${locale}-deleted-get-401-recovered`, info.project.name);
    });
    for (const deletion of ["lost", "malformed"] as const) {
      test(`${locale} ${deletion} stays unknown through GET 503 and never repeats DELETE`, async ({ page }, info) => {
        const f = await openGarden(page, { locale, consent: "withdrawn", deletion }); await keepsakes(page, copy);
        await page.getByRole("button", { name: copy.garden.keepsakes.remove, exact: true }).click();
        await expect(page.getByText(copy.garden.management.deleteUnknown, { exact: true })).toBeVisible();
        await controlGarden(page, "set", "readFailure", 503);
        await page.getByRole("button", { name: copy.garden.quick.refreshGarden, exact: true }).click();
        await expect(page.getByTestId("garden-read-unavailable")).toBeVisible();
        await expect(page.getByText(copy.garden.management.deleteUnknown, { exact: true })).toBeVisible();
        await expect(page.getByText(copy.garden.management.deletedRefreshPending, { exact: true })).toHaveCount(0);
        await expect(page.getByTestId("inline-student-consent")).toHaveCount(0);
        await recoveryScreenshot(page, `${locale}-unknown-${deletion}-503`, info.project.name);
        await controlGarden(page, "set", "readFailure", 0);
        await page.getByTestId("garden-read-retry").click();
        await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("7");
        await expect(page.getByText(copy.garden.keepsakes.removed, { exact: true })).toHaveCount(0);
        await managementStillReadOnly(page, copy);
        await page.getByRole("button", { name: copy.garden.keepsakes.open, exact: true }).click();
        await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(deletion === "lost" ? 0 : 1);
        const state = await gardenState(page); expect(state.deletes).toBe(1);
        expect(state.calls.filter((c) => c.method !== "GET")).toHaveLength(1);
        expect(f.errors).toEqual([]); expect(f.network).toEqual([]); expect(state.unexpected).toEqual([]);
      });
    }
    for (const next of ["B", "out"] as const) {
      test(`${locale} initial 503 retry late 403 after ${next} cannot restore or clear another actor`, async ({ page }) => {
        const f = await openGarden(page, { locale, consent: "withdrawn", readFailure: 503 });
        await expect(page.getByTestId("garden-read-unavailable")).toBeVisible();
        await controlGarden(page, "set", "readFailure", 403);
        await controlGarden(page, "set", "hold", "read");
        await page.getByTestId("garden-read-retry").click();
        await expect.poll(async () => (await gardenState(page)).pending).toBe(1);
        await controlGarden(page, "set", "readFailure", 0);
        await controlGarden(page, "setActor", next);
        if (next === "B") await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("2");
        else await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
        const before = await gardenState(page);
        await controlGarden(page, "release");
        if (next === "B") {
          await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("2");
          await expect(page.getByTestId("garden-read-restricted")).toHaveCount(0);
        } else await expect(page.locator(".garden-fact-grid")).toHaveCount(0);
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const after = await gardenState(page); expect(after.calls.length).toBe(before.calls.length);
        expect(after.calls.every((c) => c.method === "GET")).toBe(true);
        expect(f.errors).toEqual([]); expect(f.network).toEqual([]); expect(after.unexpected).toEqual([]);
        await noPrivateStorage(page);
      });
    }
  }
});
