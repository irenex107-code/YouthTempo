import { expect, test } from "@playwright/test";

test("成年人入口展示解忧室介绍，访客看不到房间或消息", async ({ page, request }) => {
  await page.goto("/for-young-adults");
  await expect(page.getByRole("heading", { level: 2, name: "解忧室" })).toBeVisible();
  const response = await page.goto("/peer-space");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "想说的话" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "主题房间" })).toHaveCount(0);
  for (const path of ["/api/peer-space/access", "/api/peer-space/rooms", "/api/peer-space/messages?roomId=00000000-0000-4000-8000-000000001800"]) {
    expect((await request.get(path)).status()).toBe(401);
  }
});

test("英文解忧室访客页在移动端可读", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/peer-space");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
