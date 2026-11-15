import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const production = process.env.E2E_REPORTS_INTEGRATION_PRODUCTION === "true";
const enabled = process.env.E2E_REPORTS_LOCAL_INTEGRATION === "true";
const grant = "00000000-0000-4000-8000-000000000201";

for (const prefix of ["", "/en"]) {
  test(`${prefix || "zh"} reports 默认关闭或production强制拒绝，浏览器状态不能开启`, async ({ page }) => {
    test.skip(enabled && !production, "This server explicitly enables local integration.");
    await page.addInitScript(() => {
      localStorage.setItem("youthtempo:reports-enabled", "true");
      localStorage.setItem("REPORTS_LOCAL_INTEGRATION_ENABLED", "true");
    });
    const response = await page.goto(`${prefix}/reports?enabled=true&preview=true&REPORTS_LOCAL_INTEGRATION_ENABLED=true`);
    expect(response?.status()).toBe(404);
    await expect(page.locator("[data-report-access-state], [data-report-authorization], [data-report-summary]")).toHaveCount(0);
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    if (production) expect(response?.headers()["cache-control"]).toContain("no-store");
  });
}

test("关闭门禁先于认证：四个报告API均404且no-store", async ({ request }) => {
  test.skip(enabled && !production, "This server explicitly enables local integration.");
  const headers = { Authorization: "Bearer SYNTHETIC-INVALID-TOKEN" };
  const responses = await Promise.all([
    request.get("/api/reports/access?enabled=true", { headers }),
    request.get(`/api/reports/current?authorizationId=${grant}&enabled=true`, { headers }),
    request.post("/api/reports/authorizations", { headers, data: { recipientId: grant, recipientType: "teacher", dimensions: ["sleep"], requestId: grant, confirmed: true } }),
    request.delete(`/api/reports/authorizations/${grant}`, { headers, data: {} }),
  ]);
  for (const response of responses) {
    expect(response.status()).toBe(404);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["cache-control"]).toContain("private");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    expect(await response.text()).not.toMatch(/SYNTHETIC-INVALID-TOKEN|supabase|service_role|report_authorizations/);
  }
});

test("production使用实际BUILD_ID的两语言Next数据路径仍拒绝，首页保持可用", async ({ request }) => {
  test.skip(!production, "Requires a production build/run with integration flag true and loopback Supabase URL.");
  expect((await request.get("/")).status()).toBe(200);
  const buildId = (await readFile(path.join(process.cwd(), ".next/BUILD_ID"), "utf8")).trim();
  expect(buildId).toMatch(/^[A-Za-z0-9_-]+$/);
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), ".next/server/pages-manifest.json"), "utf8")) as Record<string, string>;
  expect(manifest["/reports"]).toBeTruthy();
  const routes = JSON.parse(await readFile(path.join(process.cwd(), ".next/routes-manifest.json"), "utf8")) as { dataRoutes: { page: string; dataRouteRegex: string }[] };
  const route = routes.dataRoutes.find((entry) => entry.page === "/reports");
  expect(route).toBeTruthy();
  expect(`/_next/data/${buildId}/reports.json`).toMatch(new RegExp(route!.dataRouteRegex));
  for (const locale of ["zh-CN", "en"]) {
    const response = await request.get(`/_next/data/${buildId}/${locale}/reports.json?enabled=true`, { headers: { "x-nextjs-data": "1" } });
    expect(response.status(), locale).toBe(404);
    expect(await response.json()).toEqual({ notFound: true });
  }
});
