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

const safetyPatterns = [
  /不想活/u,
  /想死/u,
  /自杀/u,
  /轻生/u,
  /伤害自己/u,
  /结束生命/u,
  /活不下去/u,
];

const reportedSpeechPatterns = [
  /他[们]?说/u,
  /她[们]?说/u,
  /有人说/u,
  /被.{0,8}(骂|说)/u,
  /对我说/u,
];

export function moderateStudentMessage(body: string) {
  if (safetyPatterns.some((pattern) => pattern.test(body))) {
    return { status: "safety_review" as const, reason: "检测到需要尽快获得现实支持的内容。" };
  }
  if (
    abusivePatterns.some((pattern) => pattern.test(body)) &&
    !reportedSpeechPatterns.some((pattern) => pattern.test(body))
  ) {
    return { status: "blocked" as const, reason: "这段话包含可能伤害他人的表达，请换一种说法后再发送。" };
  }
  return { status: "sent" as const, reason: null };
}
