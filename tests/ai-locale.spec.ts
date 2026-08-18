import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  aiText,
  generateJson,
  getAiSystemMessage,
  normalizeAiLocale,
  resolveAiProviderConfiguration,
} from "@/pages/api/ai/_shared";

test.describe.configure({ mode: "serial" });

function enableTestProvider() {
  const original = {
    enabled: process.env.AI_GENERATION_ENABLED,
    baseUrl: process.env.OPENAI_BASE_URL,
    hosts: process.env.AI_ALLOWED_PROVIDER_HOSTS,
    model: process.env.OPENAI_MODEL,
    models: process.env.AI_ALLOWED_MODELS,
  };
  process.env.AI_GENERATION_ENABLED = "true";
  process.env.OPENAI_BASE_URL = "https://api.openai.com";
  process.env.AI_ALLOWED_PROVIDER_HOSTS = "api.openai.com";
  process.env.OPENAI_MODEL = "gpt-4.1-mini-2025-04-14";
  process.env.AI_ALLOWED_MODELS = "gpt-4.1-mini-2025-04-14";
  return () => {
    for (const [key, value] of Object.entries({
      AI_GENERATION_ENABLED: original.enabled,
      OPENAI_BASE_URL: original.baseUrl,
      AI_ALLOWED_PROVIDER_HOSTS: original.hosts,
      OPENAI_MODEL: original.model,
      AI_ALLOWED_MODELS: original.models,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

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
  const restoreProvider = enableTestProvider();
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
    restoreProvider();
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("英文请求使用英文 prompt 并返回英文 JSON", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const restoreProvider = enableTestProvider();
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
    restoreProvider();
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("生成模型默认关闭，且 provider 主机与模型快照必须同时通过白名单", () => {
  const restoreProvider = enableTestProvider();
  try {
    process.env.AI_GENERATION_ENABLED = "false";
    expect(() => resolveAiProviderConfiguration()).toThrow("disabled");

    process.env.AI_GENERATION_ENABLED = "true";
    process.env.OPENAI_BASE_URL = "https://unapproved.example.com";
    expect(() => resolveAiProviderConfiguration()).toThrow("host is not allowlisted");

    process.env.OPENAI_BASE_URL = "https://api.openai.com";
    process.env.OPENAI_MODEL = "gpt-4.1-mini";
    process.env.AI_ALLOWED_MODELS = "gpt-4.1-mini";
    expect(() => resolveAiProviderConfiguration()).toThrow("dated snapshot");

    process.env.OPENAI_MODEL = "gpt-4.1-mini-2025-04-14";
    process.env.AI_ALLOWED_MODELS = "gpt-4.1-mini-2025-04-14";
    expect(resolveAiProviderConfiguration()).toMatchObject({
      model: "gpt-4.1-mini-2025-04-14",
    });
  } finally {
    restoreProvider();
  }
});

test("两个 AI 摘要页面与 API 都传递 locale 并提供双语 fallback", async () => {
  const cases = [
    { view: "views/check-in/page.tsx", api: "pages/api/ai/check-in.ts" },
    { view: "views/mood-journal/page.tsx", api: "pages/api/ai/mood-journal.ts" },
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

test("Worry Time 保留双语固定规则且不再调用生成模型", async () => {
  const [viewSource, apiSource] = await Promise.all([
    readFile(path.join(process.cwd(), "views/worry-time/page.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "pages/api/ai/worry-time.ts"), "utf8"),
  ]);
  expect(viewSource).toContain("worryTime.ruleBased.label");
  expect(viewSource).not.toContain("AiTransparencyNotice");
  expect(apiSource).toContain("buildWorryTimeGuidance");
  expect(apiSource).not.toContain("generateJson");
  expect(apiSource).not.toContain("requireAiNotice");
});

test("Talk API 保留双语关闭回应与固定危机路径，但不再调用生成模型", async () => {
  const [viewSource, apiSource] = await Promise.all([
    readFile(path.join(process.cwd(), "views/talk/page.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "pages/api/ai/talk.ts"), "utf8"),
  ]);
  expect(viewSource).toContain("talk.closed.title");
  expect(viewSource).not.toContain('fetch("/api/ai/talk"');
  expect(apiSource).toContain("normalizeAiLocale(req.body?.locale)");
  expect(apiSource).toContain("respondToAiCrisis");
  expect(apiSource).toContain("TALK_PILOT_CLOSURE_VERSION");
  expect(apiSource).toContain("aiText(");
  expect(apiSource).not.toContain("generateJson");
  expect(apiSource).not.toContain("requireAiNotice");
});

test("Referral 保留双语接口但不再调用生成模型", async () => {
  const [viewSource, apiSource] = await Promise.all([
    readFile(path.join(process.cwd(), "views/referral/page.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "pages/api/ai/referral.ts"), "utf8"),
  ]);
  expect(viewSource).toContain("referral.ruleBased.label");
  expect(apiSource).toContain("buildReferralGuidance");
  expect(apiSource).not.toContain("generateJson");
  expect(apiSource).not.toContain("requireAiNotice");
});

test("中英文 system prompt 保持相同产品和安全边界", () => {
  const zh = getAiSystemMessage("zh-CN");
  const en = getAiSystemMessage("en");

  expect(zh).toContain("不诊断");
  expect(zh).toContain("不替代医生");
  expect(en).toContain("Do not diagnose");
  expect(en).toContain("replace doctors");
  expect(en).toContain("Safety always takes priority");
});
