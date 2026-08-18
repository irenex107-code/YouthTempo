import type { NextApiRequest, NextApiResponse } from "next";
import { aiText, missing, normalizeAiLocale, requirePost, respondToAiCrisis } from "./_shared";
import { buildReferralGuidance } from "@/lib/referralRules";

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

  if (respondToAiCrisis(res, {
    currentState: currentStates,
    affectedAreas: affectedAreaList,
    duration,
    impact,
    adultWillingness: adultWillingnessValue,
    preferredSupport: preferredSupportList,
    mainNeed: mainNeedValue,
    note,
  }, locale)) return;
  if (!currentStates.length || !duration || !impact || !adultWillingnessValue || !preferredSupportList.length || !mainNeedValue) {
    return missing(res, aiText(locale, "请先完成必要问题，再生成回应。", "Complete the required questions before generating a response."));
  }
  res.status(200).json(buildReferralGuidance({
    currentStates,
    affectedAreas: affectedAreaList,
    duration: String(duration),
    impact: String(impact),
    adultWillingness: String(adultWillingnessValue),
    preferredSupport: preferredSupportList,
    mainNeed: String(mainNeedValue),
  }, locale));
}

export const config = {
  api: { bodyParser: { sizeLimit: "32kb" } },
};
