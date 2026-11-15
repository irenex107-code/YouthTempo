import path from "node:path";
import { defineConfig } from "@playwright/test";

const phase = process.env.P01_COPY_PHASE || "run";
const evidence = path.join(process.cwd(), "audit-records/2026-11-11/product01_p01_06_07_13_15_16_local", phase);

export default defineConfig({
  testDir: ".",
  outputDir: path.join(evidence, "test-results"),
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: path.join(evidence, "results.json") }]],
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
    {
      name: "rules",
      testMatch: ["p01-06-07-13-15-16-rules.spec.ts"],
    },
    {
      name: "local-desktop",
      testMatch: ["p01-06-07-13-15-16-local.spec.ts"],
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: "local-narrow",
      testMatch: ["p01-06-07-13-15-16-local.spec.ts"],
      use: { viewport: { width: 320, height: 844 }, isMobile: true, deviceScaleFactor: 1 },
    },
  ],
});
