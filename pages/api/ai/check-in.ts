import type { NextApiRequest, NextApiResponse } from "next";
import { buildCheckInGuidance } from "@/lib/checkInRules";
import { aiText, buildGroundedSummary, fail, generateJson, minimizeAiText, missing, normalizeAiLocale, requireAiEligibility, requireAiGenerationEnabled, requireAiInputSize, requireAiNotice, requireAiRateLimit, requirePost, respondToAiCrisis, validateAiSourceSelection, type AiSourceField } from "./_shared";

type CheckInResult = {
  sourceFieldIds?: unknown;
};

function hasAnswer(value: unknown) {
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" && item.trim());
  return typeof value === "string" && Boolean(value.trim());
}

function buildSourceFields(records: unknown[], locale: "zh-CN" | "en") {
  const dimensionLabels = locale === "en"
    ? ["Sleep: ", "Wake: ", "Eat: ", "Exercise: ", "Task: "]
    : ["睡眠：", "醒来：", "饮食：", "运动：", "任务："];
  const sourceFields: AiSourceField[] = [];
  records.forEach((record, recordIndex) => {
    const item = record && typeof record === "object" ? record as Record<string, unknown> : {};
    const fields = Array.isArray(item.fields) ? item.fields.slice(0, 12) : [];
    fields.forEach((field) => {
      const nextField = field && typeof field === "object" ? field as Record<string, unknown> : {};
      if (!hasAnswer(nextField.value)) return;
      const value = Array.isArray(nextField.value)
        ? nextField.value
          .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
          .slice(0, 8)
          .map((entry) => minimizeAiText(entry, 80))
          .filter(Boolean)
          .join(locale === "en" ? ", " : "、")
        : minimizeAiText(nextField.value, 160);
      if (!value) return;
      sourceFields.push({
        id: `f${sourceFields.length + 1}`,
        label: dimensionLabels[recordIndex] || aiText(locale, "记录：", "Record: "),
        value,
      });
    });
  });
  return sourceFields;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const locale = normalizeAiLocale(req.body?.locale);
  if (!requirePost(req, res)) return;
  const { records } = req.body || {};
  if (respondToAiCrisis(res, records, locale)) return;
  if (!Array.isArray(records) || records.length !== 5 || records.some((record) => !Array.isArray(record?.fields) || record.fields.length > 12)) {
    return missing(res, aiText(locale, "请先完成必要问题，再生成回应。", "Complete the required questions before generating a response."));
  }
  if (!requireAiNotice(req, res, locale)) return;
  if (!requireAiInputSize(req, res, locale)) return;
  if (!(await requireAiEligibility(req, res, locale))) return;
  if (!requireAiGenerationEnabled(res, locale)) return;
  if (!(await requireAiRateLimit(req, res, locale))) return;

  try {
    const guidance = buildCheckInGuidance(records, locale);
    const sourceFields = buildSourceFields(records, locale);
    const result = (await generateJson({
      locale,
      task: locale === "en"
        ? [
            "Select one or two source field IDs that most clearly represent this SWEET check-in.",
            "Use only IDs present in sourceFields. Do not rewrite, summarize, diagnose, infer, advise, or return any user text.",
            "Return exactly one JSON key named sourceFieldIds. Prefer at most one steady item and one effortful item when the supplied words explicitly support that distinction.",
          ].join("\n")
        : [
            "从 sourceFields 中选择一到两个最能代表本次 SWEET 记录的来源字段 ID。",
            "只能返回 sourceFields 中真实存在的 ID；不要改写、总结、诊断、推断、建议，也不要返回任何用户原文。",
            "严格只返回 sourceFieldIds 一个 JSON 字段。原词明确支持时，最多选择一项维持住的内容和一项更费力的内容。",
          ].join("\n"),
      schema: '{ "sourceFieldIds": string[] }',
      input: { sourceFields },
    })) as CheckInResult;
    const selectedFields = validateAiSourceSelection(result, sourceFields, 2);
    res.status(200).json({
      summary: buildGroundedSummary(selectedFields, locale, aiText(locale, "本次记录已整理；下面的线索和下一步由固定规则生成。", "This record is organized below; the clue and next step use fixed rules.")),
      ...guidance,
    });
  } catch (error) {
    await fail(req, res, error, "check_in_generate", locale);
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "64kb" } },
};
