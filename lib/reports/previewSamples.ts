import { buildReportSummary } from "./summary";
import { reportDimensions, type ReportDimension, type ReportSourceRecord } from "./types";

export const reportPreviewScenarios = ["ready", "waiting", "insufficient", "expired", "guardianUnverified", "readFailure"] as const;
export type ReportPreviewScenario = typeof reportPreviewScenarios[number];
export type ReportPreviewViewer = "self" | "guardian" | "teacher";

// Fixed, invented category choices only. Neither this module nor its caller loads accounts or records.
const now = "2026-10-27T04:00:00Z";
const effectiveAt = "2026-10-05T16:00:00Z";
const expiresAt = "2026-11-04T16:00:00Z";
const records: ReportSourceRecord[] = [14, 16, 18, 21, 23, 25].map((day, index) => ({
  createdAt: `2026-10-${day}T04:00:00Z`,
  answers: {
    sleep: index < 3 ? "sleep_neutral" : "sleep_good",
    wake: "wake_energized",
    eat: ["eat_regular", "eat_neutral", "eat_irregular"][index % 3] as ReportSourceRecord["answers"]["eat"],
    exercise: "exercise_ten_to_nineteen",
    task: "task_smooth",
  },
}));

export function previewPermissionWindow(scenario: ReportPreviewScenario, viewer: ReportPreviewViewer) {
  if (viewer !== "self" && scenario === "waiting") {
    return { effectiveAt: "2026-10-25T16:00:00Z", expiresAt: "2026-11-24T16:00:00Z" };
  }
  if (viewer !== "self" && scenario === "expired") {
    return { effectiveAt: "2026-09-25T16:00:00Z", expiresAt: "2026-10-25T16:00:00Z" };
  }
  return { effectiveAt, expiresAt };
}

export function previewRecipientAvailable(scenario: ReportPreviewScenario, recipient: "guardian" | "teacher") {
  return scenario !== "expired" && !(scenario === "guardianUnverified" && recipient === "guardian");
}

export function buildPreviewReport(
  scenario: ReportPreviewScenario,
  viewer: ReportPreviewViewer,
  selectedDimensions: readonly ReportDimension[] = reportDimensions,
) {
  const ownReport = viewer === "self";
  return buildReportSummary({
    records: scenario === "insufficient" ? records.slice(0, 4) : records,
    ...previewPermissionWindow(scenario, viewer),
    now,
    dimensions: ownReport ? reportDimensions : selectedDimensions,
  });
}
