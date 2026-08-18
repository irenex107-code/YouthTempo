export const REFERRAL_RULE_VERSION = "referral-rules-2026-08-18";

type ReferralLocale = "zh-CN" | "en";

export type ReferralRuleInput = {
  currentStates: string[];
  affectedAreas: string[];
  duration: string;
  impact: string;
  adultWillingness: string;
  preferredSupport: string[];
  mainNeed: string;
};

export type ReferralRuleResult = {
  recommendedSupport: string;
  reason: string;
  nextStep: string;
  whenToSeekMoreSupport: string;
  supportReminder: string;
  decisionMethod: "deterministic_rules";
  decisionVersion: string;
  supportTier: "self_guided" | "trusted_adult" | "school_support" | "professional_support";
};

function has(values: string[], patterns: RegExp[]) {
  return values.some((value) => patterns.some((pattern) => pattern.test(value)));
}

export function buildReferralGuidance(input: ReferralRuleInput, locale: ReferralLocale): ReferralRuleResult {
  const significantImpact = /明显|significant/i.test(input.impact);
  const sustained = /一两周|更久|week|longer/i.test(input.duration);
  const wantsProfessional = has(input.preferredSupport, [/专业|professional/i]);
  const wantsSchool = has(input.preferredSupport, [/学校|school/i]);
  const wantsListener = has(input.preferredSupport, [/有人听|listen/i]);
  const adultAvailable = /愿意|不知道怎么开口|willing|how to start/i.test(input.adultWillingness)
    && !/暂时不想|not now/i.test(input.adultWillingness);

  const needsProfessional = wantsProfessional || (significantImpact && sustained);
  const needsSchool = !needsProfessional && (wantsSchool || significantImpact || sustained);
  const needsTrustedAdult = !needsProfessional && !needsSchool && (adultAvailable || wantsListener);

  if (locale === "en") {
    if (needsProfessional) {
      return {
        recommendedSupport: "Start with a parent or guardian, teacher, or another trusted adult and ask them to help you connect with a qualified mental health professional.",
        reason: wantsProfessional
          ? "You said that professional support is an option you would consider, so the pathway starts with a person who can help make that connection."
          : "You said this has continued and is clearly affecting daily life, so adding qualified human support is appropriate.",
        nextStep: "Today, tell a parent or guardian, teacher, or another trusted adult: “This has been affecting daily life, and I would like help finding qualified support.”",
        whenToSeekMoreSupport: "Seek support sooner if sleep, eating, learning, relationships, or everyday activities become harder; use the fixed urgent pathway if safety becomes a concern.",
        supportReminder: "This pathway is not a diagnosis. A qualified person should make any clinical assessment with you.",
        decisionMethod: "deterministic_rules",
        decisionVersion: REFERRAL_RULE_VERSION,
        supportTier: "professional_support",
      };
    }

    if (needsSchool) {
      return {
        recommendedSupport: "Start with a parent or guardian, teacher, or the named student-support contact at school, using the support route you feel most willing to try.",
        reason: "You said this has lasted for a while or is affecting daily life, so a real person should help with the next step.",
        nextStep: "Choose one person and say: “I have been finding things harder lately. Could we talk privately about what support is available?”",
        whenToSeekMoreSupport: "Ask for qualified professional support if the impact continues, becomes stronger, or does not improve with the first support step.",
        supportReminder: "You do not have to explain everything at once, and this rule-based pathway is not a diagnosis.",
        decisionMethod: "deterministic_rules",
        decisionVersion: REFERRAL_RULE_VERSION,
        supportTier: "school_support",
      };
    }

    if (needsTrustedAdult) {
      return {
        recommendedSupport: "Begin with a parent or guardian, teacher, or another trusted adult you feel comfortable talking to, and decide the next step together.",
        reason: "You indicated that being heard or speaking with someone may be an acceptable, low-pressure starting point.",
        nextStep: "You can say: “I do not need you to fix everything. Could you listen while I explain one part?”",
        whenToSeekMoreSupport: "Connect with school or qualified professional support if this lasts for weeks or begins to affect sleep, eating, learning, or daily life.",
        supportReminder: "This pathway organizes your choices; it does not assess or diagnose you.",
        decisionMethod: "deterministic_rules",
        decisionVersion: REFERRAL_RULE_VERSION,
        supportTier: "trusted_adult",
      };
    }

    return {
      recommendedSupport: "Start with a private reflection tool, then decide whether you want to share one part with a parent, teacher, or another trusted person.",
      reason: "Your answers point to a lower-pressure starting point, and you can stop or choose another route at any time.",
      nextStep: "Write down the one thing you most want to feel clearer about, then choose one small action for today.",
      whenToSeekMoreSupport: "Move to parent or guardian, school, or qualified professional support if this continues or starts affecting everyday life.",
      supportReminder: "This is a rule-based pathway, not an assessment or diagnosis.",
      decisionMethod: "deterministic_rules",
      decisionVersion: REFERRAL_RULE_VERSION,
      supportTier: "self_guided",
    };
  }

  if (needsProfessional) {
    return {
      recommendedSupport: "可以先告诉家长、老师或其他可信任的成年人，并请对方协助联系有资质的心理专业人员。",
      reason: wantsProfessional
        ? "你表示愿意考虑专业支持，因此先从能协助连接资源的真人开始。"
        : "你选择的状态已经持续一段时间并明显影响日常，适合尽快加入有资质的真人支持。",
      nextStep: "今天可以告诉家长、老师或其他可信任的成年人：“这件事已经影响到日常，我想请你帮我连接合适的专业支持。”",
      whenToSeekMoreSupport: "如果睡眠、吃饭、学习、关系或日常活动变得更困难，应更快寻求支持；出现安全问题时直接走固定紧急路径。",
      supportReminder: "这条路径不是诊断；任何专业评估都应由有资质的人员和你一起完成。",
      decisionMethod: "deterministic_rules",
      decisionVersion: REFERRAL_RULE_VERSION,
      supportTier: "professional_support",
    };
  }

  if (needsSchool) {
    return {
      recommendedSupport: "可以先联系家长、老师或学校指定的学生支持联系人，从你最愿意接受的真人入口开始。",
      reason: "你选择的状态已经持续一段时间或影响到日常，因此下一步适合由现实中的人一起承接。",
      nextStep: "选一个人并告诉对方：“我最近有些事情越来越难应付，想私下了解可以获得什么支持。”",
      whenToSeekMoreSupport: "如果影响继续存在、变得更明显，或第一步支持没有帮助，可以进一步联系有资质的专业人员。",
      supportReminder: "不用一次解释全部；这只是规则化路径整理，不是诊断。",
      decisionMethod: "deterministic_rules",
      decisionVersion: REFERRAL_RULE_VERSION,
      supportTier: "school_support",
    };
  }

  if (needsTrustedAdult) {
    return {
      recommendedSupport: "可以先找家长、老师或其他你愿意开口的可信任成年人，让对方听你说，再一起决定下一步。",
      reason: "你表示有人倾听或与大人沟通可能是一个能接受、压力较小的起点。",
      nextStep: "你可以说：“我不需要你马上解决，能先听我把其中一件事说完吗？”",
      whenToSeekMoreSupport: "如果持续数周，或开始影响睡眠、吃饭、学习和日常生活，可以连接学校或有资质的专业支持。",
      supportReminder: "这条路径只整理你的选择，不对你进行评估或诊断。",
      decisionMethod: "deterministic_rules",
      decisionVersion: REFERRAL_RULE_VERSION,
      supportTier: "trusted_adult",
    };
  }

  return {
    recommendedSupport: "可以先使用一个私密的自我整理工具，再决定是否把其中一部分告诉家长、老师或其他可信任的人。",
    reason: "你的回答更适合从低压力入口开始，而且可以随时停止或换一条路径。",
    nextStep: "写下现在最想弄清楚的一件事，再为今天选一个很小的动作。",
    whenToSeekMoreSupport: "如果这种状态持续，或开始影响日常生活，可以转向家长、老师、学校支持人员或有资质的专业支持。",
    supportReminder: "这是规则化路径整理，不是评估或诊断。",
    decisionMethod: "deterministic_rules",
    decisionVersion: REFERRAL_RULE_VERSION,
    supportTier: "self_guided",
  };
}
