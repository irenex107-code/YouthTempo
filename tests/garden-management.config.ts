import { defineConfig } from "@playwright/test";

// No app server, dotenv, fixture reset, real SDK, Auth or database connection.
export default defineConfig({
  testDir: ".",
  testMatch: ["garden-management-api.spec.ts", "garden-management-client.spec.ts"],
  outputDir: "../audit-records/2026-11-03/product01_garden_management/test-results",
  reporter: [["list"], ["json"]],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  use: {
    browserName: "chromium", channel: "chrome", offline: true, serviceWorkers: "block",
    screenshot: "only-on-failure", trace: "retain-on-failure",
    launchOptions: { args: ["--no-proxy-server", "--disable-background-networking"] },
  },
  projects: [
    { name: "local-desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "local-narrow", testIgnore: "garden-management-api.spec.ts", use: { viewport: { width: 320, height: 844 }, isMobile: true } },
  ],
});
