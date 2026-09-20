import { expect, test } from "@playwright/test";

test("工作人员审核页不向访客披露事项", async ({ page, request }) => {
  const response = await page.goto("/admin/peer-space");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "审核队列" })).toHaveCount(0);
  expect((await request.get("/api/admin/peer-space/review")).status()).toBe(401);
});

test("英文工作人员审核页在移动端可读", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/admin/peer-space");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
