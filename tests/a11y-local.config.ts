import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "a11y-local.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: "../audit-records/2026-11-11/product01_a11y_local/playwright-artifacts",
  reporter: [
    ["line"],
    ["json", { outputFile: "../audit-records/2026-11-11/product01_a11y_local/playwright-report.json" }],
  ],
  use: {
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    offline: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: { args: ["--no-proxy-server", "--disable-background-networking"] },
  },
});
