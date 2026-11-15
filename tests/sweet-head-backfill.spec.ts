import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectSweetBackfillSnapshot, sweetBackfillDay, sweetBackfillInstant, sweetBackfillPublicReport } from "../lib/sweetBackfillPlan";

const actor = "00000000-0000-4000-8000-000000000091";
const other = "00000000-0000-4000-8000-000000000092";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fields = ["sleep", "wake", "eat", "exercise", "task"].map((dimension) => ({
  id: dimension, title: "SYNTHETIC_TITLE", label: "SYNTHETIC_LABEL",
  fields: [{ id: "field", title: "SYNTHETIC_FIELD", value: "SYNTHETIC_PRIVATE_ANSWER" }],
}));
const row = (number = 1, createdAt = "2026-10-30T02:00:00.000001Z", summary: string | null = null) => ({
  id: id(number), user_id: actor, school_id: null, records: structuredClone(fields),
  summary, small_step: null, recommended_next_tool: null, created_at: createdAt,
});
const followupFk = () => ({ schema: "public", table: "school_followups", column: "record_id",
  targetSchema: "public", targetTable: "sweet_records", targetColumn: "id", onDelete: "CASCADE",
  deferrable: false, validated: true, impactReviewed: true });
const headFk = () => ({ schema: "private", table: "sweet_record_heads", column: "current_record_id",
  targetSchema: "public", targetTable: "sweet_records", targetColumn: "id", onDelete: "NO ACTION",
  deferrable: true, validated: true, impactReviewed: true });
type Envelope = {
  version: number; sources: unknown[]; authUserIds: unknown[]; existingHeads: unknown[];
  accountSelections: unknown[]; incomingForeignKeys: unknown[]; dependencyReferences: unknown[];
  manifest: Record<string, unknown>; barrier: Record<string, unknown>;
};
function snapshot(sources: unknown[] = [row()], selections: unknown[] = [
  { user_id: actor, business_day: "2026-10-30", record_id: id(1) },
]): Envelope {
  const result: Envelope = {
    version: 1, sources, authUserIds: [actor, other], existingHeads: [], accountSelections: selections,
    incomingForeignKeys: [followupFk()], dependencyReferences: [],
    manifest: { allSourcesExported: true, allActorsExported: true, allHeadsExported: true,
      allSelectionsExported: true, allIncomingForeignKeysExported: true, allDependencyReferencesExported: true },
    barrier: { phase: "closed", writesPaused: true, tokenIssuancePaused: true,
      legacyDirectWritesBlocked: true, inFlightTransactionsDrained: true },
  };
  counts(result); return result;
}
function counts(input: Envelope) {
  Object.assign(input.manifest, { sourceCount: input.sources.length, actorCount: input.authUserIds.length,
    headCount: input.existingHeads.length, selectionCount: input.accountSelections.length,
    foreignKeyCount: input.incomingForeignKeys.length, dependencyReferenceCount: input.dependencyReferences.length });
}
function object(input: unknown) { return input as Record<string, unknown>; }
function expectBlocked(input: unknown, code: string) {
  const result = inspectSweetBackfillSnapshot(input);
  expect(result.offlineAdmission).toBe("blocked");
  expect(result.issues.map((issue) => issue.code)).toContain(code);
  expect(result.heads).toEqual([]);
  expect(result.databaseReady).toBe(false);
  expect(result.sourceMutationCount).toBe(0);
}

test("C30 offline null source plans only its existing UUID and never mutates source or claims database readiness", () => {
  const input = snapshot(); const before = structuredClone(input);
  const result = inspectSweetBackfillSnapshot(input);
  expect(result.offlineAdmission).toBe("eligible");
  expect(result.heads).toEqual([{ user_id: actor, business_day: "2026-10-30", head_token: id(1),
    current_record_id: id(1), action: "create" }]);
  expect(result.counts.nullSummarySources).toBe(1);
  expect(result.requiresLockedDatabaseRevalidation).toBe(true);
  expect(result.databaseReady).toBe(false);
  expect(result.sourceMutationCount).toBe(0);
  expect(input).toEqual(before);
  const publicText = JSON.stringify(sweetBackfillPublicReport(result));
  for (const secret of [actor, id(1), "SYNTHETIC_PRIVATE_ANSWER", "SYNTHETIC_TITLE", "records", "heads"]) {
    expect(publicText).not.toContain(secret);
  }
});

test("C29/C30 full input spans more than fifty days and a late omitted-day selection blocks the entire plan", () => {
  const sources = Array.from({ length: 65 }, (_, index) => row(index + 1,
    new Date(Date.UTC(2026, 6, 1 + index, 2)).toISOString()));
  const selections = sources.map((source) => ({ user_id: actor,
    business_day: source.created_at.slice(0, 10), record_id: source.id }));
  const input = snapshot(sources, selections);
  const result = inspectSweetBackfillSnapshot(input);
  expect(result.heads).toHaveLength(65);
  expect(result.counts.scopes).toBe(65);
  object(input.accountSelections[61]).record_id = id(999);
  expectBlocked(input, "selection_mismatch");
});

test("C30 older non-null legacy sources remain intact while unique latest null becomes initial head", () => {
  const old = row(1, "2026-10-30T02:00:00.000001Z", "SYNTHETIC_OLD_SUMMARY");
  const latest = row(2, "2026-10-30T02:00:00.000002Z");
  const input = snapshot([old, latest], [{ user_id: actor, business_day: "2026-10-30", record_id: id(2) }]);
  const before = structuredClone(input.sources);
  const plan = inspectSweetBackfillSnapshot(input);
  expect(plan.offlineAdmission).toBe("eligible");
  expect(plan.heads[0].current_record_id).toBe(id(2));
  expect(plan.counts.multiSourceScopes).toBe(1);
  expect(input.sources).toEqual(before);
});

test("C27/C30 microsecond maxima are exact and equal instants with different offsets are a tie", () => {
  expect(sweetBackfillInstant("2026-10-30T02:00:00.000002Z")!
    - sweetBackfillInstant("2026-10-30T02:00:00.000001Z")!).toBe(1);
  const input = snapshot([row(1), row(2, "2026-10-30T10:00:00.000001+08:00")]);
  expectBlocked(input, "latest_time_tie");
});

test("C24/C30 scope uses Asia/Shanghai rather than UTC or host time and validates ISO instants", () => {
  expect(sweetBackfillDay("2026-10-30T15:59:59.999999Z")).toBe("2026-10-30");
  expect(sweetBackfillDay("2026-10-30T16:00:00.000000Z")).toBe("2026-10-31");
  for (const bad of ["infinity", "2026-02-30T02:00:00Z", "2026-10-30T02:00:00", "2026-10-30T25:00:00Z",
    "2026-10-30T02:00:00+15:00", "9999-12-01T02:00:00.000001Z", null]) {
    expect(sweetBackfillInstant(bad)).toBeNull();
    expectBlocked(snapshot([{ ...row(), created_at: bad }]), "invalid_source_time");
  }
});

for (const [name, mutate, code] of [
  ["missing full export evidence", (input: Envelope) => { input.manifest.allSourcesExported = false; }, "incomplete_export"],
  ["row count disagreement", (input: Envelope) => { input.manifest.sourceCount = 0; }, "count_mismatch"],
  ["open barrier", (input: Envelope) => { input.barrier.phase = "open"; }, "barrier_not_asserted"],
  ["token issuance running", (input: Envelope) => { input.barrier.tokenIssuancePaused = false; }, "barrier_not_asserted"],
  ["old transactions not drained", (input: Envelope) => { input.barrier.inFlightTransactionsDrained = false; }, "barrier_not_asserted"],
  ["source actor missing", (input: Envelope) => { input.authUserIds = [other]; counts(input); }, "source_actor_missing"],
  ["duplicate UUID", (input: Envelope) => { input.sources.push(row()); counts(input); }, "duplicate_source_id"],
  ["malformed payload", (input: Envelope) => { object(input.sources[0]).records = []; }, "invalid_source_payload"],
  ["missing nullable field", (input: Envelope) => { delete object(input.sources[0]).summary; }, "invalid_source_payload"],
  ["selection missing", (input: Envelope) => { input.accountSelections = []; counts(input); }, "selection_missing"],
  ["invalid selection date", (input: Envelope) => { object(input.accountSelections[0]).business_day = "2026-99-00"; }, "invalid_selection"],
  ["unknown incoming FK", (input: Envelope) => { input.incomingForeignKeys.push({ ...followupFk(), table: "unreviewed_table" }); counts(input); }, "unknown_foreign_key"],
  ["unreviewed FK impact", (input: Envelope) => { object(input.incomingForeignKeys[0]).impactReviewed = false; }, "foreign_key_not_reviewed"],
  ["unvalidated FK", (input: Envelope) => { object(input.incomingForeignKeys[0]).validated = false; }, "foreign_key_not_validated"],
  ["missing known FK inventory", (input: Envelope) => { input.incomingForeignKeys = []; counts(input); }, "foreign_key_inventory_incomplete"],
  ["orphan dependency", (input: Envelope) => { input.dependencyReferences.push({ relation: "public.school_followups", record_id: id(99) }); counts(input); }, "reference_source_missing"],
] as const) {
  test(`C26/C30 preflight stops: ${name}`, () => {
    const input = snapshot(); mutate(input); expectBlocked(input, code);
  });
}

test("C30/C34 malformed envelope is blocked rather than implicitly treating missing data as empty", () => {
  for (const input of [null, {}, { version: 1, sources: [] }]) expectBlocked(input, "invalid_envelope");
  const empty = snapshot([], []);
  const plan = inspectSweetBackfillSnapshot(empty);
  expect(plan.offlineAdmission).toBe("eligible");
  expect(plan.heads).toEqual([]);
  expect(plan.databaseReady).toBe(false);
});

test("C30 oversized legacy text or arrays require review instead of silently truncating content", () => {
  const longSummary = snapshot([{ ...row(), summary: "x".repeat(20_001) }]);
  const longField = snapshot();
  const source = longField.sources[0] as ReturnType<typeof row>;
  source.records[0].fields[0].value = "x".repeat(10_001);
  const arrayField = snapshot();
  const arraySource = arrayField.sources[0] as ReturnType<typeof row>;
  object(arraySource.records[0].fields[0]).value = Array.from({ length: 101 }, () => "SYNTHETIC");
  const byteBudget = snapshot();
  for (const step of (byteBudget.sources[0] as ReturnType<typeof row>).records) step.fields[0].value = "中".repeat(4_000);
  const nullByte = snapshot([{ ...row(), summary: "SYNTHETIC\u0000" }]);
  expectBlocked(longSummary, "invalid_source_payload");
  expectBlocked(longField, "invalid_source_payload");
  expectBlocked(arrayField, "invalid_source_payload");
  expectBlocked(byteBudget, "invalid_source_payload");
  expectBlocked(nullByte, "invalid_source_payload");
  expect(object(longSummary.sources[0]).summary).toHaveLength(20_001);
  expect(source.records[0].fields[0].value).toHaveLength(10_001);
});

test("C30 existing matching heads are advisory NOOP, and a real empty tombstone is preserved", () => {
  const input = snapshot();
  input.incomingForeignKeys.push(headFk());
  input.existingHeads.push({ user_id: actor, business_day: "2026-10-30", head_token: id(1), current_record_id: id(1) },
    { user_id: other, business_day: "2026-10-29", head_token: id(99), current_record_id: null });
  counts(input);
  const plan = inspectSweetBackfillSnapshot(input);
  expect(plan.offlineAdmission).toBe("eligible");
  expect(plan.heads[0].action).toBe("already_matches");
  expect(plan.counts.tombstones).toBe(1);
  expect(plan.heads).toHaveLength(1);
});

test("C12/C34 wrong pointer, cross-owner head, tombstone source and content-bearing heads are not auto-repaired", () => {
  for (const variant of [
    { user_id: actor, business_day: "2026-10-30", head_token: id(2), current_record_id: id(2) },
    { user_id: other, business_day: "2026-10-30", head_token: id(1), current_record_id: id(1) },
    { user_id: actor, business_day: "2026-10-30", head_token: id(99), current_record_id: null },
    { user_id: actor, business_day: "2026-10-30", head_token: id(1), current_record_id: id(1), summary: "SYNTHETIC_FORBIDDEN_CONTENT" },
  ]) {
    const input = snapshot(); input.incomingForeignKeys.push(headFk()); input.existingHeads.push(variant); counts(input);
    const plan = inspectSweetBackfillSnapshot(input);
    expect(plan.offlineAdmission).toBe("blocked");
    expect(plan.heads).toEqual([]);
    expect(plan.sourceMutationCount).toBe(0);
  }
});

async function cli(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [path.join(process.cwd(), "scripts/prepare-sweet-head-backfill.mjs"), ...args],
      { cwd: process.cwd() }, (error, stdout, stderr) => resolve({ code: error ? Number(error.code) || 1 : 0, stdout, stderr }));
  });
}

test("C30 CLI is offline, defaults to redacted diagnostics and requires explicit restricted-plan permission", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sweet-offline-preflight-"));
  try {
    const input = path.join(directory, "snapshot.json"), planFile = path.join(directory, "plan.json");
    await writeFile(input, JSON.stringify(snapshot()));
    const normal = await cli(["--input", input]);
    expect(normal.code).toBe(0); expect(normal.stderr).toBe("");
    expect(JSON.parse(normal.stdout)).toMatchObject({ offlineAdmission: "eligible", databaseReady: false });
    expect(normal.stdout).not.toContain(actor); expect(normal.stdout).not.toContain("SYNTHETIC_PRIVATE_ANSWER");
    expect((await cli(["--input", input, "--restricted-plan", planFile])).code).toBe(64);
    const explicit = await cli(["--input", input, "--restricted-plan", planFile, "--allow-sensitive-plan"]);
    expect(explicit.code).toBe(0);
    const saved = await readFile(planFile, "utf8");
    expect(JSON.parse(saved)).toMatchObject({ advisoryOnly: true, databaseReady: false, sourceMutationCount: 0 });
    expect(saved).not.toContain("SYNTHETIC_PRIVATE_ANSWER");
    expect((await stat(planFile)).mode & 0o777).toBe(0o600);
    expect((await cli(["--input", input, "--restricted-plan", planFile, "--allow-sensitive-plan"])).code).toBe(1);
    expect(await readFile(planFile, "utf8")).toBe(saved);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C26/C30 CLI refuses URLs and malformed JSON without leaking the content", async () => {
  expect((await cli(["--input", "https://example.invalid/snapshot.json"])).code).toBe(1);
  const directory = await mkdtemp(path.join(os.tmpdir(), "sweet-invalid-preflight-"));
  try {
    const input = path.join(directory, "bad.json"); await writeFile(input, `SYNTHETIC_PRIVATE_TEXT_${actor}`);
    const result = await cli(["--input", input]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(actor);
    expect(result.stdout + result.stderr).not.toContain("SYNTHETIC_PRIVATE_TEXT");
    expect(result.stderr).toContain("offline_preflight_input_or_output_unavailable");
    const source = await readFile("scripts/prepare-sweet-head-backfill.mjs", "utf8");
    expect(source).not.toMatch(/process\.env\s*[.[]|\bfetch\s*\(|createClient\s*\(|\bspawn\s*\(/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
