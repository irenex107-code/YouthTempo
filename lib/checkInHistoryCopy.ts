import type { Locale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";

type UnknownRecord = Record<string, unknown>;

const currentLabelCopy = new Map<string, string>();
const currentOptionCopy = new Map<string, Map<string, string>>();

function collectParallelCopy(zhValue: unknown, enValue: unknown) {
  if (typeof zhValue === "string" && typeof enValue === "string") {
    currentLabelCopy.set(zhValue, enValue);
    return;
  }
  if (!zhValue || !enValue || typeof zhValue !== "object" || typeof enValue !== "object") return;
  Object.keys(zhValue).forEach((key) => {
    collectParallelCopy(
      (zhValue as UnknownRecord)[key],
      (enValue as UnknownRecord)[key],
    );
  });
}

collectParallelCopy(dictionaries["zh-CN"].checkIn.steps, dictionaries.en.checkIn.steps);

Object.entries(dictionaries["zh-CN"].checkIn.steps).forEach(([stepId, rawZhStep]) => {
  const enStep = (dictionaries.en.checkIn.steps as UnknownRecord)[stepId] as UnknownRecord | undefined;
  const zhFields = (rawZhStep as UnknownRecord).fields as UnknownRecord | undefined;
  const enFields = enStep?.fields as UnknownRecord | undefined;
  if (!zhFields || !enFields) return;

  Object.entries(zhFields).forEach(([fieldId, rawZhField]) => {
    const zhOptions = (rawZhField as UnknownRecord).options as UnknownRecord | undefined;
    const enOptions = (enFields[fieldId] as UnknownRecord | undefined)?.options as UnknownRecord | undefined;
    if (!zhOptions || !enOptions) return;
    const copy = new Map<string, string>();
    Object.entries(zhOptions).forEach(([optionId, zhValue]) => {
      const enValue = enOptions[optionId];
      if (typeof zhValue === "string" && typeof enValue === "string") copy.set(zhValue, enValue);
    });
    currentOptionCopy.set(`${stepId}.${fieldId}`, copy);
  });
});

const primaryFieldAliases: Record<string, string> = {
  "sleep.state": "sleep.quality",
  "eat.state": "eat.rhythm",
  "exercise.state": "exercise.duration",
  "task.state": "task.engagement",
};

const legacyLabelCopy = new Map<string, string>([
  ["睡眠质量如何？", "How was your sleep?"],
  ["昨晚睡得怎么样？", "How did you sleep last night?"],
  ["今天醒来后的状态更接近哪一种？", "How did you feel when you woke up today?"],
  ["今天醒来后的状态呢？", "How did you feel after waking today?"],
  ["今天开始的难度", "How hard was it to get started today?"],
  ["今天饮食节奏如何？", "How was your meal rhythm today?"],
  ["今天精力和饮食有关系吗？", "Did eating affect your energy today?"],
  ["今天大概活动了多久？", "About how long were you active today?"],
  ["今天身体状态更像哪种？", "How did your body feel today?"],
  ["今天学习或生活任务完成得怎么样？", "How did learning or everyday tasks go today?"],
  ["今天开始学习、工作或生活任务顺利吗？", "How smoothly did learning, work, or everyday tasks begin today?"],
]);

const legacyOptionCopy: Record<string, Record<string, string>> = {
  "sleep.quality": {
    比较安稳: "Fairly restful",
    还可以: "It was okay",
    容易醒: "I woke up often",
    入睡困难: "It was hard to fall asleep",
    睡得很乱: "It felt very irregular",
  },
  "sleep.duration": {
    "5-6 小时": "5–6 hours",
    "6-7 小时": "6–7 hours",
    "7-8 小时": "7–8 hours",
  },
  "wake.state": {
    平静: "Calm",
    有精神: "Energized",
    紧张或烦躁: "Tense or irritable",
    不想开始今天: "Not ready to start the day",
  },
  "wake.startDifficulty": {
    很容易开始: "Easy to start",
    需要一点时间: "I needed some time",
    有点困难: "A little difficult",
    很难开始: "Very difficult",
  },
  "eat.rhythm": {
    基本规律: "Mostly regular",
    有一餐不太规律: "One meal was irregular",
    时间比较乱: "Meal times were quite irregular",
    几乎没有好好吃饭: "I barely ate a proper meal",
  },
  "eat.mealCount": {
    三餐比较规律: "Three fairly regular meals",
    两餐: "Two meals",
    一餐: "One meal",
    吃得比较零散: "Small amounts at different times",
  },
  "eat.energyConnection": {
    感觉有关系: "Yes, it seemed connected",
    好像有一点: "Maybe a little",
    没什么关系: "Not really",
  },
  "exercise.duration": {
    几乎没有活动: "Almost no activity",
    "5-10 分钟": "5–10 minutes",
    "10-20 分钟": "10–20 minutes",
    "20-30 分钟": "20–30 minutes",
    "5–10 分钟": "5–10 minutes",
    "10–20 分钟": "10–20 minutes",
    "20–30 分钟": "20–30 minutes",
  },
  "exercise.activityTypes": {
    走路: "Walking",
    拉伸: "Stretching",
    "球类/跑步/跳操等运动": "Sports, running, dance, or similar activity",
    "上下楼/通勤": "Stairs or active travel",
    几乎没有: "Almost none",
  },
  "exercise.bodyState": {
    比较放松: "Fairly relaxed",
    有点紧绷: "A little tense",
    久坐后不太舒服: "Uncomfortable after sitting for a long time",
    "很累，不想动": "Too tired to move",
  },
  "task.engagement": {
    能完成基本任务: "I managed the basic tasks",
    开始有点困难: "It was a little hard to start",
    "很难开始，或一直拖着": "It was very hard to start, or I kept putting it off",
  },
};

function canonicalFieldKey(stepId: string, fieldId: string) {
  const key = `${stepId}.${fieldId}`;
  return primaryFieldAliases[key] || key;
}

function dictionaryValue(locale: Locale, key: string) {
  const value = key.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as UnknownRecord)[segment];
  }, dictionaries[locale]);
  return typeof value === "string" ? value : undefined;
}

export function storedCheckInLabel(locale: Locale, key: string, fallback: string) {
  if (locale === "en") {
    return legacyLabelCopy.get(fallback)
      || currentLabelCopy.get(fallback)
      || dictionaryValue(locale, key)
      || fallback;
  }
  return dictionaryValue(locale, key) || fallback;
}

export function localizedStoredCheckInValue(
  value: string,
  locale: Locale,
  stepId: string,
  fieldId: string,
) {
  if (locale !== "en") return value;
  const key = canonicalFieldKey(stepId, fieldId);
  return currentOptionCopy.get(key)?.get(value)
    || legacyOptionCopy[key]?.[value]
    || value;
}
