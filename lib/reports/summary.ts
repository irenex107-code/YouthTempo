import { formatReportInstant, parseReportInstant } from "./source";
import {
  reportCategories, reportDimensions, reportSummaryVersion,
  type BuildReportSummaryInput, type ReportCategoryId, type ReportDimension,
  type ReportDimensionSummary, type ReportSourceRecord, type ReportSummary,
} from "./types";

const dayMicroseconds = 24 * 60 * 60 * 1_000_000;
const periodMicroseconds = 7 * dayMicroseconds;
const shanghaiOffsetMicroseconds = 8 * 60 * 60 * 1_000_000;

type TimedSource = { instant: number; answers: ReportSourceRecord["answers"] };
type Mode = { state: "insufficient" | "mixed" } | { state: "category"; category: ReportCategoryId };

function validatedSources(records: readonly ReportSourceRecord[]): TimedSource[] {
  const result: TimedSource[] = [];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const instant = parseReportInstant(record.createdAt);
    if (instant === null || !record.answers || typeof record.answers !== "object") continue;
    if (!reportDimensions.every((dimension) => reportCategories[dimension].some((category) => category === record.answers[dimension]))) continue;
    result.push({ instant, answers: record.answers });
  }
  return result;
}

function dailySources(records: TimedSource[], start: number, end: number): TimedSource[] {
  const days = new Map<number, { record: TimedSource; instants: Map<number, TimedSource>; conflicted: boolean }>();
  for (const record of records) {
    if (record.instant < start || record.instant >= end) continue;
    const day = Math.floor((record.instant + shanghaiOffsetMicroseconds) / dayMicroseconds);
    const existing = days.get(day);
    if (!existing) {
      days.set(day, { record, instants: new Map([[record.instant, record]]), conflicted: false });
      continue;
    }
    const sameInstant = existing.instants.get(record.instant);
    if (sameInstant && reportDimensions.some((dimension) => record.answers[dimension] !== sameInstant.answers[dimension])) existing.conflicted = true;
    existing.instants.set(record.instant, record);
    if (record.instant > existing.record.instant) existing.record = record;
  }
  return [...days.values()].filter((entry) => !entry.conflicted).map((entry) => entry.record);
}

function mode(records: TimedSource[], dimension: ReportDimension): Mode {
  if (records.length < 3) return { state: "insufficient" };
  const counts = new Map<ReportCategoryId, number>();
  for (const record of records) {
    const category = record.answers[dimension];
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  const maximum = Math.max(...counts.values());
  const leaders = [...counts.entries()].filter(([, count]) => count === maximum);
  return leaders.length === 1 ? { state: "category", category: leaders[0][0] } : { state: "mixed" };
}

function empty(status: Exclude<ReportSummary["status"], "ready">): ReportSummary {
  return { version: reportSummaryVersion, status, dimensions: [] };
}

/**
 * Pure calculation for one already scoped authorization. Future server code must
 * independently enforce current ownership, relationship, consent and revocation.
 * Only recipient-safe enums leave this function; all source details stay private.
 */
export function buildReportSummary(input: BuildReportSummaryInput): ReportSummary {
  const effective = parseReportInstant(input.effectiveAt);
  const expires = parseReportInstant(input.expiresAt);
  const now = input.now instanceof Date
    ? (Number.isFinite(input.now.getTime()) ? input.now.getTime() * 1000 : null)
    : parseReportInstant(input.now);
  if (effective === null || expires === null || now === null || expires <= effective
    || !Number.isSafeInteger(now) || !Array.isArray(input.records) || !Array.isArray(input.dimensions)
    || input.dimensions.length === 0
    || new Set(input.dimensions).size !== input.dimensions.length
    || input.dimensions.some((dimension) => !reportDimensions.includes(dimension))) return empty("invalid");
  if (now >= expires) return empty("expired");
  const completed = Math.floor((now - effective) / periodMicroseconds);
  if (completed < 1) return empty("waiting");
  const start = effective + (completed - 1) * periodMicroseconds;
  const end = start + periodMicroseconds;
  const sources = validatedSources(input.records);
  const current = dailySources(sources, start, end);
  const previous = completed >= 2 ? dailySources(sources, start - periodMicroseconds, start) : [];
  const dimensions = reportDimensions.filter((dimension) => input.dimensions.includes(dimension)).map((id): ReportDimensionSummary => {
    const currentMode = mode(current, id);
    if (currentMode.state !== "category") return { id, state: currentMode.state, comparison: "unavailable" };
    const previousMode = mode(previous, id);
    return previousMode.state === "category"
      ? { id, state: "category", category: currentMode.category, previousCategory: previousMode.category,
        comparison: currentMode.category === previousMode.category ? "same" : "different" }
      : { id, state: "category", category: currentMode.category, comparison: "unavailable" };
  });
  return { version: reportSummaryVersion, status: "ready", period: { start: formatReportInstant(start), end: formatReportInstant(end) }, dimensions };
}
