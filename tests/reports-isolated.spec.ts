import { readFileSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
// Historical v1 model; the current contracts are covered by reports-sharing-* tests.
test.skip(true, "Superseded voluntary period-report model; retained as historical evidence.");


const root = process.env.YOUTHTEMPO_REPORTS_ISOLATED_ROOT;
test.skip(!root, "Requires this batch's freshly reset, disposable local reports fixture.");

function privateFixture() {
  if (root !== "/private/tmp/youthtempo-isolated-reports-integration-20261028") throw new Error("Only this batch's private fixture is allowed");
  const read = (name: string) => {
    const file = path.join(root, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || path.dirname(realpathSync(file)) !== root) {
      throw new Error("Private fixture input permissions are invalid");
    }
    return JSON.parse(readFileSync(file, "utf8"));
  };
  const status = read("status.json");
  if (status.API_URL !== "http://127.0.0.1:55321") throw new Error("Only the disposable loopback database is allowed");
  const state = read("fixture-state.json");
  const accounts = read("sessions.json");
  const account = accounts[state.httpHistoricalRecipientName];
  if (account?.email !== "yt-reports-teacher-b@example.invalid" || typeof state.httpHistoricalGrantId !== "string") throw new Error("Actual HTTP acceptance must finish before this browser check");
  const payload = JSON.parse(Buffer.from(account.accessToken.split(".")[1], "base64url").toString("utf8"));
  return { grantId: state.httpHistoricalGrantId as string, session: {
    access_token: account.accessToken, refresh_token: account.refreshToken, token_type: "bearer", expires_at: payload.exp,
    expires_in: Math.max(0, payload.exp - Math.floor(Date.now() / 1000)),
    user: { id: account.id, email: account.email, aud: "authenticated", role: "authenticated", user_metadata: {}, app_metadata: {} },
  } };
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} actual local browser → API → RPC displays only its approved report`, async ({ page, baseURL }, info) => {
    if (baseURL !== "http://127.0.0.1:3214") throw new Error("Only the batch local app is allowed");
    const fixture = privateFixture();
    const nonlocalRequests: string[] = [];
    const errors: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1") nonlocalRequests.push(url.hostname);
    });
    page.on("pageerror", (error) => errors.push(error.name));
    await page.addInitScript((session) => { window.localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); }, fixture.session);
    const accessResponse = page.waitForResponse((response) => response.url().includes("/api/reports/access") && response.status() === 200);
    await page.goto(`${prefix}/reports`);
    await accessResponse;
    await expect(page.locator("html")).toHaveAttribute("lang", prefix ? "en" : "zh-CN");
    const responsePromise = page.waitForResponse((response) => response.url().includes(`/api/reports/current?authorizationId=${fixture.grantId}`) && response.status() === 200);
    await page.locator(`[data-report-select="${fixture.grantId}"]`).click();
    const response = await responsePromise;
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.json();
    expect(body.summary).toMatchObject({ status: "ready", dimensions: [{ id: "sleep", category: "sleep_good" }] });
    expect(body.summary.dimensions).toHaveLength(1);
    await expect(page.locator('[data-report-summary="ready"]')).toContainText(copy.reportsPreview.categories.sleep_good);
    await expect(page.locator("main")).not.toContainText("REPORTS_HTTP_PRIVATE");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.screenshot({ path: path.join(process.cwd(), "deliverables/reports-integration-2026-10-28", `real-http-${prefix ? "en" : "zh-CN"}-${info.project.name}.png`), fullPage: true });
    expect(nonlocalRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
