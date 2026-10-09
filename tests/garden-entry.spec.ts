import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || 'zh'} 首页先展示庭院与玩法，访客不写入数据`, async ({ page }, testInfo) => {
    const writes: string[] = [];
    await page.route("**/auth/v1/**", route => route.abort());
    await page.route("**/api/garden**", route => {
      writes.push(route.request().method());
      return route.abort();
    });
    await page.goto(`${prefix}/`);
    await expect(page.getByRole("heading", { level: 1, name: copy.home.hero.title })).toBeVisible();
    await expect(page.getByText(copy.gardenWelcome.preview, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy.garden.explore.pond.label, exact: true }).click();
    await expect(page.getByText(copy.garden.explore.pond.response, { exact: true })).toBeVisible();
    for (const key of ["record", "growth", "care", "layout", "privacy", "choice"] as const) {
      await expect(page.getByRole("heading", { name: copy.gardenWelcome[key].title, exact: true })).toBeVisible();
    }
    await expect(page.locator('a[href$="/check-in"]')).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `deliverables/garden-entry-2026-10-09/${prefix ? "en" : "zh"}-${testInfo.project.name}.png`, fullPage: true });
    await page.locator('a.button-primary').filter({ hasText: copy.gardenWelcome.enter }).last().click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/garden$`));
    await expect(page.getByRole("link", { name: copy.gardenWelcome.login, exact: true })).toBeVisible();
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

for (const [role, consent, shouldEnter] of [["学生", "active", true], ["学生", "withdrawn", false], ["家长", "active", false]] as const) {
  test(`登录入口仅为知情确认有效的学生跳转：${role}/${consent}`, async ({ page }) => {
    const user = { id: "00000000-0000-4000-8000-000000000088", email: "garden-entry@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
    const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co").hostname.split(".")[0];
    await page.addInitScript(({ ref, user }) => localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({ access_token: "synthetic-token", refresh_token: "synthetic-refresh", token_type: "bearer", expires_at: Math.floor(Date.now()/1000)+3600, user })), { ref, user });
    await page.route("**/auth/v1/**", route => new URL(route.request().url()).pathname.endsWith("/user") ? route.fulfill({ json: user }) : route.abort());
    await page.route("**/rest/v1/**", route => route.fulfill({ json: [] }));
    await page.route("**/api/**", route => {
      const url = new URL(route.request().url()).pathname;
      if (url === "/api/account/status") return route.fulfill({ json: { displayRole: role, profile: { id: user.id, display_name: "Garden visitor", role }, hasSchool: false, studentAgeBand: "18_plus" } });
      if (url === "/api/account/consent") return route.fulfill({ json: { role: role === "学生" ? "student" : "guardian", policyVersion: "test", consent: { status: consent, ageBand: "18_plus", consentBasis: "adult_self" }, children: [] } });
      if (url === "/api/garden") return route.fulfill({ status: 503, json: { error: "Unavailable" } });
      return route.fulfill({ json: { identities: [], records: [], available: false } });
    });
    await page.goto("/en/account?next=garden");
    if (shouldEnter) await expect(page).toHaveURL(/\/en\/garden$/);
    else {
      await expect(page.getByRole("heading", { name: /Garden visitor/ }).first()).toBeVisible();
      await expect(page).toHaveURL(/\/en\/account\?next=garden$/);
    }
  });
}
