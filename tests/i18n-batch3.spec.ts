import { expect, test } from "@playwright/test";
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";

const publicRoutes = [
  { path: "/resources", section: "resources" },
  { path: "/privacy-safety", section: "privacySafety" },
  { path: "/contact", section: "contact" },
  { path: "/community", section: "community" },
] as const;

function pageCopy(dictionary: typeof zhCN | typeof en, section: (typeof publicRoutes)[number]["section"]) {
  return dictionary[section] as { metadata: { title: string }; hero: { title: string } };
}

for (const route of publicRoutes) {
  test(`${route.path} 从中文词典渲染公开内容`, async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));

    const chinese = pageCopy(zhCN, route.section);
    await page.goto(route.path);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page).toHaveTitle(chinese.metadata.title);
    await expect(page.getByRole("heading", { level: 1, name: chinese.hero.title })).toBeVisible();

    const english = pageCopy(en, route.section);
    await page.goto(`/en${route.path}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(english.metadata.title);
    await expect(page.getByRole("heading", { level: 1, name: english.hero.title })).toBeVisible();
    expect(browserErrors).toEqual([]);
  });
}

const visitorRoutes = [
  { path: "/account", section: "account" },
  { path: "/feedback", section: "feedback" },
  { path: "/messages", section: "messages" },
] as const;

for (const route of visitorRoutes) {
  test(`${route.path} 未登录访客入口按 locale 使用对应词典文案`, async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));

    const chinese = zhCN[route.section];
    await page.goto(route.path);
    await expect(page).toHaveTitle(chinese.metadata.title);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByRole("heading", { name: chinese.visitor.title })).toBeVisible();

    const english = en[route.section];
    await page.goto(`/en${route.path}`);
    await expect(page).toHaveTitle(english.metadata.title);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: english.visitor.title })).toBeVisible();
    expect(browserErrors).toEqual([]);
  });
}

test("社区未登录分支保持访问边界", async ({ page }) => {
  await page.goto("/community");
  await expect(page.getByRole("heading", { name: zhCN.community.visitor.title })).toBeVisible();
  await expect(page.getByRole("link", { name: zhCN.community.visitor.action })).toHaveAttribute("href", "/account?next=/community");
});

test("Batch 3 locale 页面在窄屏下没有横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [...publicRoutes.map((route) => route.path), ...visitorRoutes.map((route) => route.path)]) {
    await page.goto(`/en${path}`);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
  }
});
