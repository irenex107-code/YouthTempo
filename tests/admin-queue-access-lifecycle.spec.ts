import { expect, test, type Page, type Response } from "@playwright/test";
import { syntheticAdminLifecycle } from "./fixtures/synthetic-admin-lifecycle";

async function finishLateResponse(page: Page, response: Promise<Response>) {
  await (await response).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

const queuePaths = [
  "/api/admin/message-duty",
  "/api/admin/community-moderation",
  "/api/admin/community-restrictions",
  "/api/admin/pilot-feedback",
  "/api/admin/pilot-experience",
  "/api/admin/professional-verifications",
] as const;

for (const path of queuePaths) {
  for (const status of [401, 403]) {
    test(`${path} 返回 ${status} 后清除整个管理工作台`, async ({ page, baseURL }) => {
      const fixture = await syntheticAdminLifecycle(page, baseURL!);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      fixture.interceptors.set(`GET ${path}`, async (route) => {
        await gate;
        await route.fulfill({ status, json: { error: "Synthetic access denied" } });
      });
      await page.goto("/admin");
      await expect(page.locator("#role-overview")).toContainText("admin-a@example.invalid");
      await page.getByLabel("成员姓名", { exact: true }).fill("OLD_PRIVILEGED_DRAFT");
      await expect.poll(() => fixture.requests.some((request) => request.path === path)).toBe(true);
      release();
      await expect(page.locator("#member-management")).toHaveCount(0);
      for (const id of ["message-duty", "community-moderation", "pilot-feedback", "professional-verifications"]) {
        await expect(page.locator(`#${id}`)).toHaveCount(0);
      }
      await expect(page.locator("#micro-feedback-admin-title")).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText("admin-a@example.invalid");
      await expect(page.locator("main")).not.toContainText("school-a student");
      await expect(page.locator("main a[href='/account?next=/admin']")).toBeVisible();
      expect(fixture.blocked).toEqual([]);
    });
  }
}

test("同一账号刷新令牌后队列使用新令牌", async ({ page, baseURL }) => {
  const fixture = await syntheticAdminLifecycle(page, baseURL!);
  await page.goto("/admin");
  await expect(page.locator("#message-duty")).toContainText("目前没有值班留言");
  await page.evaluate(() => {
    const key = "sb-youthtempo-synthetic-auth-token";
    const session = JSON.parse(localStorage.getItem(key)!);
    session.access_token = "synthetic-admin-a-refreshed-token";
    localStorage.setItem(key, JSON.stringify(session));
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event: "TOKEN_REFRESHED", session });
    channel.close();
  });
  await page.locator("#message-duty").getByRole("button", { name: "刷新队列", exact: true }).click();
  await expect.poll(() => fixture.requests.filter((request) => request.path === "/api/admin/message-duty")).toHaveLength(2);
  expect(fixture.requests.filter((request) => request.path === "/api/admin/message-duty").at(-1)?.authorization)
    .toBe("Bearer synthetic-admin-a-refreshed-token");
  await expect(page.locator("#member-management")).toBeVisible();
  expect(fixture.blocked).toEqual([]);
});

test("尚未收到换号通知时旧队列按钮不能提交旧账号请求", async ({ page, baseURL }) => {
  const fixture = await syntheticAdminLifecycle(page, baseURL!);
  await page.goto("/admin");
  await expect(page.locator("#message-duty")).toContainText("目前没有值班留言");
  await fixture.switchActor("admin-b", false);
  await page.locator("#message-duty").getByRole("button", { name: "刷新队列", exact: true }).click();
  await expect(page.locator("#member-management")).toHaveCount(0);
  await expect(page.locator("#message-duty")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("admin-a@example.invalid");
  expect(fixture.requests.filter((request) => request.path === "/api/admin/message-duty")).toHaveLength(1);
  expect(fixture.blocked).toEqual([]);
});

test("旧账号队列的迟到审核结果不再发起旧账号刷新", async ({ page, baseURL }) => {
  const fixture = await syntheticAdminLifecycle(page, baseURL!);
  const applicant = {
    user_id: "synthetic-applicant", status: "pending", institution_name: null, position_title: "Synthetic position",
    credential_type: "Synthetic credential", credential_number: "SYNTHETIC-ONLY", credential_issuer: "Synthetic issuer",
    credential_expires_on: null, evidence_reference: "Synthetic evidence", applicant_statement: null,
    verification_basis: "document_review", submitted_at: "2026-10-28T01:00:00Z", reviewed_at: null,
    review_note: null, profile: { email: null, display_name: "OLD_PRIVATE_APPLICANT" }, events: [],
  };
  fixture.interceptors.set("GET /api/admin/professional-verifications", (route) => route.fulfill({ json: {
    verifications: route.request().headers().authorization.includes("admin-a") ? [applicant] : [],
  } }));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  fixture.interceptors.set("PATCH /api/admin/professional-verifications", async (route) => {
    await gate;
    await route.fulfill({ json: {} });
  });
  await page.goto("/admin");
  await expect(page.locator("#professional-verifications")).toContainText("OLD_PRIVATE_APPLICANT");
  await page.locator("#professional-verifications").getByRole("button", { name: "确认通过", exact: true }).click();
  await expect.poll(() => fixture.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
  await fixture.switchActor("admin-b");
  await expect(page.locator("#role-overview")).toContainText("admin-b@example.invalid");
  await expect(page.locator("#professional-verifications")).toContainText("暂时没有专业身份申请");
  const before = fixture.requests.filter((request) => request.method === "GET" && request.path === "/api/admin/professional-verifications").length;
  const lateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/professional-verifications"
    && response.request().method() === "PATCH");
  release();
  await finishLateResponse(page, lateResponse);
  expect(fixture.requests.filter((request) => request.method === "GET" && request.path === "/api/admin/professional-verifications")).toHaveLength(before);
  await expect(page.locator("main")).not.toContainText("OLD_PRIVATE_APPLICANT");
  await expect(page.locator("#professional-verifications")).not.toContainText("已通过");
  expect(fixture.blocked).toEqual([]);
});
