import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "p01-unknown-generation-supplement.spec.ts",
  grep: /P01 UNKNOWN generation/,
  outputDir: process.env.YOUTHTEMPO_UNKNOWN_GENERATION_RESULTS_DIR
    || "../audit-records/2026-11-11/product01_unknown_generation_supplement/test-results",
  reporter: [["list"], ["json", {
    outputFile: process.env.YOUTHTEMPO_UNKNOWN_GENERATION_JSON
      || "../audit-records/2026-11-11/product01_unknown_generation_supplement/results.json",
  }]],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  use: {
    browserName: "chromium",
    channel: "chrome",
    viewport: { width: 1280, height: 900 },
    offline: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { args: ["--no-proxy-server", "--disable-background-networking"] },
  },
});
