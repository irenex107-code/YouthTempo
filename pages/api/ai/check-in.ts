import type { NextApiRequest, NextApiResponse } from "next";
import { fail, generateJson, missing, requireAiInputSize, requireAiRateLimit, requirePost, shortText } from "./_shared";

type CheckInResult = {
  summary?: unknown;
  mainAffectedAreas?: unknown;
  rhythmClue?: unknown;
  smallStep?: unknown;
  recommendedNextTool?: unknown;
  supportReminder?: unknown;
};

function hasAnswer(value: unknown) {
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" && item.trim());
  return typeof value === "string" && Boolean(value.trim());
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function compactRecords(records: unknown[]) {
  return records.map((record) => {
    const item = record && typeof record === "object" ? record as Record<string, unknown> : {};
    const fields = Array.isArray(item.fields) ? item.fields : [];
    return {
      id: textValue(item.id),
      title: textValue(item.title),
      label: textValue(item.label),
      dimension: textValue(item.dimension),
      fields: fields.flatMap((field) => {
        const nextField = field && typeof field === "object" ? field as Record<string, unknown> : {};
        if (!hasAnswer(nextField.value)) return [];
        return [{
          id: textValue(nextField.id),
          title: textValue(nextField.title),
          value: Array.isArray(nextField.value)
            ? nextField.value.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
            : textValue(nextField.value),
        }];
      }),
    };
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requirePost(req, res)) return;
  const { records, currentDate } = req.body || {};
  if (!Array.isArray(records) || records.length < 5 || records.some((record) => !Array.isArray(record?.fields))) {
    return missing(res);
  }
  if (!requireAiInputSize(req, res)) return;
  if (!(await requireAiRateLimit(req, res))) return;

  try {
    const result = (await generateJson({
      task:
        [
          "根据用户填写的 SWEET 节律记录，生成一份手机上十秒左右可以读完的今日回应。",
          "SWEET 包含 Sleep 睡眠、Wake 醒来、Eat 饮食、Exercise 运动、Task 任务投入。",
          "不要逐项复述问卷，也不要写成分析报告。先抓住最有用的一条主线：今天哪里还算顺利，哪里最费力，两者是否可能互相影响。",
          "summary：1 到 2 句，60 字以内。直接回应用户今天的具体状态，不以“根据记录”“数据显示”开头。",
          "mainAffectedAreas：最多两个维度，使用“睡眠、醒来、饮食、运动、任务投入”中的名称；没有明显波动时可以为空。",
          "rhythmClue：1 到 2 句，80 字以内。只解释记录中确实存在的一条可能联系，使用“可能、看起来、也许”，不要断言原因。",
          "smallStep：只给一个明天十分钟内能完成的小行动。要具体到何时、做什么，不使用“保持规律、注意休息、健康饮食、适当运动”等空泛表达。",
          "recommendedNextTool：只推荐一个入口，并简短说明原因。睡前反复想事或入睡困难时选“今晚先放下”；有难以说清的情绪时选“心情拼图”；多项日常功能明显受影响或需要真人支持时选“下一步找谁”；其余情况写“今天先到这里就可以”。",
          "supportReminder：通常一句即可。状态较平稳时不要机械地要求求助；只有记录体现持续困难、明显无法启动或安全风险时，再建议联系可信任的大人或专业支持。",
          "语言要像自然对话，避免“赋能、维度波动、改善身心状态、提升专注力”等报告式词语。不要诊断，不要评价体重、身材、热量或意志力。",
          "不要写成：“你在睡眠、饮食和任务投入方面存在波动，建议改善生活习惯。”",
          "更接近这样的表达：“昨晚没睡稳，早上也更难启动，这两件事可能连在一起。明早起床后先喝几口水，再只做五分钟最急的任务。”",
          "如果整体平稳，不要硬找问题，可以直接肯定今天已经维持住的节奏，并给出“不必额外加任务”的小结。",
        ].join("\n"),
      schema:
        '{ "summary": string, "mainAffectedAreas": string[], "rhythmClue": string, "smallStep": string, "recommendedNextTool": string, "supportReminder": string }',
      input: { records: compactRecords(records), currentDate },
    })) as CheckInResult;
    res.status(200).json({
      summary: shortText(result.summary, "今天的记录已经整理好了。"),
      mainAffectedAreas: Array.isArray(result.mainAffectedAreas)
        ? result.mainAffectedAreas.filter((item): item is string => typeof item === "string").slice(0, 2)
        : [],
      rhythmClue: shortText(result.rhythmClue, "今天暂时没有特别明显的节律线索，不需要急着下结论。"),
      smallStep: shortText(result.smallStep, "明天先选一个最容易开始的小任务，做五分钟就可以停。"),
      recommendedNextTool: shortText(result.recommendedNextTool, "今天先到这里就可以。"),
      supportReminder: shortText(result.supportReminder, "不用一次解决所有事情，先照顾好今天就可以。"),
    });
  } catch (error) {
    console.error(error);
    fail(res, error);
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "64kb" } },
};
