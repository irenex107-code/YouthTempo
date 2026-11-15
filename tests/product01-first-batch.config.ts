import { defineConfig } from "@playwright/test";

// Deliberately independent of the application config: no Next server, dotenv,
// remote baseURL, fixture mutation, or real authentication/service connection.
export default defineConfig({
  testDir: ".",
  testMatch: ["product01-first-batch.spec.ts", "safety-copy-consistency.spec.ts", "role-page-labels.spec.ts"],
  outputDir: "../audit-records/2026-11-02/product01_first_batch_20261102/test-results",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    channel: "chrome",
    offline: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { args: ["--no-proxy-server", "--disable-background-networking"] },
  },
  projects: [
    { name: "local-desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "local-narrow", use: { viewport: { width: 320, height: 844 }, isMobile: true, deviceScaleFactor: 1 } },
  ],
});
