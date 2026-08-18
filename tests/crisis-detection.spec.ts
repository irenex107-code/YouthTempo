import { expect, test } from "@playwright/test";
import { detectCrisis, detectCrisisInValues, getCrisisResponse } from "@/lib/safety/crisisDetection";
import checkInHandler from "@/pages/api/ai/check-in";
import moodJournalHandler from "@/pages/api/ai/mood-journal";
import referralHandler from "@/pages/api/ai/referral";
import talkHandler from "@/pages/api/ai/talk";
import worryTimeHandler from "@/pages/api/ai/worry-time";

type AiHandler = typeof talkHandler;

async function callHandler(handler: AiHandler, body: Record<string, unknown>) {
  let statusCode = 0;
  let payload: unknown;
  const request = { method: "POST", body };
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

  await handler(request as never, response as never);
  return { statusCode, payload };
}

async function callTalk(content: string, locale: "zh-CN" | "en") {
  return callHandler(talkHandler, { locale, messages: [{ role: "user", content }] });
}

test("英文高风险表达触发统一危机检测", () => {
  const examples = [
    "I want to die",
    "I don't want to live",
    "I am thinking about ending my life",
    "I might kill myself",
    "I have suicidal thoughts",
    "I feel life is meaningless",
    "There is no point in me living",
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
  const examples = [
    "我现在想伤害自己",
    "我不想活了",
    "我不能保证自己的安全",
    "我觉得活着没有意义",
    "我最近觉得生活没有意义",
    "我感觉人生毫无意义",
    "我觉得人生没意思",
    "我活着还有什么意思",
  ];

  for (const text of examples) {
    expect(detectCrisis(text, "zh-CN"), text).toMatchObject({ isUrgent: true });
  }
});

test("关于意义的普通讨论不会被当成本人危机表达", () => {
  const examples = [
    "这篇作文讨论人生有没有意义",
    "老师让我们阅读关于生命意义的文章",
    "我在整理哲学课上关于人生意义的笔记",
    "这篇英文作文分析 life is meaningless 这句话",
  ];

  for (const text of examples) {
    expect(detectCrisis(text, "zh-CN"), text).toEqual({ isUrgent: false });
  }
});

test("语言设置不阻止另一种语言的安全兜底", () => {
  expect(detectCrisis("I want to die", "zh-CN")).toMatchObject({ isUrgent: true });
  expect(detectCrisis("我想伤害自己", "en")).toMatchObject({ isUrgent: true });
});

test("递归检查只要任一用户文本命中就进入紧急路径", () => {
  expect(detectCrisisInValues({
    selectedWords: ["有点累"],
    nested: { earlier: "I cannot keep myself safe", latest: "I am okay now" },
  }, "zh-CN")).toEqual({
    isUrgent: true,
    matchedReason: "unable_to_stay_safe",
  });

  expect(detectCrisisInValues({ worries: ["作业有点多"], action: "明天先写五分钟" }, "zh-CN"))
    .toEqual({ isUrgent: false });
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

test("五个支持场景都在限流和模型调用前截断高风险文本", async () => {
  const originalFetch = global.fetch;
  let aiCallCount = 0;
  global.fetch = async () => {
    aiCallCount += 1;
    throw new Error("Urgent requests must not call OpenAI.");
  };

  const urgentText = "我现在想伤害自己";
  const cases: Array<{ name: string; handler: AiHandler; body: Record<string, unknown> }> = [
    {
      name: "check-in",
      handler: checkInHandler,
      body: {
        locale: "zh-CN",
        sensitiveConsentAccepted: false,
        records: [{ fields: [{ value: urgentText }] }],
      },
    },
    {
      name: "mood-journal",
      handler: moodJournalHandler,
      body: { locale: "zh-CN", selectedWords: ["累"], context: urgentText },
    },
    {
      name: "talk-earlier-message",
      handler: talkHandler,
      body: {
        locale: "zh-CN",
        messages: [
          { role: "user", content: urgentText },
          { role: "assistant", content: "请先联系身边可信任的大人。" },
          { role: "user", content: "我现在不知道说什么" },
        ],
      },
    },
    {
      name: "worry-time",
      handler: worryTimeHandler,
      body: { locale: "zh-CN", worries: ["作业", urgentText], controls: [], action: "" },
    },
    {
      name: "referral",
      handler: referralHandler,
      body: {
        locale: "zh-CN",
        note: urgentText,
      },
    },
  ];

  try {
    for (const item of cases) {
      const result = await callHandler(item.handler, item.body);
      expect(result.statusCode, item.name).toBe(200);
      expect(result.payload, item.name).toMatchObject({
        urgent: true,
        suggestHumanSupport: true,
        reply: expect.stringContaining("可信任的大人"),
      });
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
