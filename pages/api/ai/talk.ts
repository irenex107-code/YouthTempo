import type { NextApiRequest, NextApiResponse } from "next";
import { fail, generateJson, missing, requireAiInputSize, requireAiRateLimit, requirePost, shortText } from "./_shared";

type TalkMessage = {
  role: "user" | "assistant";
  content: string;
};

type TalkResult = {
  reply?: unknown;
  urgent?: unknown;
  suggestHumanSupport?: unknown;
};

const urgentPatterns = [
  /不想活/,
  /想死/,
  /自杀/,
  /伤害自己/,
  /自残/,
  /结束生命/,
  /活着没意思/,
  /不能保证.*安全/,
  /有人.*伤害我/,
  /正在被.*伤害/,
];

const urgentReply =
  "你愿意把这件事说出来很重要。现在先不要一个人扛，请立刻联系身边可信任的大人，让对方陪着你；如果你正处于危险中，请拨打 110 或 120。";

function normalizeMessages(value: unknown): TalkMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: TalkMessage[] = [];
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const message = item as Record<string, unknown>;
    const role = message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : null;
    const content = typeof message.content === "string" ? message.content.trim().slice(0, 500) : "";
    if (role && content) messages.push({ role, content });
  });
  return messages.slice(-16);
}

function hasUrgentSignal(messages: TalkMessage[]) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  return latestUserMessage ? urgentPatterns.some((pattern) => pattern.test(latestUserMessage.content)) : false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requirePost(req, res)) return;
  const messages = normalizeMessages(req.body?.messages);
  if (!messages.length || messages.at(-1)?.role !== "user") {
    return missing(res, "可以先写一句你现在最想说的话。");
  }

  if (hasUrgentSignal(messages)) {
    return res.status(200).json({
      reply: urgentReply,
      urgent: true,
      suggestHumanSupport: true,
    });
  }
  if (!requireAiInputSize(req, res)) return;
  if (!(await requireAiRateLimit(req, res))) return;

  try {
    const result = (await generateJson({
      task: [
        "这是一次短对话中的下一句回应。帮助青少年把眼前最乱的一件事说清楚一点，而不是提供治疗。",
        "只回应最新一条用户消息，但可以参考前文避免重复。先承接一个具体感受或事实，再做以下两件事中的一件：问一个容易回答的问题，或给一个五分钟内能做的小动作。",
        "reply：最多 90 个汉字，最多三句。每次最多问一个问题。不要复述整段输入，不做原因分析，不连续给多条建议。",
        "语言像可信任的大人正常聊天，避免“我能理解你的感受、听起来你正在经历、建议你、赋能、疗愈、情绪价值”等模板或书面表达。",
        "urgent：只有出现自伤、自杀、无法保证安全或正在被伤害的信号时才为 true。",
        "suggestHumanSupport：当困难持续影响生活、用户明确想找人聊，或 AI 已无法继续安全支持时为 true；普通表达时为 false。",
        "如果 urgent 为 true，reply 必须停止普通整理，优先让用户立即联系身边可信任的大人；紧急危险时拨打 110 或 120。",
      ].join("\n"),
      schema: '{ "reply": string, "urgent": boolean, "suggestHumanSupport": boolean }',
      input: { messages },
    })) as TalkResult;

    const urgent = result.urgent === true;
    res.status(200).json({
      reply: urgent
        ? urgentReply
        : shortText(result.reply, "这件事里，现在最让你卡住的是哪一小部分？"),
      urgent,
      suggestHumanSupport: result.suggestHumanSupport === true || urgent,
    });
  } catch (error) {
    await fail(req, res, error, "talk_generate");
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "32kb" } },
};
