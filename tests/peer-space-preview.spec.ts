import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

test("成年人入口展示解忧室介绍，访客看不到房间或消息", async ({ page, request }) => {
  await page.goto("/for-young-adults");
  const moreTools = page.locator("details[data-public-more-tools]");
  await expect(moreTools.locator("summary")).toHaveText(zh.ageWorkspace.moreTools.title);
  await moreTools.locator("summary").click();
  const introduction = moreTools.locator("article").filter({
    has: page.getByRole("heading", { level: 3, name: zh.forYoungAdults.peerSpace.title, exact: true }),
  });
  await expect(introduction.getByRole("heading", { level: 3, name: zh.forYoungAdults.peerSpace.title, exact: true })).toBeVisible();
  await expect(introduction).toContainText(zh.siteNavigation.peerEligibility);
  await expect(introduction.getByRole("link", { name: zh.siteNavigation.peerLearnMore, exact: true })).toHaveAttribute("href", "/peer-space");
  await expect(introduction.getByRole("link", { name: zh.forYoungAdults.peerSpace.action, exact: true })).toHaveCount(0);
  const response = await page.goto("/peer-space");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: zh.peerSpaceLive.title, exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: zh.peerSpace.room.composer.label, exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: zh.peerSpaceLive.rooms, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: zh.peerSpaceLive.join, exact: true })).toHaveCount(0);
  for (const path of ["/api/peer-space/access", "/api/peer-space/rooms", "/api/peer-space/messages?roomId=00000000-0000-4000-8000-000000001800"]) {
    expect((await request.get(path)).status()).toBe(401);
  }
});

test("英文解忧室访客页在移动端可读", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/peer-space");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: en.peerSpaceLive.title, exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
