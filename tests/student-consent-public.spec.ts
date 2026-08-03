import { expect, test } from "@playwright/test";

test("知情同意说明公开可查，账户接口拒绝未登录访问", async ({ page, request }) => {
  await page.goto("/privacy-safety#student-consent");
  await expect(page.getByRole("heading", { name: "未成年人及监护人知情同意" })).toBeVisible();
  await expect(page.getByText("学生先确认", { exact: true })).toBeVisible();
  await expect(page.getByText("随时可以撤回", { exact: true })).toBeVisible();

  const response = await request.get("/api/account/consent");
  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: "请先登录。" });
});

test("SWEET AI 在处理回答前要求本次单独确认", async ({ request }) => {
  const response = await request.post("/api/ai/check-in", {
    data: {
      currentDate: new Date().toISOString(),
      sensitiveConsentAccepted: false,
      records: Array.from({ length: 5 }, (_, index) => ({
        id: `step-${index}`,
        fields: [],
      })),
    },
  });
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "请先阅读并确认本次 AI 处理说明。" });
});
