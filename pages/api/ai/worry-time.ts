import type { NextApiRequest, NextApiResponse } from "next";
import { fail, generateJson, missing, requirePost, shortText } from "./_shared";

type WorryResult = {
  controllableParts?: unknown;
  canWaitUntilTomorrow?: unknown;
  tomorrowSmallAction?: unknown;
  bedtimeSentence?: unknown;
  supportReminder?: unknown;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requirePost(req, res)) return;
  const { worries, controls, tomorrowAction, action } = req.body || {};
  const requestedAction = tomorrowAction || action;
  if (!Array.isArray(worries) || worries.every((item) => !String(item || "").trim())) {
    return missing(res);
  }

  try {
    const result = (await generateJson({
      task: [
        "根据用户睡前写下的担心、可控性分类和明天行动，生成一份适合睡前快速读完的整理。",
        "目的不是解决所有担心，而是帮用户决定：今晚停在哪里，明天先做什么。",
        "controllableParts：一句，55 字以内。只指出今晚或明天确实能做的一小部分；没有可控部分时直接说明今晚不必处理。",
        "canWaitUntilTomorrow：一句，55 字以内。具体说哪件事可以先放下，不要重复全部担心。",
        "tomorrowSmallAction：只给一个十分钟内能完成的动作。用户已填写行动时，优先帮其缩小和具体化，不另起一套建议。",
        "bedtimeSentence：一句自然、不过度煽情的睡前自我提醒，30 字以内。",
        "supportReminder：通常一句，45 字以内。不要机械推荐求助；只有持续失眠、日常明显受影响或有安全风险时才引导联系可信任的大人或专业支持。",
        "不要使用“接纳情绪、释放压力、拥抱自己、相信明天”等空泛或鸡汤式表达。",
      ].join("\n"),
      schema:
        '{ "controllableParts": string, "canWaitUntilTomorrow": string, "tomorrowSmallAction": string, "bedtimeSentence": string, "supportReminder": string }',
      input: { worries, controls, tomorrowAction: requestedAction },
    })) as WorryResult;
    res.status(200).json({
      controllableParts: shortText(result.controllableParts, "今晚先把担心写下来就够了，不需要现在全部解决。"),
      canWaitUntilTomorrow: shortText(result.canWaitUntilTomorrow, "需要更多时间或别人回应的部分，可以留到明天再处理。"),
      tomorrowSmallAction: shortText(result.tomorrowSmallAction, "明天找一个十分钟，把最容易开始的一步做完。"),
      bedtimeSentence: shortText(result.bedtimeSentence, "这件事已经记下了，今晚可以先停在这里。"),
      supportReminder: shortText(result.supportReminder, "现在不用继续想答案，先让身体慢慢休息。"),
    });
  } catch (error) {
    console.error(error);
    fail(res);
  }
}
