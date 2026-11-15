import { defineConfig } from "@playwright/test";

// Dedicated in-memory React/SDK transports. No webServer, dotenv, global setup or real Auth.
export default defineConfig({
  testDir: ".",
  testMatch: ["feedback-otp-client.spec.ts", "feedback-otp-errors.spec.ts", "email-otp-network-errors.spec.ts", "email-otp-readiness.spec.ts", "email-otp-recovery.spec.ts"],
  outputDir: process.env.YOUTHTEMPO_FEEDBACK_OTP_RESULTS || "../audit-records/2026-11-07/product01_feedback_otp/results",
  reporter: [["list"], ["json"]], workers: 1, fullyParallel: false, retries: 0, timeout: 20_000,
  use: {
    browserName: "chromium", channel: "chrome", offline: true, serviceWorkers: "block",
    screenshot: "only-on-failure", trace: "retain-on-failure",
    launchOptions: { args: ["--no-proxy-server", "--disable-background-networking"] },
  },
  projects: [
    { name: "local-desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "local-narrow", testMatch: "feedback-otp-client.spec.ts", grep: /visual/, use: { viewport: { width: 320, height: 844 }, isMobile: true } },
  ],
});
