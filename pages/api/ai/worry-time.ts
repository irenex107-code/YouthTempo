import type { NextApiRequest, NextApiResponse } from "next";
import { buildWorryTimeGuidance } from "@/lib/worryTimeRules";
import { aiText, missing, normalizeAiLocale, requirePost, respondToAiCrisis } from "./_shared";

function normalizeTextList(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 500))
    .slice(0, maxItems);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const locale = normalizeAiLocale(req.body?.locale);
  if (!requirePost(req, res)) return;
  const { worries, controls, tomorrowAction, action } = req.body || {};
  const requestedAction = tomorrowAction || action;
  if (respondToAiCrisis(res, { worries, controls, tomorrowAction: requestedAction }, locale)) return;
  if (!Array.isArray(worries) || worries.every((item) => !String(item || "").trim())) {
    return missing(res, aiText(locale, "请先完成必要问题，再生成回应。", "Complete the required questions before generating a response."));
  }
  res.status(200).json(buildWorryTimeGuidance({
    worries: normalizeTextList(worries, 3),
    controls: normalizeTextList(controls, 3),
    tomorrowAction: typeof requestedAction === "string" ? requestedAction : "",
  }, locale));
}

export const config = {
  api: { bodyParser: { sizeLimit: "32kb" } },
};
