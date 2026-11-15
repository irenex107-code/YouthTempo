import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.skip(process.env.E2E_REPORTS_PRODUCTION !== "true", "Requires the production build started with REPORTS_UI_PREVIEW_ENABLED=true.");

for (const prefix of ["", "/en"]) {
  test(`${prefix || "zh"} production refuses the report preview even with its server switch enabled`, async ({ page }) => {
    const response = await page.goto(`${prefix}/reports-preview?preview=true&state=ready`);
    expect(response?.status()).toBe(404);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    expect(response?.headers()["cache-control"]).toContain("no-store");
  });
}

test("production refuses its actual localized Next data routes while the site remains available", async ({ request }) => {
  expect((await request.get("/")).status()).toBe(200);
  const buildId = (await readFile(path.join(process.cwd(), ".next/BUILD_ID"), "utf8")).trim();
  expect(buildId).toMatch(/^[A-Za-z0-9_-]+$/);
  const pages = JSON.parse(await readFile(path.join(process.cwd(), ".next/server/pages-manifest.json"), "utf8")) as Record<string, string>;
  expect(pages["/reports-preview"]).toBeTruthy();
  const routes = JSON.parse(await readFile(path.join(process.cwd(), ".next/routes-manifest.json"), "utf8")) as {
    dataRoutes: { page: string; dataRouteRegex: string }[];
  };
  const dataRoute = routes.dataRoutes.find((route) => route.page === "/reports-preview");
  expect(dataRoute).toBeTruthy();
  // Next normalizes the locale segment before matching a manifest data route.
  expect(`/_next/data/${buildId}/reports-preview.json`).toMatch(new RegExp(dataRoute!.dataRouteRegex));
  for (const locale of ["zh-CN", "en"]) {
    const dataPath = `/_next/data/${buildId}/${locale}/reports-preview.json`;
    const response = await request.get(`${dataPath}?preview=true`, {
      headers: { "x-nextjs-data": "1" },
    });
    expect(response.status(), locale).toBe(404);
    const body: unknown = await response.json();
    expect(body).toEqual({ notFound: true });
  }
});
