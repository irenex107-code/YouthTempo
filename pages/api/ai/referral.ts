import type { NextApiRequest, NextApiResponse } from "next";
import { fail, generateJson, missing, requirePost } from "./_shared";

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
    const result = await generateJson({
      task:
        "根据用户的支持路径问卷，推荐一到两个适合优先尝试的支持路径。请重点结合用户选择的当前状态、主要影响方面、持续时间、影响程度、是否愿意和可信任的大人说、偏好的支持类型和现在最需要的支持。语言要克制、温和、非临床，使用“可以优先考虑”“也许适合先尝试”等表达。不要把结果写成正式评估，也不要使用标签化语言。",
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
    });
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    fail(res);
  }
}
