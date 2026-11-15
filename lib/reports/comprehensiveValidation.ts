import { detailFieldDefinitions, validDetailedFieldValue } from "./comprehensive";
import { parseReportInstant } from "./source";
import { reportCategories, reportDimensions, type ReportDimension } from "./types";
import {
  comprehensiveVersion, historyDetailsVersion, maximumDetailDaysPerPage, maximumDetailTextCharacters, maximumTrendBinsPerPage,
  type SchoolReportDetails, type SchoolReportTrend,
} from "./comprehensiveTypes";

const day = 86_400_000_000;
const offset = 28_800_000_000;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type ObjectValue = Record<string, unknown>;

function object(value: unknown): value is ObjectValue { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function shape(value: unknown, required: readonly string[], optional: readonly string[] = []): value is ObjectValue {
  return object(value) && required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function token(value: unknown) { return typeof value === "string" && value.length >= 16 && value.length <= 4096 && /^[A-Za-z0-9._~-]+$/.test(value) && !uuidPattern.test(value); }
function nullableToken(value: unknown) { return value === null || token(value); }
function instant(value: unknown): number | null { return parseReportInstant(value); }

function dimensions(value: unknown): value is ObjectValue[] {
  return Array.isArray(value) && value.length === reportDimensions.length && value.every((raw, index) => {
    if (!shape(raw, ["id", "state"], ["category"]) || raw.id !== reportDimensions[index] || typeof raw.state !== "string") return false;
    if (raw.state === "category") return typeof raw.category === "string" && reportCategories[reportDimensions[index]].some((category) => category === raw.category);
    return ["mixed", "insufficient", "unsupported"].includes(raw.state) && !Object.hasOwn(raw, "category");
  });
}

function window(value: unknown, expectedStart: number | null, expectedEnd: number): value is ObjectValue & { dimensions: ObjectValue[] } {
  return shape(value, ["start", "end", "dimensions"])
    && (expectedStart === null ? value.start === null : instant(value.start) === expectedStart)
    && instant(value.end) === expectedEnd && dimensions(value.dimensions);
}

function recent(value: unknown, end: number, length: number) {
  if (!shape(value, ["current", "previous", "comparisons"])) return false;
  const start = end - length * day;
  if (!window(value.current, start, end) || !window(value.previous, start - length * day, start)
    || !Array.isArray(value.comparisons) || value.comparisons.length !== reportDimensions.length) return false;
  const current = value.current;
  const previous = value.previous;
  return value.comparisons.every((raw, index) => {
    if (!shape(raw, ["id", "state"]) || raw.id !== reportDimensions[index]) return false;
    const a = current.dimensions[index]; const b = previous.dimensions[index];
    const supported = a.state === "category" && b.state === "category"
      && !(raw.id === "exercise" && (a.category === "exercise_unsure" || b.category === "exercise_unsure"));
    const expected = !supported ? "unavailable" : a.category === b.category ? "same" : "different";
    return raw.state === expected;
  });
}

function nextCalendarBin(start: number, unit: "week" | "month") {
  if ((start + offset) % day !== 0) return null;
  const date = new Date((start + offset) / 1000);
  if (unit === "week") return date.getUTCDay() === 1 ? start + 7 * day : null;
  return date.getUTCDate() === 1 ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) * 1000 - offset : null;
}

function trend(value: unknown): value is SchoolReportTrend {
  if (!shape(value, ["version", "asOf", "viewToken", "coverage", "overview", "recent", "longTerm", "detailsState"])
    || value.version !== comprehensiveVersion || !token(value.viewToken)
    || typeof value.detailsState !== "string" || !["off", "available"].includes(value.detailsState)) return false;
  const end = instant(value.asOf);
  if (end === null || !shape(value.coverage, ["start", "end", "state"]) || instant(value.coverage.end) !== end
    || typeof value.coverage.state !== "string" || !["complete", "partial", "unsupported"].includes(value.coverage.state)) return false;
  const start = value.coverage.start === null ? null : instant(value.coverage.start);
  if (value.coverage.start !== null && (start === null || start >= end)) return false;
  if (!window(value.overview, start, end) || !shape(value.recent, ["days7", "days30"])
    || !recent(value.recent.days7, end, 7) || !recent(value.recent.days30, end, 30)) return false;
  if ((start === null || value.coverage.state === "unsupported")
    && value.overview.dimensions.some((dimension) => dimension.state === "category" || dimension.state === "mixed")) return false;
  if (!shape(value.longTerm, ["unit", "bins", "nextCursor"]) || !Array.isArray(value.longTerm.bins)
    || value.longTerm.bins.length > maximumTrendBinsPerPage || !nullableToken(value.longTerm.nextCursor)) return false;
  const span = start === null ? 0 : Math.floor((end + offset) / day) - Math.floor((start + offset) / day) + 1;
  const expectedUnit = span <= 90 ? "week" : "month";
  if (value.longTerm.unit !== expectedUnit || (start === null && (value.longTerm.bins.length > 0 || value.longTerm.nextCursor !== null))) return false;
  if (start !== null && value.longTerm.bins.length === 0) return false;
  let previousStart: number | null = null;
  for (const raw of value.longTerm.bins) {
    if (!shape(raw, ["start", "end", "dimensions", "partial"]) || !dimensions(raw.dimensions) || typeof raw.partial !== "boolean") return false;
    const binStart = instant(raw.start); const binEnd = instant(raw.end);
    if (binStart === null || binEnd === null || binStart >= end || start === null
      || nextCalendarBin(binStart, expectedUnit) !== binEnd || binEnd <= start
      || (previousStart !== null && binEnd !== previousStart)
      || raw.partial !== (binStart < start || binEnd > end)) return false;
    previousStart = binStart;
  }
  if (value.longTerm.bins.length === 0 && value.longTerm.nextCursor !== null) return false;
  return true;
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return instant(`${value}T00:00:00+08:00`) !== null;
}

function detailDimension(value: unknown, id: ReportDimension) {
  if (!shape(value, ["id", "fields"]) || value.id !== id || !Array.isArray(value.fields)) return false;
  const definitions = detailFieldDefinitions[id];
  let lastIndex = -1;
  for (const raw of value.fields) {
    if (!shape(raw, ["id", "state"], ["value"])) return false;
    const index = definitions.findIndex((definition) => definition.id === raw.id);
    if (index < 0 || index <= lastIndex) return false;
    lastIndex = index;
    if (raw.state === "unsupported") {
      if (Object.hasOwn(raw, "value")) return false;
    } else if (raw.state === "available") {
      if (!validDetailedFieldValue(definitions[index], raw.value)) return false;
      if (Array.isArray(raw.value)) {
        const values = raw.value;
        const canonical = definitions[index].options!.filter((option) => values.includes(option));
        if (JSON.stringify(canonical) !== JSON.stringify(raw.value)) return false;
      }
    } else return false;
  }
  return value.fields.some((field) => object(field) && field.id === definitions[0].id);
}

function detailItem(value: unknown) {
  if (!shape(value, ["key", "date", "state"], ["dimensions", "summary", "summaryState"]) || !token(value.key) || typeof value.state !== "string") return false;
  if (value.date !== null && !calendarDate(value.date)) return false;
  if (value.state === "unsupported" || value.state === "conflict") {
    return (value.state !== "conflict" || value.date !== null)
      && !Object.hasOwn(value, "dimensions") && !Object.hasOwn(value, "summary") && !Object.hasOwn(value, "summaryState");
  }
  if (!["available", "partial"].includes(value.state) || value.date === null
    || !Array.isArray(value.dimensions) || value.dimensions.length !== reportDimensions.length
    || !value.dimensions.every((dimension, index) => detailDimension(dimension, reportDimensions[index]))
    || !Object.hasOwn(value, "summary") || !Object.hasOwn(value, "summaryState")) return false;
  if (value.summaryState === "available") {
    if (typeof value.summary !== "string" || value.summary.trim().length === 0 || [...value.summary].length > maximumDetailTextCharacters) return false;
  } else if (typeof value.summaryState !== "string" || !["missing", "unsupported"].includes(value.summaryState) || value.summary !== null) return false;
  if (value.state === "available") {
    if (value.summaryState === "unsupported" || value.dimensions.some((dimension) => object(dimension)
      && (dimension.fields as ObjectValue[]).some((field) => field.state !== "available"))) return false;
  }
  return true;
}

function details(value: unknown): value is SchoolReportDetails {
  if (!shape(value, ["version", "asOf", "viewToken", "items", "nextCursor"])
    || value.version !== historyDetailsVersion || !token(value.viewToken) || !nullableToken(value.nextCursor)
    || !Array.isArray(value.items) || value.items.length > maximumDetailDaysPerPage) return false;
  const asOf = instant(value.asOf);
  if (asOf === null || (value.items.length === 0 && value.nextCursor !== null)) return false;
  const asOfDate = new Date((asOf + offset) / 1000).toISOString().slice(0, 10);
  const seen = new Set<string>();
  let previousDate: string | null = null;
  let dated = false; let undated = false;
  for (const raw of value.items) {
    if (!detailItem(raw) || !object(raw) || seen.has(raw.key as string)) return false;
    seen.add(raw.key as string);
    if (raw.date === null) undated = true;
    else {
      dated = true;
      const date = raw.date as string;
      if (date > asOfDate || (previousDate !== null && date >= previousDate)) return false;
      previousDate = date;
    }
  }
  return !(dated && undated);
}

export function isSchoolReportTrend(value: unknown): value is SchoolReportTrend { try { return trend(value); } catch { return false; } }
export function isSchoolReportDetails(value: unknown): value is SchoolReportDetails { try { return details(value); } catch { return false; } }
export function parseSchoolReportTrend(value: unknown): SchoolReportTrend {
  if (!isSchoolReportTrend(value)) throw new TypeError("Invalid comprehensive report DTO");
  return value;
}
export function parseSchoolReportDetails(value: unknown): SchoolReportDetails {
  if (!isSchoolReportDetails(value)) throw new TypeError("Invalid detailed report DTO");
  return value;
}
