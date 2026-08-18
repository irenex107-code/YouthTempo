import { expect, test } from "@playwright/test";
import talkHandler from "@/pages/api/ai/talk";

async function callTalk(body: Record<string, unknown>) {
  let statusCode = 0;
  let payload: unknown;
  const response = {
    setHeader: () => undefined,
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(nextPayload: unknown) {
      payload = nextPayload;
      return this;
    },
  };

  await talkHandler({ method: "POST", body } as never, response as never);
  return { statusCode, payload };
}

test("中英文普通 Talk 请求均返回版本化关闭状态且不调用模型", async () => {
  const originalFetch = global.fetch;
  let providerCalls = 0;
  global.fetch = async () => {
    providerCalls += 1;
    throw new Error("Closed Talk requests must not call an AI provider.");
  };

  try {
    const zh = await callTalk({
      locale: "zh-CN",
      messages: [{ role: "user", content: "今天作业有点多" }],
    });
    const en = await callTalk({
      locale: "en",
      messages: [{ role: "user", content: "I have a lot of homework today" }],
    });

    expect(zh).toMatchObject({
      statusCode: 410,
      payload: {
        closed: true,
        closureVersion: "talk-closed-2026-08-18",
        error: expect.stringContaining("首轮学校试点期间暂不开放"),
      },
    });
    expect(en).toMatchObject({
      statusCode: 410,
      payload: {
        closed: true,
        closureVersion: "talk-closed-2026-08-18",
        error: expect.stringContaining("not available during the first school pilot"),
      },
    });
    expect(providerCalls).toBe(0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("关闭页面没有对话输入，并提供规则路径与真人支持入口", async ({ page }) => {
  await page.goto("/talk");

  await expect(page.getByRole("heading", { name: "这里暂时不会提供 AI 对话" })).toBeVisible();
  await expect(page.getByText("功能已关闭", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "看看下一步找谁" })).toHaveAttribute("href", "/referral");
  await expect(page.getByRole("link", { name: "打开悄悄话信箱" })).toHaveAttribute("href", "/messages");
});

test("青少年工具列表不再展示 Talk 入口", async ({ page }) => {
  await page.goto("/for-teens");

  await expect(page.locator('a[href="/talk"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "看看下一步" }).first()).toBeVisible();
});
