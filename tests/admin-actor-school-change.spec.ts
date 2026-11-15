import { expect, test, type Page, type Response } from "@playwright/test";
import { adminOverview, adminRoster, syntheticAdminLifecycle } from "./fixtures/synthetic-admin-lifecycle";

async function finishLateResponse(page: Page, response: Promise<Response>) {
  await (await response).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test("换号与退出立即清除管理目录、表单和平台队列", async ({ page, baseURL }) => {
  const fixture = await syntheticAdminLifecycle(page, baseURL!);
  await page.goto("/admin");
  await expect(page.locator("#role-overview")).toContainText("admin-a@example.invalid");
  await page.getByLabel("成员姓名", { exact: true }).fill("OLD_ACCOUNT_DRAFT");
  await expect(page.locator("#community-moderation")).toBeAttached();
  await fixture.switchActor("admin-b");
  await expect(page.locator("#role-overview")).toContainText("admin-b@example.invalid");
  await expect(page.locator("main")).not.toContainText("admin-a@example.invalid");
  await expect(page.getByLabel("成员姓名", { exact: true })).toHaveValue("");
  await fixture.switchActor(null);
  await expect(page.locator("#member-management")).toHaveCount(0);
  await expect(page.locator("#community-moderation")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("admin-b@example.invalid");
  await expect(page.locator("main a[href='/account?next=/admin']")).toBeVisible();
  expect(fixture.blocked).toEqual([]);
});

test("旧账号迟到的管理概览不能覆盖新账号", async ({ page, baseURL }) => {
  const fixture = await syntheticAdminLifecycle(page, baseURL!);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  fixture.interceptors.set("GET /api/admin/overview", async (route) => {
    const old = route.request().headers().authorization.includes("admin-a");
    if (old) await gate;
    await route.fulfill({ json: adminOverview(old ? "admin-a" : "admin-b") });
  });
  await page.goto("/admin");
  await expect.poll(() => fixture.requests.some((request) => request.path === "/api/admin/overview")).toBe(true);
  await fixture.switchActor("admin-b");
  await expect(page.locator("#role-overview")).toContainText("admin-b@example.invalid");
  const lateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/overview"
    && response.request().headers().authorization.includes("admin-a"));
  release();
  await finishLateResponse(page, lateResponse);
  await expect(page.locator("#role-overview")).toContainText("admin-b@example.invalid");
  await expect(page.locator("main")).not.toContainText("admin-a@example.invalid");
  expect(fixture.blocked).toEqual([]);
});

test("快速切校忽略旧名单，负责关系只提交当前学校人员", async ({ page, baseURL }) => {
  const fixture = await syntheticAdminLifecycle(page, baseURL!);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  fixture.interceptors.set("GET /api/admin/teacher-student-assignments", async (route) => {
    const schoolId = new URL(route.request().url()).searchParams.get("schoolId")!;
    if (schoolId === "school-a") await gate;
    await route.fulfill({ json: adminRoster(schoolId) });
  });
  fixture.interceptors.set("POST /api/admin/teacher-student-assignments", (route) => route.fulfill({ json: adminRoster("school-b") }));
  await page.goto("/admin");
  await expect.poll(() => fixture.requests.some((request) => request.path === "/api/admin/teacher-student-assignments")).toBe(true);
  await page.locator("#teacher-assignment summary").click();
  await page.locator("#member-management select").first().selectOption("school-b");
  await expect(page.locator("#teacher-assignment")).toContainText("school-b teacher");
  const lateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/teacher-student-assignments"
    && new URL(response.url()).searchParams.get("schoolId") === "school-a");
  release();
  await finishLateResponse(page, lateResponse);
  await expect(page.locator("#teacher-assignment")).not.toContainText("school-a teacher");
  await page.locator("#teacher-assignment input[type=checkbox]").first().check();
  await page.locator("#teacher-assignment").getByRole("button", { name: "保存负责学生", exact: true }).click();
  await expect.poll(() => fixture.requests.filter((request) => request.method === "POST")).toHaveLength(1);
  expect(fixture.requests.find((request) => request.method === "POST")?.body).toEqual({ schoolId: "school-b", teacherUserId: "school-b-teacher", studentUserIds: ["school-b-student"] });
  expect(fixture.blocked).toEqual([]);
});

test("当前管理资格被拒后撤下目录、队列和草稿", async ({ page, baseURL }) => {
  const fixture = await syntheticAdminLifecycle(page, baseURL!);
  fixture.interceptors.set("POST /api/admin/school-assignments", (route) => route.fulfill({ status: 403, json: { error: "需要管理权限" } }));
  await page.goto("/admin");
  await expect(page.locator("#member-management")).toBeVisible();
  await page.getByLabel("成员姓名", { exact: true }).fill("Denied draft");
  await page.getByLabel("成员登录邮箱", { exact: true }).fill("denied@example.invalid");
  await page.getByRole("button", { name: "添加成员", exact: true }).click();
  await expect(page.locator("#member-management")).toHaveCount(0);
  await expect(page.locator("#community-moderation")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("school-a student");
  await expect(page.locator("main")).not.toContainText("admin-a@example.invalid");
  expect(fixture.requests.filter((request) => request.method === "POST")).toHaveLength(1);
  expect(fixture.blocked).toEqual([]);
});

test("切校后返回同校仍拒绝上一次名单的迟到结果", async ({ page, baseURL }) => {
  const fixture = await syntheticAdminLifecycle(page, baseURL!);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let schoolAReads = 0;
  fixture.interceptors.set("GET /api/admin/teacher-student-assignments", async (route) => {
    const schoolId = new URL(route.request().url()).searchParams.get("schoolId")!;
    const old = schoolId === "school-a" && ++schoolAReads === 1;
    if (old) await gate;
    const roster = adminRoster(schoolId);
    if (old) roster.teachers[0] = { id: "old-a-teacher", display_name: "STALE_A_TEACHER", email: "old-a@example.invalid" };
    await route.fulfill({ json: roster });
  });
  await page.goto("/admin");
  await expect.poll(() => schoolAReads).toBe(1);
  await page.locator("#teacher-assignment summary").click();
  await page.locator("#member-management select").first().selectOption("school-b");
  await page.locator("#member-management select").first().selectOption("school-a");
  await expect(page.locator("#teacher-assignment select")).toHaveValue("school-a-teacher");
  const lateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/teacher-student-assignments"
    && new URL(response.url()).searchParams.get("schoolId") === "school-a");
  release();
  await finishLateResponse(page, lateResponse);
  await expect(page.locator("#teacher-assignment select")).toHaveValue("school-a-teacher");
  await expect(page.locator("#teacher-assignment")).not.toContainText("STALE_A_TEACHER");
  expect(fixture.blocked).toEqual([]);
});

test("旧账号表单不能使用刚取得的新账号令牌提交", async ({ page, baseURL }) => {
  const fixture = await syntheticAdminLifecycle(page, baseURL!);
  await page.goto("/admin");
  await expect(page.locator("#member-management")).toBeVisible();
  await page.getByLabel("成员姓名", { exact: true }).fill("Old actor form");
  await page.getByLabel("成员登录邮箱", { exact: true }).fill("old-form@example.invalid");
  // Model the interval before this tab receives the cross-tab Auth event.
  await fixture.switchActor("admin-b", false);
  await page.getByRole("button", { name: "添加成员", exact: true }).click();
  await expect(page.locator("#member-management")).toHaveCount(0);
  await expect(page.locator("#community-moderation")).toHaveCount(0);
  expect(fixture.requests.filter((request) => request.method !== "GET")).toEqual([]);
  expect(fixture.blocked).toEqual([]);
});

test("批量登记中换号后不提交下一行，也不回填旧结果", async ({ page, baseURL }) => {
  const fixture = await syntheticAdminLifecycle(page, baseURL!);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  fixture.interceptors.set("POST /api/admin/school-assignments", async (route) => {
    await gate;
    await route.fulfill({ json: { displayName: "Synthetic row" } });
  });
  await page.goto("/admin");
  await expect(page.locator("#member-management")).toBeVisible();
  await page.getByText("一次登记多名成员", { exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({ name: "synthetic.csv", mimeType: "text/csv", buffer: Buffer.from("姓名,邮箱,身份\nFirst,first@example.invalid,支持老师\nSecond,second@example.invalid,支持老师") });
  await page.getByRole("button", { name: "确认登记 2 人", exact: true }).click();
  await expect.poll(() => fixture.requests.filter((request) => request.method === "POST")).toHaveLength(1);
  await fixture.switchActor("admin-b");
  await expect(page.locator("#role-overview")).toContainText("admin-b@example.invalid");
  const lateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/school-assignments"
    && response.request().method() === "POST");
  release();
  await finishLateResponse(page, lateResponse);
  await expect(page.locator("main")).not.toContainText("批量登记完成");
  expect(fixture.requests.filter((request) => request.method === "POST")).toHaveLength(1);
  expect(fixture.blocked).toEqual([]);
});

test("换为学生不能保留上一账号的学校工作台", async ({ page, baseURL }) => {
  const fixture = await syntheticAdminLifecycle(page, baseURL!);
  await page.goto("/admin");
  await expect(page.locator("#member-management")).toBeVisible();
  await fixture.switchActor("student");
  await expect(page.locator("#member-management")).toHaveCount(0);
  await expect(page.locator("#community-moderation")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("admin-a@example.invalid");
  expect(fixture.requests.filter((request) => request.authorization.includes("student") && request.method !== "GET")).toEqual([]);
  expect(fixture.blocked).toEqual([]);
});

for (const prefix of ["", "/en"]) {
  test(`${prefix || "zh"} 老师工作台保留消息与负责学生入口`, async ({ page, baseURL }) => {
    const fixture = await syntheticAdminLifecycle(page, baseURL!);
    fixture.interceptors.set("GET /api/admin/overview", (route) => route.fulfill({ json: {
      ...adminOverview("admin-a"), admin: { email: "teacher@example.invalid", role: "支持老师", status: "active", scope: "school", canManageMembers: false },
    } }));
    await page.goto(`${prefix}/admin`);
    await expect(page.getByRole("heading", { name: prefix ? "Teacher workspace" : "老师工作台", exact: true })).toBeVisible();
    await expect(page.locator(`main a[href='${prefix}/messages']`)).toBeVisible();
    await expect(page.locator(`main a[href='${prefix}/account#students']`)).toBeVisible();
    await expect(page.locator("#member-management")).toHaveCount(0);
    expect(fixture.blocked).toEqual([]);
  });
}
