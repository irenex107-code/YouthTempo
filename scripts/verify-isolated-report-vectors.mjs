import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, lstatSync, realpathSync, mkdirSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { isDeepStrictEqual } from "node:util";
import vm from "node:vm";

// This runner has no configurable host/container and never loads an env file.
// Its only writes to the database are synthetic student-a1 transactions which
// always ROLLBACK. Raw rows, RPC context, identifiers and credentials stay private.
const privateRoot = "/private/tmp/youthtempo-isolated-reports-v2-20261028";
const container = "supabase_db_youthtempo-isolated-reports-v2-20261028";
const dockerContext = "colima-youthtempo-e2e";
const evidencePath = resolve("deliverables/comprehensive-reports-2026-10-28/vector-verification.json");
const expectedInputNames = ["status.json", "sessions.json", "fixture-state.json"];
const require = createRequire(import.meta.url);
const ts = require("typescript");
let checks = 0;
let activeTransaction;
let stage = "local-guards";
const caseResults = [];
let databaseFunctionFingerprint;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

class SafeFailure extends Error {}
function ensure(value, label) { checks += 1; if (!value) throw new SafeFailure(label); }
function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeUuid(value) { ensure(typeof value === "string" && uuidPattern.test(value), "Synthetic fixture identifier is invalid"); return value; }
function firstDifference(a, b, path = "report") {
  if (Object.is(a, b)) return null;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return path;
  if (Array.isArray(a) !== Array.isArray(b)) return path;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const key of keys) {
    if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) return `${path}.${key}`;
    const found = firstDifference(a[key], b[key], `${path}.${key}`);
    if (found) return found;
  }
  return null;
}
function same(actual, expected, label) {
  const plain = clone(expected);
  ensure(isDeepStrictEqual(actual, plain), `${label} (${firstDifference(actual, plain) || "shape"})`);
}
function privateJson(file, expectedName) {
  const path = resolve(file);
  ensure(basename(path) === expectedName && dirname(realpathSync(path)) === privateRoot, "Unexpected private fixture path refused");
  const stat = lstatSync(path);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0, "Private inputs must be single-link 0600 files");
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new SafeFailure("Private fixture input could not be parsed; contents withheld"); }
}
function docker(args, input) {
  try {
    return execFileSync("docker", ["--context", dockerContext, ...args], {
      input, encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024, timeout: 60_000,
    }).trim();
  } catch { throw new SafeFailure("Controlled local Docker/database operation failed; details withheld"); }
}
function sql(statement) {
  return docker(["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], statement);
}
function json(text) {
  try { return JSON.parse(text); }
  catch { throw new SafeFailure("Expected a private JSON database result; contents withheld"); }
}

// Compile the actual reference implementation and exported test vectors in
// memory. Playwright test declarations are registered as no-ops, never run.
function loadReference() {
  const cache = new Map();
  const allowed = new Set(["types", "source", "comprehensiveTypes", "comprehensive", "comprehensiveValidation"].map((name) => resolve(`lib/reports/${name}.ts`)));
  const vectorsPath = resolve("tests/reports-history-summary.spec.ts");
  allowed.add(vectorsPath);
  function load(file) {
    ensure(allowed.has(file), "Reference import outside the approved calculation files refused");
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const localRequire = (name) => {
      if (name === "@playwright/test") return { test() {}, expect() { throw new SafeFailure("Playwright assertions must not run in the vector loader"); } };
      ensure(name.startsWith("."), "External reference import refused");
      return load(resolve(dirname(file), `${name}.ts`));
    };
    vm.runInNewContext(compiled, { module, exports: module.exports, require: localRequire }, { filename: file, timeout: 10_000 });
    return module.exports;
  }
  return { ...load(resolve("lib/reports/comprehensive.ts")), ...load(resolve("lib/reports/source.ts")), ...load(vectorsPath) };
}

async function transaction() {
  ensure(!activeTransaction, "Only one synthetic transaction may run at a time");
  const child = spawn("docker", ["--context", dockerContext, "exec", "-i", "-e", "PGAPPNAME=youthtempo_comprehensive_vector_rollback",
    container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  child.stderr.on("data", () => {});
  let pending = null;
  let closed = false;
  const fail = () => {
    closed = true;
    if (pending) { clearTimeout(pending.timer); pending.reject(new SafeFailure("Synthetic transaction ended unexpectedly; SQL withheld")); pending = null; }
  };
  child.on("error", fail); child.on("close", fail); child.stdin.on("error", fail);
  lines.on("line", (line) => {
    if (!pending) return;
    if (line === pending.marker) {
      const result = pending; pending = null; clearTimeout(result.timer); result.resolve(result.lines.join("\n"));
    } else pending.lines.push(line);
  });
  const command = (statement) => new Promise((resolveResult, reject) => {
    if (closed || pending) { reject(new SafeFailure("Synthetic transaction is unavailable")); return; }
    const marker = `VECTOR_BARRIER_${randomUUID().replaceAll("-", "")}`;
    pending = { marker, lines: [], resolve: resolveResult, reject, timer: setTimeout(() => {
      pending = null; child.kill("SIGTERM"); reject(new SafeFailure("Synthetic transaction timed out; connection rollback requested"));
    }, 60_000) };
    child.stdin.write(`${statement}\n\\echo ${marker}\n`);
  });
  const tx = {
    command,
    async rollback() {
      try { if (!closed) await command("rollback;"); }
      finally { child.stdin.end(); lines.close(); activeTransaction = null; }
    },
    abort() { child.stdin.end("rollback;\n"); child.kill("SIGTERM"); lines.close(); activeTransaction = null; },
  };
  activeTransaction = tx;
  await command("begin isolation level read committed; set local statement_timeout='55s'; set local lock_timeout='5s'; set local idle_in_transaction_session_timeout='90s';");
  return tx;
}

function normalizerVectors(reference) {
  const base = () => [
    { id: "sleep", fields: [{ id: "quality", value: "比较好" }] },
    { id: "wake", fields: [{ id: "state", value: "比较有精神" }] },
    { id: "eat", fields: [{ id: "rhythm", value: "比较规律" }] },
    { id: "exercise", fields: [{ id: "duration", value: "10–19 分钟" }] },
    { id: "task", fields: [{ id: "engagement", value: "比较顺利" }] },
  ];
  const output = [];
  const add = (name, records, summary = "SYNTHETIC_SUMMARY") => output.push({ name, records, summary });
  add("canonical", base()); add("records-null", null); add("records-object", {}); add("records-empty", []);
  for (const [index, [id, definitions]] of Object.entries(reference.detailFieldDefinitions).entries()) {
    for (const definition of definitions) {
      const values = definition.kind === "text" ? ["  SYNTHETIC_TEXT 😀  ", "😀".repeat(8192)]
        : definition.kind === "single" ? [...definition.options] : [...definition.options.map((v) => [v]), [...definition.options].reverse()];
      for (const [number, value] of values.entries()) {
        const records = base(); records[index].fields = records[index].fields.filter((f) => f.id !== definition.id);
        records[index].fields.push({ id: definition.id, value }); add(`${id}.${definition.id}.valid-${number}`, records);
      }
      for (const [number, value] of [null, false, 1, {}, ["UNKNOWN_OPTION"], "UNKNOWN_OPTION"].entries()) {
        const records = base(); records[index].fields = records[index].fields.filter((f) => f.id !== definition.id);
        records[index].fields.push({ id: definition.id, value }); add(`${id}.${definition.id}.invalid-${number}`, records);
      }
      const duplicate = base(); duplicate[index].fields.push({ id: definition.id, value: "SYNTHETIC_DUPLICATE" });
      if (!definition.required) duplicate[index].fields.push({ id: definition.id, value: "SYNTHETIC_DUPLICATE" });
      add(`${id}.${definition.id}.duplicate`, duplicate);
      if (!definition.required) {
        const blank = base(); blank[index].fields.push({ id: definition.id, value: definition.kind === "multi" ? [] : definition.kind === "text" ? " \u00a0\ufeff\u3000\t\n" : "" });
        add(`${id}.${definition.id}.optional-empty`, blank);
      }
      if (definition.kind === "text") {
        const oversize = base(); oversize[index].fields.push({ id: definition.id, value: "😀".repeat(8193) }); add(`${id}.${definition.id}.oversize`, oversize);
      }
      if (definition.kind === "multi") {
        const repeated = base(); repeated[index].fields.push({ id: definition.id, value: [definition.options[0], definition.options[0]] }); add(`${id}.${definition.id}.duplicate-options`, repeated);
      }
    }
  }
  const extra = base(); extra[0].fields.push({ id: "unapproved_field", value: "SYNTHETIC_EXCLUDED" }); add("unknown-field", extra);
  add("duplicate-step", [...base(), base()[0]]); add("missing-step", base().slice(1));
  const malformed = base(); malformed[0].fields = null; add("fields-not-array", malformed);
  for (const [number, summary] of [null, "", " \u00a0\ufeff\u3000\t\n", "😀".repeat(8192), "😀".repeat(8193)].entries()) add(`summary-${number}`, base(), summary);
  return output;
}

function evidence(status, extra = {}) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify({ date: "2026-10-28", status, checks, cases: caseResults,
    scope: "Actual isolated PostgreSQL functions/RPC versus the shared TypeScript reference. Synthetic student-a1 transactions always rollback; student-a2 is untouched. No remote, production, OTP or email operation.",
    sourceLifecycle: "Latest retained Shanghai-day row is selected before validation. An unknown latest row never falls back. Directly deleting that one row may expose an older row still physically retained for the same day; deleting the whole day removes that day. No deleted row or backup is restored, and no tombstone is added.",
    databaseFunctionFingerprint,
    referenceFiles: ["lib/reports/comprehensiveTypes.ts", "lib/reports/comprehensive.ts", "lib/reports/comprehensiveValidation.ts", "tests/reports-history-summary.spec.ts", "scripts/verify-isolated-report-vectors.mjs"].map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
    ...extra }, null, 2) + "\n");
}

try {
  const supplied = process.argv.slice(2);
  ensure(supplied.length === 0 || supplied.length === 3, "Pass no arguments or exactly status, sessions and fixture-state JSON paths");
  const paths = supplied.length ? supplied : expectedInputNames.map((name) => `${privateRoot}/${name}`);
  ensure(realpathSync(privateRoot) === privateRoot, "Private runtime root must not be a symbolic link");
  const [status, accounts, fixture] = paths.map((file, index) => privateJson(file, expectedInputNames[index]));
  ensure(status.API_URL === "http://127.0.0.1:55321", "Only the dedicated local API on port 55321 is allowed");
  ensure(fixture.version === "reports-isolated-v1", "Only the approved reports synthetic base fixture is allowed");
  const owner = accounts["student-a1"], teacher = accounts["teacher-a"];
  for (const [name, account] of [["student-a1", owner], ["teacher-a", teacher]]) {
    safeUuid(account?.id); ensure(account.email === `yt-reports-${name}@example.invalid`, "Non-synthetic identity refused");
  }
  safeUuid(fixture.schoolA); safeUuid(fixture.schoolB);
  const endpoint = docker(["context", "inspect", dockerContext, "--format", "{{.Endpoints.docker.Host}}"]);
  ensure(endpoint === "unix:///Users/irenexiao/.colima/youthtempo-e2e/docker.sock", "Docker context must use the dedicated local Colima socket");
  ensure(docker(["inspect", "--format", "{{.Name}}", container]) === `/${container}`, "Unexpected database container refused");
  ensure(sql(`select count(*) from auth.users where (id=${literal(owner.id)}::uuid and email='yt-reports-student-a1@example.invalid') or (id=${literal(teacher.id)}::uuid and email='yt-reports-teacher-a@example.invalid');`) === "2", "Local database and private fixture identities do not match");
  ensure(sql("select count(*) from supabase_migrations.schema_migrations where version='20261027192211';") === "1", "The new comprehensive-report migration must already be applied");
  databaseFunctionFingerprint = sql("select md5(string_agg(pg_get_functiondef(p.oid),'|' order by n.nspname,p.proname,p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname like 'school_report_%') or (n.nspname='public' and p.proname in('read_school_report_trend','read_school_report_details','validate_school_report_view')); ");
  ensure(/^[a-f0-9]{32}$/.test(databaseFunctionFingerprint), "Database calculation fingerprint was unavailable");
  const enrollment = json(sql(`select json_build_object('id',e.id,'enabled',d.enabled) from public.school_report_enrollments e join public.school_report_detail_states d on d.enrollment_id=e.id where e.student_user_id=${literal(owner.id)}::uuid and e.status='active';`));
  safeUuid(enrollment.id); ensure(enrollment.enabled === false, "Synthetic student-a1 must begin with details OFF");
  const snapshot = () => json(sql(`select json_build_object(
    'source', (select md5(coalesce(string_agg(to_jsonb(r)::text,'|' order by r.id),'')) from public.sweet_records r where r.user_id=${literal(owner.id)}::uuid),
    'enrollment',(select to_jsonb(e) from public.school_report_enrollments e where e.id=${literal(enrollment.id)}::uuid),
    'details',(select to_jsonb(d) from public.school_report_detail_states d where d.enrollment_id=${literal(enrollment.id)}::uuid),
    'events',(select count(*) from public.school_report_sharing_events where enrollment_id=${literal(enrollment.id)}::uuid),
    'audit',(select count(*) from public.school_report_mode_access_audit where enrollment_id=${literal(enrollment.id)}::uuid));`));
  const initialSnapshot = snapshot();
  const reference = loadReference();
  const asOfNow = (tx) => tx.command("select private.school_report_iso(clock_timestamp()-interval '1 second');");
  const rpc = async (tx, name, args, actor = owner.id) => {
    const list = [`p_actor_user_id=>${literal(actor)}::uuid`, `p_enrollment_id=>${literal(enrollment.id)}::uuid`, ...Object.entries(args).map(([key, value]) => `${key}=>${value === null ? "null" : literal(value)}`)];
    return json(await tx.command(`select public.${name}(${list.join(",")});`));
  };
  const read = async (tx, mode, asOf, position) => {
    const args = { p_as_of: asOf };
    if (mode === "trend" && position) args.p_before_bin = position;
    if (mode === "detail" && position) {
      args.p_phase = position.phase;
      if (position.phase === "dated") args.p_before_day = position.beforeDate; else args.p_before_id = position.afterId;
    }
    const result = await rpc(tx, mode === "trend" ? "read_school_report_trend" : "read_school_report_details", args, mode === "trend" ? teacher.id : owner.id);
    ensure(result.status === "ready" && result.report && result.context, `${stage}: actual ${mode} RPC must be ready`);
    return result;
  };
  const insert = (tx, rows) => {
    const mapped = rows.map((row) => ({ ...row, user_id: owner.id,
      school_id: row.school_id === "PREVIOUS_SCHOOL" ? fixture.schoolB : row.school_id === null ? null : fixture.schoolA,
      summary: row.summary ?? null, small_step: "SYNTHETIC_EXCLUDED_AI_STEP", recommended_next_tool: "SYNTHETIC_EXCLUDED_TOOL" }));
    return tx.command(`reset role; delete from public.sweet_records where user_id=${literal(owner.id)}::uuid;
      insert into public.sweet_records(id,user_id,school_id,records,summary,small_step,recommended_next_tool,created_at)
      select id,user_id,school_id,records,summary,small_step,recommended_next_tool,created_at from jsonb_to_recordset(${literal(JSON.stringify(mapped))}::jsonb)
      as r(id uuid,user_id uuid,school_id uuid,records jsonb,summary text,small_step text,recommended_next_tool text,created_at timestamptz);
      set local role service_role;`);
  };

  stage = "field-normalizer";
  const normalization = normalizerVectors(reference);
  const normalizerTx = await transaction();
  try {
    await normalizerTx.command("set local role service_role;");
    const actual = json(await normalizerTx.command(`select jsonb_agg(private.school_report_normalize(v->'records',v->>'summary') order by ord) from jsonb_array_elements(${literal(JSON.stringify(normalization))}::jsonb) with ordinality t(v,ord);`));
    same(actual.length, normalization.length, "Normalizer vector count");
    for (const [index, vector] of normalization.entries()) same(actual[index], reference.normalizeSweetDetails(vector.records, vector.summary), `Normalizer ${vector.name}`);
  } finally { await normalizerTx.rollback(); }
  caseResults.push({ name: stage, status: "passed", vectors: normalization.length, approvedFields: 19 });

  const names = reference.buildHistorySummarySqlVectors().map((vector) => vector.name);
  for (const name of names) {
    stage = name;
    const tx = await transaction();
    let trendPages = 0, detailPages = 0, detailItems = 0;
    try {
      const asOf = await asOfNow(tx);
      const vector = reference.buildHistorySummarySqlVectors(asOf).find((value) => value.name === name);
      ensure(Boolean(vector), "A reference vector is missing");
      await insert(tx, vector.rows);
      let beforeBinStart;
      do {
        const expected = reference.buildComprehensiveTrend({ rows: vector.rows, asOf, beforeBinStart });
        const actual = (await read(tx, "trend", asOf, beforeBinStart)).report;
        same(actual, expected, `${name}: full trend page ${trendPages + 1}`);
        trendPages += 1; ensure(trendPages <= 100, "Trend pagination failed to terminate");
        beforeBinStart = actual.longTerm.hasMore ? actual.longTerm.nextBinStart : undefined;
      } while (beforeBinStart);
      let position;
      do {
        const expected = reference.buildComprehensiveDetails({ rows: vector.rows, asOf, position });
        const actual = (await read(tx, "detail", asOf, position)).report;
        same(actual, expected, `${name}: full detail page ${detailPages + 1}`);
        detailPages += 1; detailItems += actual.items.length; ensure(detailPages <= 100, "Detail pagination failed to terminate");
        position = actual.hasMore ? actual.nextPosition : undefined;
      } while (position);
    } finally { await tx.rollback(); }
    same(snapshot(), initialSnapshot, `${name}: source, enrollment, detail state and audit/event rollback`);
    caseResults.push({ name, status: "passed", trendPages, detailPages, detailItems, rollbackVerified: true });
  }

  stage = "source-delete-correction-and-stale-view";
  const lifecycle = await transaction();
  try {
    const asOf = await asOfNow(lifecycle);
    const vector = reference.buildHistorySummarySqlVectors(asOf).find((v) => v.name === "latest-unknown-no-fallback");
    let rows = vector.rows;
    await insert(lifecycle, rows);
    const staleView = (await read(lifecycle, "trend", asOf)).context;
    const unknown = rows.at(-1);
    await lifecycle.command(`reset role; delete from public.sweet_records where user_id=${literal(owner.id)}::uuid and id=${literal(unknown.id)}::uuid; set local role service_role;`);
    rows = rows.filter((row) => row.id !== unknown.id);
    same((await read(lifecycle, "trend", asOf)).report, reference.buildComprehensiveTrend({ rows, asOf }), "Single-row delete selects older retained daily row");
    const validated = json(await lifecycle.command(`select public.validate_school_report_view(${literal(staleView.actorId)}::uuid,${literal(staleView.enrollmentId)}::uuid,'trend',${literal(staleView.studentId)}::uuid,${literal(staleView.asOf)}::timestamptz,${staleView.sourceRevision},${staleView.recipientEpoch},${staleView.detailRevision},${literal(staleView.expiresAt)}::timestamptz);`));
    ensure(validated.status === "refresh_required", "Deleted source must invalidate an existing view");
    const remainingDay = rows[0];
    const corrected = clone(remainingDay); corrected.records[0].fields[0].value = "很不好";
    await lifecycle.command(`reset role; update public.sweet_records set records=${literal(JSON.stringify(corrected.records))}::jsonb where user_id=${literal(owner.id)}::uuid and id=${literal(remainingDay.id)}::uuid; set local role service_role;`);
    rows = rows.map((row) => row.id === corrected.id ? corrected : row);
    same((await read(lifecycle, "detail", asOf)).report, reference.buildComprehensiveDetails({ rows, asOf }), "Source correction replaces the detail content");
    await lifecycle.command(`reset role; delete from public.sweet_records where user_id=${literal(owner.id)}::uuid and isfinite(created_at) and (created_at at time zone 'Asia/Shanghai')::date=(${literal(remainingDay.created_at)}::timestamptz at time zone 'Asia/Shanghai')::date; set local role service_role;`);
    rows = rows.filter((row) => row.id !== remainingDay.id);
    same((await read(lifecycle, "detail", asOf)).report, reference.buildComprehensiveDetails({ rows, asOf }), "Whole-day deletion removes the day without restoring deleted content");
  } finally { await lifecycle.rollback(); }
  same(snapshot(), initialSnapshot, "Lifecycle test rollback");
  caseResults.push({ name: stage, status: "passed", rollbackVerified: true });

  stage = "malformed-timestamp-storage-rejection";
  let rejected = false;
  try { sql("begin; select 'not-a-date'::timestamptz; rollback;"); } catch (error) { if (error instanceof SafeFailure) rejected = true; else throw error; }
  ensure(rejected, "PostgreSQL must reject a malformed timestamp string rather than store it as a dated source");
  caseResults.push({ name: stage, status: "passed", note: "Malformed date text is rejected by the typed column; SQL undated vectors use infinity, -infinity and a finite out-of-exact-range timestamp." });
  same(snapshot(), initialSnapshot, "Final synthetic source and enrollment state remained unchanged");
  evidence("passed", { normalizerVectors: normalization.length, historyVectors: names.length, rollbackVerified: true });
  console.log(JSON.stringify({ status: "passed", checks, normalizerVectors: normalization.length, historyVectors: names.length, rollbackVerified: true }));
} catch (error) {
  activeTransaction?.abort();
  const reason = error instanceof SafeFailure ? error.message : "Local vector verification failed; private error details withheld";
  evidence("failed", { failedStage: stage, reason, rollbackRequested: true });
  console.error(JSON.stringify({ status: "failed", stage, reason }));
  process.exitCode = 1;
}
