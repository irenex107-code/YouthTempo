import type { NextApiRequest, NextApiResponse } from "next";
import { fail, generateJson, missing, requirePost, shortText } from "./_shared";

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
    return missing(res);
  }

  try {
    const result = (await generateJson({
      task: [
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
      recommendedSupport: shortText(result.recommendedSupport, "可以先从你最愿意接受的一种支持开始。"),
      reason: shortText(result.reason, "先选择阻力较小的入口，更容易把现在的需要说清楚。"),
      nextStep: shortText(result.nextStep, "今天先告诉一个可信任的人：“我最近有点卡住，想先和你说说。”"),
      whenToSeekMoreSupport: shortText(result.whenToSeekMoreSupport, "如果这种状态持续影响睡眠、吃饭、学习或日常生活，可以尽快连接学校或专业支持。"),
      supportReminder: shortText(result.supportReminder, "你不需要一次解决全部问题，可以先让一个人知道。"),
    });
  } catch (error) {
    console.error(error);
    fail(res);
  }
}
