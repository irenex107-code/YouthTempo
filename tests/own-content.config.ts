import { defineConfig } from "@playwright/test";

// Synthetic SDK/fetch fixtures only. No Next server, dotenv, global setup or real services.
export default defineConfig({
  testDir: ".", testMatch: ["own-content-api.spec.ts", "own-content-helper.spec.ts", "own-content-client.spec.ts"],
  outputDir: process.env.YOUTHTEMPO_OWN_RESULTS_DIR || "../audit-records/2026-11-04/product01_own_content_implementation/test-results",
  reporter: [["list"], ["json"]], workers: 1, fullyParallel: false, retries: 0, timeout: 30_000,
  use: {
    browserName: "chromium", channel: "chrome", offline: true, serviceWorkers: "block",
    screenshot: "only-on-failure", trace: "retain-on-failure",
    launchOptions: { args: ["--no-proxy-server", "--disable-background-networking"] },
  },
  projects: [
    { name: "local-desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "local-narrow", grep: /visual/, testMatch: "own-content-client.spec.ts", use: { viewport: { width: 320, height: 844 }, isMobile: true } },
  ],
});
