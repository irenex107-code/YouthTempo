import { expect, test } from "@playwright/test";
import { moderateCommunityContent, moderateStudentMessage } from "@/lib/messageSafety";
import { detectCrisis, detectCrisisInValues, getCrisisResponse, type CrisisLocale, type CrisisReason } from "@/lib/safety/crisisDetection";
import checkInHandler from "@/pages/api/ai/check-in";
import moodJournalHandler from "@/pages/api/ai/mood-journal";
import referralHandler from "@/pages/api/ai/referral";
import talkHandler from "@/pages/api/ai/talk";
import worryTimeHandler from "@/pages/api/ai/worry-time";

// Synthetic regression labels approved for this local additive repair. These
// examples are not an exhaustive language corpus or a clinical risk assessment.
const urgentCases: Array<{ id: string; text: string; reason: CrisisReason }> = [
  { id: "zh-own-life", text: "我今晚要结束自己的生命。", reason: "suicidal_intent" },
  { id: "en-commit-suicide", text: "I intend to commit suicide tonight.", reason: "suicidal_intent" },
  { id: "en-third-party-intent", text: "My friend wants to kill herself tonight, and she is alone now.", reason: "suicidal_intent" },
  { id: "en-third-party-human-harm", text: "My friend is being hurt by a family member and is not safe right now.", reason: "harm_by_others" },
  { id: "en-third-party-ongoing-abuse", text: "My friend is being abused right now.", reason: "harm_by_others" },
  { id: "en-third-party-ongoing-harm", text: "They are being harmed right now.", reason: "harm_by_others" },
  { id: "en-third-party-human-modifier", text: "My friend is being harmed emotionally by a family member.", reason: "harm_by_others" },
  { id: "en-third-party-human-place", text: "My classmate is being abused at school by a teacher.", reason: "harm_by_others" },
];

const intentVariants = [
  "我现在想要结束我自己的生命。",
  "我已经决定结束自己的生命。",
  "I will commit suicide tonight.",
  "I'll commit suicide tonight.",
  "I'm going to commit suicide tonight.",
  "I am planning to commit suicide tonight.",
  "She wants to kill herself tonight.",
  "He plans to kill himself tonight.",
  "They intend to kill themselves tonight.",
];

const harmVariants = [
  "My friend is being harmed by a family member right now.",
  "My classmate is being hurt by a teacher.",
  "She is being abused right now.",
];

const addedBoundaryRegressions = [
  { id: "zh-life-metaphor", text: "我想结束自己生命中的迷茫，先好好睡一觉。" },
  { id: "zh-life-routine", text: "我想结束自己生命中每天熬夜的状态。" },
  { id: "en-exam-stress-source", text: "My friend is being harmed by exam stress, but she is safe." },
  { id: "en-exam-grade-source", text: "My classmate is being harmed by a disappointing exam grade." },
];

const ordinaryCases = [
  "My friend is being harmed emotionally by exam stress, but she is safe.",
  "My friend is being harmed by exam stress caused by a teacher.",
  "我想结束自己生命里的迷茫，先休息。",
  "My friend is being abused by homework pressure, but he is safe.",
  "My friend is being harmed right now by exam stress, but she is safe.",
  "My friend is being harmed constantly by exam stress, but she is safe.",
  "最近学校作业很多，我有点累和不知所措。",
  "我不想住在这个城市，想搬走。",
  "我昨天踢球时不小心擦伤了膝盖，现在没事。",
  "我今晚要结束自己的课程。",
  "我今晚要结束自己的生命科学课程。",
  "I feel tired and overwhelmed by schoolwork.",
  "I don't want to live here; I want to move to another city.",
  "I hurt myself playing football yesterday.",
  "I intend to study suicide prevention tonight.",
  "I intend to commit to a school project.",
  "My friend wants to kill time before class.",
  "My friend wants to finish her homework tonight.",
  "My friend hurt herself playing football yesterday.",
  "My friend was hurt in an accident yesterday and is safe now.",
  "My friend is being hurt by football training.",
  "My friend is being hurt by a disappointing exam grade.",
  "She is being helped by a teacher.",
];

// These are bounded scope checks, not a general policy that denial or historical
// disclosure is safe. Broader historical/ambiguous handling still needs review.
const scopeCases = [
  "我没有打算结束自己的生命。",
  "I don't intend to commit suicide; this is a textbook example.",
  "My friend does not want to kill herself; this is a textbook example.",
  "My friend is not being abused right now.",
  "They are not being harmed right now.",
  "My friend was being abused last year.",
  "My friend wanted to kill herself years ago.",
];

const realRiskWithContextWords = [
  "My friend is being harmed by exam stress, but she is being abused at school by a teacher.",
  "She is being abused at school by a teacher, while my friend is being harmed by exam stress.",
  "我想结束自己生命中的迷茫。但我今晚要结束自己的生命。",
  "My friend is being harmed by exam stress, but she is being abused right now.",
  "My friend is being harmed by exam stress, but she is being hurt by a family member.",
  "She is being abused right now, while my friend is being harmed by exam stress.",
  "She is being abused and my friend is being harmed by exam stress.",
  "They are being harmed right now by a family member.",
  "我不是在讨论小说，我今晚要结束自己的生命。",
  "I don't intend to discuss a novel; I intend to commit suicide tonight.",
  "My friend does not want to discuss a novel; she wants to kill herself tonight.",
  "My friend is not being hurt by football; she is being abused right now.",
  "My friend just texted me, 'I want to die', and is alone now.",
  "我朋友刚给我发消息：“我不想活了”，他现在一个人。",
];

// Deliberate pending-policy cases: no classroom/fiction/quotation exemption is
// authorized. Preserve the conservative urgent path rather than silently waive it.
const conservativeQuotes = [
  "语文课讲解小说中“不想活了”这句话的修辞。",
  "In literature class, the fictional character says 'I want to die'.",
  "课堂要求我们讨论如何预防自杀，并不涉及现实中正在受伤的人。",
  "Our class quotes 'I intend to commit suicide tonight.'",
  "语文课引用“我今晚要结束自己的生命”这句话。",
  "In a grammar exercise, 'My friend is being abused right now' is present continuous.",
];

type AiHandler = typeof talkHandler;

async function callHandler(handler: AiHandler, body: Record<string, unknown>) {
  let statusCode = 0;
  let payload: unknown;
  const response = {
    setHeader: () => undefined,
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { payload = value; return this; },
  };
  await handler({ method: "POST", body } as never, response as never);
  return { statusCode, payload };
}

async function withoutNetwork<T>(operation: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("Synthetic safety regression must not use the network.");
  };
  try {
    const result = await operation();
    expect(networkCalls).toBe(0);
    return result;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const handlerCases: Array<{ name: string; handler: AiHandler; body: (text: string, locale: CrisisLocale) => Record<string, unknown> }> = [
  { name: "check-in", handler: checkInHandler, body: (text, locale) => ({ locale, sensitiveConsentAccepted: false, records: [{ fields: [{ value: text }] }] }) },
  { name: "mood-journal", handler: moodJournalHandler, body: (text, locale) => ({ locale, selectedWords: ["tired"], context: text }) },
  { name: "talk-earlier-user-message", handler: talkHandler, body: (text, locale) => ({ locale, messages: [
    { role: "user", content: text }, { role: "assistant", content: "Please contact someone nearby." }, { role: "user", content: "I do not know what to say now." },
  ] }) },
  { name: "worry-time", handler: worryTimeHandler, body: (text, locale) => ({ locale, worries: ["schoolwork", text], controls: [], action: "" }) },
  { name: "referral", handler: referralHandler, body: (text, locale) => ({ locale, note: text }) },
];

for (const locale of ["zh-CN", "en"] as const) {
  for (const item of addedBoundaryRegressions) {
    test(`${locale} narrowed addition ${item.id} avoids a new false positive`, () => {
      expect(detectCrisis(item.text, locale)).toEqual({ isUrgent: false });
      expect(moderateStudentMessage(item.text, locale)).toEqual({ status: "sent", reason: null });
      expect(moderateCommunityContent(item.text, locale)).toEqual({ status: "published", reason: null });
    });
  }

  for (const item of urgentCases) {
    test(`${locale} additive ${item.id} detects explicit urgent signal`, () => {
      expect(detectCrisis(item.text, locale)).toEqual({ isUrgent: true, matchedReason: item.reason });
    });

    test(`${locale} additive ${item.id} retains Messages and Community safety_review`, () => {
      expect(moderateStudentMessage(item.text, locale)).toMatchObject({ status: "safety_review" });
      expect(moderateCommunityContent(item.text, locale)).toMatchObject({ status: "safety_review" });
    });

    for (const scenario of handlerCases) {
      test(`${locale} additive ${item.id} ${scenario.name} stops before network/provider and ordinary gates`, async () => {
        await withoutNetwork(async () => {
          const result = await callHandler(scenario.handler, scenario.body(item.text, locale));
          expect(result).toEqual({ statusCode: 200, payload: {
            reply: getCrisisResponse(locale), urgent: true, suggestHumanSupport: true,
          } });
        });
      });
    }
  }

  test(`${locale} additive explicit intent and ongoing human-harm variants`, () => {
    for (const text of intentVariants) expect(detectCrisis(text, locale), text).toEqual({ isUrgent: true, matchedReason: "suicidal_intent" });
    for (const text of harmVariants) expect(detectCrisis(text, locale), text).toEqual({ isUrgent: true, matchedReason: "harm_by_others" });
  });

  test(`${locale} additive ordinary stress and accidental injuries keep ordinary moderation`, () => {
    for (const text of ordinaryCases) {
      expect(detectCrisis(text, locale), text).toEqual({ isUrgent: false });
      expect(moderateStudentMessage(text, locale), text).toEqual({ status: "sent", reason: null });
      expect(moderateCommunityContent(text, locale), text).toEqual({ status: "published", reason: null });
    }
  });

  test(`${locale} additive bounded negation/history cases do not expand without review`, () => {
    for (const text of scopeCases) expect(detectCrisis(text, locale), text).toEqual({ isUrgent: false });
  });

  test(`${locale} additive context words never create a blanket exemption`, () => {
    for (const text of realRiskWithContextWords) expect(detectCrisis(text, locale), text).toMatchObject({ isUrgent: true });
    for (const text of conservativeQuotes) {
      expect(detectCrisis(text, locale), text).toMatchObject({ isUrgent: true });
      expect(moderateCommunityContent(text, locale), text).toMatchObject({ status: "safety_review" });
    }
  });

  test(`${locale} additive scans earlier nested and mixed-language user text`, () => {
    const text = locale === "en" ? urgentCases[0].text : urgentCases[1].text;
    expect(detectCrisisInValues({ context: "schoolwork", nested: { earlier: [{ text }], latest: "I am not sure what to say now." } }, locale))
      .toEqual({ isUrgent: true, matchedReason: "suicidal_intent" });
  });

  test(`${locale} additive rules cannot replace an earlier legacy reason`, () => {
    expect(detectCrisis(`我不能保证自己的安全。 ${urgentCases[1].text}`, locale))
      .toEqual({ isUrgent: true, matchedReason: "unable_to_stay_safe" });
    expect(detectCrisis(`Someone is hurting me. 我不想活了。 ${urgentCases[1].text}`, locale))
      .toEqual({ isUrgent: true, matchedReason: locale === "en" ? "harm_by_others" : "suicidal_intent" });
  });

  test(`${locale} additive ordinary AI paths keep their notice, closure and deterministic boundaries`, async () => {
    await withoutNetwork(async () => {
      const checkIn = await callHandler(checkInHandler, { locale, records: Array.from({ length: 5 }, () => ({ fields: [{ value: "schoolwork" }] })) });
      expect(checkIn.statusCode).toBe(400);
      expect(checkIn.payload).not.toHaveProperty("urgent");
      const mood = await callHandler(moodJournalHandler, { locale, selectedWords: ["tired"], context: "schoolwork" });
      expect(mood.statusCode).toBe(400);
      expect(mood.payload).not.toHaveProperty("urgent");
      const talk = await callHandler(talkHandler, { locale, messages: [{ role: "user", content: "schoolwork" }] });
      expect(talk.statusCode).toBe(410);
      expect(talk.payload).toMatchObject({ closed: true });
      const worry = await callHandler(worryTimeHandler, { locale, worries: ["schoolwork"], controls: ["a small review"], action: "review for five minutes" });
      expect(worry.statusCode).toBe(200);
      expect(worry.payload).toMatchObject({ decisionMethod: "deterministic_rules" });
      const referral = await callHandler(referralHandler, { locale, currentState: ["学校压力"], duration: "一两周", impact: "已经明显影响", adultWillingness: "愿意", preferredSupport: ["学校支持"], mainNeed: "下一步" });
      expect(referral.statusCode).toBe(200);
      expect(referral.payload).toMatchObject({ decisionMethod: "deterministic_rules" });
    });
  });
}
