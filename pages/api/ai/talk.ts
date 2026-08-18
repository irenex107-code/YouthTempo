import type { NextApiRequest, NextApiResponse } from "next";
import { TALK_PILOT_CLOSURE_VERSION } from "@/lib/talkPilot";
import { aiText, normalizeAiLocale, requirePost, respondToAiCrisis } from "./_shared";

type TalkMessage = {
  role: "user" | "assistant";
  content: string;
};

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const locale = normalizeAiLocale(req.body?.locale);
  if (!requirePost(req, res)) return;
  const messages = normalizeMessages(req.body?.messages);
  const userMessages = messages.filter((message) => message.role === "user").map((message) => message.content);
  if (userMessages.length > 0 && respondToAiCrisis(res, userMessages, locale)) return;

  return res.status(410).json({
    error: aiText(
      locale,
      "“陪我捋一捋”在首轮学校试点期间暂不开放。请使用支持路径，或联系家长、老师及其他可信任的人。",
      '“Talk It Through” is not available during the first school pilot. Please use the support pathway or contact a parent, teacher, or another person you trust.',
    ),
    closed: true,
    closureVersion: TALK_PILOT_CLOSURE_VERSION,
  });
}

export const config = {
  api: { bodyParser: { sizeLimit: "32kb" } },
};
