import { expect, test } from "@playwright/test";
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "string" ? [path] : flattenKeys(child, path);
  });
}

test("中英文翻译文件拥有相同的结构化键", () => {
  expect(flattenKeys(en).sort()).toEqual(flattenKeys(zhCN).sort());
});

test("语言切换保留路径并通过 Cookie 记住选择", async ({ page, context }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/resources?source=i18n#resources");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("group", { name: "切换语言" })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.i18nNavigation = "client";
  });

  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/resources\?source=i18n#resources$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-i18n-navigation", "client");
  await expect(page.getByRole("group", { name: "Switch language" })).toBeVisible();
  expect((await context.cookies()).find((cookie) => cookie.name === "NEXT_LOCALE")?.value).toBe("en");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await expect(page).toHaveURL(/\/resources\?source=i18n#resources$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect((await context.cookies()).find((cookie) => cookie.name === "NEXT_LOCALE")?.value).toBe("zh-CN");
  expect(browserErrors).toEqual([]);
});

test("移动端语言切换器不会造成横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("group", { name: "切换语言" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/?$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
