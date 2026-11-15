import { readFileSync, lstatSync, realpathSync, mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

const fixtureRoot = process.env.YOUTHTEMPO_REPORTS_V2_ISOLATED_ROOT;
test.skip(!fixtureRoot, "Requires the freshly reset disposable comprehensive report fixture.");
test.use({ trace: "off", video: "off", screenshot: "off" });
function fixture(name: "teacher-a" | "student-a2") {
  if (fixtureRoot !== "/private/tmp/youthtempo-isolated-reports-v2-20261028") throw new Error("Only this batch's disposable root is allowed");
  const read = (name: string) => {
    const file = path.join(fixtureRoot, name), info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || path.dirname(realpathSync(file)) !== fixtureRoot) throw new Error("Invalid private fixture input");
    return JSON.parse(readFileSync(file, "utf8"));
  };
  if (read("status.json").API_URL !== "http://127.0.0.1:55321") throw new Error("Remote database refused");
  const accounts = read("sessions.json"), state = read("v2-state.json"), account = accounts[name];
  if (account.email !== `yt-reports-${name}@example.invalid` || !state.enrollments["student-a2"]) throw new Error("Invalid synthetic identity");
  const payload = JSON.parse(Buffer.from(account.accessToken.split(".")[1], "base64url").toString("utf8"));
  return { enrollmentId: state.enrollments["student-a2"] as string, session: {
    access_token: account.accessToken, refresh_token: account.refreshToken, token_type: "bearer", expires_at: payload.exp,
    expires_in: Math.max(0, payload.exp - Math.floor(Date.now() / 1000)),
    user: { id: account.id, email: account.email, aud: "authenticated", role: "authenticated", user_metadata: {}, app_metadata: {} },
  } };
}
for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} real teacher browser reads composite history and allowed detailed text`, async ({ page, baseURL }, info) => {
    if (baseURL !== "http://127.0.0.1:3214") throw new Error("Only this batch's local app is allowed");
    const data = fixture("teacher-a"); const outside: string[] = [], pageErrors: string[] = [];
    page.on("request", (r) => { const url = new URL(r.url()); if (["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1") outside.push(url.hostname); });
    page.on("pageerror", (e) => pageErrors.push(e.name));
    await page.addInitScript((session) => localStorage.setItem("sb-127-auth-token", JSON.stringify(session)), data.session);
    await page.goto(`${prefix}/reports`);
    await expect(page.locator(`[data-report-open="${data.enrollmentId}"]`)).toBeVisible();
    const currentResponse = page.waitForResponse((r) => r.url().includes("/api/reports/current?") && r.request().method() === "GET");
    await page.locator(`[data-report-open="${data.enrollmentId}"]`).click();
    const loaded = await currentResponse;
    expect(loaded.status(), "Actual current report must be accepted before rendering").toBe(200);
    await expect(page.locator("[data-report-comprehensive]")).toBeVisible();
    await expect(page.locator("[data-report-comprehensive]")).toContainText(copy.reportsV2.trend.days7);
    await expect(page.locator("[data-report-comprehensive]")).toContainText(copy.reportsV2.trend.days30);
    await expect(page.locator("main")).not.toContainText("PRIVATE_HISTORY_");
    await expect(page.locator("[data-report-detail-switch]")).toHaveCount(0);
    await page.getByRole("button", { name: copy.reportsV2.details.show, exact: true }).click();
    await expect(page.locator("[data-report-details]")).toContainText("PRIVATE_HISTORY_");
    await expect(page.locator("[data-report-details]")).toContainText("PRIVATE_SINGLE_SUMMARY_");
    await expect(page.locator("main")).not.toContainText("PRIVATE_EXCLUDED");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(outside).toEqual([]); expect(pageErrors).toEqual([]);
    if (process.env.YOUTHTEMPO_CAPTURE_REPORTS_SHARING === "true") {
      const dir = path.join(process.cwd(), "deliverables/comprehensive-reports-2026-10-28"); mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `actual-${prefix ? "en" : "zh-CN"}-${info.project.name}.png`), fullPage: false, scale: "css" });
    }
  });
}
