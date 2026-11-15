import { defineConfig } from "@playwright/test";

// Node-only: installed Supabase SDK plus the existing in-memory transport.
export default defineConfig({
  testDir: ".",
  testMatch: "garden-participation-999-supplement.spec.ts",
  outputDir: "../audit-records/2026-11-11/product01_p01_19_boundary_supplement/playwright-artifacts",
  reporter: [
    ["line"],
    ["json", { outputFile: "../audit-records/2026-11-11/product01_p01_19_boundary_supplement/playwright-report.json" }],
  ],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 15_000,
});
