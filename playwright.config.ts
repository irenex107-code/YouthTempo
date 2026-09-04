import { defineConfig, devices } from "@playwright/test";
import protectedSupabaseProjects from "./tests/fixtures/protected-supabase-projects.json";

const remoteTestCredentialsPresent = Boolean(
  process.env.E2E_PERMISSION_TEST_PASSWORD || process.env.SUPABASE_SERVICE_ROLE_KEY,
);

if (remoteTestCredentialsPresent) {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredUrl) {
    throw new Error("远程认证测试必须显式设置隔离的 NEXT_PUBLIC_SUPABASE_URL。");
  }
  const projectRef = new URL(configuredUrl).hostname.split(".")[0];
  if (Object.values(protectedSupabaseProjects).includes(projectRef)) {
    throw new Error(`拒绝对受保护的 Supabase 项目 ${projectRef} 运行远程认证测试。`);
  }
  if (process.env.ALLOW_E2E_FIXTURE_MUTATION !== "true") {
    throw new Error("远程认证测试必须显式设置 ALLOW_E2E_FIXTURE_MUTATION=true。");
  }
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests",
  testIgnore: "mobile-browser-acceptance.spec.ts",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    launchOptions: {
      args: ["--no-proxy-server"],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], channel: process.env.CI ? undefined : "chrome" },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], channel: process.env.CI ? undefined : "chrome" },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev:local",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
