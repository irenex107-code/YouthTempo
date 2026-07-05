import type { NextApiRequest, NextApiResponse } from "next";
import { fail, generateJson, missing, requirePost } from "./_shared";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requirePost(req, res)) return;
  const { selectedWords, context, bodyFeeling, recurringThought, communicationStarter } = req.body || {};
  const hasWords = Array.isArray(selectedWords) && selectedWords.length > 0;
  if (!hasWords && !context && !bodyFeeling && !recurringThought) {
    return missing(res);
  }

  try {
    const result = await generateJson({
      task:
        "根据用户的情绪词、情境、身体感受和反复出现的想法，生成温和的情绪回应。帮助命名情绪但不要过度解释，不要诊断。",
      schema:
        '{ "emotionReflection": string, "possibleNeed": string, "communicationSuggestion": string, "smallStep": string, "supportReminder": string }',
      input: { selectedWords, context, bodyFeeling, recurringThought, communicationStarter },
    });
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    fail(res);
  }
}
