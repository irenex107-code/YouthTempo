import { expect, test, type Page } from "@playwright/test";
import zh from "@/locales/zh-CN.json";
import en from "@/locales/en.json";

async function illustrativeRole(page: Page, role: string) {
  const user = {
    id: "00000000-0000-4000-8000-000000000061",
    aud: "authenticated", role: "authenticated", email: "navigation@example.invalid",
    app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z",
  };
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co").hostname.split(".")[0];
  await page.addInitScript(({ ref, user }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      access_token: "synthetic-navigation-token", refresh_token: "synthetic-navigation-refresh",
      token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, { ref, user });
  await page.route("**/auth/v1/**", (route) => new URL(route.request().url()).pathname.endsWith("/user")
    ? route.fulfill({ json: user }) : route.abort());
  await page.route("**/rest/v1/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/**", (route) => route.fulfill({ json: {
    displayRole: role, profile: { id: user.id, display_name: "Navigation visitor", role }, hasSchool: false,
  } }));
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"}: 家长公开入口提供沟通和支持资源，不承诺读取孩子记录`, async ({ page }) => {
    await page.goto(`${prefix}/for-parents`);
    await expect(page.getByRole("link", { name: copy.forParents.hero.primaryAction, exact: true }))
      .toHaveAttribute("href", `${prefix}/for-parents#conversation`);
    await expect(page.getByText(copy.forParents.intro.visibleText, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: copy.forParents.messages.action, exact: true }))
      .toHaveAttribute("href", `${prefix}/resources`);
    await expect(page.locator('a[href$="/messages"]')).toHaveCount(0);
    await expect(page.locator('[data-section="sweet-talk-conversation"]')).toBeVisible();
  });

  for (const [role, target, key] of [
    ["家长", "/for-parents", "parentGuide"],
    ["专业支持者", "/support/apply", "supportApplication"],
  ] as const) {
    test(`${prefix || "zh"}: ${role}主入口匹配当前资格流程`, async ({ page }) => {
      await illustrativeRole(page, role);
      await page.goto(`${prefix}/`);
      const menu = page.getByRole("button", { name: copy.common.navbar.openMenu, exact: true });
      if (await menu.isVisible()) await menu.click();
      const link = page.locator("header").getByRole("link", { name: copy.common.navbar.actions[key], exact: true });
      await expect(link.first()).toHaveAttribute("href", `${prefix}${target}`);
      await expect(page.locator('header a[href$="/account#records"]')).toHaveCount(0);
      await expect(page.locator('header a.button-primary[href$="/garden"]')).toHaveCount(0);
    });
  }
}
