export const reportDimensions = ["sleep", "wake", "eat", "exercise", "task"] as const;

export type ReportDimension = typeof reportDimensions[number];

export const reportCategories = {
  sleep: ["sleep_very_good", "sleep_good", "sleep_neutral", "sleep_poor", "sleep_very_poor"],
  wake: ["wake_very_energized", "wake_energized", "wake_neutral", "wake_tired", "wake_very_tired"],
  eat: ["eat_very_regular", "eat_regular", "eat_neutral", "eat_irregular", "eat_very_irregular"],
  exercise: ["exercise_none", "exercise_one_to_nine", "exercise_ten_to_nineteen", "exercise_twenty_to_twenty_nine", "exercise_over_thirty", "exercise_unsure"],
  task: ["task_very_smooth", "task_smooth", "task_neutral", "task_difficult", "task_very_difficult"],
} as const satisfies Record<ReportDimension, readonly string[]>;

export type ReportCategoryId = typeof reportCategories[ReportDimension][number];

export type ReportAnswers = {
  [Dimension in ReportDimension]: typeof reportCategories[Dimension][number];
};

// This is a private, normalized calculation input, never an adult response type.
export type ReportSourceRecord = {
  createdAt: string;
  answers: ReportAnswers;
};

export type ReportDimensionSummary = {
  id: ReportDimension;
  state: "category" | "mixed" | "insufficient";
  category?: ReportCategoryId;
  previousCategory?: ReportCategoryId;
  comparison: "same" | "different" | "unavailable";
};

export const reportSummaryVersion = "sweet-period-report-v1" as const;

// No source text, identity, per-day data or sample counts belong in this contract.
export type ReportSummary = {
  version: typeof reportSummaryVersion;
  status: "waiting" | "expired" | "invalid" | "ready";
  period?: { start: string; end: string };
  dimensions: ReportDimensionSummary[];
};

export type BuildReportSummaryInput = {
  records: readonly ReportSourceRecord[];
  effectiveAt: string;
  expiresAt: string;
  now: Date | string;
  dimensions: readonly ReportDimension[];
};
