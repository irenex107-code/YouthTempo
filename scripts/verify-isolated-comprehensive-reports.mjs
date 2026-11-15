import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, lstatSync, realpathSync, chmodSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const [statusFile, sessionsFile, fixtureFile, phase = "verify"] = process.argv.slice(2);
const container = "supabase_db_youthtempo-isolated-reports-v2-20261028";
const appOrigin = "http://127.0.0.1:3214";
const evidencePath = "deliverables/comprehensive-reports-2026-10-28/database-verification.json";
let checks = 0;
const groups = {};
let group = "guards";
function ensure(value, label) { checks++; groups[group] = (groups[group] || 0) + 1; if (!value) throw new Error(label); }
function same(a, b, label) { ensure(isDeepStrictEqual(a, b), label); }
function literal(v) { return `'${String(v).replaceAll("'", "''")}'`; }
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function uuid(v) { ensure(typeof v === "string" && uuidPattern.test(v), "Invalid synthetic identifier"); return v; }
const privateRoot = realpathSync(dirname(resolve(statusFile)));
ensure(privateRoot === "/private/tmp/youthtempo-isolated-reports-v2-20261028", "Only the dedicated v2 private runtime is allowed");
function privateJson(file) {
  const path = resolve(file); const stat = lstatSync(path);
  ensure(dirname(realpathSync(path)) === privateRoot && stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0, "Private fixture files must be local single-link 0600 files");
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("Invalid private JSON; input withheld"); }
}
const status = privateJson(statusFile), accounts = privateJson(sessionsFile), original = privateJson(fixtureFile);
ensure(status.API_URL === "http://127.0.0.1:55321", "Remote or unexpected API refused");
ensure(["seed", "verify", "http"].includes(phase), "Unknown verification phase");
const names = ["student-a1", "student-a2", "student-b1", "adult-a", "teacher-a", "teacher-b", "guardian-linked", "guardian-unrelated", "guardian-b", "school-lead", "admin"];
for (const name of names) { uuid(accounts[name]?.id); ensure(accounts[name].email === `yt-reports-${name}@example.invalid`, "Non-synthetic account refused"); }
const id = (name) => accounts[name].id;
function privateWrite(file, value) { writeFileSync(file, JSON.stringify(value), { mode: 0o600 }); chmodSync(file, 0o600); }
function sql(statement) {
  try { return execFileSync("docker", ["--context", "colima-youthtempo-e2e", "exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"],
    { input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout: 45_000 }).trim(); }
  catch (error) { writeFileSync(`${privateRoot}/last-sql-error.log`, String(error.stderr || "Local SQL failure"), { mode: 0o600 }); throw new Error("Controlled local SQL failed; details withheld"); }
}
ensure(sql(`select count(*) from auth.users where id in (${names.map((n) => `${literal(uuid(id(n)))}::uuid`).join(",")})`) === "11", "Docker and REST fixture identity sets must match");
async function request(origin, path, token, method = "GET", body, extra = {}) {
  const url = new URL(path, origin); ensure(url.origin === origin, "Request tried to leave the isolated origin");
  const response = await fetch(url, { method, signal: AbortSignal.timeout(30_000), headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation", ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data; try { data = await response.json(); } catch { throw new Error("Expected safe JSON response; body withheld"); }
  return { status: response.status, ok: response.ok, data, headers: response.headers };
}
const rest = (path, name, method = "GET", body) => request(status.API_URL, path, name === "service" ? status.SERVICE_ROLE_KEY : accounts[name].accessToken, method, body);
const rpc = (name, args, caller = "service") => rest(`/rest/v1/rpc/${name}`, caller, "POST", args);
function ready(result, label) { ensure(result.ok && result.data?.status === "ready", label); return result.data; }
function denied(result, label) { ensure(!result.ok || ["denied", "expired", "refresh_required", "stale_setting"].includes(result.data?.status), label); }
function noPrivate(value, label) { ensure(!/PRIVATE_|example\.invalid|refresh_token|access_token|small_step|recommended_next_tool/.test(JSON.stringify(value)), label); }
const v2File = `${privateRoot}/v2-state.json`;
let state = phase === "seed" ? { version: "comprehensive-isolated-v2", schoolA: original.schoolA, schoolB: original.schoolB, enrollments: {}, records: {} } : privateJson(v2File);
const canonical = (note = "PRIVATE_SWEET_NOTE", quality = "比较好") => [
  { id: "sleep", fields: [{ id: "quality", value: quality }, { id: "duration", value: "7 小时以上、不足 8 小时" }, { id: "factors", value: ["睡前想太多"] }, { id: "note", value: note }] },
  { id: "wake", fields: [{ id: "state", value: "比较有精神" }, { id: "note", value: `${note}-wake` }] },
  { id: "eat", fields: [{ id: "rhythm", value: "比较规律" }, { id: "mealCount", value: "3 餐或以上" }, { id: "foodDetails", value: `${note}-food` }] },
  { id: "exercise", fields: [{ id: "duration", value: "10–19 分钟" }, { id: "activityNote", value: `${note}-activity` }] },
  { id: "task", fields: [{ id: "engagement", value: "比较顺利" }, { id: "completedSmallTask", value: `${note}-completed` }] },
];
async function issue(name, school) {
  const until = new Date(Date.now() + 40 * 86400_000).toISOString();
  const proof = await rpc("issue_report_minor_eligibility", { p_actor_user_id: id("admin"), p_student_user_id: id(name), p_school_id: school, p_verification_basis: "school_verified", p_source_reference: `synthetic-v2-age-${name}`, p_valid_until: until });
  ensure(proof.ok && typeof proof.data === "string", "Trusted age proof failed");
  const response = await rpc("issue_school_report_enrollment", { p_actor_user_id: id("admin"), p_student_user_id: id(name), p_school_id: school, p_basis_reference: `synthetic-v2-purpose-${name}`, p_notice_reference: `synthetic-v2-notice-${name}`, p_school_registered_until: until, p_basis_valid_until: until, p_request_id: randomUUID() });
  const enrollment = ready(response, "Trusted new enrollment failed"); uuid(enrollment.enrollmentId); state.enrollments[name] = enrollment.enrollmentId; privateWrite(v2File, state); return enrollment.enrollmentId;
}
const trend = (name, actor = "teacher-a", extra = {}) => rpc("read_school_report_trend", { p_actor_user_id: id(actor), p_enrollment_id: state.enrollments[name], ...extra });
const details = (name, actor = "teacher-a", extra = {}) => rpc("read_school_report_details", { p_actor_user_id: id(actor), p_enrollment_id: state.enrollments[name], ...extra });
async function access(actor, extra = {}) { return ready(await rpc("read_school_report_access", { p_actor_user_id: id(actor), ...extra }), "Access context unavailable"); }
async function toggle(name, enabled, extra = {}) {
  const a = await access(name); const own = a.owner;
  ensure(own && own.enrollmentId === state.enrollments[name], "Owner context missing");
  return rpc("set_school_report_details", { p_actor_user_id: id(name), p_enrollment_id: own.enrollmentId, p_enabled: enabled, p_request_id: randomUUID(),
    ...(enabled ? { p_expected_detail_revision: own.detailRevision, p_expected_recipient_epoch: own.recipientEpoch, p_notice_version: "sweet-details-2026-10-28", p_confirmed: true } : {}), ...extra });
}
const api = (path, actor, method = "GET", body, extra = {}) => request(appOrigin, path, actor ? accounts[actor].accessToken : "", method, body, extra);
function success(result, label) { if (!result.ok) console.error(JSON.stringify({ event: "isolated_api_failure", status: result.status, code: result.data?.code, check: label })); ensure(result.ok, label); return result.data; }
function apiDenied(result, label) { ensure(result.status >= 400, label); noPrivate(result.data, "Denied API leaked private data"); ensure(result.headers.get("cache-control")?.includes("no-store"), "Denied API must be no-store"); }

if (phase === "seed") {
  group = "seed";
  sql(`update public.student_consents set policy_version='2026-08-28' where student_user_id in (${["student-a1", "student-a2", "student-b1", "adult-a"].map((n) => `${literal(id(n))}::uuid`).join(",")});
    insert into public.teacher_student_assignments(id,school_id,teacher_user_id,student_user_id,assigned_by,status) values(gen_random_uuid(),${literal(state.schoolA)},${literal(id("teacher-a"))},${literal(id("student-a2"))},${literal(id("admin"))},'active');
    delete from public.sweet_records where user_id=${literal(id("student-a2"))};`);
  const anchor = Date.now() - 120_000;
  const rows = Array.from({ length: 1205 }, (_, i) => ({ id: randomUUID(), user_id: id("student-a2"), school_id: i % 3 === 0 ? null : i % 3 === 1 ? state.schoolB : state.schoolA,
    records: canonical(`PRIVATE_HISTORY_${i}`, i % 5 === 0 ? "一般" : "比较好"), summary: `PRIVATE_SINGLE_SUMMARY_${i}`, small_step: "PRIVATE_EXCLUDED_AI_STEP", recommended_next_tool: "PRIVATE_EXCLUDED_TOOL", created_at: new Date(anchor - i * 86400_000).toISOString() }));
  state.records.long = rows.map((r) => r.id);
  const duplicate = { ...rows[13], id: randomUUID(), records: canonical("PRIVATE_CONFLICT") };
  const unknown = { ...rows[0], id: randomUUID(), created_at: new Date(anchor + 1).toISOString(), records: canonical("PRIVATE_UNKNOWN", "UNKNOWN_OPTION") };
  const undated = { ...rows[0], id: randomUUID(), created_at: "infinity" };
  rows.push(duplicate, unknown, undated); state.records.unknown = unknown.id; state.records.undated = undated.id;
  sql(`insert into public.sweet_records(id,user_id,school_id,records,summary,small_step,recommended_next_tool,created_at)
    select id,user_id,school_id,records,summary,small_step,recommended_next_tool,created_at from jsonb_to_recordset(${literal(JSON.stringify(rows))}::jsonb) as r(id uuid,user_id uuid,school_id uuid,records jsonb,summary text,small_step text,recommended_next_tool text,created_at timestamptz);`);
  for (const [name, school] of [["student-a1", state.schoolA], ["student-a2", state.schoolA], ["student-b1", state.schoolB]]) await issue(name, school);
  privateWrite(v2File, state);
  console.log(JSON.stringify({ phase, syntheticAccounts: names.length, schools: 2, historyDates: 1205, physicalLongRows: rows.length, checks }));
} else if (phase === "verify") {
  group = "catalog";
  const tables = ["school_report_enrollments", "school_report_detail_states", "school_report_sharing_events", "school_report_mode_access_audit"];
  for (const table of tables) {
    same(sql(`select relrowsecurity from pg_class where oid='public.${table}'::regclass`), "t", "New table must retain RLS");
    for (const role of ["anon", "authenticated"]) for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) same(sql(`select has_table_privilege('${role}','public.${table}','${privilege}')`), "f", "Client table grant present");
    for (const actor of names) ensure(!(await rest(`/rest/v1/${table}?select=*`, actor)).ok, "Direct Data API table access must deny all client roles");
  }
  const functions = ["issue_school_report_enrollment", "end_school_report_enrollment", "read_school_report_access", "set_school_report_details", "read_school_report_trend", "read_school_report_details", "validate_school_report_view", "purge_expired_school_report_metadata"];
  for (const fn of functions) {
    same(sql(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='${fn}' and not prosecdef`), "1", "Business RPC must be single SECURITY INVOKER");
    for (const role of ["anon", "authenticated"]) same(sql(`select bool_or(has_function_privilege('${role}',oid,'EXECUTE')) from pg_proc where pronamespace='public'::regnamespace and proname='${fn}'`), "f", "Client RPC grant present");
  }
  for (const fn of ["create_report_authorization", "revoke_report_authorization", "lock_report_authorization", "read_report_summary"]) same(sql(`select bool_or(has_function_privilege('service_role',oid,'EXECUTE')) from pg_proc where pronamespace='public'::regnamespace and proname='${fn}'`), "f", "Legacy RPC remains executable");
  same(sql("select count(*) from pg_constraint where conrelid='public.guardian_student_links'::regclass and conname='pilot_guardian_links_inactive'"), "1", "Guardian constraint must remain installed");

  group = "automatic-trend-and-whitelist";
  const own = await access("student-a2"); ensure(own.owner.detailsEnabled === false, "Detail default must be off");
  ensure(own.owner.recipients.length === 1 && own.owner.recipients[0].id === id("teacher-a"), "Only current assigned teacher is in recipient set");
  const first = ready(await trend("student-a2"), "Automatic trend must not require student enable"); noPrivate(first.report, "Trend leaked notes or summary");
  ensure(first.report.version === "sweet-comprehensive-report-v2" && first.report.recent.days7 && first.report.recent.days30 && first.report.longTerm.unit === "month", "Composite report shape missing");
  ensure(first.report.longTerm.hasMore, "1205-day timeline must continue beyond first bin page");
  denied(await details("student-a2"), "Teacher detail off must deny");
  ensure(ready(await details("student-a2", "student-a2"), "Owner off preview must remain available").report.items.length > 0, "Owner preview empty");
  for (const actor of ["teacher-b", "guardian-linked", "guardian-unrelated", "guardian-b", "school-lead", "admin", "student-a1", "adult-a"]) {
    denied(await trend("student-a2", actor), "Unassigned role obtained trend"); denied(await details("student-a2", actor), "Unassigned role obtained detail");
    denied(await rpc("set_school_report_details", { p_actor_user_id: id(actor), p_enrollment_id: state.enrollments["student-a2"], p_enabled: true, p_request_id: randomUUID(), p_expected_detail_revision: own.owner.detailRevision, p_expected_recipient_epoch: own.owner.recipientEpoch, p_notice_version: "sweet-details-2026-10-28", p_confirmed: true }), "Non-owner opened detail");
  }
  ready(await toggle("student-a2", true), "Owner one-click ON failed");
  let page = ready(await details("student-a2"), "Enabled details unavailable");
  const dates = new Set(), keys = new Set(); let undated = 0, noteSeen = false, summarySeen = false, pages = 0;
  const fixedAsOf = page.context.asOf;
  for (;;) {
    pages++;
    for (const item of page.report.items) {
      ensure(!keys.has(item.key), "Detail pages duplicated an item"); keys.add(item.key);
      if (item.date) { ensure(!dates.has(item.date), "Date repeated across detail pages"); dates.add(item.date); } else undated++;
      noteSeen ||= JSON.stringify(item).includes("PRIVATE_HISTORY_1204"); summarySeen ||= JSON.stringify(item).includes("PRIVATE_SINGLE_SUMMARY_1204");
      ensure(!JSON.stringify(item).includes("PRIVATE_EXCLUDED"), "Detailed DTO included AI step or recommended tool");
    }
    if (!page.report.hasMore) break;
    const position = page.report.nextPosition;
    page = ready(await details("student-a2", "teacher-a", { p_as_of: fixedAsOf, p_phase: position.phase, p_before_day: position.beforeDate ?? null, p_before_id: position.afterId ?? null }), "Detail continuation failed");
    ensure(pages < 100, "Detail paging did not terminate");
  }
  same(dates.size, 1205, "All retained daily history must span beyond 1000 rows"); same(undated, 1, "Unsupported date placeholder missing"); ensure(noteSeen && summarySeen, "Oldest supplementary text and saved summary missing");

  group = "toggle-idempotency-and-source";
  const before = (await access("student-a2")).owner;
  const oldRequest = randomUUID();
  const onArgs = { p_actor_user_id: id("student-a2"), p_enrollment_id: before.enrollmentId, p_enabled: true, p_request_id: oldRequest, p_expected_detail_revision: before.detailRevision, p_expected_recipient_epoch: before.recipientEpoch, p_notice_version: "sweet-details-2026-10-28", p_confirmed: true };
  ready(await rpc("set_school_report_details", onArgs), "Idempotent ON first request failed");
  ready(await toggle("student-a2", false), "OFF failed");
  const replay = ready(await rpc("set_school_report_details", onArgs), "ON retry acknowledgement failed"); ensure(replay.replayed && replay.enabled === false, "Old ON replay reopened details");
  denied(await rpc("set_school_report_details", { ...onArgs, p_request_id: randomUUID() }), "Old expected revision accepted");
  denied(await rpc("set_school_report_details", { ...onArgs, p_enabled: false }), "Same request UUID accepted different command");
  const preOffRevision = (await access("student-a2")).owner.detailRevision; ready(await toggle("student-a2", false), "OFF when already off failed"); ensure((await access("student-a2")).owner.detailRevision > preOffRevision, "OFF did not invalidate queued ON");
  const newId = randomUUID(); sql(`insert into public.sweet_records(id,user_id,school_id,records,summary,created_at) values(${literal(newId)},${literal(id("student-a2"))},null,${literal(JSON.stringify(canonical("PRIVATE_OFF_PERIOD")))}::jsonb,'PRIVATE_OFF_PERIOD_SUMMARY',clock_timestamp());`);
  denied(await details("student-a2"), "Off-period record leaked while OFF"); ready(await toggle("student-a2", true), "Re-enable failed"); ensure(JSON.stringify(ready(await details("student-a2"), "Re-enabled detail failed").report).includes("PRIVATE_OFF_PERIOD"), "Re-enable omitted off-period history");
  const oldView = ready(await trend("student-a2"), "View context failed").context;
  sql(`delete from public.sweet_records where id=${literal(newId)};`);
  const validation = await rpc("validate_school_report_view", { p_actor_user_id: id("teacher-a"), p_enrollment_id: oldView.enrollmentId, p_mode: "detail", p_student_id: oldView.studentId, p_as_of: oldView.asOf, p_source_revision: oldView.sourceRevision, p_recipient_epoch: oldView.recipientEpoch, p_detail_revision: oldView.detailRevision, p_expires_at: oldView.expiresAt });
  denied(validation, "Deleted source kept old version valid");

  group = "relationship-reset-and-renewal";
  const assignment = sql(`select id from public.teacher_student_assignments where student_user_id=${literal(id("student-a2"))} and teacher_user_id=${literal(id("teacher-a"))} and status='active' limit 1`);
  sql(`update public.teacher_student_assignments set status='revoked' where id=${literal(assignment)};`);
  denied(await trend("student-a2"), "Revoked teacher read trend with old session");
  ensure((await access("student-a2")).owner.detailsEnabled === false, "Recipient removal did not reset detail");
  sql(`update public.teacher_student_assignments set status='active' where id=${literal(assignment)};`);
  ensure((await access("student-a2")).owner.detailsEnabled === false, "Relationship restoration revived details"); ready(await trend("student-a2"), "Restored current relation did not receive automatic trend");
  const oldEnrollment = state.enrollments["student-a2"];
  await issue("student-a2", state.schoolA);
  ensure(state.enrollments["student-a2"] !== oldEnrollment, "Renewal reused old enrollment ID");
  denied(await rpc("read_school_report_trend", { p_actor_user_id: id("teacher-a"), p_enrollment_id: oldEnrollment }), "Old enrollment revived after renewal");
  ensure((await access("student-a2")).owner.detailsEnabled === false, "Renewal did not reset details");
  ready(await toggle("student-a2", true), "Restore active fixture ON failed");
  privateWrite(v2File, state);
  writeFileSync(evidencePath, JSON.stringify({ date: "2026-10-28", phase, status: "passed", checks, groups, syntheticAccounts: names.length, schools: 2, historyDates: 1205, historyPages: pages,
    scope: "Disposable local-only real JWT/Data API/RPC/database verification; no formal Supabase, real OTP/email, production or guardian positive workflow." }, null, 2) + "\n");
  console.log(JSON.stringify({ phase, status: "passed", checks, groups, historyDates: dates.size, pages }));
} else {
  group = "http";
  apiDenied(await api("/api/reports/access", null), "Missing bearer accepted");
  for (const actor of ["guardian-linked", "guardian-unrelated", "school-lead", "admin", "teacher-b", "student-a1"]) apiDenied(await api(`/api/reports/current?enrollmentId=${state.enrollments["student-a2"]}`, actor), "Unrelated role passed HTTP report boundary");
  const first = success(await api(`/api/reports/current?enrollmentId=${state.enrollments["student-a2"]}`, "teacher-a"), "Actual teacher HTTP trend failed"); noPrivate(first, "Actual trend API leaked private text");
  ensure(first.viewToken && first.longTerm.nextCursor, "Encrypted report continuation missing");
  ensure(!JSON.stringify(first).includes("sourceRevision"), "Source count leaked in public DTO");
  const second = success(await api("/api/reports/history", "teacher-a", "POST", { enrollmentId: state.enrollments["student-a2"], cursor: first.longTerm.nextCursor }), "Trend continuation HTTP failed"); same(second.asOf, first.asOf, "Timeline page changed asOf");
  const detail = success(await api("/api/reports/details", "teacher-a", "POST", { enrollmentId: state.enrollments["student-a2"], viewToken: first.viewToken }), "Actual detail HTTP failed");
  ensure(detail.items.length && detail.items.every((i) => !uuidPattern.test(i.key)), "Source UUID leaked as public detail key");
  apiDenied(await api("/api/reports/details", "teacher-b", "POST", { enrollmentId: state.enrollments["student-a2"], viewToken: first.viewToken }), "View token crossed actors");
  apiDenied(await api("/api/reports/details", "teacher-a", "POST", { enrollmentId: state.enrollments["student-a2"], viewToken: first.viewToken, cursor: first.longTerm.nextCursor }), "Trend cursor read detail");
  const on = success(await api("/api/reports/access", "student-a2"), "Owner access HTTP failed").owner;
  const offCommand = { enrollmentId: on.enrollmentId, enabled: false, requestId: randomUUID() };
  success(await api("/api/reports/details-setting", "student-a2", "POST", offCommand), "Actual student OFF HTTP failed");
  apiDenied(await api("/api/reports/details", "teacher-a", "POST", { enrollmentId: on.enrollmentId, viewToken: first.viewToken, cursor: detail.nextCursor }), "Old cursor read after OFF");
  const offTrend = success(await api(`/api/reports/current?enrollmentId=${on.enrollmentId}`, "teacher-a"), "Trend must continue after detail OFF"); ensure(offTrend.detailsState === "off", "OFF trend state incorrect");
  const owner = success(await api("/api/reports/access", "student-a2"), "Owner fresh state failed").owner;
  const command = { enrollmentId: owner.enrollmentId, enabled: true, requestId: randomUUID(), expectedDetailRevision: owner.detailRevision, expectedRecipientEpoch: owner.recipientEpoch, policyVersion: "sweet-details-2026-10-28", confirmed: true };
  apiDenied(await api("/api/reports/details-setting", "teacher-a", "POST", command), "Teacher opened student detail via HTTP");
  apiDenied(await api("/api/reports/details-setting", "student-a2", "POST", { ...command, actorId: id("admin") }), "Actor injection accepted");
  apiDenied(await api("/api/reports/details-setting", "student-a2", "POST", command, { Origin: "https://foreign.example.invalid" }), "Foreign origin accepted");
  success(await api("/api/reports/details-setting", "student-a2", "POST", command), "HTTP re-enable failed");
  const report = success(await api(`/api/reports/current?enrollmentId=${owner.enrollmentId}`, "teacher-a"), "Fresh report unavailable");
  const injected = await api("/api/reports/authorizations", "student-a2", "POST", { recipientId: id("teacher-a"), confirmed: true }); apiDenied(injected, "Legacy create still available");
  apiDenied(await api(`/api/reports/current?enrollmentId=${owner.enrollmentId}&role=admin`, "teacher-a"), "Extra query role accepted");
  apiDenied(await api("/api/reports/details", "teacher-a", "POST", { enrollmentId: owner.enrollmentId, viewToken: `${report.viewToken}x` }), "Tampered view token accepted");
  console.log(JSON.stringify({ phase, status: "passed", checks, groups }));
  writeFileSync("deliverables/comprehensive-reports-2026-10-28/http-verification.json", JSON.stringify({ date: "2026-10-28", phase, status: "passed", checks, groups, scope: "Actual local Auth bearer → Pages API → RPC/database. No remote/production operations." }, null, 2) + "\n");
}
