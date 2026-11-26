import { expect, test } from "@playwright/test";

test("首页提供青少年日常支持和 SWEET 主入口", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/YouthTempo/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SWEET花园");
  await expect(page.getByText("庭院预览 · 不保存记录", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "选择我的入口", exact: true })).toHaveAttribute("href", "/for-young-people");
});

test("未登录用户可以看到三个角色入口", async ({ page }) => {
  await page.goto("/");

  const menuButton = page.getByRole("button", { name: "打开导航菜单" });
  if (await menuButton.isVisible()) await menuButton.click();

  await expect(page.getByRole("link", { name: "学生与青年", exact: true })).toHaveAttribute("href", "/for-young-people");
  await expect(page.getByRole("link", { name: "家长指南", exact: true })).toHaveAttribute("href", "/for-parents");
  await expect(page.getByRole("link", { name: "教师指南", exact: true })).toHaveAttribute("href", "/for-teachers");
});

test("青少年入口先展示中学生和大学生路径", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "选择我的入口", exact: true }).click();
  await expect(page).toHaveURL(/\/for-young-people$/);
  await expect(page.getByRole("heading", { level: 1, name: "选择适合你的入口" })).toBeVisible();
  await expect(page.getByRole("link", { name: "进入中学生花园" })).toHaveAttribute("href", "/garden");
  await expect(page.getByRole("link", { name: "进入青年专区" })).toHaveAttribute("href", "/for-young-adults");

  await page.getByRole("link", { name: "进入青年专区" }).click();
  await expect(page).toHaveURL(/\/for-young-adults$/);

  await page.goto("/en/for-young-people");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("link", { name: "Open the student garden" })).toHaveAttribute("href", "/en/garden");
  await expect(page.getByRole("link", { name: "Open the young adult space" })).toHaveAttribute("href", "/en/for-young-adults");
});

for (const rolePage of [
  { path: "/for-teens", heading: "中学生可以从这里开始", workspace: "记录今天" },
  { path: "/for-parents", heading: "家长陪伴指南", workspace: "打开我的账户" },
  { path: "/for-teachers", heading: "教师支持指南", workspace: "进入教师账户" },
]) {
  test(`${rolePage.heading}提供工作台和 SWEET 入口`, async ({ page }) => {
    await page.goto(rolePage.path);

    await expect(page.getByRole("heading", { level: 1, name: rolePage.heading })).toBeVisible();
    await expect(page.getByRole("link", { name: rolePage.workspace, exact: true })).toHaveAttribute("href", rolePage.path === "/for-teens" ? "/garden" : "/account");
    if (rolePage.path === "/for-teens") await page.locator("summary").filter({ hasText: "更多工具" }).click();
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

test("未登录进入试点反馈页时只显示登录入口", async ({ page }) => {
  await page.goto("/feedback");

  await expect(page.getByRole("heading", { level: 1, name: "这次用起来怎么样？" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "登录后再填写" })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交反馈" })).toHaveCount(0);
});

test("18–25 岁可以找到不依赖学校或监护人的独立入口", async ({ page }) => {
  await page.goto("/for-young-adults");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("大学生与青年");
  await expect(page.getByText(/无需家长或学校加入/)).toBeVisible();
  const tasks = page.getByRole("navigation", { name: "我想做什么" });
  await expect(tasks.getByRole("link", { name: "记录今天" })).toHaveAttribute("href", "/garden?audience=adult");
  await expect(tasks.getByRole("link", { name: "找人聊聊" })).toHaveAttribute("href", "/for-young-adults#direct-support");
  await page.locator("summary").filter({ hasText: "更多工具" }).click();
  await expect(page.getByRole("link", { name: "有邀请？进入解忧室" })).toHaveAttribute("href", "/peer-space");
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

  for (const path of ["/", "/for-young-people", "/for-teens", "/for-young-adults", "/for-parents", "/for-teachers", "/community", "/account", "/feedback", "/privacy-safety"]) {
    await page.goto(path);
    const body = await page.locator("body").innerText();
    for (const phrase of productionPhrases) {
      expect(body, `${path} 不应显示“${phrase}”`).not.toContain(phrase);
    }
  }
});

test("关键公开页面没有横向溢出", async ({ page }) => {
  for (const path of ["/", "/for-young-people", "/for-teens", "/for-young-adults", "/for-parents", "/for-teachers", "/community", "/account", "/feedback"]) {
    await page.goto(path);
    const sizes = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(sizes.scrollWidth, `${path} 出现横向溢出`).toBeLessThanOrEqual(sizes.clientWidth + 1);
  }
});
