import type { NextApiRequest, NextApiResponse } from "next";
import { aiText, fail, generateJson, missing, normalizeAiLocale, requireAiInputSize, requireAiRateLimit, requirePost, shortText } from "./_shared";

type ReferralResult = {
  recommendedSupport?: unknown;
  reason?: unknown;
  nextStep?: unknown;
  whenToSeekMoreSupport?: unknown;
  supportReminder?: unknown;
};

function normalizeField(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string") return value.split(/[、,]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const locale = normalizeAiLocale(req.body?.locale);
  if (!requirePost(req, res)) return;
  const {
    currentState,
    affectedAreas,
    duration,
    impact,
    adultWillingness,
    trustedAdult,
    preferredSupport,
    supportType,
    mainNeed,
    currentNeed,
    note,
  } = req.body || {};
  const currentStates = normalizeField(currentState);
  const affectedAreaList = normalizeField(affectedAreas);
  const preferredSupportList = normalizeField(preferredSupport || supportType);
  const adultWillingnessValue = adultWillingness || trustedAdult;
  const mainNeedValue = mainNeed || currentNeed;

  if (!currentStates.length || !duration || !impact || !adultWillingnessValue || !preferredSupportList.length || !mainNeedValue) {
    return missing(res, aiText(locale, "请先完成必要问题，再生成回应。", "Complete the required questions before generating a response."));
  }
  if (!requireAiInputSize(req, res, locale)) return;
  if (!(await requireAiRateLimit(req, res, locale))) return;

  try {
    const result = (await generateJson({
      locale,
      task: locale === "en"
        ? [
            "Use the support-pathway questionnaire to give the user one clear, low-pressure route forward that takes about fifteen seconds to read on a phone.",
            "Do not repeat every selected option, write an assessment report, or list many resources. Respect the kinds of support the user is willing to consider.",
            "recommendedSupport: one sentence, no more than 40 English words. Recommend at most two support sources in a clear order, such as speaking with a trusted adult first and then considering school or qualified professional support.",
            "reason: one sentence, no more than 40 English words. Refer only to the one or two most relevant facts. Avoid clinical or management terms such as risk level, symptoms, or intervention.",
            "nextStep: one specific action the user can take today or tomorrow, no more than 40 English words. Give a natural opening sentence when useful.",
            "whenToSeekMoreSupport: one sentence, no more than 45 English words. Explain which concrete changes mean more support is needed. For a safety concern, prioritize a trusted adult nearby; for immediate danger, direct the user to local emergency services.",
            "supportReminder: one sentence, no more than 30 English words. Remind the user that they do not need to manage this alone without repeating another field.",
            "Avoid formal templates such as 'It is recommended that you seek assistance from an appropriate professional' or 'establish a comprehensive support system'.",
          ].join("\n")
        : [
            "根据支持路径问卷，给用户一条清楚、低压力的下一步路线。手机上十五秒左右可以读完。",
            "不要复述所有选项，不要写成评估报告，也不要罗列很多资源。优先尊重用户愿意接受的支持方式。",
            "recommendedSupport：一句，60 字以内。最多推荐两个有先后顺序的支持来源，例如先找可信任的大人，再考虑学校或专业支持。",
            "reason：一句，60 字以内。只引用最关键的一到两个事实解释推荐原因，不使用“风险等级、症状、干预”等临床或管理术语。",
            "nextStep：一个今天或明天能完成的具体动作，60 字以内。能给出口语化开场句时直接给一句。",
            "whenToSeekMoreSupport：一句，70 字以内。说明什么具体变化出现时应升级支持；安全风险时明确优先联系可信任的大人、12356，紧急危险拨打 110 或 120。",
            "supportReminder：一句，45 字以内。表达用户不用独自处理，但不要重复其他字段。",
            "避免“建议您寻求相关专业人士的帮助”“建立完善支持系统”等模板话。",
          ].join("\n"),
      schema:
        '{ "recommendedSupport": string, "reason": string, "nextStep": string, "whenToSeekMoreSupport": string, "supportReminder": string }',
      input: {
        currentState: currentStates,
        affectedAreas: affectedAreaList,
        duration,
        impact,
        adultWillingness: adultWillingnessValue,
        preferredSupport: preferredSupportList,
        mainNeed: mainNeedValue,
        note,
      },
    })) as ReferralResult;
    res.status(200).json({
      recommendedSupport: shortText(result.recommendedSupport, aiText(locale, "可以先从你最愿意接受的一种支持开始。", "Start with the kind of support you feel most willing to accept.")),
      reason: shortText(result.reason, aiText(locale, "先选择阻力较小的入口，更容易把现在的需要说清楚。", "A lower-pressure starting point can make it easier to explain what you need right now.")),
      nextStep: shortText(result.nextStep, aiText(locale, "今天先告诉一个可信任的人：“我最近有点卡住，想先和你说说。”", "Tell someone you trust today: “I have been feeling stuck lately, and I would like to talk.”")),
      whenToSeekMoreSupport: shortText(result.whenToSeekMoreSupport, aiText(locale, "如果这种状态持续影响睡眠、吃饭、学习或日常生活，可以尽快连接学校或专业支持。", "If this continues to affect sleep, eating, learning, or daily life, connect with school or qualified professional support soon.")),
      supportReminder: shortText(result.supportReminder, aiText(locale, "你不需要一次解决全部问题，可以先让一个人知道。", "You do not need to resolve everything at once. Start by letting one person know.")),
    });
  } catch (error) {
    await fail(req, res, error, "referral_generate", locale);
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "32kb" } },
};
