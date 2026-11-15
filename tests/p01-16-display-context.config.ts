import path from "node:path";
import { defineConfig } from "@playwright/test";

const phase = process.env.P01_16_PHASE || "run";
const evidence = path.join(process.cwd(), "audit-records/2026-11-12/product01_p01_16_display_context", phase);

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
      name: "logic",
      testMatch: ["p01-16-display-context-rules.spec.ts"],
    },
    {
      name: "desktop",
      testMatch: ["p01-16-display-context-ui.spec.ts"],
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: "narrow-320",
      testMatch: ["p01-16-display-context-ui.spec.ts"],
      use: { viewport: { width: 320, height: 844 }, isMobile: true, deviceScaleFactor: 1 },
    },
  ],
});
