export type CrisisLocale = "zh-CN" | "en";

export type CrisisReason =
  | "suicidal_intent"
  | "self_harm"
  | "unable_to_stay_safe"
  | "harm_by_others";

export type CrisisDetectionResult = {
  isUrgent: boolean;
  matchedReason?: CrisisReason;
};

type CrisisRule = {
  reason: CrisisReason;
  pattern: RegExp;
};

const chineseRules: CrisisRule[] = [
  { reason: "suicidal_intent", pattern: /不想活/u },
  { reason: "suicidal_intent", pattern: /想死/u },
  { reason: "suicidal_intent", pattern: /自杀/u },
  { reason: "self_harm", pattern: /伤害自己/u },
  { reason: "self_harm", pattern: /自残/u },
  { reason: "suicidal_intent", pattern: /结束生命/u },
  { reason: "suicidal_intent", pattern: /活着没意思/u },
  { reason: "unable_to_stay_safe", pattern: /不能保证.*安全/u },
  { reason: "harm_by_others", pattern: /有人.*伤害我/u },
  { reason: "harm_by_others", pattern: /正在被.*伤害/u },
];

const englishRules: CrisisRule[] = [
  { reason: "suicidal_intent", pattern: /\b(?:i\s+)?(?:really\s+)?want\s+to\s+die\b/i },
  { reason: "suicidal_intent", pattern: /\b(?:i\s+)?(?:do\s+not|don['’]?t)\s+want\s+to\s+(?:live(?!\s+(?:here|there|in|with|at|near|abroad)\b)|be\s+alive|go\s+on\s+living)\b/i },
  { reason: "suicidal_intent", pattern: /\b(?:end(?:ing)?|take|taking)\s+my\s+(?:own\s+)?life\b/i },
  { reason: "suicidal_intent", pattern: /\bkill(?:ing)?\s+myself\b/i },
  { reason: "suicidal_intent", pattern: /\b(?:suicidal\s+(?:thoughts?|ideation)|i\s+(?:am|feel)\s+suicidal)\b/i },
  { reason: "suicidal_intent", pattern: /\b(?:wish\s+i\s+(?:were|was)\s+dead|better\s+off\s+dead)\b/i },
  { reason: "self_harm", pattern: /\b(?:want\s+to|plan(?:ning)?\s+to|going\s+to|might|may|will|thinking\s+about)\s+(?:self[-\s]?harm|hurt\s+myself)\b/i },
  { reason: "self_harm", pattern: /\bi\s+(?:am|have\s+been|was)\s+self[-\s]?harm(?:ing)?\b/i },
  { reason: "self_harm", pattern: /\bself[-\s]?harm(?:ing)?\s+(?:thoughts?|urges?)\b/i },
  { reason: "self_harm", pattern: /^\s*(?:i\s+)?(?:self[-\s]?harm|hurt\s+myself)\s*[.!?]*\s*$/i },
  { reason: "unable_to_stay_safe", pattern: /\b(?:i\s+)?(?:cannot|can['’]?t|am\s+unable\s+to)\s+keep\s+myself\s+safe\b/i },
  { reason: "unable_to_stay_safe", pattern: /\bi\s+(?:do\s+not|don['’]?t)\s+(?:think\s+)?i\s+can\s+keep\s+myself\s+safe\b/i },
  { reason: "harm_by_others", pattern: /\b(?:someone|they|he|she)\s+(?:is|keeps?)\s+(?:hurting|harming|abusing)\s+me\b/i },
  { reason: "harm_by_others", pattern: /\bi\s+am\s+being\s+(?:hurt|harmed|abused)\b/i },
];

export function detectCrisis(text: unknown, locale: CrisisLocale): CrisisDetectionResult {
  if (typeof text !== "string" || !text.trim()) return { isUrgent: false };

  // 优先检查当前界面语言，同时保留另一种语言作为安全兜底，避免用户切换语言后漏检。
  const rules = locale === "en"
    ? [...englishRules, ...chineseRules]
    : [...chineseRules, ...englishRules];
  const match = rules.find((rule) => rule.pattern.test(text));

  return match
    ? { isUrgent: true, matchedReason: match.reason }
    : { isUrgent: false };
}

export function getCrisisResponse(locale: CrisisLocale) {
  if (locale === "en") {
    return "Speaking up about this matters. YouthTempo's AI support cannot replace emergency help. Please contact a trusted person nearby now and ask them to stay with you. If you may act on this or are in immediate danger, contact your local emergency services now.";
  }

  return "你愿意把这件事说出来很重要。现在先不要一个人扛，请立刻联系身边可信任的大人，让对方陪着你；如果你正处于危险中，请拨打 110 或 120。";
}
