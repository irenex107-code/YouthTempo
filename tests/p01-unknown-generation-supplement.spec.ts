import { expect, test, type Page } from "@playwright/test";
import en from "../locales/en.json";
import {
  controlTermination,
  openTermination,
  terminationState,
} from "./fixtures/support-termination-local-browser";

async function supportPosts(page: Page) {
  return (await terminationState(page)).calls.filter((call) =>
    call.path === "/api/support/cases" && call.method === "POST");
}

async function beginUnknown(page: Page, draft: string) {
  await expect(page.locator("article")).toHaveCount(3);
  await page.locator("form textarea").fill(draft);
  await page.locator("form button[type=submit]").click();
  const recovery = page.getByTestId("support-create-recovery");
  await expect(recovery).toContainText(en.supportFlow.portal.createUnknown);
  await expect(page.locator("form textarea")).toHaveValue(draft);
  await expect(page.locator("form button[type=submit]")).toBeDisabled();
  expect(await supportPosts(page)).toHaveLength(1);
  return recovery;
}

async function expectIsolated(page: Page, fixture: { network: string[]; errors: string[] }) {
  expect((await terminationState(page)).unexpected).toEqual([]);
  expect(fixture.network).toEqual([]);
  expect(fixture.errors).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
}

test("P01 UNKNOWN generation keeps the current recovery across same-account identity verification", async ({ page }) => {
  const fixture = await openTermination(page, { locale: "en", mode: "adult", createFailure: "offline" });
  const recovery = await beginUnknown(page, "Synthetic identity-generation request");

  await controlTermination(page, "set", "createFailure", undefined);
  await controlTermination(page, "set", "readFailure", 401);
  await recovery.getByRole("button", { name: en.supportFlow.portal.historyRetry, exact: true }).click();
  const identity = page.getByTestId("support-history-error");
  await expect(identity).toContainText(en.supportFlow.portal.historyIdentity);
  await expect(recovery).toBeVisible();
  expect(await supportPosts(page)).toHaveLength(1);

  await controlTermination(page, "set", "readFailure", 0);
  await identity.getByRole("button", { name: en.supportFlow.portal.historyVerify, exact: true }).click();
  await expect(page.locator("article")).toHaveCount(4);
  await expect(recovery).toBeVisible();
  await expect(page.locator("form textarea")).toHaveValue("Synthetic identity-generation request");
  await expect(page.locator("form button[type=submit]")).toBeDisabled();
  expect(await supportPosts(page)).toHaveLength(1);
  await expectIsolated(page, fixture);
});

test("P01 UNKNOWN generation retires stale consent recovery and lock without replaying an old read", async ({ page }) => {
  const fixture = await openTermination(page, { locale: "en", mode: "adult", createFailure: "offline" });
  await beginUnknown(page, "Synthetic consent-generation request");

  await controlTermination(page, "set", "createFailure", undefined);
  await controlTermination(page, "set", "marker", " | OLD GENERATION");
  await controlTermination(page, "set", "holdRead", true);
  await page.getByTestId("support-create-recovery")
    .getByRole("button", { name: en.supportFlow.portal.historyRetry, exact: true }).click();
  await expect.poll(async () => (await terminationState(page)).pending.includes("read")).toBe(true);

  await controlTermination(page, "consent", "withdrawn");
  await expect(page.getByTestId("support-create-recovery")).toHaveCount(0);
  await expect(page.locator("form")).toHaveCount(0);
  expect(await supportPosts(page)).toHaveLength(1);

  await controlTermination(page, "set", "marker", " | CURRENT GENERATION");
  await controlTermination(page, "set", "holdRead", false);
  await controlTermination(page, "consent", "active");
  await expect(page.locator("article")).toHaveCount(4);
  await controlTermination(page, "release", "read");
  await expect(page.locator("article").first()).toContainText("CURRENT GENERATION");
  expect((await page.locator("article").allTextContents()).join("\n")).not.toContain("OLD GENERATION");
  await expect(page.getByTestId("support-create-recovery")).toHaveCount(0);
  await expect(page.locator("form textarea")).toHaveValue("Synthetic consent-generation request");
  expect(await supportPosts(page)).toHaveLength(1);

  const submit = page.locator("form button[type=submit]");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator("#root")).toContainText(en.supportFlow.portal.submitted);
  expect(await supportPosts(page)).toHaveLength(2);
  await expectIsolated(page, fixture);
});
