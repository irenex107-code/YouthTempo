import type { CloudSweetRecord } from "@/lib/cloudRecords";

type RecordField = {
  id?: string;
  title?: string;
  value?: string | string[];
};

type RecordStep = {
  id?: string;
  title?: string;
  fields?: RecordField[];
};

export type RhythmDimension = {
  id: string;
  label: string;
  value: string;
};

export type RhythmOverview = {
  recordCount: number;
  activeDays: number;
  latestAt: string | null;
  latestSummary: string | null;
  dimensions: RhythmDimension[];
};

const dimensionLabels: Record<string, string> = {
  sleep: "睡眠",
  wake: "醒来状态",
  eat: "饮食",
  exercise: "活动",
  task: "任务投入",
};

function displayValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).join("、");
  }
  return typeof value === "string" ? value.trim() : "";
}

function firstUsefulValue(step: RecordStep) {
  const preferredFieldIds: Record<string, string[]> = {
    sleep: ["quality", "duration"],
    wake: ["state", "startDifficulty"],
    eat: ["rhythm", "mealCount"],
    exercise: ["duration", "bodyState"],
    task: ["engagement", "completedSmallTask"],
  };
  const preferred = preferredFieldIds[step.id || ""] || [];
  const fields = Array.isArray(step.fields) ? step.fields : [];
  const ordered = [
    ...preferred.flatMap((fieldId) => fields.filter((field) => field.id === fieldId)),
    ...fields.filter((field) => !preferred.includes(field.id || "")),
  ];
  return ordered.map((field) => displayValue(field.value)).find(Boolean) || "暂未填写";
}

export function latestDimensions(record?: CloudSweetRecord | null): RhythmDimension[] {
  if (!record || !Array.isArray(record.records)) return [];
  return (record.records as RecordStep[])
    .filter((step) => step && typeof step === "object" && typeof step.id === "string")
    .map((step) => ({
      id: step.id || "",
      label: dimensionLabels[step.id || ""] || step.title || "节律",
      value: firstUsefulValue(step),
    }))
    .slice(0, 5);
}

export function rhythmOverview(records: CloudSweetRecord[], days: number, userId?: string): RhythmOverview {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - Math.max(0, days - 1));

  const scoped = records
    .filter((record) => (!userId || record.user_id === userId) && new Date(record.created_at) >= cutoff)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const activeDays = new Set(
    scoped.map((record) => {
      const date = new Date(record.created_at);
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    }),
  ).size;
  const latest = scoped[0] || null;

  return {
    recordCount: scoped.length,
    activeDays,
    latestAt: latest?.created_at || null,
    latestSummary: latest?.summary?.trim() || null,
    dimensions: latestDimensions(latest),
  };
}
