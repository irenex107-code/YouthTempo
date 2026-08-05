import { expect, test } from "@playwright/test";
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";

const routes = [
  { path: "/", section: "home" },
  { path: "/for-teens", section: "forTeens" },
  { path: "/for-parents", section: "forParents" },
  { path: "/for-teachers", section: "forTeachers" },
  { path: "/for-young-adults", section: "forYoungAdults" },
] as const;

function pageCopy(dictionary: typeof zhCN | typeof en, section: (typeof routes)[number]["section"]) {
  return dictionary[section] as { metadata: { title: string }; hero: { title: string } };
}

for (const route of routes) {
  test(`${route.path} 从中文词典渲染原文并支持英文 locale 路由`, async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));

    const chinese = pageCopy(zhCN, route.section);
    await page.goto(route.path);
    await expect(page).toHaveTitle(chinese.metadata.title);
    await expect(page.getByRole("heading", { level: 1, name: chinese.hero.title })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText(zhCN.common.footer.description);

    const english = pageCopy(en, route.section);
    await page.goto(`/en${route.path === "/" ? "" : route.path}`);
    await expect(page).toHaveTitle(english.metadata.title);
    await expect(page.getByRole("heading", { level: 1, name: english.hero.title })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText(en.common.footer.description);
    await expect(page.getByRole("group", { name: en.common.languageSwitcher.ariaLabel })).toBeVisible();
    expect(browserErrors).toEqual([]);
  });
}

test("Batch 1 locale 页面在窄屏下没有横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const route of routes) {
    await page.goto(`/en${route.path === "/" ? "" : route.path}`);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
  }
});
