import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function gotoReady(page: Page, route: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await expect(page.locator("main")).toBeVisible();
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await page.waitForTimeout(750);
    }
  }
  throw lastError;
}

const keyPaths = [
  "/",
  "/for-teens",
  "/for-parents",
  "/for-teachers",
  "/check-in",
  "/community",
  "/account",
  "/feedback",
];

const implementationPhrases = [
  "生产数据库",
  "service_role",
  "NEXT_PUBLIC_",
  "系统提示词",
  "模型推理",
  "开发者思考",
];

test("关键页面在手机浏览器中正常重排", async ({ page }, testInfo) => {
  for (const route of keyPaths) {
    const response = await gotoReady(page, route);
    expect(response?.status(), `${testInfo.project.name} ${route} 请求失败`).toBeLessThan(400);

    const result = await page.evaluate((phrases) => {
      const root = document.documentElement;
      const text = document.body.innerText;
      const header = document.querySelector("header")?.getBoundingClientRect();
      return {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        headerTop: header?.top ?? 0,
        headerRight: header?.right ?? root.clientWidth,
        leakedPhrase: phrases.find((phrase) => text.includes(phrase)) || null,
        brokenVisibleImages: Array.from(document.images).filter((image) => {
          const rect = image.getBoundingClientRect();
          const visible = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
          return visible && image.complete && image.naturalWidth === 0;
        }).length,
      };
    }, implementationPhrases);

    expect(result.scrollWidth, `${testInfo.project.name} ${route} 出现横向溢出`).toBeLessThanOrEqual(result.clientWidth + 1);
    expect(result.headerTop, `${testInfo.project.name} ${route} 顶部导航被裁切`).toBeGreaterThanOrEqual(0);
    expect(result.headerRight, `${testInfo.project.name} ${route} 顶部导航超出视口`).toBeLessThanOrEqual(result.clientWidth + 1);
    expect(result.leakedPhrase, `${testInfo.project.name} ${route} 显示了实现信息`).toBeNull();
    expect(result.brokenVisibleImages, `${testInfo.project.name} ${route} 首屏图片加载失败`).toBe(0);
  }
});

test("手机导航可以展开、访问角色入口并关闭", async ({ page }) => {
  await gotoReady(page, "/");
  const menuButton = page.getByRole("button", { name: "打开导航菜单" });
  await expect(menuButton).toBeVisible();
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");

  await menuButton.click();
  await expect(page.getByRole("link", { name: "青少年入口", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "家长入口", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "老师入口", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "登录 / 我的记录", exact: true })).toBeVisible();

  const closeButton = page.getByRole("button", { name: "关闭导航菜单" });
  await expect(closeButton).toHaveAttribute("aria-expanded", "true");
  await closeButton.click();
  await expect(page.getByRole("button", { name: "打开导航菜单" })).toBeVisible();
});

test("登录输入框不会触发 iOS 自动放大", async ({ page }) => {
  await gotoReady(page, "/account");
  const email = page.getByLabel("邮箱");
  await expect(email).toBeVisible();
  const fontSize = await email.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  const height = await email.evaluate((element) => element.getBoundingClientRect().height);
  expect(fontSize).toBeGreaterThanOrEqual(16);
  expect(height).toBeGreaterThanOrEqual(44);
});

test("反馈登录状态在手机端完整可见", async ({ page }, testInfo) => {
  await gotoReady(page, "/feedback");
  await expect(page.getByRole("heading", { level: 1, name: "这次用起来怎么样？" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "登录后再填写" })).toBeVisible();
  await expect(page.getByRole("link", { name: "前往登录" })).toBeVisible();

  const screenshotPath = path.join("test-results", `mobile-browser-${testInfo.project.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
});

test("微信项目使用内置浏览器标识", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "wechat-webview", "只检查微信 WebView 项目");
  await gotoReady(page, "/");
  expect(await page.evaluate(() => navigator.userAgent)).toContain("MicroMessenger");
});
