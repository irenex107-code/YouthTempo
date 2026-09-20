import { moderateStudentMessage } from "@/lib/messageSafety";
import { generateJson, isAiGenerationEnabled, minimizeAiText } from "@/pages/api/ai/_shared";
import type { Locale } from "@/lib/i18n/config";

export type PeerMessageSafety = {
  status: "visible" | "safety_review";
  priority: "standard" | "high" | "urgent";
  category: "crisis" | "privacy" | "harassment" | "other";
  source: "deterministic" | "ai_assisted";
  urgent: boolean;
};

const contactPatterns = [
  /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u,
  /(?:\+?86[-\s]?)?1[3-9]\d{9}/u,
  /(?:微信|微\s*信|WeChat|WhatsApp|Telegram|QQ|加我|私下联系)\s*[:：]?\s*[\w-]{3,}/iu,
];

export function classifyPeerSpaceMessage(body: string, locale: Locale): PeerMessageSafety {
  const existing = moderateStudentMessage(body, locale);
  if (existing.status === "safety_review") {
    return { status: "safety_review", priority: "urgent", category: "crisis", source: "deterministic", urgent: true };
  }
  if (contactPatterns.some((pattern) => pattern.test(body))) {
    return { status: "safety_review", priority: "high", category: "privacy", source: "deterministic", urgent: false };
  }
  if (existing.status === "blocked") {
    return { status: "safety_review", priority: "high", category: "harassment", source: "deterministic", urgent: false };
  }
  return { status: "visible", priority: "standard", category: "other", source: "deterministic", urgent: false };
}

export async function classifyPeerSpaceMessageWithAi(body: string, locale: Locale): Promise<PeerMessageSafety> {
  const deterministic = classifyPeerSpaceMessage(body, locale);
  if (deterministic.status === "safety_review") return deterministic;
  if (process.env.PEER_SPACE_AI_REVIEW_ENABLED !== "true") return deterministic;
  if (!isAiGenerationEnabled()) {
    return { status: "safety_review", priority: "high", category: "other", source: "ai_assisted", urgent: false };
  }
  try {
    const result = await generateJson<{
      review: boolean;
      priority: "standard" | "high";
      category: "privacy" | "harassment" | "other";
    }>({
      locale,
      task: locale === "en"
        ? "Classify whether this adult peer-room message needs human review for privacy exposure, harassment, or other clear public-safety concerns. Ordinary sadness or stress is not a crisis. Never diagnose, punish, or make a final decision."
        : "只判断成年人同伴聊天室内容是否需要人工复核隐私泄露、骚扰或其他明显公开安全风险。普通难过或压力不是危机。不要诊断、处罚或作最终决定。",
      schema: '{"review":boolean,"priority":"standard"|"high","category":"privacy"|"harassment"|"other"}',
      input: { text: minimizeAiText(body, 600) },
    });
    if (typeof result.review !== "boolean"
      || !["standard", "high"].includes(result.priority)
      || !["privacy", "harassment", "other"].includes(result.category)) {
      throw new Error("invalid_peer_space_ai_classification");
    }
    return result.review
      ? { status: "safety_review", priority: result.priority, category: result.category, source: "ai_assisted", urgent: false }
      : deterministic;
  } catch {
    // A failed optional classifier cannot silently publish potentially unsafe content.
    return { status: "safety_review", priority: "high", category: "other", source: "ai_assisted", urgent: false };
  }
}
