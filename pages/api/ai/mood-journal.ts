import type { NextApiRequest, NextApiResponse } from "next";
import { fail, generateJson, missing, requireAiInputSize, requireAiRateLimit, requirePost, shortText } from "./_shared";

type MoodResult = {
  emotionReflection?: unknown;
  possibleNeed?: unknown;
  communicationSuggestion?: unknown;
  smallStep?: unknown;
  supportReminder?: unknown;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requirePost(req, res)) return;
  const {
    selectedWords,
    context,
    bodyFeeling,
    recurringThought,
    desiredSupport,
    communicationStarter,
  } = req.body || {};
  const hasWords = Array.isArray(selectedWords) && selectedWords.length > 0;
  if (!hasWords && !context && !bodyFeeling && !recurringThought) {
    return missing(res);
  }
  if (!requireAiInputSize(req, res)) return;
  if (!(await requireAiRateLimit(req, res))) return;

  try {
    const result = (await generateJson({
      task: [
        "根据用户写下的情绪词、情境、身体感受、想被理解的事和希望获得的支持，生成一份十秒左右可以读完的回应。",
        "不要逐项复述输入，也不要解释用户为什么会这样。抓住一个最明显的感受和一个当下需要即可。",
        "emotionReflection：一句，50 字以内。用“听起来”“你好像”“也许”开头或自然融入，承认具体感受，不夸张、不下结论。",
        "possibleNeed：一句，45 字以内。只写一个可能需要，例如被听完、暂时安静、一起拆小任务；优先采用用户自己写下的希望。",
        "communicationSuggestion：一句可以直接说出口的话，45 字以内。口语化，不使用“我希望你能够理解”“我需要获得支持”等书面表达。",
        "smallStep：只给一个五分钟内能完成的动作，写清现在或今天什么时候做什么。不要使用“调整心态、放松自己、关注感受”等空话。",
        "supportReminder：通常一句，45 字以内。状态一般时不要机械要求求助；持续难受、生活明显受影响或出现安全风险时，再引导联系可信任的大人或专业支持。",
        "避免连续使用“可能、也许、可以”；不要在不同字段重复同一个意思。",
      ].join("\n"),
      schema:
        '{ "emotionReflection": string, "possibleNeed": string, "communicationSuggestion": string, "smallStep": string, "supportReminder": string }',
      input: {
        selectedWords,
        context,
        bodyFeeling,
        recurringThought,
        desiredSupport,
        communicationStarter,
      },
    })) as MoodResult;
    res.status(200).json({
      emotionReflection: shortText(result.emotionReflection, "听起来你现在有些累，也有些说不清的感受。"),
      possibleNeed: shortText(result.possibleNeed, "你现在也许更需要有人先听你说完。"),
      communicationSuggestion: shortText(result.communicationSuggestion, "“我现在有点乱，你能先听我说一会儿吗？”"),
      smallStep: shortText(result.smallStep, "先喝几口水，然后用一分钟写下此刻最明显的感受。"),
      supportReminder: shortText(result.supportReminder, "不用一次说清楚，先说出一点点就可以。"),
    });
  } catch (error) {
    console.error(error);
    fail(res, error);
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "32kb" } },
};
