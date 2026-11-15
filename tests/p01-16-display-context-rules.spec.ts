import { expect, test } from "@playwright/test";
import {
  buildReferralGuidance,
  type ReferralRuleInput,
  type ReferralRuleResult,
} from "@/lib/referralRules";
import referralHandler from "@/pages/api/ai/referral";

type Locale = "zh-CN" | "en";
type BuildWithDisplayContext = (
  input: ReferralRuleInput,
  locale: Locale,
  displayContext?: unknown,
) => ReferralRuleResult;

const buildWithDisplayContext = buildReferralGuidance as BuildWithDisplayContext;

const expected = {
  "zh-CN": {
    legacy: [
      "可以先使用一个私密的自我整理工具，再决定是否把其中一部分告诉家长、老师或其他可信任的人。",
      "可以先找家长、老师或其他你愿意开口的可信任成年人，让对方听你说，再一起决定下一步。",
      "可以先联系家长、老师或学校指定的学生支持联系人，从你最愿意接受的真人入口开始。",
      "可以先告诉家长、老师或其他可信任的成年人，并请对方协助联系有资质的心理专业人员。",
    ],
    adult: [
      "可以先使用一个私密的自我整理工具；是否联系信任的人或你愿意使用的支持服务，由你决定。",
      "可以先找一位由你选择且信任的人——例如家人、朋友、老师或同事——或你愿意使用的支持服务，再一起决定下一步。",
      "可以从适合你的入口开始：信任的人，学校、校园、工作单位或社区支持，或有资质的专业人员。由你决定先联系哪一个；不要求家长或学校加入。",
      "你可以直接联系有资质的心理专业人员，也可以请由你选择的人——例如家人、朋友、老师、同事，或学校、校园、工作单位、社区的支持联系人——协助连接。这不要求家长或学校加入。",
    ],
  },
  en: {
    legacy: [
      "Start with a private reflection tool, then decide whether you want to share one part with a parent, teacher, or another trusted person.",
      "Begin with a parent or guardian, teacher, or another trusted adult you feel comfortable talking to, and decide the next step together.",
      "Start with a parent or guardian, teacher, or the named student-support contact at school, using the support route you feel most willing to try.",
      "Start with a parent or guardian, teacher, or another trusted adult and ask them to help you connect with a qualified mental health professional.",
    ],
    adult: [
      "Start with a private reflection tool; you decide whether to contact someone you trust or a support service you prefer.",
      "Begin with someone you choose and trust—such as a family member, friend, teacher, or colleague—or a support service you prefer, then decide the next step together.",
      "Choose the route that fits you: someone you trust, school, campus, workplace or community support, or a qualified professional. You decide whom to contact first; a parent, guardian, or school does not have to join.",
      "You can contact a qualified mental health professional directly, or ask someone you choose—such as a family member, friend, teacher, colleague, or school, campus, workplace, or community support contact—to help you connect. This does not require a parent, guardian, or school to join.",
    ],
  },
} as const;

function tierInputs(locale: Locale): ReferralRuleInput[] {
  const base: ReferralRuleInput = {
    currentStates: [locale === "en" ? "emotional pressure" : "情绪压力比较大"],
    affectedAreas: [locale === "en" ? "expression" : "情绪表达"],
    duration: locale === "en" ? "Only today" : "只是今天",
    impact: locale === "en" ? "Not really" : "基本没有",
    adultWillingness: locale === "en" ? "Not now" : "暂时不想",
    preferredSupport: [locale === "en" ? "Time to reflect on my own" : "自己先整理一下"],
    mainNeed: locale === "en" ? "One clear, small step" : "一个具体小步骤",
  };
  return [
    base,
    {
      ...base,
      adultWillingness: locale === "en" ? "willing" : "愿意",
      preferredSupport: [locale === "en" ? "Someone to listen" : "有人听我说"],
    },
    {
      ...base,
      duration: locale === "en" ? "One or two weeks" : "一两周",
      impact: locale === "en" ? "A little" : "有一点影响",
    },
    {
      ...base,
      duration: locale === "en" ? "Longer than that" : "更久一些",
      impact: locale === "en" ? "It is having a significant impact" : "已经明显影响",
    },
  ];
}

async function callReferralApi(body: Record<string, unknown>) {
  let statusCode = 200;
  let payload: unknown;
  const response = {
    setHeader: () => undefined,
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { payload = value; return this; },
  };
  await referralHandler({ method: "POST", body } as never, response as never);
  return { statusCode, payload: payload as Record<string, unknown> };
}

function apiBody(input: ReferralRuleInput, locale: Locale, displayContext?: unknown) {
  return {
    locale,
    currentState: input.currentStates,
    affectedAreas: input.affectedAreas,
    duration: input.duration,
    impact: input.impact,
    adultWillingness: input.adultWillingness,
    preferredSupport: input.preferredSupport,
    mainNeed: input.mainNeed,
    ...(displayContext === undefined ? {} : { displayContext }),
  };
}

for (const locale of ["zh-CN", "en"] as const) {
  test(`${locale} rules keep all four tiers while copy context is explicit and fail-closed`, () => {
    const inputs = tierInputs(locale);
    const legacy = inputs.map((input) => buildWithDisplayContext(input, locale));
    const invalid = inputs.map((input) => buildWithDisplayContext(input, locale, "18_plus"));
    const adult = inputs.map((input) => buildWithDisplayContext(input, locale, "young_adult"));
    const tiers = ["self_guided", "trusted_adult", "school_support", "professional_support"];

    expect(legacy.map((result) => result.supportTier)).toEqual(tiers);
    expect(invalid.map((result) => result.supportTier)).toEqual(tiers);
    expect(adult.map((result) => result.supportTier)).toEqual(tiers);
    expect(legacy.map((result) => result.recommendedSupport)).toEqual(expected[locale].legacy);
    expect(invalid.map((result) => result.recommendedSupport)).toEqual(expected[locale].legacy);
    expect(adult.map((result) => result.recommendedSupport)).toEqual(expected[locale].adult);
  });

  test(`${locale} API accepts only the fixed display context and defaults to legacy copy`, async () => {
    const professional = tierInputs(locale)[3];
    const adult = await callReferralApi(apiBody(professional, locale, "young_adult"));
    const absent = await callReferralApi(apiBody(professional, locale));
    const invalidString = await callReferralApi(apiBody(professional, locale, "18_plus"));
    const invalidArray = await callReferralApi(apiBody(professional, locale, ["young_adult"]));

    for (const result of [adult, absent, invalidString, invalidArray]) {
      expect(result.statusCode).toBe(200);
      expect(result.payload).toMatchObject({
        decisionMethod: "deterministic_rules",
        supportTier: "professional_support",
      });
    }
    expect(adult.payload.recommendedSupport).toBe(expected[locale].adult[3]);
    for (const result of [absent, invalidString, invalidArray]) {
      expect(result.payload.recommendedSupport).toBe(expected[locale].legacy[3]);
    }
  });

  test(`${locale} crisis response still precedes display-copy selection`, async () => {
    const result = await callReferralApi({
      locale,
      displayContext: "young_adult",
      note: locale === "en" ? "I intend to commit suicide tonight." : "我今晚要结束自己的生命。",
    });
    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({ urgent: true, suggestHumanSupport: true });
    expect(result.payload).not.toHaveProperty("decisionMethod");
    expect(result.payload).not.toHaveProperty("supportTier");
  });
}
