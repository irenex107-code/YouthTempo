import { expect, test } from "@playwright/test";
import { detectCrisis, getCrisisResponse } from "@/lib/safety/crisisDetection";
import talkHandler from "@/pages/api/ai/talk";

async function callTalk(content: string, locale: "zh-CN" | "en") {
  let statusCode = 0;
  let payload: unknown;
  const request = {
    method: "POST",
    body: { locale, messages: [{ role: "user", content }] },
  };
  const response = {
    setHeader: () => undefined,
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      payload = body;
      return this;
    },
  };

  await talkHandler(request as never, response as never);
  return { statusCode, payload };
}

test("英文高风险表达触发统一危机检测", () => {
  const examples = [
    "I want to die",
    "I don't want to live",
    "I am thinking about ending my life",
    "I might kill myself",
    "I have suicidal thoughts",
    "I am thinking about self harm",
    "I want to hurt myself",
    "I cannot keep myself safe",
    "Someone is hurting me",
  ];

  for (const text of examples) {
    expect(detectCrisis(text, "en"), text).toMatchObject({ isUrgent: true });
  }
  expect(detectCrisis("I cannot keep myself safe", "en")).toEqual({
    isUrgent: true,
    matchedReason: "unable_to_stay_safe",
  });
});

test("普通压力或低落表达不触发危机检测", () => {
  const examples = [
    "I feel stressed about school",
    "I am exhausted",
    "I feel sad",
    "I don't want to live in this city",
    "I hurt myself playing football yesterday",
  ];

  for (const text of examples) {
    expect(detectCrisis(text, "en"), text).toEqual({ isUrgent: false });
  }
});

test("中文既有高风险表达继续命中", () => {
  const examples = ["我现在想伤害自己", "我不想活了", "我不能保证自己的安全"];

  for (const text of examples) {
    expect(detectCrisis(text, "zh-CN"), text).toMatchObject({ isUrgent: true });
  }
});

test("语言设置不阻止另一种语言的安全兜底", () => {
  expect(detectCrisis("I want to die", "zh-CN")).toMatchObject({ isUrgent: true });
  expect(detectCrisis("我想伤害自己", "en")).toMatchObject({ isUrgent: true });
});

test("英文高风险输入在 OpenAI 调用前进入确定性安全路径", async () => {
  const originalFetch = global.fetch;
  let aiCallCount = 0;
  global.fetch = async () => {
    aiCallCount += 1;
    throw new Error("Urgent requests must not call OpenAI.");
  };

  try {
    for (const text of ["I want to die", "kill myself", "I cannot keep myself safe"]) {
      const result = await callTalk(text, "en");
      expect(result.statusCode, text).toBe(200);
      expect(result.payload, text).toMatchObject({ urgent: true, suggestHumanSupport: true });
    }
    expect(aiCallCount).toBe(0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("确定性危机回复按语言提供适当紧急支持边界", () => {
  const zh = getCrisisResponse("zh-CN");
  const en = getCrisisResponse("en");

  expect(zh).toContain("可信任的大人");
  expect(en).toContain("cannot replace emergency help");
  expect(en).toContain("trusted person nearby");
  expect(en).toContain("local emergency services");
  expect(en).not.toMatch(/\b(?:110|120|12356)\b/);
});
