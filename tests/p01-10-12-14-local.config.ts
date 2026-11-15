import { defineConfig } from "@playwright/test";

const outputDir = process.env.YOUTHTEMPO_P01_MERGED_RESULTS_DIR
  || "../audit-records/2026-11-11/product01_p01_10_12_14_local/test-results";
const jsonOutput = process.env.YOUTHTEMPO_P01_MERGED_JSON
  || "../audit-records/2026-11-11/product01_p01_10_12_14_local/results.json";

export default defineConfig({
  testDir: ".",
  grep: /P01 merged/,
  outputDir,
  reporter: [["list"], ["json", { outputFile: jsonOutput }]],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  use: {
    browserName: "chromium",
    channel: "chrome",
    offline: true,
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { args: ["--no-proxy-server", "--disable-background-networking"] },
  },
  projects: [
    {
      name: "api",
      testMatch: "support-history-api.spec.ts",
    },
    {
      name: "ui-desktop",
      testMatch: "support-termination-client.spec.ts",
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: "ui-320",
      testMatch: "support-termination-client.spec.ts",
      use: { viewport: { width: 320, height: 844 }, isMobile: true },
    },
  ],
});
