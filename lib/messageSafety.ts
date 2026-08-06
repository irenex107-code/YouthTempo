import { normalizeLocale, type Locale } from "@/lib/i18n/config";
import { detectCrisis } from "@/lib/safety/crisisDetection";

const abusivePatterns = [
  /去死/u,
  /弄死/u,
  /杀了你/u,
  /废物/u,
  /傻[逼比]/u,
  /贱人/u,
  /滚开/u,
  /fuck\s+you/iu,
];

const reportedSpeechPatterns = [
  /他[们]?说/u,
  /她[们]?说/u,
  /有人说/u,
  /被.{0,8}(骂|说)/u,
  /对我说/u,
];

function safetyText(locale: Locale, zhCN: string, en: string) {
  return locale === "en" ? en : zhCN;
}

export function moderateStudentMessage(body: string, requestedLocale?: string) {
  const locale = normalizeLocale(requestedLocale);
  if (detectCrisis(body, locale).isUrgent) {
    return {
      status: "safety_review" as const,
      reason: safetyText(
        locale,
        "检测到需要尽快获得现实支持的内容。",
        "Content that may need prompt real-world support was detected.",
      ),
    };
  }
  if (
    abusivePatterns.some((pattern) => pattern.test(body)) &&
    !reportedSpeechPatterns.some((pattern) => pattern.test(body))
  ) {
    return {
      status: "blocked" as const,
      reason: safetyText(
        locale,
        "这段话包含可能伤害他人的表达，请换一种说法后再发送。",
        "This message includes language that may harm someone. Rephrase it before sending.",
      ),
    };
  }
  return { status: "sent" as const, reason: null };
}

export function moderateCommunityContent(body: string, requestedLocale?: string) {
  const result = moderateStudentMessage(body, requestedLocale);
  if (result.status === "sent") {
    return { status: "published" as const, reason: null };
  }
  return result;
}
