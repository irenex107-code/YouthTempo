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

for (const copy of [
  {
    prefix: "", closed: "AI 对话暂未开放", privacy: "这里不会收集或发送对话内容。",
    personal: /平时聊天的方式给老师或家长发一条悄悄话/,
    referral: "看看下一步找谁", inbox: "打开悄悄话信箱",
  },
  {
    prefix: "/en", closed: "AI chat is paused", privacy: "This page doesn’t collect or send chat messages.",
    personal: /a note to a teacher or parent the way you usually keep in touch/,
    referral: "Find the right support", inbox: "Open private messages",
  },
]) {
  test(`关闭页面区分日常联系与站内信箱 ${copy.prefix || "zh-CN"}`, async ({ page }) => {
    await page.goto(`${copy.prefix}/talk`);

    await expect(page.getByText(copy.closed, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.privacy, { exact: true })).toBeVisible();
    await expect(page.locator("main p").filter({ hasText: copy.personal })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("link", { name: copy.referral, exact: true })).toHaveAttribute("href", `${copy.prefix}/referral`);
    await expect(page.getByRole("link", { name: copy.inbox, exact: true })).toHaveAttribute("href", `${copy.prefix}/messages`);
  });
}

test("青少年工具列表不再展示 Talk 入口", async ({ page }) => {
  await page.goto("/for-teens");

  await expect(page.locator('a[href="/talk"]')).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "我想做什么" }).getByRole("link", { name: "找人聊聊" })).toBeVisible();
});
