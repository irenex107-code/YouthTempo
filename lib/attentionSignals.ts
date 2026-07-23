export type AttentionLevel = "priority" | "check_in" | "routine";

type AttentionAssessment = {
  level: AttentionLevel;
  score: number;
  reasons: string[];
};

const prioritySignals = [
  { pattern: /睡得很乱|少于 5 小时/, reason: "近期睡眠状态明显不稳定" },
  { pattern: /不想开始今天/, reason: "早晨启动状态需要了解" },
  { pattern: /几乎没有好好吃饭|一餐/, reason: "饮食节律明显受到影响" },
  { pattern: /很难开始，或一直拖着/, reason: "学习或生活任务很难开始" },
];

const checkInSignals = [
  { pattern: /入睡困难|容易醒/, reason: "睡眠质量出现变化" },
  { pattern: /紧张或烦躁|很难开始/, reason: "早晨状态或启动较困难" },
  { pattern: /时间比较乱|吃得比较零散/, reason: "饮食节律不太稳定" },
  { pattern: /几乎没有活动|很累，不想动/, reason: "身体活动明显减少" },
  { pattern: /开始有点困难|情绪很累/, reason: "任务参与出现阻力" },
];

function collectText(value: unknown, result: string[]) {
  if (typeof value === "string") {
    if (value.trim()) result.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, result));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectText(item, result));
  }
}

export function assessSweetRecord(records: unknown): AttentionAssessment {
  const values: string[] = [];
  collectText(records, values);
  const text = values.join(" / ");
  const reasons: string[] = [];
  let score = 0;

  prioritySignals.forEach((signal) => {
    if (!signal.pattern.test(text)) return;
    score += 2;
    if (!reasons.includes(signal.reason)) reasons.push(signal.reason);
  });
  checkInSignals.forEach((signal) => {
    if (!signal.pattern.test(text)) return;
    score += 1;
    if (!reasons.includes(signal.reason)) reasons.push(signal.reason);
  });

  return {
    level: score >= 4 ? "priority" : score >= 2 ? "check_in" : "routine",
    score,
    reasons: reasons.slice(0, 3),
  };
}
