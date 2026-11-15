import { defineConfig } from "@playwright/test";

// Local synthetic SDK/network fixtures only. No Next, dotenv, global setup or real services.
export default defineConfig({
  testDir: ".",
  testMatch: ["teacher-history-api.spec.ts", "teacher-history-client.spec.ts", "teacher-history-transport.spec.ts"],
  outputDir: process.env.YOUTHTEMPO_TEACHER_RESULTS_DIR || "../audit-records/2026-11-04/product01_teacher_history_implementation/test-results",
  reporter: [["list"], ["json"]], workers: 1, fullyParallel: false, retries: 0, timeout: 30_000,
  use: {
    browserName: "chromium", channel: "chrome", offline: true, serviceWorkers: "block",
    screenshot: "only-on-failure", trace: "retain-on-failure",
    launchOptions: { args: ["--no-proxy-server", "--disable-background-networking"] },
  },
  projects: [
    { name: "local-desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "local-narrow", grep: /visual/, testMatch: "teacher-history-client.spec.ts", use: { viewport: { width: 320, height: 844 }, isMobile: true } },
  ],
});
