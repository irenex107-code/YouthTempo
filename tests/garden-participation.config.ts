import { defineConfig } from "@playwright/test";

// In-memory transport only: no browser, app server, dotenv or fixture reset.
export default defineConfig({
  testDir: ".",
  testMatch: "garden-participation.spec.ts",
  outputDir: "../audit-records/2026-11-04/product01_p01_19_participation/test-results",
  reporter: [["list"], ["json"]],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 15_000,
});
