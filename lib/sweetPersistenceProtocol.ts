import type { CloudSweetRecord } from "./cloudRecords";
import type { SavedSweetRecordStep } from "./sweetRecordTypes";

export type SweetIntent = "preserve_summary" | "replace_summary" | "clear_summary"
  | "delete_day" | "delete_record_cutoff";
export type SweetRecordInput = {
  records: SavedSweetRecordStep[];
  summary?: string | null;
  smallStep?: string | null;
  recommendedNextTool?: string | null;
};
export type SweetScope = {
  operationDay: string;
  targetDay: string;
  headToken: string | null;
  record: CloudSweetRecord | null;
};
export type SweetCommand = {
  operationDay: string;
  targetDay: string;
  expectedHead: string | null;
  intent: SweetIntent;
  record?: SweetRecordInput;
  recordId?: string;
};
export type SweetStatus = "ready" | "accepted" | "noop" | "conflict" | "scope_expired"
  | "protocol_unavailable" | "denied" | "not_found" | "invalid_request" | "write_rejected";
export type SweetReply = SweetScope & { status: "ready" | "accepted" | "noop" };
export type SweetFailure = SweetStatus | "outcome_unknown" | "interrupted";

export class SweetPersistenceError extends Error {
  constructor(public readonly code: SweetFailure) {
    super(`sweet_persistence_${code}`);
    this.name = "SweetPersistenceError";
  }
}

export function isSweetUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Validates an expected date; never computes today's business day in a client. */
export function isSweetDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Validates a persisted instant's scope with the same IANA zone as PostgreSQL. */
export function sweetStoredDay(instant: string): string | null {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (kind: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === kind)?.value;
  const year = part("year");
  return year && part("month") && part("day") ? `${year.padStart(4, "0")}-${part("month")}-${part("day")}` : null;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit;
const summary = (value: unknown) => value == null || text(value, 20_000);

export function validSweetRecords(value: unknown): value is SavedSweetRecordStep[] {
  const ids = ["sleep", "wake", "eat", "exercise", "task"];
  if (!Array.isArray(value) || value.length !== ids.length) return false;
  const seen = new Set<string>();
  return value.every((step: unknown) => {
    if (!object(step) || typeof step.id !== "string" || !ids.includes(step.id) || seen.has(step.id)
      || Object.keys(step).some((key) => !["id", "title", "label", "fields"].includes(key))
      || !text(step.title, 2_000) || !text(step.label, 2_000)
      || !Array.isArray(step.fields) || step.fields.length === 0 || step.fields.length > 30) return false;
    seen.add(step.id);
    const fields = new Set<string>();
    return step.fields.every((field: unknown) => {
      if (!object(field) || Object.keys(field).some((key) => !["id", "title", "value"].includes(key))
        || !text(field.id, 100) || !field.id || fields.has(field.id) || !text(field.title, 2_000)) return false;
      fields.add(field.id);
      return text(field.value, 10_000) || (Array.isArray(field.value) && field.value.length <= 100
        && field.value.every((item) => text(item, 10_000)));
    });
  });
}

export function sweetRecordsKey(records: SavedSweetRecordStep[]) {
  return JSON.stringify(records.map((step) => ({ id: step.id, title: step.title, label: step.label,
    fields: step.fields.map((field) => ({ id: field.id, title: field.title, value: field.value })) })));
}

export function parseSweetCommand(value: unknown): SweetCommand | null {
  if (!object(value) || !Object.hasOwn(value, "expectedHead")
    || !isSweetDay(value.operationDay) || !isSweetDay(value.targetDay)
    || !(value.expectedHead === null || isSweetUuid(value.expectedHead))) return null;
  const allowed = new Set(["operationDay", "targetDay", "expectedHead", "intent", "record", "recordId", "locale"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  if (!["preserve_summary", "replace_summary", "clear_summary", "delete_day", "delete_record_cutoff"].includes(String(value.intent))) return null;
  const intent = value.intent as SweetIntent;
  if (intent === "delete_day" || intent === "delete_record_cutoff") {
    if (!isSweetUuid(value.recordId) || value.record !== undefined) return null;
  } else {
    if (!object(value.record) || !validSweetRecords(value.record.records)
      || !summary(value.record.summary) || !summary(value.record.smallStep) || !summary(value.record.recommendedNextTool)
      || Object.keys(value.record).some((key) => !["records", "summary", "smallStep", "recommendedNextTool"].includes(key))) return null;
    // Null is an explicit operation. A fallback cannot smuggle in an update.
    if (intent !== "replace_summary" && [value.record.summary, value.record.smallStep,
      value.record.recommendedNextTool].some((item) => item != null && item !== "")) return null;
  }
  return value as unknown as SweetCommand;
}

export function parseSweetReply(value: unknown, actor: string): SweetReply | null {
  if (!object(value) || !["ready", "accepted", "noop"].includes(String(value.status))
    || !isSweetDay(value.operationDay) || !isSweetDay(value.targetDay)
    || !(value.headToken === null || isSweetUuid(value.headToken))) return null;
  if (value.status !== "ready" && value.headToken === null) return null;
  if (value.record !== null) {
    const row = value.record;
    if (!object(row) || !isSweetUuid(row.id) || row.user_id !== actor || row.id !== value.headToken
      || !(row.school_id === null || isSweetUuid(row.school_id))
      || !validSweetRecords(row.records) || !["summary", "small_step", "recommended_next_tool"].every((key) =>
        Object.hasOwn(row, key) && (row[key] === null || text(row[key], 20_000)))
      || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) return null;
    const storedDay = sweetStoredDay(row.created_at);
    if (storedDay !== value.targetDay) return null;
  }
  return value as unknown as SweetReply;
}

export function sweetHttpStatus(status: string) {
  if (status === "accepted") return 201;
  if (status === "ready" || status === "noop") return 200;
  if (status === "conflict" || status === "scope_expired") return 409;
  if (status === "denied") return 403;
  if (status === "not_found") return 404;
  if (status === "invalid_request") return 400;
  return 503;
}
