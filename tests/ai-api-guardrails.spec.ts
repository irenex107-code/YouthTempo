import { expect, test } from "@playwright/test";
import { AI_NOTICE_VERSION } from "@/lib/aiNotice";

test("AI 接口在调用模型前拒绝超长输入", async ({ request }) => {
  const response = await request.post("/api/ai/mood-journal", {
    data: {
      selectedWords: ["有点累"],
      context: "a".repeat(21_000),
      aiNoticeAccepted: true,
      aiNoticeVersion: AI_NOTICE_VERSION,
    },
  });

  expect(response.status()).toBe(413);
  await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("精简") });
});

test("两个普通 AI 摘要入口都要求确认当前告知版本", async ({ request }) => {
  const cases = [
    { path: "/api/ai/check-in", data: { records: Array.from({ length: 5 }, () => ({ fields: [{ value: "还可以" }] })) } },
    { path: "/api/ai/mood-journal", data: { selectedWords: ["累"], context: "今天作业有点多" } },
  ];

  for (const item of cases) {
    const missing = await request.post(item.path, { data: item.data });
    expect(missing.status(), item.path).toBe(400);
    await expect(missing.json(), item.path).resolves.toEqual({ error: "请先阅读并确认本次 AI 处理说明。" });

    const stale = await request.post(item.path, { data: { ...item.data, aiNoticeAccepted: true, aiNoticeVersion: "old-version" } });
    expect(stale.status(), item.path).toBe(400);
  }
});

test("Worry Time 使用固定规则且不要求 AI 告知", async ({ request }) => {
  const response = await request.post("/api/ai/worry-time", {
    data: {
      worries: ["明天的小测"],
      controls: ["我可以做一点点"],
      action: "复习五分钟",
    },
  });

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    decisionMethod: "deterministic_rules",
    decisionVersion: "worry-time-rules-2026-08-18",
    tomorrowSmallAction: "复习五分钟",
  });
});

test("普通 AI 摘要入口绑定登录与有效同意", async ({ request }) => {
  const cases = [
    { path: "/api/ai/check-in", data: { records: Array.from({ length: 5 }, () => ({ fields: [{ value: "还可以" }] })) } },
    { path: "/api/ai/mood-journal", data: { selectedWords: ["累"], context: "今天作业有点多" } },
  ];

  for (const item of cases) {
    const response = await request.post(item.path, {
      data: { ...item.data, aiNoticeAccepted: true, aiNoticeVersion: AI_NOTICE_VERSION },
    });
    expect(response.status(), item.path).toBe(401);
    await expect(response.json(), item.path).resolves.toMatchObject({ error: expect.stringContaining("登录") });
  }
});

test("Talk 普通请求在首轮学校试点中保持关闭", async ({ request }) => {
  const response = await request.post("/api/ai/talk", {
    data: { messages: [{ role: "user", content: "今天作业有点多" }] },
  });

  expect(response.status()).toBe(410);
  await expect(response.json()).resolves.toMatchObject({
    closed: true,
    closureVersion: "talk-closed-2026-08-18",
    error: expect.stringContaining("首轮学校试点期间暂不开放"),
  });
});

test("Referral 使用固定规则且不要求 AI 告知", async ({ request }) => {
  const response = await request.post("/api/ai/referral", {
    data: {
      currentState: ["情绪压力比较大"],
      duration: "一两周",
      impact: "已经明显影响",
      adultWillingness: "愿意",
      preferredSupport: ["学校支持"],
      mainNeed: "帮我判断下一步",
    },
  });

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    decisionMethod: "deterministic_rules",
    decisionVersion: "referral-rules-2026-08-18",
  });
});

test("五个支持入口的紧急安全信号不受 AI 服务与限流状态影响", async ({ request }) => {
  const urgentText = "我现在想伤害自己";
  const cases = [
    {
      path: "/api/ai/check-in",
      data: {
        sensitiveConsentAccepted: false,
        records: [{ fields: [{ value: urgentText }] }],
      },
    },
    { path: "/api/ai/mood-journal", data: { selectedWords: ["累"], context: urgentText } },
    { path: "/api/ai/talk", data: { messages: [{ role: "user", content: urgentText }] } },
    { path: "/api/ai/worry-time", data: { worries: [urgentText], controls: [], action: "" } },
    {
      path: "/api/ai/referral",
      data: { note: urgentText },
    },
  ];

  for (const item of cases) {
    const response = await request.post(item.path, { data: item.data });
    expect(response.status(), item.path).toBe(200);
    await expect(response.json(), item.path).resolves.toMatchObject({
      urgent: true,
      suggestHumanSupport: true,
      reply: expect.stringContaining("可信任的大人"),
    });
  }
});

test("一次性 AI 工具用固定安全提示替代普通生成结果", async ({ page }) => {
  await page.goto("/mood-journal");
  await page.getByLabel("这件事发生在什么情境里？").fill("我现在想伤害自己");
  await page.getByRole("button", { name: "整理我的感受" }).click();

  const alert = page.locator('section[role="alert"]');
  await expect(alert).toContainText("现在先联系现实中的人");
  await expect(alert).toContainText("可信任的大人");
  await expect(alert).toContainText("不是 AI 对你的诊断或风险评分");
  await expect(page.getByRole("heading", { name: "把现在的感受说清一点" })).toHaveCount(0);
});

test("普通 AI 生成发送当前告知版本并持续标识生成内容", async ({ page }) => {
  await page.route("**/api/ai/mood-journal", async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload).toMatchObject({ aiNoticeAccepted: true, aiNoticeVersion: AI_NOTICE_VERSION });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        emotionReflection: "你可能有些疲惫。",
        possibleNeed: "先休息一下。",
        communicationSuggestion: "可以告诉可信任的人。",
        smallStep: "喝一杯水。",
        supportReminder: "需要时联系真人支持。",
      }),
    });
  });

  await page.goto("/mood-journal");
  await page.getByLabel("这件事发生在什么情境里？").fill("今天作业有点多");
  await page.getByRole("checkbox", { name: /我已阅读并同意/ }).check();
  await page.getByRole("button", { name: "整理我的感受" }).click();
  await expect(page.getByText("AI 辅助记录小结 · 非评估或诊断", { exact: true })).toBeVisible();
});
