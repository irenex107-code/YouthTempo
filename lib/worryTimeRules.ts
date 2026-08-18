export const WORRY_TIME_RULE_VERSION = "worry-time-rules-2026-08-18";

export type WorryTimeLocale = "zh-CN" | "en";

type WorryTimeRuleInput = {
  worries: string[];
  controls: string[];
  tomorrowAction: string;
};

export type WorryTimeRuleResult = {
  decisionMethod: "deterministic_rules";
  decisionVersion: string;
  controllableParts: string;
  canWaitUntilTomorrow: string;
  tomorrowSmallAction: string;
  bedtimeSentence: string;
  supportReminder: string;
};

const actionableControl = "我可以做一点点";
const uncontrollableControl = "我暂时控制不了";

function cleanText(value: unknown, maxLength = 120) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function shortList(items: string[], locale: WorryTimeLocale) {
  const cleaned = items.map((item) => cleanText(item, 60)).filter(Boolean).slice(0, 2);
  if (!cleaned.length) return "";
  return locale === "en" ? cleaned.join("; ") : cleaned.join("；");
}

export function buildWorryTimeGuidance(input: WorryTimeRuleInput, locale: WorryTimeLocale): WorryTimeRuleResult {
  const worries = input.worries.map((item) => cleanText(item)).filter(Boolean);
  const actionable = worries.filter((_, index) => input.controls[index] === actionableControl);
  const canWait = worries.filter((_, index) => input.controls[index] !== actionableControl);
  const explicitlyUncontrollable = worries.filter((_, index) => input.controls[index] === uncontrollableControl);
  const action = cleanText(input.tomorrowAction, 160);
  const actionableSummary = shortList(actionable, locale);
  const canWaitSummary = shortList(canWait, locale);

  if (locale === "en") {
    return {
      decisionMethod: "deterministic_rules",
      decisionVersion: WORRY_TIME_RULE_VERSION,
      controllableParts: actionableSummary
        ? `You marked these as places where you can take a small step: ${actionableSummary}.`
        : "You have not marked a controllable part yet. You do not need to force an answer tonight.",
      canWaitUntilTomorrow: canWaitSummary
        ? `You can set these aside until tomorrow: ${canWaitSummary}.`
        : "You have already given each written worry a next step, so you can stop reviewing them tonight.",
      tomorrowSmallAction: action || "Tomorrow, choose one written worry and spend no more than ten minutes on its smallest next step.",
      bedtimeSentence: "I have written this down, and I can stop here for tonight.",
      supportReminder: explicitlyUncontrollable.length
        ? "Anything outside your control does not need to be solved tonight. If it keeps affecting daily life, consider telling a parent or guardian, teacher, or another trusted adult."
        : "This is a rule-based reflection, not an assessment or advice from a professional.",
    };
  }

  return {
    decisionMethod: "deterministic_rules",
    decisionVersion: WORRY_TIME_RULE_VERSION,
    controllableParts: actionableSummary
      ? `你标记为“可以做一点点”的是：${actionableSummary}。`
      : "你还没有标记出可控的部分，今晚不需要勉强找出答案。",
    canWaitUntilTomorrow: canWaitSummary
      ? `这些可以先留到明天：${canWaitSummary}。`
      : "你已经为写下的担心安排了下一步，今晚可以先不再反复检查。",
    tomorrowSmallAction: action || "明天从写下的一件担心里选一个最小步骤，只做十分钟。",
    bedtimeSentence: "这件事已经记下了，今晚可以先停在这里。",
    supportReminder: explicitlyUncontrollable.length
      ? "暂时无法控制的部分不需要今晚解决；如果它持续影响日常生活，可以告诉家长、老师或其他可信任的成年人。"
      : "这是固定规则生成的整理结果，不是评估，也不是专业建议。",
  };
}
