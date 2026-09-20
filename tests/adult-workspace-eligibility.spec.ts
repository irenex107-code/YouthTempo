import { expect, test, type Page } from "@playwright/test";

const projectRef = new URL(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co",
).hostname.split(".")[0];

async function useAdultFixture(page: Page, peerSpaceResponse: { status: number; available?: boolean }) {
  const user = {
    id: "00000000-0000-4000-8000-000000000018",
    aud: "authenticated",
    role: "authenticated",
    email: "adult-preview@example.invalid",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { display_name: "Preview" },
    created_at: "2026-01-01T00:00:00.000Z",
  };
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: `sb-${projectRef}-auth-token`,
    value: {
      access_token: "local-adult-workspace-test-token",
      refresh_token: "local-adult-workspace-test-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    },
  });
  await page.route("**/auth/v1/user", (route) => route.fulfill({ status: 200, json: user }));
  await page.route("**/rest/v1/**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/account/status", (route) => route.fulfill({ status: 200, json: {
    profile: { id: user.id, email: user.email, display_name: "Preview", role: "学生", school_id: null },
    displayRole: "学生", adminAccess: null, schoolMemberships: [], hasSchool: false,
    studentAgeBand: "18_plus", linkedChildren: [], assignedStudents: [], assignedTeachers: [], linkedGuardians: [],
  } }));
  await page.route("**/api/account/consent", (route) => route.fulfill({ status: 200, json: {
    role: "student", policyVersion: "2026-08-28", children: [], consent: {
      studentUserId: user.id, studentName: "Preview", ageBand: "18_plus", consentBasis: "adult_self",
      policyVersion: "2026-08-28", status: "active", studentAssentedAt: "2026-09-19T00:00:00Z",
      guardianUserId: null, guardianConsentedAt: null, withdrawnAt: null, hasLinkedGuardian: false,
    },
  } }));
  await page.route("**/api/peer-space/access?*", (route) => route.fulfill({
    status: peerSpaceResponse.status,
    json: peerSpaceResponse.status === 200
      ? { available: peerSpaceResponse.available === true }
      : { error: "unavailable" },
  }));
}

test("自行申报成年但没有邀请时，工作台不显示解忧室入口", async ({ page }) => {
  await useAdultFixture(page, { status: 200, available: false });
  await page.goto("/account");

  await expect(page.getByRole("heading", { name: "18–25 岁：按自己的节奏选择支持" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "进入主题聊天室" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "找适合自己的同伴空间" })).toBeVisible();
});

test("资格接口关闭时，成年人工作台不显示解忧室入口", async ({ page }) => {
  await useAdultFixture(page, { status: 404 });
  await page.goto("/account");

  await expect(page.getByRole("heading", { name: "18–25 岁：按自己的节奏选择支持" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "进入主题聊天室" })).toHaveCount(0);
});

test("服务端确认有效邀请后，成年人工作台才显示解忧室入口", async ({ page }) => {
  await useAdultFixture(page, { status: 200, available: true });
  await page.goto("/account");

  await expect(page.getByRole("heading", { name: "进入主题聊天室" })).toBeVisible();
  await expect(page.getByRole("link", { name: "了解解忧室" })).toHaveAttribute("href", "/peer-space");
});
