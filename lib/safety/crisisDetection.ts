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
  { reason: "suicidal_intent", pattern: /轻生/u },
  { reason: "self_harm", pattern: /伤害自己/u },
  { reason: "self_harm", pattern: /自残/u },
  { reason: "suicidal_intent", pattern: /结束生命/u },
  { reason: "suicidal_intent", pattern: /活着没意思/u },
  { reason: "suicidal_intent", pattern: /我(?:最近)?(?:觉得|感觉).{0,4}(?:活着|生活|人生).{0,4}(?:没有|没什么|毫无).{0,3}意义/u },
  { reason: "suicidal_intent", pattern: /我(?:最近)?(?:觉得|感觉).{0,4}(?:活着|生活|人生).{0,3}(?:没意思|没有意思)/u },
  { reason: "suicidal_intent", pattern: /我.{0,3}活着.{0,4}(?:还有什么意思|有什么意义|有何意义)/u },
  { reason: "suicidal_intent", pattern: /活不下去/u },
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
  { reason: "suicidal_intent", pattern: /\b(?:i\s+(?:feel|think)\s+(?:that\s+)?(?:my\s+)?(?:life|living)|my\s+life)\s+(?:is|feels)\s+(?:meaningless|pointless)\b/i },
  { reason: "suicidal_intent", pattern: /\bthere(?:['’]?s|\s+is)\s+no\s+point\s+in\s+(?:me\s+)?living\b/i },
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

export function detectCrisisInValues(value: unknown, locale: CrisisLocale): CrisisDetectionResult {
  const pending: unknown[] = [value];
  const visited = new Set<object>();

  while (pending.length) {
    const current = pending.pop();
    if (typeof current === "string") {
      const result = detectCrisis(current, locale);
      if (result.isUrgent) return result;
      continue;
    }
    if (!current || typeof current !== "object" || visited.has(current)) continue;

    visited.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
    } else {
      pending.push(...Object.values(current as Record<string, unknown>));
    }
  }

  return { isUrgent: false };
}

export function getCrisisResponse(locale: CrisisLocale) {
  if (locale === "en") {
    return "Speaking up about this matters. YouthTempo cannot replace emergency help. Please contact a family member, teacher, or another trusted person nearby now and ask them to stay with you. If you cannot reach them, contact a qualified support service. If you may act on this or are in immediate danger, contact local emergency services now.";
  }

  return "你愿意把这件事说出来很重要。现在先不要一个人扛，请立刻联系家长、老师或其他身边可信任的大人，请对方陪着你；如果暂时联系不上，可以联系专业支持。如果你正处于即时危险中，请拨打 110 或 120；没有即时危险但需要心理支持时，也可以拨打 12356。";
}
