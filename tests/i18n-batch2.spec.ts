import { expect, test } from "@playwright/test";
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";

const routes = [
  { path: "/sweet-model", section: "sweetModel" },
  { path: "/check-in", section: "checkIn" },
  { path: "/mood-journal", section: "moodJournal" },
  { path: "/talk", section: "talk" },
  { path: "/worry-time", section: "worryTime" },
  { path: "/referral", section: "referral" },
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
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page).toHaveTitle(chinese.metadata.title);
    await expect(page.getByRole("heading", { level: 1, name: chinese.hero.title })).toBeVisible();

    const english = pageCopy(en, route.section);
    await page.goto(`/en${route.path}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(english.metadata.title);
    await expect(page.getByRole("heading", { level: 1, name: english.hero.title })).toBeVisible();
    await expect(page.getByRole("group", { name: en.common.languageSwitcher.ariaLabel })).toBeVisible();
    expect(browserErrors).toEqual([]);
  });
}

test("Batch 2 locale 页面在窄屏下没有横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const route of routes) {
    await page.goto(`/en${route.path}`);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
  }
});

test("自评选项显示词典文案并保持原有交互", async ({ page }) => {
  await page.goto("/check-in");
  await page.getByRole("button", { name: zhCN.checkIn.steps.sleep.fields.quality.options.steady }).click();
  await expect(page.getByRole("button", { name: zhCN.checkIn.actions.next })).toBeEnabled();

  await page.goto("/referral");
  await page.getByRole("button", { name: zhCN.referral.questions.currentState.options.emotionalPressure }).click();
  await expect(page.getByText(zhCN.referral.status.selectedCount.replace("{{count}}", "1"))).toBeVisible();
});
