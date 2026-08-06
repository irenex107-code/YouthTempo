import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  aiText,
  generateJson,
  getAiSystemMessage,
  normalizeAiLocale,
} from "@/pages/api/ai/_shared";

test.describe.configure({ mode: "serial" });

test("AI locale 仅接受 zh-CN 和 en，并默认回落中文", () => {
  expect(normalizeAiLocale("zh-CN")).toBe("zh-CN");
  expect(normalizeAiLocale("en")).toBe("en");
  expect(normalizeAiLocale("en-US")).toBe("zh-CN");
  expect(normalizeAiLocale(undefined)).toBe("zh-CN");
  expect(aiText("zh-CN", "中文 fallback", "English fallback")).toBe("中文 fallback");
  expect(aiText("en", "中文 fallback", "English fallback")).toBe("English fallback");
});

test("中文请求使用中文 prompt 并返回中文 JSON", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  let requestBody: any = null;
  process.env.OPENAI_API_KEY = "test-openai-key";
  global.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ reply: "中文回应" }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await generateJson<{ reply: string }>({
      locale: "zh-CN",
      task: "生成一句回应。",
      schema: '{ "reply": string }',
      input: { message: "今天有点累" },
    });

    expect(result).toEqual({ reply: "中文回应" });
    const messages = requestBody?.messages as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain("只用简体中文");
    expect(messages[1].content).toContain("请严格返回 JSON");
    expect(messages[1].content).toContain("用户输入");
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("英文请求使用英文 prompt 并返回英文 JSON", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  let requestBody: any = null;
  process.env.OPENAI_API_KEY = "test-openai-key";
  global.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ reply: "English response" }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await generateJson<{ reply: string }>({
      locale: "en",
      task: "Write one response.",
      schema: '{ "reply": string }',
      input: { message: "I feel tired today" },
    });

    expect(result).toEqual({ reply: "English response" });
    const messages = requestBody?.messages as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain("Use English only");
    expect(messages[0].content).toContain("Do not diagnose");
    expect(messages[1].content).toContain("Return strict JSON only");
    expect(messages[1].content).toContain("User input");
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("五个 AI 页面与 API 都传递 locale 并提供双语 fallback", async () => {
  const cases = [
    { view: "views/talk/page.tsx", api: "pages/api/ai/talk.ts" },
    { view: "views/check-in/page.tsx", api: "pages/api/ai/check-in.ts" },
    { view: "views/mood-journal/page.tsx", api: "pages/api/ai/mood-journal.ts" },
    { view: "views/worry-time/page.tsx", api: "pages/api/ai/worry-time.ts" },
    { view: "views/referral/page.tsx", api: "pages/api/ai/referral.ts" },
  ];

  for (const item of cases) {
    const [viewSource, apiSource] = await Promise.all([
      readFile(path.join(process.cwd(), item.view), "utf8"),
      readFile(path.join(process.cwd(), item.api), "utf8"),
    ]);
    expect(viewSource, `${item.view} 应读取当前 locale`).toContain("locale");
    expect(viewSource, `${item.view} 应在 AI 请求中发送 locale`).toContain("locale,");
    expect(viewSource, `${item.view} 应序列化 AI 请求`).toContain("JSON.stringify(");
    expect(apiSource, `${item.api} 应规范化 locale`).toContain("normalizeAiLocale(req.body?.locale)");
    expect(apiSource, `${item.api} 应把 locale 交给 generateJson`).toMatch(/generateJson\(\{\s*locale,/);
    expect(apiSource, `${item.api} 应提供双语 fallback`).toContain("aiText(locale");
  }
});

test("中英文 system prompt 保持相同产品和安全边界", () => {
  const zh = getAiSystemMessage("zh-CN");
  const en = getAiSystemMessage("en");

  expect(zh).toContain("不诊断");
  expect(zh).toContain("不替代医生");
  expect(en).toContain("Do not diagnose");
  expect(en).toContain("Do not replace doctors");
  expect(en).toContain("Safety always takes priority");
});
