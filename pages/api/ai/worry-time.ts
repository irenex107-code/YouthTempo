import type { NextApiRequest, NextApiResponse } from "next";
import { fail, generateJson, missing, requirePost } from "./_shared";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requirePost(req, res)) return;
  const { worries, controls, tomorrowAction } = req.body || {};
  if (!Array.isArray(worries) || worries.every((item) => !String(item || "").trim())) {
    return missing(res);
  }

  try {
    const result = await generateJson({
      task:
        "根据用户睡前写下的担心、可控性分类和明天小行动，生成睡前整理回应。帮助区分可做一点点、可暂时放到明天和不确定的部分，用适合睡前的温和语言。",
      schema:
        '{ "controllableParts": string, "canWaitUntilTomorrow": string, "tomorrowSmallAction": string, "bedtimeSentence": string, "supportReminder": string }',
      input: { worries, controls, tomorrowAction },
    });
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    fail(res);
  }
}
