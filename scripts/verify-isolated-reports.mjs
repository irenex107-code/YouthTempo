import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createInterface } from "node:readline";

const [statusArgument, sessionsArgument, stateArgument, container, phase = "verify"] = process.argv.slice(2);
const dockerContext = "colima-youthtempo-e2e";
const accountNames = ["student-a1", "student-a2", "student-b1", "adult-a", "teacher-a", "teacher-b", "guardian-linked", "guardian-unrelated", "guardian-b", "school-lead", "admin"];
const reportTables = ["report_authorizations", "minor_eligibility_assertions", "report_authorization_events", "report_access_audit"];
const basePolicyVersion = "reports-school-2026-10-27";
const reportPolicyVersion = "reports-2026-10-27";
let assertionCount = 0;

function ensure(condition, label) {
  assertionCount += 1;
  if (!condition) throw new Error(label);
}
function same(actual, expected, label) { ensure(isDeepStrictEqual(actual, expected), label); }
function uuid(value) {
  ensure(typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value), "invalid synthetic fixture identifier");
  return value;
}
function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function parsePrivateJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new Error("A private JSON input could not be read or parsed; its contents were withheld"); }
}

ensure(statusArgument && sessionsArgument && stateArgument, "Pass local status, sessions, state, container and optional phase");
ensure(/^supabase_db_youthtempo-isolated-[a-z0-9-]+$/.test(container ?? ""), "Only a disposable youthtempo-isolated database container is allowed");
ensure(["pre-boundary-seed", "verify"].includes(phase), "Unknown isolated report phase");
const statusPath = resolve(statusArgument);
const sessionsPath = resolve(sessionsArgument);
const statePath = resolve(stateArgument);
const privateRoot = realpathSync(dirname(statusPath));
ensure(privateRoot.startsWith("/private/tmp/") && /^youthtempo-isolated-[a-z0-9-]+$/.test(basename(privateRoot)), "Use a dedicated private-tmp youthtempo-isolated directory");
for (const file of [statusPath, sessionsPath, statePath]) {
  ensure(realpathSync(dirname(file)) === privateRoot, "All private JSON files must use the same disposable directory");
  if (existsSync(file)) {
    const stat = lstatSync(file);
    ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0, "Private JSON files must be single-link regular files with mode 0600");
    ensure(dirname(realpathSync(file)) === privateRoot, "Private JSON must not escape the disposable directory");
  }
}
const status = parsePrivateJson(statusPath);
let api;
try { api = new URL(status.API_URL); } catch { throw new Error("The local API URL is invalid; its value was withheld"); }
ensure(api.origin === "http://127.0.0.1:55321" && api.pathname === "/" && !api.username && !api.password && !api.search && !api.hash, "Only the dedicated disposable reports Supabase API is allowed");
ensure(typeof status.ANON_KEY === "string" && typeof status.SERVICE_ROLE_KEY === "string", "Local API credentials are required");

function savePrivate(file, data) {
  writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
  chmodSync(file, 0o600);
}
function query(sql, label = "local database assertion") {
  try {
    return execFileSync("docker", ["--context", dockerContext, "exec", container,
      "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim();
  } catch { throw new Error(`${label} failed; SQL details were withheld`); }
}
function queryAccepted(sql) {
  try { query(sql, "controlled synthetic mutation"); return true; }
  catch { return false; }
}
async function localRequest(path, token, method = "GET", body, params = "") {
  const url = new URL(path, api);
  ensure(url.origin === api.origin, "A test request tried to leave the local API");
  if (params) url.search = params;
  let response;
  try {
    response = await fetch(url, {
      method, signal: AbortSignal.timeout(20_000),
      headers: { apikey: url.pathname.startsWith("/auth/v1/admin/") ? status.SERVICE_ROLE_KEY : status.ANON_KEY,
        Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new Error("A local API request failed; credentials and response details were withheld"); }
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { throw new Error("A local API response was not valid JSON"); }
  }
  return { status: response.status, ok: response.ok, data };
}
async function service(table, method = "GET", params = "select=id", body) {
  const result = await localRequest(`/rest/v1/${table}`, status.SERVICE_ROLE_KEY, method, body, params);
  ensure(result.ok, `local service fixture operation failed for ${table}`);
  return result.data;
}
function seedBeforeBoundarySql(table, rows, conflictColumns) {
  ensure(["schools", "profiles", "admin_roles", "school_members", "teacher_student_assignments", "guardian_student_links", "student_consents", "sweet_records"].includes(table), "Only approved pre-boundary fixture tables may be seeded");
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    const columns = Object.keys(row);
    ensure(columns.every((column) => /^[a-z_]+$/.test(column)) && conflictColumns.every((column) => columns.includes(column)), "Invalid fixture columns");
    const quoted = (column) => `"${column}"`;
    const update = columns.filter((column) => !conflictColumns.includes(column))
      .map((column) => `${quoted(column)}=excluded.${quoted(column)}`).join(",");
    // Core service grants are introduced later in the real migration chain.
    // Postgres fixture inserts obey every currently installed CHECK/trigger/FK;
    // no table grant or constraint is changed for this bootstrap.
    query(`insert into public.${table} (${columns.map(quoted).join(",")})
      select ${columns.map(quoted).join(",")} from jsonb_populate_record(null::public.${table},${literal(JSON.stringify(row))}::jsonb)
      on conflict (${conflictColumns.map(quoted).join(",")}) do update set ${update};`, "pre-boundary synthetic fixture insert");
  }
}
async function rpc(name, args, token = status.SERVICE_ROLE_KEY) {
  return localRequest(`/rest/v1/rpc/${name}`, token, "POST", args);
}
function ok(result, label) { ensure(result.ok, label); return result.data; }
function denied(result, label) { ensure(!result.ok, label); }

let accounts = existsSync(sessionsPath) ? parsePrivateJson(sessionsPath) : null;
let state = existsSync(statePath) ? parsePrivateJson(statePath) : null;
function validateAccounts() {
  ensure(accounts && accountNames.every((name) => accounts[name]), "The complete reports-only synthetic account set is required");
  for (const name of accountNames) {
    const account = accounts[name];
    uuid(account.id);
    ensure(account.email === `yt-reports-${name}@example.invalid` && typeof account.accessToken === "string", "Only the reports-only synthetic identities are allowed");
  }
}
function validateState() {
  ensure(state?.version === "reports-isolated-v1", "The reports-only fixture state is required");
  for (const value of [state.schoolA, state.schoolB, state.assignmentA1, state.assignmentAdult, state.assignmentB1, state.legacyLinkId, state.legacyLinkB1Id,
    ...Object.values(state.recordIds ?? {})]) uuid(value);
}

async function verifySyntheticAuthUsers() {
  for (const name of accountNames) {
    const user = ok(await localRequest(`/auth/v1/admin/users/${uuid(accounts[name].id)}`, status.SERVICE_ROLE_KEY), "Synthetic Auth identity could not be checked");
    same(user.id, accounts[name].id, "A synthetic Auth identifier did not match");
    same(user.email, accounts[name].email, "A fixture does not belong to the reports-only synthetic address set");
  }
  same(Number(query(`select count(*) from auth.users where id in (${accountNames.map((name) => `${literal(uuid(accounts[name].id))}::uuid`).join(",")})`)),
    accountNames.length, "The local REST endpoint and selected disposable container do not hold the same synthetic identities");
}

function sweetAnswers(sleep = "比较好", eat = "比较规律") {
  return [
    { id: "sleep", fields: [{ id: "quality", value: sleep }, { id: "note", value: "REPORTS_PRIVATE_NOTE" }] },
    { id: "wake", fields: [{ id: "state", value: "比较有精神" }] },
    { id: "eat", fields: [{ id: "rhythm", value: eat }] },
    { id: "exercise", fields: [{ id: "duration", value: "10–19 分钟" }] },
    { id: "task", fields: [{ id: "engagement", value: "比较顺利" }] },
  ];
}

async function seedBeforeBoundary() {
  same(query("select count(*) from pg_constraint where conrelid='public.guardian_student_links'::regclass and conname='pilot_guardian_links_inactive'"), "0", "Legacy guardian fixture must be seeded before the real boundary migration; constraints must never be disabled");
  if (!accounts) {
    accounts = {};
    for (const name of accountNames) {
      const email = `yt-reports-${name}@example.invalid`;
      const password = `Local-reports-${randomBytes(20).toString("hex")}`;
      const created = ok(await localRequest("/auth/v1/admin/users", status.SERVICE_ROLE_KEY, "POST", {
        email, password, email_confirm: true, user_metadata: { display_name: `Synthetic reports ${name}` },
      }), `synthetic ${name} creation failed`);
      const signed = ok(await localRequest("/auth/v1/token", status.ANON_KEY, "POST", { email, password }, "grant_type=password"), `synthetic ${name} sign-in failed`);
      accounts[name] = { id: uuid(created.id), email, accessToken: signed.access_token, refreshToken: signed.refresh_token };
      savePrivate(sessionsPath, accounts);
    }
  }
  validateAccounts();
  await verifySyntheticAuthUsers();
  if (!state) {
    state = {
      version: "reports-isolated-v1", schoolA: randomUUID(), schoolB: randomUUID(),
      assignmentA1: randomUUID(), assignmentAdult: randomUUID(), assignmentB1: randomUUID(), legacyLinkId: randomUUID(), legacyLinkB1Id: randomUUID(),
      recordIds: Object.fromEntries(["student-a1", "student-a2", "student-b1", "adult-a"].map((name) => [name, randomUUID()])),
    };
    savePrivate(statePath, state);
  }
  validateState();
  const stamp = query("select clock_timestamp()::text");
  seedBeforeBoundarySql("schools", [
    { id: state.schoolA, name: "Synthetic reports school A" }, { id: state.schoolB, name: "Synthetic reports school B" },
  ], ["id"]);
  for (const name of accountNames) {
    const account = accounts[name];
    const role = name.startsWith("guardian-") ? "家长" : name.startsWith("teacher-") || ["school-lead", "admin"].includes(name) ? "学校支持人员" : "学生";
    const schoolId = ["student-b1", "teacher-b", "guardian-b"].includes(name) ? state.schoolB : name === "admin" ? null : state.schoolA;
    seedBeforeBoundarySql("profiles", { id: account.id, email: account.email, display_name: `Synthetic reports ${name}`, role, school_id: schoolId }, ["id"]);
  }
  seedBeforeBoundarySql("admin_roles", { email: accounts.admin.email, role: "管理员", status: "active" }, ["email"]);
  for (const [name, schoolId] of [["teacher-a", state.schoolA], ["teacher-b", state.schoolB], ["school-lead", state.schoolA]]) {
    seedBeforeBoundarySql("school_members", { school_id: schoolId, user_id: accounts[name].id, email: accounts[name].email, member_role: name === "school-lead" ? "school_admin" : "school_support", status: "active" }, ["school_id", "user_id"]);
  }
  for (const [id, student, teacher, schoolId] of [
    [state.assignmentA1, "student-a1", "teacher-a", state.schoolA], [state.assignmentAdult, "adult-a", "teacher-a", state.schoolA],
    [state.assignmentB1, "student-b1", "teacher-b", state.schoolB],
  ]) seedBeforeBoundarySql("teacher_student_assignments", {
    id, school_id: schoolId, teacher_user_id: accounts[teacher].id, student_user_id: accounts[student].id,
    assigned_by: accounts.admin.id, status: "active",
  }, ["id"]);
  seedBeforeBoundarySql("guardian_student_links", {
    id: state.legacyLinkId, school_id: state.schoolA, guardian_user_id: accounts["guardian-linked"].id,
    student_user_id: accounts["student-a1"].id, confirmed_by: accounts.admin.id, status: "active",
  }, ["id"]);
  seedBeforeBoundarySql("guardian_student_links", {
    id: state.legacyLinkB1Id, school_id: state.schoolB, guardian_user_id: accounts["guardian-b"].id,
    student_user_id: accounts["student-b1"].id, confirmed_by: accounts.admin.id, status: "active",
  }, ["id"]);
  for (const name of ["student-a1", "student-a2", "student-b1", "adult-a"]) {
    const adult = name === "adult-a";
    const selfPilot = name === "student-a2";
    seedBeforeBoundarySql("student_consents", {
      student_user_id: accounts[name].id, school_id: name === "student-b1" ? state.schoolB : state.schoolA,
      age_band: adult ? "18_plus" : "14_17", consent_basis: adult ? "adult_self" : selfPilot ? "student_self_pilot" : "student_guardian",
      policy_version: selfPilot ? "2026-08-28" : basePolicyVersion, status: "active", student_assented_at: stamp,
      guardian_user_id: !adult && !selfPilot ? accounts[name === "student-b1" ? "guardian-b" : "guardian-linked"].id : null,
      guardian_consented_at: !adult && !selfPilot ? stamp : null,
    }, ["student_user_id"]);
    seedBeforeBoundarySql("sweet_records", {
      id: state.recordIds[name], user_id: accounts[name].id, school_id: name === "student-b1" ? state.schoolB : state.schoolA,
      records: sweetAnswers(), summary: "REPORTS_PRIVATE_AI_SUMMARY", created_at: stamp,
    }, ["id"]);
  }
  state.seededBeforeGuardianBoundary = true;
  savePrivate(statePath, state);
  console.log(`isolated reports pre-boundary fixture seeded: 2 schools, ${accountNames.length} synthetic sessions, canonical records and two real same-school legacy active guardian links; no constraint disabled`);
}

function verifyCatalog() {
  const names = reportTables.map(literal).join(",");
  same(query(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (${names}) and c.relkind='r' and c.relrowsecurity`), "4", "All four report tables must exist and retain RLS");
  for (const table of reportTables) {
    for (const role of ["anon", "authenticated"]) for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      same(query(`select has_table_privilege(${literal(role)},${literal(`public.${table}`)},${literal(privilege)})`), "f", `Client ${privilege} grant must be absent for ${table}`);
    }
    same(query(`select has_table_privilege('service_role',${literal(`public.${table}`)},'SELECT')`), "t", `Service read grant required for ${table}`);
  }
  const functions = ["issue_report_minor_eligibility", "create_report_authorization", "revoke_report_authorization", "read_report_summary", "lock_report_authorization"];
  const functionNames = functions.map(literal).join(",");
  same(query(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${functionNames})`), "5", "Exactly the five approved report RPCs must exist without ambiguous overloads");
  same(query(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${functionNames}) and p.prosecdef`), "0", "Report RPCs must remain SECURITY INVOKER");
  same(query(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
    lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where n.nspname='public' and p.proname in (${functionNames}) and a.grantee=0 and a.privilege_type='EXECUTE'`), "0", "Report RPCs must not inherit default PUBLIC execution");
  for (const name of functions) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      same(query(`select has_function_privilege(${literal(role)},p.oid,'EXECUTE') from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=${literal(name)}`),
      role === "service_role" ? "t" : "f", `Service-only execution grant required for ${name}`);
    }
  }
}

function assertSummary(data, label) {
  ensure(data && typeof data === "object" && !Array.isArray(data), `${label}: report object required`);
  ensure(Object.keys(data).every((key) => ["version", "status", "period", "dimensions"].includes(key)), `${label}: report envelope leaked extra data`);
  same(data.version, "sweet-period-report-v1", `${label}: report contract version`);
  ensure(["ready", "waiting", "expired", "invalid"].includes(data.status) && Array.isArray(data.dimensions), `${label}: invalid report status`);
  if (data.status !== "ready") {
    same(data.dimensions, [], `${label}: unavailable report must not contain dimensions`);
    ensure(!Object.hasOwn(data, "period"), `${label}: unavailable report must not reveal a period`);
  }
  if (data.status === "ready") {
    ensure(data.period && Object.keys(data.period).length === 2
      && ["start", "end"].every((key) => typeof data.period[key] === "string" && Number.isFinite(Date.parse(data.period[key]))), `${label}: invalid period contract`);
    same(Date.parse(data.period.end) - Date.parse(data.period.start), 7 * 86_400_000, `${label}: period must remain exactly seven days`);
  }
  ensure(new Set(data.dimensions.map((item) => item.id)).size === data.dimensions.length, `${label}: duplicate dimension`);
  for (const dimension of data.dimensions) {
    ensure(Object.keys(dimension).every((key) => ["id", "state", "category", "previousCategory", "comparison"].includes(key)), `${label}: dimension leaked extra data`);
    ensure(["sleep", "wake", "eat", "exercise", "task"].includes(dimension.id), `${label}: unknown dimension`);
    ensure(["category", "mixed", "insufficient"].includes(dimension.state), `${label}: invalid dimension state`);
    ensure(["same", "different", "unavailable"].includes(dimension.comparison), `${label}: invalid comparison`);
    if (dimension.state !== "category") ensure(!Object.hasOwn(dimension, "category") && !Object.hasOwn(dimension, "previousCategory"), `${label}: unavailable category leaked`);
    for (const key of ["category", "previousCategory"]) if (Object.hasOwn(dimension, key)) {
      ensure(typeof dimension[key] === "string" && dimension[key].startsWith(`${dimension.id}_`), `${label}: category does not belong to its dimension`);
    }
  }
  ensure(!JSON.stringify(data).includes("REPORTS_PRIVATE_"), `${label}: private source text reached the report`);
}
function unavailable(result, label) {
  if (!result.ok) {
    ensure([400, 401, 403, 404, 409].includes(result.status), `${label}: unexpected server failure instead of controlled denial`);
    return;
  }
  assertSummary(result.data, label);
  ensure(["expired", "invalid"].includes(result.data.status), `${label}: unauthorized report remained available`);
}

async function loadTypeScriptContract() {
  const loaded = await import("typescript");
  const ts = loaded.default ?? loaded;
  const directory = join(privateRoot, "report-contract-modules");
  if (existsSync(directory)) ensure(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(), "Contract module directory must not be a link");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const name of ["types", "source", "summary"]) {
    const source = readFileSync(join("lib/reports", `${name}.ts`), "utf8");
    const emitted = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
      .replace(/from (["'])\.\/(types|source)\1/g, 'from "./$2.mjs"');
    writeFileSync(join(directory, `${name}.mjs`), emitted, { mode: 0o600 });
  }
  const source = await import(pathToFileURL(join(directory, "source.mjs")).href);
  const summary = await import(pathToFileURL(join(directory, "summary.mjs")).href);
  return { ...source, ...summary };
}

async function transaction(label) {
  const child = spawn("docker", ["--context", dockerContext, "exec", "-i", "-e", `PGAPPNAME=reports_isolated_${randomUUID()}`,
    container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"],
  { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  child.stderr.on("data", () => {});
  let pending = null;
  let ended = false;
  lines.on("line", (line) => {
    if (!pending) return;
    if (line === pending.marker) {
      const current = pending;
      pending = null;
      clearTimeout(current.timer);
      current.resolve(current.lines.join("\n"));
    } else pending.lines.push(line);
  });
  const failed = () => {
    ended = true;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(`${label}: isolated transaction ended unexpectedly`)); pending = null; }
  };
  child.on("error", failed);
  child.on("close", failed);
  child.stdin.on("error", failed);
  async function command(sql) {
    ensure(!pending && !ended, `${label}: isolated transaction is not available`);
    return new Promise((resolveResult, reject) => {
      const marker = `REPORTS_BARRIER_${randomUUID().replaceAll("-", "")}`;
      pending = { marker, lines: [], resolve: resolveResult, reject, timer: setTimeout(() => {
        pending = null;
        child.kill("SIGTERM");
        reject(new Error(`${label}: isolated transaction barrier timed out`));
      }, 12_000) };
      child.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }
  await command("begin;");
  return {
    command,
    async commit() { await command("commit;"); child.stdin.end(); lines.close(); },
    abort() { child.stdin.end("rollback;\n"); child.kill("SIGTERM"); lines.close(); },
  };
}

async function waitForBlockedRpc(name, promise) {
  let completed = false;
  promise.then(() => { completed = true; }, () => { completed = true; });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    ensure(!completed, `${name}: RPC completed while the conflicting transaction still held its lock`);
    if (Number(query(`select count(*) from pg_stat_activity where state='active' and wait_event_type='Lock'
      and query like ${literal(`%${name}%`)}`)) > 0) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 75));
  }
  throw new Error(`${name}: the expected real database lock wait was not observed`);
}

function createArgs(student, recipient, recipientType, dimensions = ["sleep", "eat"], requestId = randomUUID()) {
  return {
    p_actor_user_id: accounts[student].id, p_recipient_user_id: accounts[recipient].id,
    p_recipient_type: recipientType, p_dimensions: dimensions, p_request_id: requestId, p_policy_version: reportPolicyVersion,
  };
}
async function createAuthorization(student, recipient, recipientType, dimensions = ["sleep", "eat"]) {
  const args = createArgs(student, recipient, recipientType, dimensions);
  const id = uuid(ok(await rpc("create_report_authorization", args), "An eligible synthetic authorization could not be created"));
  return { id, args };
}
async function readAuthorization(actor, authorizationId) {
  return rpc("read_report_summary", { p_actor_user_id: accounts[actor].id, p_authorization_id: uuid(authorizationId) });
}
async function revokeAuthorization(actor, authorizationId) {
  return rpc("revoke_report_authorization", { p_actor_user_id: accounts[actor].id, p_authorization_id: uuid(authorizationId) });
}
async function issueProof(student, schoolId, validUntil, actor = "admin") {
  return rpc("issue_report_minor_eligibility", {
    p_actor_user_id: accounts[actor].id, p_student_user_id: accounts[student].id, p_school_id: uuid(schoolId),
    p_verification_basis: "school_verified", p_source_reference: `isolated-reports-${student}`, p_valid_until: validUntil,
  });
}

async function verifyRawBoundaries(grants, proofUntil) {
  for (const name of accountNames) {
    const account = accounts[name];
    for (const table of reportTables) {
      const result = await localRequest(`/rest/v1/${table}`, account.accessToken, "GET", undefined, "select=*");
      if (result.ok) same(result.data, [], `${name}: raw ${table} rows must not be visible`);
      else ensure([401, 403].includes(result.status), `${name}: raw report table must fail with a controlled denial`);
    }
    for (const [method, body] of [["PATCH", { recipient_user_id: account.id, dimensions: ["task"], status: "active" }], ["DELETE", undefined]]) {
      const mutation = await localRequest("/rest/v1/report_authorizations", account.accessToken, method, body, `id=eq.${grants.teacherA1.id}`);
      ensure([401, 403].includes(mutation.status), `${name}: direct authorization mutation must be denied by the Data API`);
    }
    const ownRecord = state.recordIds[name];
    const raw = await localRequest("/rest/v1/sweet_records", account.accessToken, "GET", undefined,
      `select=id&id=in.(${Object.values(state.recordIds).map(uuid).join(",")})`);
    ensure(raw.ok, `${name}: direct SWEET ownership query failed`);
    same(raw.data.map((row) => row.id).sort(), ownRecord ? [ownRecord] : [], `${name}: old JWT must not read another person's raw SWEET`);
    const calls = [
      ["issue_report_minor_eligibility", { p_actor_user_id: accounts.admin.id, p_student_user_id: accounts["student-a1"].id,
        p_school_id: state.schoolA, p_verification_basis: "school_verified", p_source_reference: "isolated-denied-client", p_valid_until: proofUntil }],
      ["create_report_authorization", grants.teacherA1.args],
      ["revoke_report_authorization", { p_actor_user_id: accounts["student-a1"].id, p_authorization_id: grants.teacherA1.id }],
      ["read_report_summary", { p_actor_user_id: accounts["teacher-a"].id, p_authorization_id: grants.teacherA1.id }],
      ["lock_report_authorization", { p_actor_user_id: accounts["teacher-a"].id, p_authorization_id: grants.teacherA1.id }],
    ];
    for (const [rpcName, args] of calls) denied(await rpc(rpcName, args, account.accessToken), `${name}: internal report RPC ${rpcName} must reject a browser token`);
  }
  for (const table of reportTables) {
    const guest = await localRequest(`/rest/v1/${table}`, status.ANON_KEY, "GET", undefined, "select=*");
    if (guest.ok) same(guest.data, [], "An anonymous caller must not read raw report rows");
    else ensure([401, 403].includes(guest.status), "Anonymous report access must fail with a controlled denial");
  }
}

async function verifyFreshAuthorizationFlow() {
  const legacy = await service("guardian_student_links", "GET", `select=id,status&id=eq.${uuid(state.legacyLinkId)}`);
  same(legacy[0]?.status, "active", "The positive guardian fixture must retain its real pre-boundary active link");
  same(query("select count(*) from pg_constraint where conrelid='public.guardian_student_links'::regclass and conname='pilot_guardian_links_inactive'"), "1", "The real guardian boundary constraint must remain present");
  denied(await rpc("create_report_authorization", createArgs("student-a1", "teacher-a", "teacher")), "A minor without a trusted current proof must not authorize a report");
  const proofUntil = query("select to_char((clock_timestamp()+interval '35 days') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')");
  denied(await rpc("issue_report_minor_eligibility", {
    p_actor_user_id: accounts["student-a1"].id, p_student_user_id: accounts["student-a1"].id, p_school_id: state.schoolA,
    p_verification_basis: "school_verified", p_source_reference: "isolated-spoofed-student", p_valid_until: proofUntil,
  }), "The student must not act as a trusted eligibility verifier");
  denied(await issueProof("student-a1", state.schoolB, proofUntil), "A forged school must not establish minor eligibility");
  denied(await issueProof("adult-a", state.schoolA, proofUntil), "An adult must not receive a trusted minor-eligibility assertion");
  denied(await issueProof("student-b1", state.schoolB, proofUntil, "school-lead"), "A school lead must not verify a different school's minor eligibility");
  const proofA1 = uuid(ok(await issueProof("student-a1", state.schoolA, proofUntil, "school-lead"), "Trusted school A minor proof could not be issued"));
  const proofB1 = uuid(ok(await issueProof("student-b1", state.schoolB, proofUntil), "Trusted school B minor proof could not be issued"));
  state.proofIds = { studentA1: proofA1, studentB1: proofB1 };
  savePrivate(statePath, state);
  for (const dimensions of [[], ["sleep", "sleep"], ["sleep", "free_text"]]) {
    denied(await rpc("create_report_authorization", createArgs("student-a1", "teacher-a", "teacher", dimensions)), "Invalid dimensions must not produce a report authorization");
  }
  denied(await rpc("create_report_authorization", { ...createArgs("student-a1", "teacher-a", "teacher"), p_policy_version: "unapproved-policy" }), "An unknown report policy must not be accepted");
  denied(await rpc("create_report_authorization", createArgs("student-a1", "guardian-unrelated", "guardian")), "An unrelated guardian must not receive an authorization");
  denied(await rpc("create_report_authorization", createArgs("student-a1", "teacher-b", "teacher")), "A cross-school teacher must not receive an authorization");
  denied(await rpc("create_report_authorization", createArgs("student-a2", "teacher-a", "teacher")), "An unassigned same-school teacher and a self-pilot consent must not authorize reporting");
  denied(await rpc("create_report_authorization", createArgs("adult-a", "guardian-linked", "guardian")), "An adult must not enter the minor guardian-report path");
  const teacherA1 = await createAuthorization("student-a1", "teacher-a", "teacher");
  const guardianA1 = await createAuthorization("student-a1", "guardian-linked", "guardian", ["wake"]);
  const adultA = await createAuthorization("adult-a", "teacher-a", "teacher", ["sleep", "eat"]);
  const concurrentArgs = createArgs("student-b1", "teacher-b", "teacher", ["sleep"]);
  const concurrent = await Promise.all([rpc("create_report_authorization", concurrentArgs), rpc("create_report_authorization", concurrentArgs)]);
  const teacherB1 = { id: uuid(ok(concurrent[0], "First concurrent authorization failed")), args: concurrentArgs };
  same(uuid(ok(concurrent[1], "Second idempotent concurrent authorization failed")), teacherB1.id, "Concurrent identical requests must resolve to one authorization");
  const grants = { teacherA1, guardianA1, teacherB1, adultA };
  state.authorizationIds = Object.fromEntries(Object.entries(grants).map(([name, grant]) => [name, grant.id]));
  savePrivate(statePath, state);
  for (const [actor, grant] of [["teacher-a", teacherA1], ["guardian-linked", guardianA1], ["teacher-b", teacherB1], ["teacher-a", adultA]]) {
    const result = ok(await readAuthorization(actor, grant.id), "An authorized recipient could not read its fresh report state");
    assertSummary(result, "fresh authorized report");
    same(result.status, "waiting", "A fresh authorization must wait for its first full period");
  }
  same(uuid(ok(await rpc("create_report_authorization", teacherA1.args), "An identical retry failed")), teacherA1.id, "An identical retry must keep its authorization ID");
  denied(await rpc("create_report_authorization", { ...teacherA1.args, p_dimensions: ["task"] }), "An idempotency key must not be reused for a different scope");
  ensure(!queryAccepted(`update public.report_authorizations set dimensions=array['task']::text[] where id=${literal(teacherA1.id)}::uuid`), "Even a trusted direct mutation must not replace an immutable authorization scope");
  ensure(!queryAccepted(`update public.report_authorizations set effective_at=effective_at-interval '1 second' where id=${literal(teacherA1.id)}::uuid`), "Even a trusted direct mutation must not backfill an existing authorization");
  for (const actor of ["student-a2", "student-b1", "teacher-b", "guardian-unrelated", "school-lead", "admin"]) {
    unavailable(await readAuthorization(actor, teacherA1.id), `${actor}: another recipient's authorization must remain unavailable`);
  }
  await verifyRawBoundaries(grants, proofUntil);
  ok(await revokeAuthorization("student-a1", guardianA1.id), "Guardian-only revoke failed");
  unavailable(await readAuthorization("guardian-linked", guardianA1.id), "Revoked guardian report remained readable with its old session");
  same(ok(await readAuthorization("teacher-a", teacherA1.id), "Guardian revoke affected the teacher report").status, "waiting", "Guardian revoke must leave the independent teacher report intact");
  ok(await revokeAuthorization("student-a1", guardianA1.id), "A repeated revoke must be idempotent");
  return grants;
}

function isoAt(instant, days = 0, milliseconds = 0) {
  return new Date(Date.parse(instant) + days * 86_400_000 + milliseconds).toISOString();
}
function sourceRow(createdAt, sleep = "比较好", eat = "比较规律") {
  return { id: randomUUID(), user_id: accounts["adult-a"].id, school_id: state.schoolA,
    created_at: createdAt, records: sweetAnswers(sleep, eat), summary: "REPORTS_PRIVATE_AI_SUMMARY" };
}
function insertSyntheticSources(rows) {
  for (const row of rows) {
    query(`insert into public.sweet_records select * from jsonb_populate_record(null::public.sweet_records,${literal(JSON.stringify(row))}::jsonb)`, "historical synthetic SWEET insertion");
  }
}
function replaceSyntheticSources(rows) {
  query(`delete from public.sweet_records where user_id=${literal(accounts["adult-a"].id)}::uuid`, "historical synthetic SWEET reset");
  insertSyntheticSources(rows);
}
function normalizeSummary(data) {
  return data.period ? { ...data, period: {
    start: new Date(data.period.start).toISOString(), end: new Date(data.period.end).toISOString(),
  } } : data;
}
async function assertCalculatedReport(id, rows, contract, effectiveAt, expiresAt, dimensions, label) {
  const result = ok(await readAuthorization("teacher-a", id), label);
  assertSummary(result, label);
  const clock = query("select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')");
  const expected = contract.buildReportSummary({ records: contract.adaptSweetReportSources(rows), effectiveAt, expiresAt, now: clock, dimensions });
  same(normalizeSummary(result), normalizeSummary(expected), `${label}: database and TypeScript calculations must agree`);
  return result;
}
async function insertHistoricalAuthorization(effectiveAt, expiresAt, dimensions = ["sleep", "eat"]) {
  const id = uuid(query(`insert into public.report_authorizations
    (student_user_id,recipient_user_id,recipient_type,relationship_id,school_id,minor_assertion_id,
      dimensions,purpose,policy_version,consent_snapshot,effective_at,expires_at,request_id,created_at)
    select c.student_user_id,${literal(accounts["teacher-a"].id)}::uuid,'teacher',${literal(state.assignmentAdult)}::uuid,
      ${literal(state.schoolA)}::uuid,null,${literal(`{${dimensions.join(",")}}`)}::text[],'rhythm_context',${literal(reportPolicyVersion)},
      to_jsonb(c)-'created_at'-'updated_at',${literal(effectiveAt)}::timestamptz,${literal(expiresAt)}::timestamptz,
      ${literal(randomUUID())}::uuid,${literal(effectiveAt)}::timestamptz
    from public.student_consents c where c.student_user_id=${literal(accounts["adult-a"].id)}::uuid
    returning id::text`, "historical authorization fixture insertion"));
  return id;
}

async function verifyHistoricalCalculation(grants) {
  ok(await revokeAuthorization("adult-a", grants.adultA.id), "Fresh adult fixture could not be closed before historical acceptance");
  const effectiveAt = new Date(query("select to_char(((date_trunc('day',clock_timestamp() at time zone 'Asia/Shanghai')-interval '15 days'+interval '12 hours') at time zone 'Asia/Shanghai') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")).toISOString();
  const expiresAt = isoAt(effectiveAt, 30);
  query(`update public.student_consents set student_assented_at=${literal(isoAt(effectiveAt, -2))}::timestamptz
    where student_user_id=${literal(accounts["adult-a"].id)}::uuid`, "historical adult consent fixture setup");
  const id = await insertHistoricalAuthorization(effectiveAt, expiresAt);
  const contract = await loadTypeScriptContract();
  const original = [1, 2, 3].map((day) => sourceRow(isoAt(effectiveAt, day)));
  let current = [8, 9, 10].map((day) => sourceRow(isoAt(effectiveAt, day), "不太好"));
  let rows = [...original, ...current, sourceRow(isoAt(effectiveAt, -1), "很不好"),
    sourceRow(isoAt(effectiveAt, 14), "睡得很好")];
  replaceSyntheticSources(rows);
  const baseline = await assertCalculatedReport(id, rows, contract, effectiveAt, expiresAt, ["sleep", "eat"], "Two completed periods and excluded pre-grant/current data");
  same(baseline.dimensions.map((item) => item.id), ["sleep", "eat"], "The database report must filter to independently authorized dimensions");
  same(baseline.dimensions[0].comparison, "different", "Category changes must remain factual category comparisons");
  same(baseline.dimensions[1].comparison, "same", "Unchanged categories must remain factual category comparisons");

  const allDimensions = ["sleep", "wake", "eat", "exercise", "task"];
  const mappingId = await insertHistoricalAuthorization(effectiveAt, expiresAt, allDimensions);
  const canonicalOptions = [
    ["睡得很好", "比较好", "一般", "不太好", "很不好"],
    ["很有精神", "比较有精神", "一般", "有点疲惫", "很疲惫"],
    ["很规律", "比较规律", "一般", "不太规律", "很不规律"],
    ["0 分钟", "1–9 分钟", "10–19 分钟", "20–29 分钟", "30 分钟以上", "不太确定"],
    ["很顺利", "比较顺利", "一般", "不太顺利", "很不顺利"],
  ];
  for (const [step, values] of canonicalOptions.entries()) for (const value of values) {
    const mappingRows = [8, 9, 10].map((day) => {
      const row = sourceRow(isoAt(effectiveAt, day)); row.records[step].fields[0].value = value; return row;
    });
    replaceSyntheticSources(mappingRows);
    await assertCalculatedReport(mappingId, mappingRows, contract, effectiveAt, expiresAt, allDimensions, "Every canonical primary category preserves exact database/TypeScript mapping");
  }
  replaceSyntheticSources(rows);

  // A later same-day answer replaces the earlier one, while an incomplete or
  // unrecognized record never becomes an inferred answer.
  const duplicate = sourceRow(isoAt(effectiveAt, 8, 3_600_000), "比较好");
  const unknown = sourceRow(isoAt(effectiveAt, 11)); unknown.records[0].fields[0].value = "REPORTS_PRIVATE_UNKNOWN";
  const incomplete = sourceRow(isoAt(effectiveAt, 12)); incomplete.records.pop();
  rows = [...rows, duplicate, unknown, incomplete];
  replaceSyntheticSources(rows);
  await assertCalculatedReport(id, rows, contract, effectiveAt, expiresAt, ["sleep", "eat"], "Same-day latest valid source and unknown/incomplete rejection");

  // Correction and deletion must be recomputed from remaining valid sources.
  query(`update public.sweet_records set records=${literal(JSON.stringify(sweetAnswers("比较好")))}::jsonb where id=${literal(current[1].id)}::uuid`, "synthetic source correction");
  rows = rows.map((row) => row.id === current[1].id ? { ...row, records: sweetAnswers("比较好") } : row);
  await assertCalculatedReport(id, rows, contract, effectiveAt, expiresAt, ["sleep", "eat"], "Source correction is reflected on the next read");
  query(`delete from public.sweet_records where id=${literal(duplicate.id)}::uuid`, "synthetic latest-answer deletion");
  rows = rows.filter((row) => row.id !== duplicate.id);
  await assertCalculatedReport(id, rows, contract, effectiveAt, expiresAt, ["sleep", "eat"], "Deleting a latest answer reselects the remaining same-day answer");

  current = [8, 9, 10, 11, 12, 13].map((day, index) => sourceRow(isoAt(effectiveAt, day), index < 3 ? "比较好" : "不太好"));
  rows = [...original, ...current];
  replaceSyntheticSources(rows);
  const mixed = await assertCalculatedReport(id, rows, contract, effectiveAt, expiresAt, ["sleep", "eat"], "Tied modes remain mixed");
  same(mixed.dimensions[0].state, "mixed", "Ties must not be resolved by category ordering");

  const conflicted = sourceRow(current[0].created_at, "很不好");
  rows = [...original, ...current.slice(0, 3), conflicted];
  replaceSyntheticSources(rows);
  const insufficient = await assertCalculatedReport(id, rows, contract, effectiveAt, expiresAt, ["sleep", "eat"], "Conflicting equal timestamps remove that Shanghai day");
  same(insufficient.dimensions[0].state, "insufficient", "Two valid dates must never produce a category");

  rows = [...original, ...[8, 9, 10].map((day) => sourceRow(isoAt(effectiveAt, day), "不太好"))];
  replaceSyntheticSources(rows);
  await assertCalculatedReport(id, rows, contract, effectiveAt, expiresAt, ["sleep", "eat"], "Restored canonical synthetic sources");
  const expiresId = await insertHistoricalAuthorization(effectiveAt, isoAt(effectiveAt, 14));
  unavailable(await readAuthorization("teacher-a", expiresId), "An authorization past its expiry must not disclose even a completed report");
  state.historical = { id, effectiveAt, expiresAt, rows };
  savePrivate(statePath, state);
  return { id, effectiveAt, expiresAt, rows, contract };
}

async function verifyTerminalLifecycles(grants) {
  denied(await revokeAuthorization("teacher-a", grants.teacherA1.id), "A recipient must not revoke or modify the student's authorization");
  ok(await revokeAuthorization("student-a1", grants.teacherA1.id), "The owner could not revoke the teacher report");
  unavailable(await readAuthorization("teacher-a", grants.teacherA1.id), "An old recipient session survived explicit revocation");
  const retry = await rpc("create_report_authorization", grants.teacherA1.args);
  if (retry.ok) {
    same(uuid(retry.data), grants.teacherA1.id, "A revoked idempotency request must not mint a replacement authorization");
    unavailable(await readAuthorization("teacher-a", retry.data), "Retrying an old request resurrected its revoked authorization");
  } else denied(retry, "A revoked idempotency request must fail safely");

  async function invalidatesAndStaysInvalid(label, mutate, restore) {
    const grant = await createAuthorization("student-a1", "teacher-a", "teacher");
    query(mutate, `${label}: synthetic invalidation mutation`);
    unavailable(await readAuthorization("teacher-a", grant.id), `${label}: invalidated authorization remained available`);
    if (restore) query(restore, `${label}: trusted synthetic restoration`);
    unavailable(await readAuthorization("teacher-a", grant.id), `${label}: restoring a prerequisite resurrected an old authorization`);
    return grant;
  }
  const student = literal(accounts["student-a1"].id);
  const teacher = literal(accounts["teacher-a"].id);
  await invalidatesAndStaysInvalid("Consent withdrawal", `update public.student_consents set status='withdrawn',withdrawn_at=clock_timestamp(),withdrawn_by=${student}::uuid where student_user_id=${student}::uuid`,
    `update public.student_consents set status='active',withdrawn_at=null,withdrawn_by=null where student_user_id=${student}::uuid`);
  const policyGrant = await createAuthorization("student-a1", "teacher-a", "teacher");
  query(`update public.student_consents set policy_version='legacy-school-policy' where student_user_id=${student}::uuid`, "synthetic older school-consent version");
  unavailable(await readAuthorization("teacher-a", policyGrant.id), "An older school-consent version retained current report access");
  denied(await rpc("create_report_authorization", createArgs("student-a1", "teacher-a", "teacher")), "An old active school consent must not authorize a new continuing report");
  query(`update public.student_consents set policy_version=${literal(basePolicyVersion)} where student_user_id=${student}::uuid`, "synthetic approved school-consent version restoration");
  unavailable(await readAuthorization("teacher-a", policyGrant.id), "Fresh consent restored a former continuing authorization without a new opt-in");
  await invalidatesAndStaysInvalid("Teacher assignment revocation", `update public.teacher_student_assignments set status='revoked',revoked_at=clock_timestamp() where id=${literal(state.assignmentA1)}::uuid`,
    `update public.teacher_student_assignments set status='active',revoked_at=null where id=${literal(state.assignmentA1)}::uuid`);
  await invalidatesAndStaysInvalid("Teacher school membership revocation", `update public.school_members set status='revoked',revoked_at=clock_timestamp() where school_id=${literal(state.schoolA)}::uuid and user_id=${teacher}::uuid`,
    `update public.school_members set status='active',revoked_at=null where school_id=${literal(state.schoolA)}::uuid and user_id=${teacher}::uuid`);
  const unrelatedProfileGrant = await createAuthorization("student-a1", "teacher-a", "teacher");
  query(`update public.profiles set role='学生' where id=${literal(accounts["guardian-unrelated"].id)}::uuid`, "synthetic unrelated guardian profile change");
  same(ok(await readAuthorization("teacher-a", unrelatedProfileGrant.id), "An unrelated guardian profile change affected an independent report").status, "waiting", "Unrelated profile changes must not invalidate the student's report");
  query(`update public.profiles set role='家长' where id=${literal(accounts["guardian-unrelated"].id)}::uuid`, "synthetic unrelated guardian profile restoration");
  await invalidatesAndStaysInvalid("Consenting guardian loses the guardian role", `update public.profiles set role='学生' where id=${literal(accounts["guardian-linked"].id)}::uuid`,
    `update public.profiles set role='家长' where id=${literal(accounts["guardian-linked"].id)}::uuid`);
  await invalidatesAndStaysInvalid("Student leaves the profile school", `update public.profiles set school_id=null where id=${student}::uuid`,
    `update public.profiles set school_id=${literal(state.schoolA)}::uuid where id=${student}::uuid`);
  await invalidatesAndStaysInvalid("School pauses participation", `update public.schools set status='paused' where id=${literal(state.schoolA)}::uuid`,
    `update public.schools set status='active' where id=${literal(state.schoolA)}::uuid`);

  const proofUntil = query("select to_char((clock_timestamp()+interval '3 days') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')");
  const shortProof = uuid(ok(await issueProof("student-a1", state.schoolA, proofUntil), "A bounded minor proof could not be issued"));
  const bounded = await createAuthorization("student-a1", "teacher-a", "teacher");
  same(query(`select (expires_at<=${literal(proofUntil)}::timestamptz and expires_at<=effective_at+interval '30 days')::text from public.report_authorizations where id=${literal(bounded.id)}::uuid`), "true", "A minor authorization must be bounded by both trusted eligibility and thirty days");
  query(`update public.minor_eligibility_assertions set revoked_at=clock_timestamp() where id=${literal(shortProof)}::uuid`, "synthetic minor proof revocation");
  unavailable(await readAuthorization("teacher-a", bounded.id), "Revoking trusted minor proof did not stop the report");
  denied(await rpc("create_report_authorization", createArgs("student-a1", "teacher-a", "teacher")), "A revoked latest eligibility assertion must not fall back to an older long-lived assertion");
  queryAccepted(`update public.minor_eligibility_assertions set revoked_at=null where id=${literal(shortProof)}::uuid`);
  unavailable(await readAuthorization("teacher-a", bounded.id), "Restoring proof status resurrected an old authorization");
  query(`update public.minor_eligibility_assertions set verified_at=clock_timestamp()-interval '5 days',valid_until=clock_timestamp()-interval '1 day'
    where id=${literal(shortProof)}::uuid`, "synthetic latest minor cutoff expiration");
  denied(await rpc("create_report_authorization", createArgs("student-a1", "teacher-a", "teacher")), "A stale fourteen-to-seventeen label and expired latest proof must not permit reauthorization");
  unavailable(await readAuthorization("teacher-a", bounded.id), "A report survived the trusted minor cutoff");
  const newProofUntil = query("select to_char((clock_timestamp()+interval '35 days') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')");
  ok(await issueProof("student-a1", state.schoolA, newProofUntil), "Fresh proof after revocation could not be established");

  const ageGrant = await createAuthorization("student-a1", "teacher-a", "teacher");
  query(`update public.student_consents set age_band='18_plus',consent_basis='adult_self',guardian_user_id=null,guardian_consented_at=null
    where student_user_id=${student}::uuid`, "synthetic transition to adulthood");
  unavailable(await readAuthorization("teacher-a", ageGrant.id), "A minor authorization survived an age-basis change");
  denied(await rpc("create_report_authorization", createArgs("student-a1", "guardian-linked", "guardian")), "An adult must not receive a new guardian report authorization");
  query(`update public.student_consents set age_band='14_17',consent_basis='student_guardian',guardian_user_id=${literal(accounts["guardian-linked"].id)}::uuid,
    guardian_consented_at=student_assented_at where student_user_id=${student}::uuid`, "synthetic minor consent restoration");
  unavailable(await readAuthorization("teacher-a", ageGrant.id), "Restoring an old age label resurrected the former authorization");
  ok(await issueProof("student-a1", state.schoolA, newProofUntil), "Fresh trusted eligibility after an age-basis change failed");
}

async function verifyConcurrentOrdering(history) {
  // An actual open database transaction holds the same lock as the RPC. The
  // competing request must be observed waiting in pg_stat_activity before the
  // first transaction commits; a timing-only sleep cannot prove ordering.
  let grant = await createAuthorization("student-a1", "teacher-a", "teacher");
  let first = await transaction("read before revoke");
  try {
    await first.command(`set local role service_role; select public.read_report_summary(${literal(accounts["teacher-a"].id)}::uuid,${literal(grant.id)}::uuid);`);
    const revoking = revokeAuthorization("student-a1", grant.id);
    await waitForBlockedRpc("revoke_report_authorization", revoking);
    await first.commit(); first = null;
    ok(await revoking, "A queued owner revocation failed after the earlier read committed");
    unavailable(await readAuthorization("teacher-a", grant.id), "A read-first authorization remained available after queued revocation completed");
  } finally { first?.abort(); }

  grant = await createAuthorization("student-a1", "teacher-a", "teacher");
  first = await transaction("revoke before read");
  try {
    await first.command(`set local role service_role; select public.revoke_report_authorization(${literal(accounts["student-a1"].id)}::uuid,${literal(grant.id)}::uuid);`);
    const reading = readAuthorization("teacher-a", grant.id);
    await waitForBlockedRpc("read_report_summary", reading);
    await first.commit(); first = null;
    unavailable(await reading, "A read queued behind a completed revocation returned a report");
  } finally { first?.abort(); }

  grant = await createAuthorization("student-a1", "teacher-a", "teacher");
  first = await transaction("relationship invalidation before read");
  try {
    await first.command(`update public.teacher_student_assignments set status='revoked',revoked_at=clock_timestamp() where id=${literal(state.assignmentA1)}::uuid;`);
    const reading = readAuthorization("teacher-a", grant.id);
    await waitForBlockedRpc("read_report_summary", reading);
    await first.commit(); first = null;
    unavailable(await reading, "A read queued behind relationship invalidation returned a report");
    query(`update public.teacher_student_assignments set status='active',revoked_at=null where id=${literal(state.assignmentA1)}::uuid`, "synthetic relationship restoration after concurrency");
    unavailable(await readAuthorization("teacher-a", grant.id), "A relationship restored after a race resurrected its former authorization");
  } finally { first?.abort(); }

  // Earlier school/profile lifecycle changes terminally invalidate old history.
  // Create a new, independently identified historical scope for source races.
  const id = await insertHistoricalAuthorization(history.effectiveAt, history.expiresAt);
  let rows = history.rows;
  const victim = rows.find((row) => Date.parse(row.created_at) >= Date.parse(isoAt(history.effectiveAt, 8)));
  ensure(Boolean(victim), "A current-period synthetic source is required for deletion ordering");
  first = await transaction("source deletion before read");
  try {
    await first.command(`delete from public.sweet_records where id=${literal(victim.id)}::uuid;`);
    const reading = readAuthorization("teacher-a", id);
    await waitForBlockedRpc("read_report_summary", reading);
    await first.commit(); first = null;
    const after = ok(await reading, "A read after source deletion failed");
    assertSummary(after, "Source-deletion-first report");
    rows = rows.filter((row) => row.id !== victim.id);
    const expected = await assertCalculatedReport(id, rows, history.contract, history.effectiveAt, history.expiresAt, ["sleep", "eat"], "Source deletion committed before report recomputation");
    same(normalizeSummary(after), normalizeSummary(expected), "A read queued behind deletion returned a stale summary");
  } finally { first?.abort(); }

  insertSyntheticSources([victim]); rows = [...rows, victim];
  first = await transaction("read before source deletion");
  let second = null;
  try {
    const before = JSON.parse(await first.command(`set local role service_role; select public.read_report_summary(${literal(accounts["teacher-a"].id)}::uuid,${literal(id)}::uuid)::text;`));
    assertSummary(before, "Read-first report");
    second = await transaction("queued source deletion");
    const deleting = second.command(`delete from public.sweet_records where id=${literal(victim.id)}::uuid;`);
    await waitForBlockedRpc("sweet_records", deleting);
    await first.commit(); first = null;
    await deleting;
    await second.commit(); second = null;
    rows = rows.filter((row) => row.id !== victim.id);
    const after = await assertCalculatedReport(id, rows, history.contract, history.effectiveAt, history.expiresAt, ["sleep", "eat"], "Later reads reflect a queued source deletion after the earlier read completed");
    ensure(!isDeepStrictEqual(before.dimensions, after.dimensions), "The source ordering fixture must distinguish the earlier and later summaries");
  } finally { first?.abort(); second?.abort(); }
}

async function verifyExitAndDeletion() {
  const teacherDependentOnGuardian = await createAuthorization("student-a1", "teacher-a", "teacher");
  const guardian = await createAuthorization("student-a1", "guardian-linked", "guardian", ["wake"]);
  query(`update public.guardian_student_links set status='revoked',revoked_at=clock_timestamp() where id=${literal(state.legacyLinkId)}::uuid`, "synthetic guardian relationship revocation");
  unavailable(await readAuthorization("guardian-linked", guardian.id), "A guardian's old session retained a revoked relationship report");
  unavailable(await readAuthorization("teacher-a", teacherDependentOnGuardian.id), "A minor teacher report survived revocation of its consenting guardian relationship");
  denied(await rpc("create_report_authorization", createArgs("student-a1", "teacher-a", "teacher")), "A minor without a current consenting guardian relationship must not create a teacher report");
  const reactivated = queryAccepted(`update public.guardian_student_links set status='active',revoked_at=null where id=${literal(state.legacyLinkId)}::uuid`);
  ensure(!reactivated, "The pilot guardian constraint must continue to reject new active relationship transitions");
  unavailable(await readAuthorization("guardian-linked", guardian.id), "A rejected guardian reactivation affected a terminal authorization");

  const schoolGrant = await createAuthorization("student-b1", "teacher-b", "teacher");
  ok(await rpc("exit_school_pilot", { p_school_id: state.schoolB, p_actor_user_id: accounts.admin.id,
    p_reason: "Disposable synthetic reports exit acceptance", p_policy_version: reportPolicyVersion }), "The existing school-exit transaction failed on its synthetic fixture");
  unavailable(await readAuthorization("teacher-b", schoolGrant.id), "A school exit left an existing report readable");
  same(query(`select count(*) from public.sweet_records where id=${literal(state.recordIds["student-b1"])}::uuid and school_id is null`), "1", "School exit must preserve the student's own detached source record");
  const studentOwn = await localRequest("/rest/v1/sweet_records", accounts["student-b1"].accessToken, "GET", undefined,
    `select=id&id=eq.${state.recordIds["student-b1"]}`);
  same(ok(studentOwn, "The student could not read its own record after school exit").map((row) => row.id), [state.recordIds["student-b1"]], "School exit must preserve the student's own read boundary");

  // The report-school consent is deliberately distinct from today's existing
  // personal-save policy. Exercise the already supported adult_self policy
  // without relaxing the ordinary consent trigger or RLS to make tests pass.
  query(`update public.student_consents set policy_version='2026-08-28' where student_user_id=${literal(accounts["adult-a"].id)}::uuid`, "synthetic current adult personal-save consent");
  const own = sourceRow(new Date().toISOString());
  const saved = ok(await localRequest("/rest/v1/sweet_records", accounts["adult-a"].accessToken, "POST", own), "The owner could not save a canonical personal SWEET with the current accepted consent");
  same(saved.map((row) => row.id), [own.id], "Personal save must retain the actual authenticated owner's record");
  const forgedOwner = { ...own, id: randomUUID(), user_id: accounts["school-lead"].id };
  const forged = await localRequest("/rest/v1/sweet_records", accounts["adult-a"].accessToken, "POST", forgedOwner);
  ensure([401, 403].includes(forged.status), "A student cannot save a source record under another user's identity");
  const ownRead = ok(await localRequest("/rest/v1/sweet_records", accounts["adult-a"].accessToken, "GET", undefined, `select=id&id=eq.${own.id}`), "The owner could not read a newly saved personal record");
  same(ownRead.map((row) => row.id), [own.id], "Personal ownership read must remain available");
  ok(await localRequest("/rest/v1/sweet_records", accounts["adult-a"].accessToken, "DELETE", undefined, `id=eq.${own.id}`), "The owner could not delete its newly saved personal record");
  same(query(`select count(*) from public.sweet_records where id=${literal(own.id)}::uuid`), "0", "The personal delete must actually remove the chosen record");
  query(`update public.student_consents set policy_version=${literal(basePolicyVersion)} where student_user_id=${literal(accounts["adult-a"].id)}::uuid`, "synthetic report-school consent restored after personal-save acceptance");
  const deletingGrant = await createAuthorization("adult-a", "teacher-a", "teacher");
  ok(await localRequest(`/auth/v1/admin/users/${uuid(accounts["adult-a"].id)}`, status.SERVICE_ROLE_KEY, "DELETE"), "Synthetic adult account deletion failed");
  unavailable(await readAuthorization("teacher-a", deletingGrant.id), "A deleted student's report remained readable");
  same(query(`select count(*) from public.sweet_records where user_id=${literal(accounts["adult-a"].id)}::uuid`), "0", "Deleting an owner must remove its synthetic source records");
  const stale = await localRequest("/rest/v1/sweet_records", accounts["adult-a"].accessToken, "GET", undefined, "select=id");
  if (stale.ok) same(stale.data, [], "A stale deleted-owner session must not read any source rows");
  else ensure([401, 403].includes(stale.status), "A deleted-owner session must fail safely");
}

function verifyMinimalAudit() {
  for (const table of ["report_authorization_events", "report_access_audit"]) {
    const columns = query(`select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name=${literal(table)}`).split(",");
    ensure(columns.every((name) => name === "summary_version" || !/(body|email|token|answer|records|summary|payload|message|count)/.test(name)), `${table}: audit schema must not hold private source text or activity counts`);
    const serialized = query(`select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)::text from public.${table} t`);
    ensure(!serialized.includes("REPORTS_PRIVATE_") && !serialized.includes("@example.invalid"), `${table}: minimal audit contains synthetic private source content or email`);
    ensure(Number(query(`select count(*) from public.${table}`)) > 0, `${table}: actual lifecycle/access evidence is required`);
  }
  same(query("select count(*) from pg_constraint where conrelid='public.guardian_student_links'::regclass and conname='pilot_guardian_links_inactive'"), "1", "The pilot guardian boundary must survive the complete acceptance run");
}

async function verifyReports() {
  validateAccounts();
  validateState();
  await verifySyntheticAuthUsers();
  ensure(state.seededBeforeGuardianBoundary === true, "A real pre-boundary legacy guardian fixture is required");
  verifyCatalog();
  const grants = await verifyFreshAuthorizationFlow();
  const history = await verifyHistoricalCalculation(grants);
  await verifyTerminalLifecycles(grants);
  await verifyConcurrentOrdering(history);
  await verifyExitAndDeletion();
  verifyMinimalAudit();
  console.log(`isolated reports acceptance passed: ${assertionCount} controlled assertions; 2 schools, ${accountNames.length} synthetic sessions, real direct Data API, lifecycle/age/cutoff boundaries, TypeScript calculation parity, school exit, owner deletion and observed database lock ordering; no remote project or mail used`);
}

try {
  if (phase === "pre-boundary-seed") await seedBeforeBoundary();
  else {
    await verifyReports();
  }
} catch (error) {
  // Labels above are controlled strings. No command arguments, SQL errors, API
  // payloads, session objects or credential-bearing process errors are logged.
  console.error(`isolated reports check failed: ${error instanceof Error ? error.message : "controlled local operation failed"}`);
  process.exitCode = 1;
}
