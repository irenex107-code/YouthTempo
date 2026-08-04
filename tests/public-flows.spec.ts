import { expect, test } from "@playwright/test";

test("首页提供青少年日常支持和 SWEET 主入口", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/YouthTempo/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("最近过得怎么样");
  await expect(page.getByText("青少年日常支持平台", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "开始 SWEET 节律记录" })).toHaveAttribute("href", "/check-in");
});

test("未登录用户可以看到三个角色入口", async ({ page }) => {
  await page.goto("/");

  const menuButton = page.getByRole("button", { name: "打开导航菜单" });
  if (await menuButton.isVisible()) await menuButton.click();

  await expect(page.getByRole("link", { name: "青少年入口", exact: true })).toHaveAttribute("href", "/for-teens");
  await expect(page.getByRole("link", { name: "家长入口", exact: true })).toHaveAttribute("href", "/for-parents");
  await expect(page.getByRole("link", { name: "老师入口", exact: true })).toHaveAttribute("href", "/for-teachers");
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
  await expect(page.getByRole("heading", { name: "先保护人，再讨论问题" })).toBeVisible();
  await expect(page.getByText("紧急优先：")).toBeVisible();
  await expect(page.getByText("目标 2 小时内首次复核")).toBeVisible();
  await expect(page.getByText("登录后才能阅读和参与讨论")).toBeVisible();
  await expect(page.locator("#new-post")).toHaveCount(0);
});

test("未登录进入账户页时显示邮箱验证码登录", async ({ page }) => {
  await page.goto("/account");

  await expect(page.getByRole("heading", { level: 1, name: "登录后，记录会一直在" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送验证码" })).toBeVisible();
});

test("公开页面不展示生产端处理方式", async ({ page }) => {
  const productionPhrases = [
    "系统识别",
    "AI 简短聊几轮",
    "自动创建账号",
    "生产数据库",
    "平台管理员需先由另一位管理员",
    "最小操作审计",
    "第一层：",
    "第二层：",
    "第三层：",
  ];

  for (const path of ["/", "/for-teens", "/for-parents", "/for-teachers", "/community", "/account", "/privacy-safety"]) {
    await page.goto(path);
    const body = await page.locator("body").innerText();
    for (const phrase of productionPhrases) {
      expect(body, `${path} 不应显示“${phrase}”`).not.toContain(phrase);
    }
  }
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
