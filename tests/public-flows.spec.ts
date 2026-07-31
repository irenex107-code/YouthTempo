import { expect, test } from "@playwright/test";

test("首页明确一期服务对象和 SWEET 主入口", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/YouthTempo/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("找到自己的节奏");
  await expect(page.getByText("青少年 14-18")).toBeVisible();
  await expect(page.getByRole("link", { name: "开始 SWEET 节律记录" })).toHaveAttribute("href", "/check-in");
});

test("未登录用户可以看到三个角色入口", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "青少年入口" })).toHaveAttribute("href", "/for-teens");
  await expect(page.getByRole("link", { name: "家长入口" })).toHaveAttribute("href", "/for-parents");
  await expect(page.getByRole("link", { name: "老师入口" })).toHaveAttribute("href", "/for-teachers");
});

for (const rolePage of [
  { path: "/for-teens", heading: "青少年入口", workspace: "进入青少年工作台" },
  { path: "/for-parents", heading: "家长入口", workspace: "进入家长工作台" },
  { path: "/for-teachers", heading: "老师入口", workspace: "进入老师工作台" },
]) {
  test(`${rolePage.heading}提供工作台和 SWEET 入口`, async ({ page }) => {
    await page.goto(rolePage.path);

    await expect(page.getByRole("heading", { level: 1, name: rolePage.heading })).toBeVisible();
    await expect(page.getByRole("link", { name: rolePage.workspace })).toHaveAttribute("href", "/account");
    await expect(page.getByRole("link", { name: "了解 SWEET" })).toHaveAttribute("href", "/sweet-model");
  });
}

test("未登录访问社区时不会显示发布表单", async ({ page }) => {
  await page.goto("/community");

  await expect(page.getByRole("heading", { level: 1, name: "家校医社区" })).toBeVisible();
  await expect(page.getByText("登录后才能阅读和参与讨论")).toBeVisible();
  await expect(page.locator("#new-post")).toHaveCount(0);
});

test("未登录进入账户页时显示邮箱验证码登录", async ({ page }) => {
  await page.goto("/account");

  await expect(page.getByRole("heading", { level: 1, name: "登录后继续记录" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送验证码" })).toBeVisible();
});

test("关键公开页面没有横向溢出", async ({ page }) => {
  for (const path of ["/", "/for-teens", "/for-parents", "/for-teachers", "/community", "/account"]) {
    await page.goto(path);
    const sizes = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(sizes.scrollWidth, `${path} 出现横向溢出`).toBeLessThanOrEqual(sizes.clientWidth + 1);
  }
});
