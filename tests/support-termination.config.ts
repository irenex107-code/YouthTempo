import { defineConfig } from "@playwright/test";

// Pure local mocked React/handler execution; no Next server, dotenv, real SDK, Auth or DB.
export default defineConfig({
  testDir: ".", testMatch: ["support-termination-api.spec.ts", "support-termination-client.spec.ts"],
  outputDir: process.env.YOUTHTEMPO_TERMINATION_RESULTS_DIR || "../audit-records/2026-11-03/product01_support_termination_implementation/test-results",
  reporter: [["list"], ["json"]], workers: 1, fullyParallel: false, retries: 0, timeout: 30_000,
  use: {
    browserName: "chromium", channel: "chrome", offline: true, serviceWorkers: "block",
    screenshot: "only-on-failure", trace: "retain-on-failure",
    launchOptions: { args: ["--no-proxy-server", "--disable-background-networking"] },
  },
  projects: [
    { name: "local-desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "local-narrow", grep: /visual/, testIgnore: "support-termination-api.spec.ts", use: { viewport: { width: 320, height: 844 }, isMobile: true } },
  ],
});
