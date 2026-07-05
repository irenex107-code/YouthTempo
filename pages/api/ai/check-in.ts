import type { NextApiRequest, NextApiResponse } from "next";
import { fail, generateJson, missing, requirePost } from "./_shared";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requirePost(req, res)) return;
  const { records, currentDate } = req.body || {};
  if (!Array.isArray(records) || records.length < 5 || records.some((record) => !Array.isArray(record?.fields))) {
    return missing(res);
  }

  try {
    const result = await generateJson({
      task:
        "根据用户填写的 SWEET 节律记录生成今日 SWEET 节律小结。SWEET 是核心结构：Sleep 睡眠、Wake 醒来、Eat 饮食、Exercise 运动、Task 任务投入。必须具体引用用户记录：睡眠时长、睡眠质量、醒来状态、开始难度、吃了几餐、吃了什么、饮食节奏、精力关系、活动时长、活动类型、身体状态、任务投入、卡住因素和已完成的小任务。请识别今天波动最明显的维度，并用温和、具体、非诊断的方式总结五个维度。Eat 要从营养支持、食物丰富度、饮食节奏、精力节律、专注和青少年日常功能角度分析；可以温和建议一顿相对完整的正餐或更稳定的吃饭节奏，但不要计算热量、不要谈体重控制、身材、节食、严格饮食计划，也不要评价用户“不健康”。Exercise 要从轻量活动、久坐、身体紧绷、压力释放、精力节律和专注角度分析；可以建议几分钟走动、拉伸或离开座位，但不要谈燃脂、身材、训练表现、健身目标或高强度计划。Task 要在合适时连接睡眠、精力、情绪和压力。只给一个小行动；推荐下一步时根据记录选择一到两个工具：情绪表达、睡前整理或转介支持。不要诊断，不要医学化，不要替代医生、咨询师、父母、学校或专业资源。",
      schema:
        '{ "summary": string, "mainAffectedAreas": string[], "fiveDimensionObservation": string, "nutritionEnergyObservation": string, "bodyActivityObservation": string, "smallStep": string, "recommendedNextTool": string, "supportReminder": string }',
      input: { records, currentDate },
    });
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    fail(res);
  }
}
