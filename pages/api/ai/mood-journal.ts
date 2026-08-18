import type { NextApiRequest, NextApiResponse } from "next";
import { aiText, buildGroundedSummary, fail, generateJson, minimizeAiText, missing, normalizeAiLocale, requireAiEligibility, requireAiGenerationEnabled, requireAiInputSize, requireAiNotice, requireAiRateLimit, requirePost, respondToAiCrisis, validateAiSourceSelection, type AiSourceField } from "./_shared";

type MoodResult = {
  sourceFieldIds?: unknown;
};

function userText(value: unknown, maxLength: number) {
  return minimizeAiText(value, maxLength).replace(/\s+/g, " ");
}

function buildSourceFields(input: {
  selectedWords: unknown;
  context: unknown;
  bodyFeeling: unknown;
  recurringThought: unknown;
  desiredSupport: unknown;
  communicationStarter: unknown;
}, locale: "zh-CN" | "en") {
  const candidates = [
    {
      label: aiText(locale, "情绪词：", "Emotion words: "),
      value: Array.isArray(input.selectedWords)
        ? input.selectedWords.slice(0, 8).map((item) => minimizeAiText(item, 40)).filter(Boolean).join(locale === "en" ? ", " : "、")
        : "",
    },
    { label: aiText(locale, "情境：", "Context: "), value: minimizeAiText(input.context, 240) },
    { label: aiText(locale, "身体感受：", "Body feeling: "), value: minimizeAiText(input.bodyFeeling, 160) },
    { label: aiText(locale, "反复想法：", "Recurring thought: "), value: minimizeAiText(input.recurringThought, 240) },
    { label: aiText(locale, "希望的支持：", "Desired support: "), value: minimizeAiText(input.desiredSupport, 160) },
    { label: aiText(locale, "沟通开头：", "Communication starter: "), value: minimizeAiText(input.communicationStarter, 160) },
  ];
  const sourceFields: AiSourceField[] = [];
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    sourceFields.push({ id: `f${sourceFields.length + 1}`, ...candidate });
  }
  return sourceFields;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const locale = normalizeAiLocale(req.body?.locale);
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
  if (respondToAiCrisis(res, {
    selectedWords,
    context,
    bodyFeeling,
    recurringThought,
    desiredSupport,
    communicationStarter,
  }, locale)) return;
  if (!hasWords && !context && !bodyFeeling && !recurringThought) {
    return missing(res, aiText(locale, "请先完成必要问题，再生成回应。", "Complete the required questions before generating a response."));
  }
  if (!requireAiNotice(req, res, locale)) return;
  if (!requireAiInputSize(req, res, locale)) return;
  if (!(await requireAiEligibility(req, res, locale))) return;
  if (!requireAiGenerationEnabled(res, locale)) return;
  if (!(await requireAiRateLimit(req, res, locale))) return;

  try {
    const sourceFields = buildSourceFields({
      selectedWords,
      context,
      bodyFeeling,
      recurringThought,
      desiredSupport,
      communicationStarter,
    }, locale);
    const result = (await generateJson({
      locale,
      task: locale === "en"
        ? [
            "Select one to three source field IDs that best represent the current mood-journal entry.",
            "Use only IDs present in sourceFields. Do not rewrite, summarize, diagnose, infer, advise, or return any user text.",
            "Return exactly one JSON key named sourceFieldIds.",
          ].join("\n")
        : [
            "从 sourceFields 中选择一到三个最能代表本次心情记录的来源字段 ID。",
            "只能返回 sourceFields 中真实存在的 ID；不要改写、总结、诊断、推断、建议，也不要返回任何用户原文。",
            "严格只返回 sourceFieldIds 一个 JSON 字段。",
          ].join("\n"),
      schema: '{ "sourceFieldIds": string[] }',
      input: { sourceFields },
    })) as MoodResult;
    const statedSupport = userText(desiredSupport, 120);
    const starter = userText(communicationStarter, 120);
    const selectedFields = validateAiSourceSelection(result, sourceFields, 3);
    res.status(200).json({
      emotionReflection: buildGroundedSummary(selectedFields, locale, aiText(locale, "本次记录已按你明确写下的内容整理，没有添加心理解释。", "This entry was organized from what you explicitly wrote, without adding a psychological interpretation.")),
      possibleNeed: statedSupport
        ? aiText(locale, `你写下希望获得的支持是：${statedSupport}`, `You wrote that the support you hope for is: ${statedSupport}`)
        : aiText(locale, "这次记录没有写明希望获得哪种支持，因此不替你推断。", "This entry did not specify the support you want, so the summary does not infer it."),
      communicationSuggestion: starter
        ? aiText(locale, `如果这句话符合你的原意，可以由你决定是否使用：${starter}`, `If this matches what you mean, you can decide whether to use it: ${starter}`)
        : aiText(locale, "这次没有添加沟通建议。", "No communication suggestion was added."),
      smallStep: aiText(locale, "这次只整理你已经写下的内容，不额外添加行动建议。", "This result only organizes what you wrote and does not add an action recommendation."),
      supportReminder: aiText(locale, "AI 小结可能出错；如果不符合原意，请以你自己的记录为准。", "AI summaries can be wrong. If this does not match your meaning, rely on your original entry."),
    });
  } catch (error) {
    await fail(req, res, error, "mood_journal_generate", locale);
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "32kb" } },
};
