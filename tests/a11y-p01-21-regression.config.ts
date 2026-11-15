import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "a11y-local.spec.ts",
  grep: /P01-21 community dialogs contain focus and restore it/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: "../audit-records/2026-11-11/product01_p01_21_radio_wrap_supplement/related-regression-artifacts",
  reporter: [
    ["line"],
    ["json", { outputFile: "../audit-records/2026-11-11/product01_p01_21_radio_wrap_supplement/related-regression-report.json" }],
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
