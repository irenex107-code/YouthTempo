import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";

const production = process.env.E2E_REPORTS_INTEGRATION_PRODUCTION === "true";
const local = process.env.E2E_REPORTS_LOCAL_INTEGRATION === "true";
const enrollmentId = "00000000-0000-4000-8000-000000000201";
for (const prefix of ["", "/en"]) {
  test(`${prefix || "zh"} comprehensive reports production拒绝所有页面与浏览器开关`, async ({ page }) => {
    test.skip(local && !production, "This server explicitly enables local integration.");
    await page.addInitScript(() => { localStorage.setItem("REPORTS_LOCAL_INTEGRATION_ENABLED", "true"); });
    const response = await page.goto(`${prefix}/reports?enabled=true&preview=true`);
    expect(response?.status()).toBe(404);
    await expect(page.locator("[data-report-comprehensive], [data-report-details], [data-report-detail-switch]")).toHaveCount(0);
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    if (production) expect(response?.headers()["cache-control"]).toContain("no-store");
  });
}

test("所有新旧报告API门禁均先于认证/解析/数据库，production强制true仍404", async ({ request }) => {
  test.skip(local && !production, "Requires closed or production gate.");
  const headers = { Authorization: "Bearer SYNTHETIC_INVALID_TOKEN", "Content-Type": "application/json" };
  const paths = ["/api/reports/access", "/api/reports/current", "/api/reports/history", "/api/reports/details", "/api/reports/details-setting", "/api/reports/validate", "/api/reports/enrollment-exit", "/api/reports/authorizations", `/api/reports/authorizations/${enrollmentId}`];
  for (const endpoint of paths) {
    const response = await request.post(`${endpoint}?enabled=true`, { headers, data: "{SYNTHETIC_PRIVATE_MALFORMED" });
    expect(response.status(), endpoint).toBe(404);
    expect(response.headers()["cache-control"]).toContain("private"); expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    expect(await response.text()).not.toMatch(/SYNTHETIC_|service_role|sourceRevision|school_report_/);
  }
});

test("综合报告实际Next数据两语言仍404，首页可用", async ({ request }) => {
  test.skip(!production, "Requires actual forced-flag production build and runtime.");
  const buildId = (await readFile(path.join(process.cwd(), ".next/BUILD_ID"), "utf8")).trim();
  expect((await request.get("/")).status()).toBe(200);
  expect((await request.get("/en")).status()).toBe(200);
  for (const locale of ["zh-CN", "en"]) {
    const response = await request.get(`/_next/data/${buildId}/${locale}/reports.json?enabled=true`, { headers: { "x-nextjs-data": "1" } });
    expect(response.status()).toBe(404); expect(await response.json()).toEqual({ notFound: true });
  }
});
