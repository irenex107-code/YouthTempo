import { expect, test } from "@playwright/test";

test("AI 接口在调用模型前拒绝超长输入", async ({ request }) => {
  const response = await request.post("/api/ai/mood-journal", {
    data: {
      selectedWords: ["有点累"],
      context: "a".repeat(21_000),
    },
  });

  expect(response.status()).toBe(413);
  await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("精简") });
});

test("紧急安全信号不受 AI 服务与限流状态影响", async ({ request }) => {
  const response = await request.post("/api/ai/talk", {
    data: { messages: [{ role: "user", content: "我现在想伤害自己" }] },
  });

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ urgent: true, suggestHumanSupport: true });
});
