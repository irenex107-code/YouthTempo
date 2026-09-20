import { expect, test, type Page } from "@playwright/test";

const projectRef = new URL(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co",
).hostname.split(".")[0];

async function useIllustrativeSession(page: Page, platformAdmin: boolean) {
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "preview@example.invalid",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { display_name: "Preview" },
    created_at: "2026-01-01T00:00:00.000Z",
  };

  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: `sb-${projectRef}-auth-token`,
    value: {
      access_token: "local-preview-test-token",
      refresh_token: "local-preview-test-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    },
  });

  await page.route("**/api/account/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: { id: user.id, display_name: user.user_metadata.display_name },
        displayRole: platformAdmin ? "平台管理员" : "学生",
        adminAccess: platformAdmin ? { role: "平台管理员", scope: "platform" } : null,
        schoolMemberships: [],
        hasSchool: false,
        studentAgeBand: null,
        linkedChildren: [],
        assignedStudents: [],
        assignedTeachers: [],
        linkedGuardians: [],
      }),
    });
  });
}

test("未登录用户不能查看管理员角色预览", async ({ page }) => {
  await page.goto("/admin/role-preview");

  await expect(page.getByRole("heading", { name: "仅平台管理员可查看" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "学生工作台" })).toHaveCount(0);
});

test("普通账号不能查看管理员角色预览", async ({ page }) => {
  await useIllustrativeSession(page, false);
  await page.goto("/admin/role-preview");

  await expect(page.getByRole("heading", { name: "仅平台管理员可查看" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "学生工作台" })).toHaveCount(0);
});

test("平台管理员可以切换虚构角色视图，且没有提交私密操作", async ({ page }) => {
  await useIllustrativeSession(page, true);
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/") && !["GET", "HEAD"].includes(request.method())) {
      mutations.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.goto("/admin/role-preview");

  await expect(page.getByRole("heading", { name: "学生工作台" })).toBeVisible();
  await expect(page.getByText("示例工作台 · 无真实数据")).toBeVisible();
  const menuButton = page.getByRole("button", { name: "打开导航菜单" });
  if (await menuButton.isVisible()) await menuButton.click();
  await expect(page.getByRole("link", { name: "青少年入口", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "家长入口", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "老师入口", exact: true })).toBeVisible();
  if (await menuButton.isVisible()) await page.getByRole("button", { name: "关闭导航菜单" }).click();
  await page.getByRole("button", { name: "家长" }).click();
  await expect(page.getByRole("heading", { name: "家长工作台" })).toBeVisible();
  await expect(page.locator("aside").getByRole("link", { name: /家长入口/ })).toHaveAttribute("href", "/for-parents");
  await page.getByRole("button", { name: "支持老师" }).click();
  await expect(page.getByRole("heading", { name: "老师工作台" })).toBeVisible();
  expect(mutations).toEqual([]);
});

test("管理员角色预览有英文界面", async ({ page }) => {
  await useIllustrativeSession(page, true);
  await page.goto("/en/admin/role-preview");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Student workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Parent or guardian" })).toBeVisible();
});
