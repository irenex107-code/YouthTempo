import { formatReportInstant, parseReportInstant } from "./source";
import { reportCategories, reportDimensions, type ReportCategoryId, type ReportDimension } from "./types";
import {
  comprehensiveVersion, historyDetailsVersion, maximumDetailDaysPerPage, maximumDetailTextCharacters, maximumTrendBinsPerPage,
  type ComprehensiveSourceRow, type DetailFieldDefinition, type HistoryDetailPosition, type NormalizedSweetDetails,
  type SchoolReportBin, type SchoolReportComparison, type SchoolReportDetailDimension, type SchoolReportDetailItem,
  type SchoolReportDetailsCore, type SchoolReportDimension, type SchoolReportField, type SchoolReportRecent,
  type SchoolReportTrendCore, type SchoolReportWindow,
} from "./comprehensiveTypes";

const dayMicroseconds = 86_400_000_000;
const dayMilliseconds = 86_400_000;
const shanghaiOffset = 28_800_000_000;

// IDs/types/options only: stored titles, labels and unknown JSON are never DTOs.
export const detailFieldDefinitions: Record<ReportDimension, readonly DetailFieldDefinition[]> = {
  sleep: [
    { id: "quality", kind: "single", required: true, options: ["睡得很好", "比较好", "一般", "不太好", "很不好"] },
    { id: "duration", kind: "single", options: ["少于 5 小时", "5 小时以上、不足 6 小时", "6 小时以上、不足 7 小时", "7 小时以上、不足 8 小时", "8 小时以上", "不太确定"] },
    { id: "factors", kind: "multi", options: ["睡前想太多", "作业或任务压力", "手机使用时间较长", "家庭或人际压力", "身体不舒服", "不太确定"] },
    { id: "note", kind: "text" },
  ],
  wake: [
    { id: "state", kind: "single", required: true, options: ["很有精神", "比较有精神", "一般", "有点疲惫", "很疲惫"] },
    { id: "factors", kind: "multi", options: ["没睡够", "一醒来就想到很多事", "早上任务压力大", "身体有点累", "情绪影响", "不太确定"] },
    { id: "note", kind: "text" },
  ],
  eat: [
    { id: "rhythm", kind: "single", required: true, options: ["很规律", "比较规律", "一般", "不太规律", "很不规律"] },
    { id: "mealCount", kind: "single", options: ["3 餐或以上", "2 餐", "1 餐", "没有吃正餐", "不太确定"] },
    { id: "foodDetails", kind: "text" },
    { id: "factors", kind: "multi", options: ["太忙了", "没胃口", "作息太乱", "情绪影响", "忘记吃饭", "家里或学校选择有限", "不太确定"] },
  ],
  exercise: [
    { id: "duration", kind: "single", required: true, options: ["0 分钟", "1–9 分钟", "10–19 分钟", "20–29 分钟", "30 分钟以上", "不太确定"] },
    { id: "activityTypes", kind: "multi", options: ["步行、通勤或上下楼", "拉伸或轻量活动", "体育课", "跑步、球类或跳操等运动", "家务或日常活动", "其他"] },
    { id: "activityNote", kind: "text" },
    { id: "bodyState", kind: "single", options: ["很有活力", "比较有活力", "一般", "有点疲惫", "很疲惫"] },
    { id: "factors", kind: "multi", options: ["太累了", "没有时间", "没有动力", "一直坐着学习或工作", "情绪影响", "身体不舒服", "不太确定"] },
  ],
  task: [
    { id: "engagement", kind: "single", required: true, options: ["很顺利", "比较顺利", "一般", "不太顺利", "很不顺利"] },
    { id: "difficultyReasons", kind: "multi", options: ["任务太多", "不知道从哪里开始", "担心做不好", "被催促后更抗拒", "情绪很累", "不太确定"] },
    { id: "completedSmallTask", kind: "text" },
  ],
};

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function textLength(value: string) { return [...value].length; }
function lexical(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0; }

/** Shared deterministic value rule for normalization and strict public DTO checks. */
export function validDetailedFieldValue(definition: DetailFieldDefinition, value: unknown): value is string | string[] {
  if (definition.kind === "text") return typeof value === "string" && value.trim().length > 0 && textLength(value) <= maximumDetailTextCharacters;
  if (definition.kind === "single") return typeof value === "string" && Boolean(definition.options?.includes(value));
  return Array.isArray(value) && value.length > 0 && new Set(value).size === value.length
    && value.every((item) => typeof item === "string" && definition.options?.includes(item));
}

function missingOptional(definition: DetailFieldDefinition, value: unknown) {
  return !definition.required && ((definition.kind === "multi" && Array.isArray(value) && value.length === 0)
    || (definition.kind === "single" && value === "") || (definition.kind === "text" && typeof value === "string" && value.trim().length === 0));
}

/** Private normalized content. It never establishes ownership or sharing permission. */
export function normalizeSweetDetails(records: unknown, rawSummary: unknown): NormalizedSweetDetails {
  const unavailable = (): NormalizedSweetDetails => ({ answers: {}, dimensions: [], summary: null, summaryState: "unsupported", state: "unsupported" });
  if (!Array.isArray(records)) return unavailable();
  const answers: Partial<Record<ReportDimension, ReportCategoryId>> = {};
  const dimensions: SchoolReportDetailDimension[] = [];
  let malformed = records.length !== reportDimensions.length || records.some((step) => !object(step) || !reportDimensions.includes(step.id as ReportDimension));
  let recognizedSteps = 0;
  let availableFields = 0;
  for (const id of reportDimensions) {
    const definitions = detailFieldDefinitions[id];
    const matches = records.filter((step) => object(step) && step.id === id);
    const fields: SchoolReportField[] = [];
    if (matches.length !== 1 || !object(matches[0]) || !Array.isArray(matches[0].fields)) {
      fields.push({ id: definitions[0].id, state: "unsupported" });
      dimensions.push({ id, fields });
      malformed = true;
      continue;
    }
    recognizedSteps += 1;
    const sourceFields = matches[0].fields;
    if (sourceFields.some((field) => !object(field) || !definitions.some((definition) => definition.id === field.id))) malformed = true;
    for (const definition of definitions) {
      const fieldMatches = sourceFields.filter((field) => object(field) && field.id === definition.id);
      if (fieldMatches.length === 0 && !definition.required) continue;
      if (fieldMatches.length !== 1 || !object(fieldMatches[0])) {
        fields.push({ id: definition.id, state: "unsupported" }); malformed = true; continue;
      }
      const value = fieldMatches[0].value;
      if (missingOptional(definition, value)) continue;
      if (!validDetailedFieldValue(definition, value)) {
        fields.push({ id: definition.id, state: "unsupported" }); malformed = true; continue;
      }
      const canonicalValue = Array.isArray(value) ? definition.options!.filter((option) => value.includes(option)) : value;
      fields.push({ id: definition.id, state: "available", value: canonicalValue });
      availableFields += 1;
      if (definition.required && typeof value === "string") {
        const index = definition.options!.indexOf(value);
        answers[id] = reportCategories[id][index];
      }
    }
    dimensions.push({ id, fields });
  }
  if (recognizedSteps === 0) return unavailable();
  let summary: string | null = null;
  let summaryState: NormalizedSweetDetails["summaryState"] = "missing";
  if (rawSummary !== null && rawSummary !== undefined && rawSummary !== "") {
    if (typeof rawSummary !== "string" || textLength(rawSummary) > maximumDetailTextCharacters) summaryState = "unsupported";
    else if (rawSummary.trim().length > 0) { summary = rawSummary; summaryState = "available"; }
  }
  if (summaryState === "unsupported") malformed = true;
  const allPrimary = reportDimensions.every((id) => answers[id] !== undefined);
  const state = !malformed && allPrimary ? "available" : availableFields > 0 || summaryState === "available" ? "partial" : "unsupported";
  return { answers, dimensions, summary, summaryState, state };
}

export type CanonicalSweetDay = {
  key: string; date: string; dayNumber: number; instant: number; conflict: boolean;
  normalized: NormalizedSweetDetails;
};
export type CanonicalSweetHistory = { days: CanonicalSweetDay[]; undated: Array<{ key: string }> };

function dayNumber(instant: number) { return Math.floor((instant + shanghaiOffset) / dayMicroseconds); }
function dateForDay(day: number) { return new Date(day * dayMilliseconds).toISOString().slice(0, 10); }
function startOfDay(day: number) { return day * dayMicroseconds - shanghaiOffset; }
function requireInstant(value: string) {
  const instant = parseReportInstant(value);
  if (instant === null) throw new TypeError("Invalid report instant");
  return instant;
}

/** Latest retained day FIRST, then mapping. An unknown replacement never reveals an older answer. */
export function buildCanonicalSweetHistory(rows: readonly ComprehensiveSourceRow[], asOf: string): CanonicalSweetHistory {
  if (!Array.isArray(rows)) throw new TypeError("Invalid SWEET source input");
  const end = requireInstant(asOf);
  const byDay = new Map<number, CanonicalSweetDay & { fingerprint: string }>();
  const undated: Array<{ key: string }> = [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (!object(row) || typeof row.id !== "string" || !row.id || ids.has(row.id)) throw new TypeError("Invalid SWEET source key");
    ids.add(row.id);
    const instant = parseReportInstant(row.created_at);
    if (instant === null) { undated.push({ key: row.id }); continue; }
    if (instant >= end) continue;
    const day = dayNumber(instant);
    const current = byDay.get(day);
    if (current && instant < current.instant) continue;
    const normalized = normalizeSweetDetails(row.records, row.summary);
    const fingerprint = JSON.stringify({ normalized, originalSummary: typeof row.summary === "string" ? row.summary : null });
    if (!current || instant > current.instant) {
      byDay.set(day, { key: row.id, date: dateForDay(day), dayNumber: day, instant, normalized, conflict: false, fingerprint });
    } else {
      current.conflict = current.conflict || current.fingerprint !== fingerprint;
      if (lexical(row.id, current.key) < 0) current.key = row.id;
    }
  }
  return {
    days: [...byDay.values()].sort((left, right) => right.dayNumber - left.dayNumber)
      .map(({ fingerprint: _fingerprint, ...day }) => day),
    undated: undated.sort((left, right) => lexical(left.key, right.key)),
  };
}

function summarizeDimension(days: readonly CanonicalSweetDay[], id: ReportDimension, extraUnknown = false): SchoolReportDimension {
  const counts = new Map<ReportCategoryId, number>();
  let knownDays = 0;
  let unknown = extraUnknown;
  for (const day of days) {
    const answer = day.conflict ? undefined : day.normalized.answers[id];
    if (answer === undefined) { unknown = true; continue; }
    knownDays += 1;
    counts.set(answer, (counts.get(answer) || 0) + 1);
  }
  if (knownDays < 3) return { id, state: knownDays === 0 && unknown ? "unsupported" : "insufficient" };
  const maximum = Math.max(...counts.values());
  const leaders = [...counts.entries()].filter(([, count]) => count === maximum);
  return leaders.length === 1 ? { id, state: "category", category: leaders[0][0] } : { id, state: "mixed" };
}

function windowSummary(days: readonly CanonicalSweetDay[], start: number | null, end: number, extraUnknown = false): SchoolReportWindow {
  return { start: start === null ? null : formatReportInstant(start), end: formatReportInstant(end), dimensions: reportDimensions.map((id) => summarizeDimension(days, id, extraUnknown)) };
}

function recentSummary(days: readonly CanonicalSweetDay[], end: number, length: number): SchoolReportRecent {
  const start = end - length * dayMicroseconds;
  const previousStart = start - length * dayMicroseconds;
  const current = windowSummary(days.filter((day) => day.instant >= start && day.instant < end), start, end);
  const previous = windowSummary(days.filter((day) => day.instant >= previousStart && day.instant < start), previousStart, start);
  const comparisons: SchoolReportComparison[] = reportDimensions.map((id, index) => {
    const a = current.dimensions[index]; const b = previous.dimensions[index];
    const supported = a.state === "category" && b.state === "category"
      && !(id === "exercise" && (a.category === "exercise_unsure" || b.category === "exercise_unsure"));
    return { id, state: !supported ? "unavailable" : a.category === b.category ? "same" : "different" };
  });
  return { current, previous, comparisons };
}

function binStart(instant: number, unit: "week" | "month") {
  const day = dayNumber(instant);
  const localDate = new Date(day * dayMilliseconds);
  if (unit === "week") return startOfDay(day - (localDate.getUTCDay() + 6) % 7);
  return Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), 1) * 1000 - shanghaiOffset;
}

function nextBin(start: number, unit: "week" | "month") {
  if (unit === "week") return start + 7 * dayMicroseconds;
  const date = new Date((start + shanghaiOffset) / 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) * 1000 - shanghaiOffset;
}

function pageLimit(value: number | undefined, maximum: number) {
  const limit = value ?? maximum;
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw new TypeError("Invalid report page size");
  return limit;
}

export function buildComprehensiveTrend(input: {
  rows: readonly ComprehensiveSourceRow[]; asOf: string; detailsState?: "off" | "available";
  beforeBinStart?: string | null; limit?: number;
}): SchoolReportTrendCore {
  const end = requireInstant(input.asOf);
  const asOf = formatReportInstant(end);
  const history = buildCanonicalSweetHistory(input.rows, asOf);
  const days = history.days;
  const oldest = days.length ? days[days.length - 1].instant : null;
  const anyKnown = days.some((day) => !day.conflict && reportDimensions.some((id) => day.normalized.answers[id] !== undefined));
  const unknown = history.undated.length > 0 || days.some((day) => day.conflict || day.normalized.state !== "available");
  const coverage = { start: oldest === null ? null : formatReportInstant(oldest), end: asOf,
    state: !unknown ? "complete" as const : anyKnown ? "partial" as const : "unsupported" as const };
  const span = oldest === null ? 0 : dayNumber(end) - dayNumber(oldest) + 1;
  const unit = span <= 90 ? "week" as const : "month" as const;
  const grouped = new Map<number, CanonicalSweetDay[]>();
  for (const day of days) {
    const key = binStart(day.instant, unit);
    const group = grouped.get(key) || [];
    group.push(day); grouped.set(key, group);
  }
  const allBins: SchoolReportBin[] = [];
  if (oldest !== null) {
    for (let start = binStart(oldest, unit); start < end; start = nextBin(start, unit)) {
      const finish = nextBin(start, unit);
      allBins.push({ ...windowSummary(grouped.get(start) || [], start, finish), start: formatReportInstant(start), partial: start < oldest || finish > end });
    }
  }
  const before = input.beforeBinStart === null || input.beforeBinStart === undefined ? null : requireInstant(input.beforeBinStart);
  const candidates = allBins.reverse().filter((bin) => before === null || requireInstant(bin.start) < before);
  const limit = pageLimit(input.limit, maximumTrendBinsPerPage);
  const bins = candidates.slice(0, limit);
  const hasMore = candidates.length > bins.length;
  return {
    version: comprehensiveVersion, asOf, coverage, overview: windowSummary(days, oldest, end, history.undated.length > 0),
    recent: { days7: recentSummary(days, end, 7), days30: recentSummary(days, end, 30) },
    longTerm: { unit, bins, hasMore, nextBinStart: hasMore ? bins[bins.length - 1].start : null },
    detailsState: input.detailsState ?? "off",
  };
}

function dayDetail(day: CanonicalSweetDay): SchoolReportDetailItem {
  if (day.conflict) return { key: day.key, date: day.date, state: "conflict" };
  if (day.normalized.state === "unsupported") return { key: day.key, date: day.date, state: "unsupported" };
  return { key: day.key, date: day.date, state: day.normalized.state, dimensions: day.normalized.dimensions,
    summary: day.normalized.summary, summaryState: day.normalized.summaryState };
}

/** Internal reference page; its keys/position must never be sent as a public response. */
export function buildComprehensiveDetails(input: {
  rows: readonly ComprehensiveSourceRow[]; asOf: string; position?: HistoryDetailPosition | null; limit?: number;
}): SchoolReportDetailsCore {
  const asOf = formatReportInstant(requireInstant(input.asOf));
  const history = buildCanonicalSweetHistory(input.rows, asOf);
  const limit = pageLimit(input.limit, maximumDetailDaysPerPage);
  const position = input.position;
  if (position?.phase === "dated" && !/^\d{4}-\d{2}-\d{2}$/.test(position.beforeDate)) throw new TypeError("Invalid detail page position");
  if (position?.phase !== "undated") {
    const dated = history.days.filter((day) => !position || day.date < position.beforeDate);
    const page = dated.slice(0, limit);
    if (page.length > 0) {
      const moreDated = dated.length > page.length;
      const nextPosition: HistoryDetailPosition | null = moreDated ? { phase: "dated", beforeDate: page[page.length - 1].date }
        : history.undated.length > 0 ? { phase: "undated", afterId: null } : null;
      return { version: historyDetailsVersion, asOf, items: page.map(dayDetail), hasMore: nextPosition !== null, nextPosition };
    }
  }
  const afterId = position?.phase === "undated" ? position.afterId : null;
  const remaining = history.undated.filter((row) => afterId === null || lexical(row.key, afterId) > 0);
  const page = remaining.slice(0, limit);
  const hasMore = remaining.length > page.length;
  return { version: historyDetailsVersion, asOf, items: page.map((row) => ({ key: row.key, date: null, state: "unsupported" })), hasMore,
    nextPosition: hasMore ? { phase: "undated", afterId: page[page.length - 1].key } : null };
}
