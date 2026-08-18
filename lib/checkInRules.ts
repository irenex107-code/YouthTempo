export type CheckInRuleLocale = "zh-CN" | "en";

type CheckInField = { id?: unknown; value?: unknown };
type CheckInRecord = { id?: unknown; fields?: unknown };

export type CheckInRuleResult = {
  mainAffectedAreas: string[];
  rhythmClue: string;
  smallStep: string;
  recommendedNextTool: string;
  supportReminder: string;
};

const affectedPatterns: Record<string, RegExp> = {
  sleep: /容易醒|入睡困难|睡得很乱|少于 5 小时|5-6 小时/u,
  wake: /有点疲惫|紧张或烦躁|不想开始今天|有点困难|很难开始/u,
  eat: /有一餐不太规律|时间比较乱|几乎没有好好吃饭|一餐|吃得比较零散/u,
  exercise: /几乎没有活动|5–10 分钟/u,
  task: /开始有点困难|很难开始|一直拖着|几乎没有投入/u,
};

const labels = {
  "zh-CN": { sleep: "睡眠", wake: "醒来", eat: "饮食", exercise: "运动", task: "任务投入" },
  en: { sleep: "Sleep", wake: "Wake", eat: "Eat", exercise: "Exercise", task: "Task" },
} as const;

function fieldText(fields: unknown) {
  if (!Array.isArray(fields)) return "";
  return fields.flatMap((field) => {
    const value = (field as CheckInField | null)?.value;
    return Array.isArray(value) ? value : [value];
  }).filter((value): value is string => typeof value === "string").join(" ");
}

export function buildCheckInGuidance(records: unknown[], locale: CheckInRuleLocale): CheckInRuleResult {
  const values = new Map<string, string>();
  records.forEach((rawRecord) => {
    const record = rawRecord && typeof rawRecord === "object" ? rawRecord as CheckInRecord : {};
    if (typeof record.id === "string") values.set(record.id, fieldText(record.fields));
  });

  const affectedIds = ["sleep", "wake", "eat", "exercise", "task"]
    .filter((id) => affectedPatterns[id].test(values.get(id) || ""));
  const mainAffectedAreas = affectedIds.slice(0, 2).map((id) => labels[locale][id as keyof typeof labels.en]);
  const combined = [...values.values()].join(" ");
  const bedtimeWorry = /睡前想太多|一直在想|入睡困难|反复想/u.test(`${values.get("sleep") || ""} ${combined}`);
  const unclearEmotion = /说不清|很乱|麻木|情绪影响/u.test(combined);

  if (locale === "en") {
    const rhythmClue = affectedIds.includes("sleep") && affectedIds.includes("wake")
      ? "Sleep and getting started both felt harder in this record. They appeared on the same day, but one check-in cannot show a cause."
      : affectedIds.length >= 2
        ? `${mainAffectedAreas.join(" and ")} both took more effort in this record. This describes today only and does not establish a cause.`
        : affectedIds.length === 1
          ? `${mainAffectedAreas[0]} took more effort in this record. One check-in is not enough to establish a pattern.`
          : "No clear rhythm change stands out in this record, and there is no need to force a conclusion from one day.";
    return {
      mainAffectedAreas,
      rhythmClue,
      smallStep: affectedIds.includes("task")
        ? "Tomorrow, choose the task you already identified and spend five minutes on its first visible step."
        : affectedIds.includes("sleep")
          ? "Tonight, keep the next step limited to the bedtime routine you already recorded; do not add another goal."
          : "Keep what already worked in this record; you do not need to add another task today.",
      recommendedNextTool: bedtimeWorry
        ? "Set worries aside tonight — your record mentions thoughts that made it harder to settle."
        : unclearEmotion
          ? "Mood map — your record mentions feelings that were difficult to put into words."
          : affectedIds.length >= 3
            ? "Find the right support — several daily rhythm areas took more effort in this record."
            : "You can stop here for today.",
      supportReminder: affectedIds.length >= 3
        ? "If these changes continue or clearly affect daily life, consider sharing the original record with a parent or guardian, teacher, or another trusted adult."
        : "This is a rule-based reflection on one record, not an assessment or diagnosis.",
    };
  }

  const rhythmClue = affectedIds.includes("sleep") && affectedIds.includes("wake")
    ? "这次记录里，睡眠和早上启动都更费力；它们在同一天出现，但一次记录不能说明原因。"
    : affectedIds.length >= 2
      ? `这次记录里，${mainAffectedAreas.join("和")}都更费力；这只描述今天，不能据此判断原因。`
      : affectedIds.length === 1
        ? `这次记录里，${mainAffectedAreas[0]}更费力；一次记录还不足以形成趋势。`
        : "这次记录里暂时没有明显的节律变化，不需要从一天的记录里勉强找出结论。";
  return {
    mainAffectedAreas,
    rhythmClue,
    smallStep: affectedIds.includes("task")
      ? "明天从你已经写下的任务里选一个，只做最前面的五分钟。"
      : affectedIds.includes("sleep")
        ? "今晚只保留你已经写下的睡前安排，不再额外增加目标。"
        : "保留这次记录里已经做得到的部分，今天不需要再加一个任务。",
    recommendedNextTool: bedtimeWorry
      ? "今晚先放下——你的记录提到睡前反复想事或入睡更费力。"
      : unclearEmotion
        ? "心情拼图——你的记录提到有些感受还不容易说清。"
        : affectedIds.length >= 3
          ? "下一步找谁——这次记录中有多个日常节律都更费力。"
          : "今天先到这里就可以。",
    supportReminder: affectedIds.length >= 3
      ? "如果这些变化持续出现或明显影响日常生活，可以把原始记录告诉家长、老师或其他可信任的成年人。"
      : "这是根据一次记录生成的规则化回顾，不是评估或诊断。",
  };
}
