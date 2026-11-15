import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import type { ReportDimension } from "../lib/reports/types";

const previewEnabled = process.env.E2E_REPORTS_PREVIEW === "true";

async function guardPreviewRequests(page: Page) {
  const blocked: string[] = [];
  const globalReads: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").origin;
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/auth/v1/")) {
      // A fresh visitor context needs no account reads. Keep global-navbar reads
      // separate from preview behavior if the shared layout attempts one.
      if (request.method() === "GET" && ["/api/account/status", "/auth/v1/user"].includes(url.pathname)) {
        globalReads.push(url.pathname);
      } else blocked.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    if (url.origin !== origin) {
      blocked.push(`external ${url.origin}`);
      return route.abort();
    }
    return route.continue();
  });
  return { blocked, globalReads, pageErrors };
}

async function storageSnapshot(page: Page) {
  return page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
}

function formatInstant(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Shanghai", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

for (const [prefix, locale, dictionary] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  const copy = dictionary.reportsPreview;
  const report = (page: Page) => page.getByRole("region", { name: copy.report.title, exact: true });
  const settings = (page: Page, recipient: "guardian" | "teacher") => page.getByRole("region", { name: copy.viewers[recipient], exact: true });
  async function view(page: Page, viewer: "self" | "guardian" | "teacher") {
    await report(page).getByRole("group", { name: copy.viewerLabel }).getByRole("button", { name: copy.viewers[viewer], exact: true }).click();
  }
  async function enable(page: Page, recipient: "guardian" | "teacher", dimensions: ReportDimension[]) {
    const card = settings(page, recipient);
    for (const dimension of dimensions) await card.getByRole("checkbox", { name: copy.dimensions[dimension], exact: true }).check();
    await expect(card.getByRole("button", { name: copy.sharing.enable, exact: true })).toBeDisabled();
    await card.getByRole("checkbox", { name: copy.sharing.confirm, exact: true }).check();
    await card.getByRole("button", { name: copy.sharing.enable, exact: true }).click();
  }

  test(`${locale} 报告预览默认关闭，查询及浏览器标记不能开启`, async ({ page }) => {
    test.skip(previewEnabled, "This run explicitly enables the nonproduction preview.");
    const requests = await guardPreviewRequests(page);
    await page.addInitScript(() => localStorage.setItem("youthtempo:reports-preview", "true"));
    const response = await page.goto(`${prefix}/reports-preview?preview=true&enabled=true`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: copy.title })).toHaveCount(0);
    expect(requests.blocked).toEqual([]);
    expect(requests.pageErrors).toEqual([]);
  });

  test(`${locale} 接收版分别确认、按维度过滤、分别关闭且不写入真实服务`, async ({ page }, testInfo) => {
    test.skip(!previewEnabled, "The preview must be explicitly enabled in a nonproduction server.");
    const requests = await guardPreviewRequests(page);
    await page.goto(`${prefix}/reports-preview`);
    await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
    await expect(page.getByText(copy.notice, { exact: true })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const before = await storageSnapshot(page);
    for (const recipient of ["guardian", "teacher"] as const) {
      const card = settings(page, recipient);
      await expect(card.getByRole("checkbox", { name: copy.sharing.confirm, exact: true })).not.toBeChecked();
      await expect(card.getByRole("button", { name: copy.sharing.enable, exact: true })).toBeDisabled();
      await expect(card.getByText(copy.sharing.schedule, { exact: true })).toBeVisible();
      await expect(card.getByText(copy.sharing.window
        .replace("{{start}}", formatInstant("2026-10-05T16:00:00Z", locale))
        .replace("{{end}}", formatInstant("2026-11-04T16:00:00Z", locale)), { exact: true })).toBeVisible();
    }
    await expect(report(page).locator("[data-report-dimension]")).toHaveCount(5);
    await expect(report(page).getByText(copy.report.period
      .replace("{{start}}", formatInstant("2026-10-19T16:00:00Z", locale))
      .replace("{{end}}", formatInstant("2026-10-26T16:00:00Z", locale)), { exact: true })).toBeVisible();
    await view(page, "guardian");
    await expect(report(page).getByText(copy.states.notEnabled, { exact: true })).toBeVisible();
    await enable(page, "guardian", ["sleep", "eat"]);
    await expect(report(page).locator("[data-report-dimension]")).toHaveCount(2);
    await expect(report(page).locator('[data-report-dimension="sleep"]')).toBeVisible();
    await expect(report(page).locator('[data-report-dimension="eat"]')).toBeVisible();
    await expect(report(page).locator('[data-report-dimension="wake"]')).toHaveCount(0);
    await expect(report(page).getByText(copy.report.mixed, { exact: true })).toBeVisible();
    await expect(report(page)).not.toContainText("sleep_good");
    await view(page, "teacher");
    await expect(report(page).getByText(copy.states.notEnabled, { exact: true })).toBeVisible();
    await enable(page, "teacher", ["wake"]);
    await expect(report(page).locator("[data-report-dimension]")).toHaveCount(1);
    await expect(report(page).locator('[data-report-dimension="wake"]')).toBeVisible();
    if (process.env.YOUTHTEMPO_CAPTURE_REPORT_PREVIEW === "true") {
      const destination = path.join(process.cwd(), "deliverables/reports-preview-2026-10-27");
      await mkdir(destination, { recursive: true });
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.screenshot({ path: path.join(destination, `${locale}-${testInfo.project.name}.png`), fullPage: true });
    }
    await settings(page, "guardian").getByRole("button", { name: copy.sharing.revoke, exact: true }).click();
    await view(page, "guardian");
    await expect(report(page).getByText(copy.states.notEnabled, { exact: true })).toBeVisible();
    await expect(report(page).locator("[data-report-dimension]")).toHaveCount(0);
    await view(page, "teacher");
    await expect(report(page).locator('[data-report-dimension="wake"]')).toBeVisible();
    await settings(page, "teacher").getByRole("button", { name: copy.sharing.revoke, exact: true }).click();
    await expect(report(page).getByText(copy.states.notEnabled, { exact: true })).toBeVisible();
    await view(page, "self");
    await expect(report(page).locator("[data-report-dimension]")).toHaveCount(5);
    expect(await storageSnapshot(page)).toEqual(before);
    expect(requests.blocked).toEqual([]);
    expect(requests.pageErrors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });

  test(`${locale} 等待、资料不足、到期、关系未核验与失败重试准确展示`, async ({ page }) => {
    test.skip(!previewEnabled, "The preview must be explicitly enabled in a nonproduction server.");
    const requests = await guardPreviewRequests(page);
    await page.goto(`${prefix}/reports-preview`);
    const scenario = page.getByRole("combobox", { name: copy.scenarioLabel, exact: true });
    await scenario.selectOption("waiting");
    await enable(page, "teacher", ["sleep"]);
    await view(page, "teacher");
    await expect(report(page).getByText(copy.states.waiting, { exact: true })).toBeVisible();
    await expect(report(page).locator("[data-report-dimension]")).toHaveCount(0);
    await scenario.selectOption("insufficient");
    await enable(page, "teacher", ["sleep"]);
    await view(page, "teacher");
    await expect(report(page).getByText(copy.report.insufficient, { exact: true })).toBeVisible();
    await expect(report(page).getByText(copy.report.comparison.different, { exact: true })).toHaveCount(0);
    await scenario.selectOption("expired");
    await expect(settings(page, "guardian").getByRole("button", { name: copy.sharing.enable })).toBeDisabled();
    await expect(settings(page, "teacher").getByRole("button", { name: copy.sharing.enable })).toBeDisabled();
    await view(page, "teacher");
    await expect(report(page).getByText(copy.states.expired, { exact: true })).toBeVisible();
    await expect(report(page).locator("[data-report-dimension]")).toHaveCount(0);
    await view(page, "self");
    await expect(report(page).locator("[data-report-dimension]")).toHaveCount(5);
    await scenario.selectOption("guardianUnverified");
    await expect(settings(page, "guardian").getByRole("checkbox", { name: copy.sharing.confirm })).toBeDisabled();
    await view(page, "guardian");
    await expect(report(page).getByText(copy.states.unverified, { exact: true })).toBeVisible();
    await enable(page, "teacher", ["sleep"]);
    await view(page, "teacher");
    await expect(report(page).locator('[data-report-dimension="sleep"]')).toBeVisible();
    await scenario.selectOption("readFailure");
    await expect(report(page).getByRole("alert")).toHaveText(copy.states.readFailure);
    await expect(report(page).locator("[data-report-dimension]")).toHaveCount(0);
    await report(page).getByRole("button", { name: copy.retry, exact: true }).click();
    await expect(report(page).locator("[data-report-dimension]")).toHaveCount(5);
    await page.reload();
    await expect(scenario).toHaveValue("ready");
    await view(page, "teacher");
    await expect(report(page).getByText(copy.states.notEnabled, { exact: true })).toBeVisible();
    await expect(settings(page, "teacher").getByRole("checkbox", { name: copy.sharing.confirm })).not.toBeChecked();
    expect(requests.blocked).toEqual([]);
    expect(requests.pageErrors).toEqual([]);
  });
}

test("报告预览键盘操作、语言Cookie与刷新重置", async ({ page, context }, testInfo) => {
  test.skip(!previewEnabled, "The preview must be explicitly enabled in a nonproduction server.");
  const requests = await guardPreviewRequests(page);
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/reports-preview");
  const card = page.getByRole("region", { name: zh.reportsPreview.viewers.teacher, exact: true });
  const firstDimension = card.getByRole("checkbox", { name: zh.reportsPreview.dimensions.sleep, exact: true });
  await firstDimension.focus();
  await page.keyboard.press("Space");
  await expect(firstDimension).toBeChecked();
  const confirmation = card.getByRole("checkbox", { name: zh.reportsPreview.sharing.confirm, exact: true });
  await confirmation.focus();
  await page.keyboard.press("Space");
  await expect(confirmation).toBeChecked();
  await card.getByRole("button", { name: zh.reportsPreview.sharing.enable, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(card.getByText(zh.reportsPreview.sharing.enabled, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/reports-preview$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect((await context.cookies()).find((cookie) => cookie.name === "NEXT_LOCALE")?.value).toBe("en");
  await expect(page.getByRole("heading", { level: 1, name: en.reportsPreview.title })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.reload();
  await expect(page.getByRole("region", { name: en.reportsPreview.viewers.teacher, exact: true })
    .getByRole("checkbox", { name: en.reportsPreview.sharing.confirm, exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await expect(page).toHaveURL(/\/reports-preview$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect((await context.cookies()).find((cookie) => cookie.name === "NEXT_LOCALE")?.value).toBe("zh-CN");
  expect(requests.blocked).toEqual([]);
  expect(requests.pageErrors).toEqual([]);
});
