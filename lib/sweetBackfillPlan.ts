/**
 * Offline admission check for an explicitly supplied export. This module never
 * connects to a database, reads environment variables or executes a backfill.
 * Export/barrier declarations are claims, not proof of a live database barrier.
 * The SQL preflight must repeat every check under its database lock.
 */
export type SweetHeadCandidate = {
  user_id: string;
  business_day: string;
  head_token: string;
  current_record_id: string;
  action: "create" | "already_matches";
};

export type SweetBackfillIssueCode =
  | "invalid_envelope" | "incomplete_export" | "count_mismatch"
  | "barrier_not_asserted" | "invalid_actor" | "duplicate_actor"
  | "invalid_source_id" | "duplicate_source_id" | "source_actor_missing"
  | "invalid_source_time" | "invalid_source_payload" | "latest_time_tie"
  | "invalid_selection" | "duplicate_selection" | "selection_mismatch"
  | "selection_missing" | "selection_without_source"
  | "unknown_foreign_key" | "foreign_key_not_reviewed" | "foreign_key_not_validated"
  | "foreign_key_inventory_incomplete" | "invalid_reference" | "reference_source_missing"
  | "invalid_head" | "duplicate_head" | "head_actor_missing"
  | "head_source_mismatch" | "tombstone_has_source";

export type SweetBackfillIssue = { code: SweetBackfillIssueCode; count: number };

export type SweetBackfillPlan = {
  version: 1;
  offlineAdmission: "eligible" | "blocked";
  databaseReady: false;
  requiresLockedDatabaseRevalidation: true;
  sourceMutationCount: 0;
  claimedBarrierComplete: boolean;
  counts: {
    inputSources: number;
    validSources: number;
    actors: number;
    scopes: number;
    multiSourceScopes: number;
    nullSummarySources: number;
    existingHeads: number;
    tombstones: number;
    candidateHeads: number;
  };
  issues: SweetBackfillIssue[];
  /** Restricted metadata. Do not write to the default/public diagnostic output. */
  heads: SweetHeadCandidate[];
};

type JsonObject = Record<string, unknown>;
type Source = { id: string; owner: string; day: string; instant: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dimensions = ["sleep", "wake", "eat", "exercise", "task"];
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});
const utf8 = new TextEncoder();

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || value.startsWith("0000-")) return false;
  const instant = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}

/** Exact timezone-bearing ISO timestamp; preserve PostgreSQL microsecond order. */
export function sweetBackfillInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const [, year, month, date, hour, minute, second, fraction = "", zone, sign, offsetHour, offsetMinute] = match;
  const oh = Number(offsetHour || 0), om = Number(offsetMinute || 0);
  if (Number(year) < 1 || oh > 14 || om > 59 || (oh === 14 && om !== 0)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const offset = zone === "Z" ? 0 : (sign === "+" ? 1 : -1) * (oh * 60 + om) * 60_000;
  const local = new Date(milliseconds + offset);
  if (local.getUTCFullYear() !== Number(year) || local.getUTCMonth() + 1 !== Number(month)
    || local.getUTCDate() !== Number(date) || local.getUTCHours() !== Number(hour)
    || local.getUTCMinutes() !== Number(minute) || local.getUTCSeconds() !== Number(second)) return null;
  const result = milliseconds * 1000 + Number(fraction.padEnd(6, "0").slice(3));
  return Number.isSafeInteger(result) ? result : null;
}

export function sweetBackfillDay(value: unknown): string | null {
  const instant = sweetBackfillInstant(value);
  if (instant === null) return null;
  const parts = dayFormatter.formatToParts(new Date(Math.floor(instant / 1000)));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}

function payload(row: JsonObject) {
  if (!Array.isArray(row.records) || row.records.length !== dimensions.length) return false;
  const text = (value: unknown, maximum: number): value is string => {
    if (typeof value !== "string" || value.length > maximum) return false;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code === 0) return false;
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    }
    return true;
  };
  for (const id of dimensions) {
    const steps = row.records.filter((item) => object(item) && item.id === id);
    if (steps.length !== 1 || !object(steps[0])) return false;
    const step = steps[0];
    if (Object.keys(step).some((key) => !["id", "title", "label", "fields"].includes(key))
      || !text(step.title, 2_000) || !text(step.label, 2_000)
      || !Array.isArray(step.fields) || !step.fields.length || step.fields.length > 30) return false;
    const fields = new Set<string>();
    for (const field of step.fields) {
      if (!object(field) || Object.keys(field).some((key) => !["id", "title", "value"].includes(key))
        || !text(field.id, 100) || !field.id
        || fields.has(field.id) || !text(field.title, 2_000)
        || !(text(field.value, 10_000) || (Array.isArray(field.value) && field.value.length <= 100
          && field.value.every((item) => text(item, 10_000))))) return false;
      fields.add(field.id);
    }
  }
  return jsonbRecordBytes(row.records) <= 60_000
    && [row.summary, row.small_step, row.recommended_next_tool]
    .every((value) => value === null || text(value, 20_000))
    && (row.school_id === null || identifier(row.school_id));
}

/** Byte budget of canonical typed records in PostgreSQL jsonb::text format.
 * Object key order cannot change byte length. The typed shape contains strings,
 * arrays and objects only, and JSONB uses a space after commas and colons.
 */
function jsonbRecordBytes(value: unknown): number {
  if (typeof value === "string") return utf8.encode(JSON.stringify(value)).length;
  const parts = Array.isArray(value) ? value.map((item) => [null, item] as const)
    : object(value) ? Object.entries(value) : null;
  if (parts === null) return Infinity;
  let total = 2 + Math.max(parts.length - 1, 0) * 2;
  for (const [key, item] of parts) {
    total += (key === null ? 0 : utf8.encode(JSON.stringify(key)).length + 2) + jsonbRecordBytes(item);
    if (total > 60_000) return total;
  }
  return total;
}

export function inspectSweetBackfillSnapshot(input: unknown): SweetBackfillPlan {
  const issues = new Map<SweetBackfillIssueCode, number>();
  const add = (code: SweetBackfillIssueCode) => issues.set(code, (issues.get(code) ?? 0) + 1);
  const counts = { inputSources: 0, validSources: 0, actors: 0, scopes: 0,
    multiSourceScopes: 0, nullSummarySources: 0, existingHeads: 0, tombstones: 0, candidateHeads: 0 };
  let barrier = false;
  const candidates: SweetHeadCandidate[] = [];
  const finish = (): SweetBackfillPlan => ({ version: 1,
    offlineAdmission: issues.size ? "blocked" : "eligible", databaseReady: false,
    requiresLockedDatabaseRevalidation: true, sourceMutationCount: 0,
    claimedBarrierComplete: barrier, counts,
    issues: [...issues].map(([code, count]) => ({ code, count })).sort((a, b) => a.code.localeCompare(b.code)),
    heads: issues.size ? [] : candidates,
  });
  if (!object(input) || input.version !== 1 || !Array.isArray(input.sources)
    || !Array.isArray(input.authUserIds) || !Array.isArray(input.existingHeads)
    || !Array.isArray(input.accountSelections) || !Array.isArray(input.incomingForeignKeys)
    || !Array.isArray(input.dependencyReferences)) {
    add("invalid_envelope"); return finish();
  }
  counts.inputSources = input.sources.length;
  counts.existingHeads = input.existingHeads.length;
  const manifest = input.manifest;
  if (!object(manifest) || manifest.allSourcesExported !== true || manifest.allActorsExported !== true
    || manifest.allHeadsExported !== true || manifest.allSelectionsExported !== true
    || manifest.allIncomingForeignKeysExported !== true || manifest.allDependencyReferencesExported !== true) {
    add("incomplete_export");
  }
  if (!object(manifest) || manifest.sourceCount !== input.sources.length
    || manifest.actorCount !== input.authUserIds.length || manifest.headCount !== input.existingHeads.length
    || manifest.selectionCount !== input.accountSelections.length
    || manifest.foreignKeyCount !== input.incomingForeignKeys.length
    || manifest.dependencyReferenceCount !== input.dependencyReferences.length) add("count_mismatch");
  const claimed = input.barrier;
  barrier = object(claimed) && claimed.phase === "closed" && claimed.writesPaused === true
    && claimed.tokenIssuancePaused === true && claimed.legacyDirectWritesBlocked === true
    && claimed.inFlightTransactionsDrained === true;
  if (!barrier) add("barrier_not_asserted");

  const actors = new Set<string>();
  for (const actor of input.authUserIds) {
    if (!identifier(actor)) { add("invalid_actor"); continue; }
    const id = actor.toLowerCase();
    if (actors.has(id)) add("duplicate_actor");
    actors.add(id);
  }
  counts.actors = actors.size;
  const sourceIds = new Map<string, Source>();
  const scopes = new Map<string, Source[]>();
  for (const item of input.sources) {
    if (!object(item) || !identifier(item.id) || !identifier(item.user_id)) { add("invalid_source_id"); continue; }
    const id = item.id.toLowerCase(), owner = item.user_id.toLowerCase();
    if (sourceIds.has(id)) { add("duplicate_source_id"); continue; }
    if (!actors.has(owner)) add("source_actor_missing");
    const instant = sweetBackfillInstant(item.created_at), businessDay = sweetBackfillDay(item.created_at);
    if (instant === null || businessDay === null) { add("invalid_source_time"); continue; }
    if (!payload(item)) { add("invalid_source_payload"); continue; }
    const source = { id, owner, instant, day: businessDay };
    sourceIds.set(id, source);
    const key = `${owner}:${businessDay}`;
    const group = scopes.get(key) ?? []; group.push(source); scopes.set(key, group);
    counts.validSources++;
    if (item.summary === null && item.small_step === null && item.recommended_next_tool === null) counts.nullSummarySources++;
  }
  counts.scopes = scopes.size;
  const selected = new Map<string, Source>();
  for (const [key, group] of scopes) {
    if (group.length > 1) counts.multiSourceScopes++;
    const maximum = group.reduce((latest, source) => Math.max(latest, source.instant), -Infinity);
    const latest = group.filter((source) => source.instant === maximum);
    if (latest.length !== 1) { add("latest_time_tie"); continue; }
    selected.set(key, latest[0]);
  }
  const selections = new Set<string>();
  for (const item of input.accountSelections) {
    if (!object(item) || !identifier(item.user_id) || !identifier(item.record_id) || !day(item.business_day)) {
      add("invalid_selection"); continue;
    }
    const key = `${item.user_id.toLowerCase()}:${item.business_day}`;
    if (selections.has(key)) add("duplicate_selection");
    selections.add(key);
    if (!scopes.has(key)) add("selection_without_source");
    else if (selected.get(key)?.id !== item.record_id.toLowerCase()) add("selection_mismatch");
  }
  for (const key of scopes.keys()) if (!selections.has(key)) add("selection_missing");

  const foreignKeys = new Set<string>();
  for (const item of input.incomingForeignKeys) {
    if (!object(item)) { add("unknown_foreign_key"); continue; }
    const relation = `${String(item.schema)}.${String(item.table)}`;
    const known = item.targetSchema === "public" && item.targetTable === "sweet_records" && item.targetColumn === "id"
      && ((relation === "public.school_followups" && item.column === "record_id" && item.onDelete === "CASCADE")
        || (relation === "private.sweet_record_heads" && item.column === "current_record_id"
          && item.onDelete === "NO ACTION" && item.deferrable === true));
    if (!known || foreignKeys.has(`${relation}:${String(item.column)}`)) add("unknown_foreign_key");
    foreignKeys.add(`${relation}:${String(item.column)}`);
    if (item.impactReviewed !== true) add("foreign_key_not_reviewed");
    if (item.validated !== true) add("foreign_key_not_validated");
  }
  if (!foreignKeys.has("public.school_followups:record_id")) add("foreign_key_inventory_incomplete");
  if (input.existingHeads.length && !foreignKeys.has("private.sweet_record_heads:current_record_id")) {
    add("foreign_key_inventory_incomplete");
  }
  for (const item of input.dependencyReferences) {
    if (!object(item) || !identifier(item.record_id)
      || !["public.school_followups", "private.sweet_record_heads"].includes(String(item.relation))) {
      add("invalid_reference"); continue;
    }
    if (!sourceIds.has(item.record_id.toLowerCase())) add("reference_source_missing");
  }

  const heads = new Map<string, JsonObject>();
  for (const item of input.existingHeads) {
    if (!object(item) || !identifier(item.user_id) || !identifier(item.head_token) || !day(item.business_day)
      || Object.keys(item).some((key) => !["user_id", "business_day", "head_token", "current_record_id"].includes(key))
      || !(item.current_record_id === null || identifier(item.current_record_id))) { add("invalid_head"); continue; }
    const key = `${item.user_id.toLowerCase()}:${item.business_day}`;
    if (heads.has(key)) add("duplicate_head");
    heads.set(key, item);
    if (!actors.has(item.user_id.toLowerCase())) add("head_actor_missing");
    if (item.current_record_id === null) {
      counts.tombstones++;
      if (scopes.has(key)) add("tombstone_has_source");
    } else {
      const current = selected.get(key);
      if (!current || current.id !== item.current_record_id.toLowerCase()
        || item.head_token.toLowerCase() !== item.current_record_id.toLowerCase()) add("head_source_mismatch");
    }
  }
  for (const [key, current] of selected) {
    const existing = heads.get(key);
    candidates.push({ user_id: current.owner, business_day: current.day, head_token: current.id,
      current_record_id: current.id, action: existing ? "already_matches" : "create" });
  }
  candidates.sort((left, right) => left.user_id.localeCompare(right.user_id)
    || left.business_day.localeCompare(right.business_day));
  counts.candidateHeads = candidates.length;
  return finish();
}

/** Only fixed issue codes and aggregate counts may reach default diagnostics. */
export function sweetBackfillPublicReport(plan: SweetBackfillPlan) {
  return { version: plan.version, offlineAdmission: plan.offlineAdmission,
    databaseReady: plan.databaseReady, requiresLockedDatabaseRevalidation: plan.requiresLockedDatabaseRevalidation,
    sourceMutationCount: plan.sourceMutationCount, claimedBarrierComplete: plan.claimedBarrierComplete,
    counts: plan.counts, issues: plan.issues };
}
