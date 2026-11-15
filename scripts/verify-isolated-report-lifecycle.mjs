import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, lstatSync, realpathSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const runtime = "/private/tmp/youthtempo-isolated-reports-v2-20261028";
const container = "supabase_db_youthtempo-isolated-reports-v2-20261028";
const dockerContext = "colima-youthtempo-e2e";
const evidenceFile = resolve("deliverables/comprehensive-reports-2026-10-28/lifecycle-verification.json");
const [statusFile = `${runtime}/status.json`, sessionsFile = `${runtime}/sessions.json`, fixtureFile = `${runtime}/fixture-state.json`, v2File = `${runtime}/v2-state.json`, phase = "verify"] = process.argv.slice(2);
let checks = 0; let group = "target-guards"; const groups = {}; const activeTransactions = new Set();
function ensure(value, label) { checks++; groups[group] = (groups[group] || 0) + 1; if (!value) throw new Error(label); }
function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function uuid(value) { ensure(typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value), "Invalid synthetic fixture identifier"); return value; }
function privateJson(file, expectedName) {
  ensure(basename(file) === expectedName && realpathSync(dirname(resolve(file))) === runtime, "Only this batch's dedicated private input files are allowed");
  const stat = lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0 && dirname(realpathSync(file)) === runtime, "Private JSON must be single-link local regular 0600 files");
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error("Private JSON is invalid; contents withheld"); }
}
const status = privateJson(statusFile, "status.json");
const accounts = privateJson(sessionsFile, "sessions.json");
const fixture = privateJson(fixtureFile, "fixture-state.json");
const v2 = privateJson(v2File, "v2-state.json");
ensure(status.API_URL === "http://127.0.0.1:55321" && v2.version === "comprehensive-isolated-v2", "Only the registered disposable v2 API and state are allowed");
ensure(["verify", "auth-delete"].includes(phase), "Unknown lifecycle phase");
const names = ["student-a1", "student-a2", "student-b1", "adult-a", "teacher-a", "teacher-b", "guardian-linked", "guardian-unrelated", "guardian-b", "school-lead", "admin"];
for (const name of names) { uuid(accounts[name]?.id); ensure(accounts[name].email === `yt-reports-${name}@example.invalid`, "Only this batch's synthetic account set is permitted"); }
const id = (name) => accounts[name].id;
const schoolA = uuid(fixture.schoolA); const schoolB = uuid(fixture.schoolB);
const subject = id("student-a1");
function query(statement) {
  try { return execFileSync("docker", ["--context", dockerContext, "exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"],
    { input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }).trim(); }
  catch { throw new Error("A controlled disposable SQL operation failed; SQL and database details withheld"); }
}
const uidList = names.map((name) => `${literal(id(name))}::uuid`).join(",");
ensure(query(`select count(*) from auth.users where id in (${uidList})`) === "11", "Selected Docker container must contain this exact synthetic identity set before lifecycle acceptance");
ensure(query(`select count(*) from public.school_report_enrollments where student_user_id not in (${uidList})`) === "0", "Unknown enrollment owners prohibit lifecycle or cleanup operations");

async function request(path, actor = "service", method = "POST", body) {
  const url = new URL(path, status.API_URL); ensure(url.origin === status.API_URL, "A lifecycle request attempted to leave the local API");
  const token = actor === "service" ? status.SERVICE_ROLE_KEY : accounts[actor].accessToken;
  let response;
  try { response = await fetch(url, { method, signal: AbortSignal.timeout(20_000), headers: { apikey: path.startsWith("/auth/v1/admin/") ? status.SERVICE_ROLE_KEY : status.ANON_KEY,
    Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error("A controlled local request failed; credentials and payload withheld"); }
  let data = null; const text = await response.text();
  if (text) { try { data = JSON.parse(text); } catch { throw new Error("A local result was not JSON; body withheld"); } }
  return { status: response.status, ok: response.ok, data };
}
const rpc = (name, args, actor = "service") => request(`/rest/v1/rpc/${name}`, actor, "POST", args);
function ready(result, label) { ensure(result.ok && result.data?.status === "ready", label); return result.data; }
function denied(result, label) { ensure(!result.ok || ["denied", "expired", "refresh_required"].includes(result.data?.status), label); }
function sqlCall(name, args) { return `public.${name}(${args.map((value) => value === null ? "null" : typeof value === "boolean" ? String(value) : typeof value === "number" ? String(value) : literal(value)).join(",")})`; }
function json(value, label) { try { return JSON.parse(value); } catch { throw new Error(`${label}: controlled result was not JSON`); } }
const enrollArgs = (actor = id("admin"), requestId = randomUUID()) => ({ p_actor_user_id: actor, p_student_user_id: subject, p_school_id: schoolA,
  p_basis_reference: "synthetic-lifecycle-current-purpose", p_notice_reference: "synthetic-lifecycle-current-notice",
  p_school_registered_until: new Date(Date.now() + 35 * 86_400_000).toISOString(), p_basis_valid_until: new Date(Date.now() + 35 * 86_400_000).toISOString(), p_request_id: requestId });
function issueSql(actor = id("admin"), target = subject, school = schoolA) {
  return sqlCall("issue_school_report_enrollment", [actor, target, school, "synthetic-lifecycle-purpose", "synthetic-lifecycle-notice", new Date(Date.now() + 35 * 86_400_000).toISOString(), new Date(Date.now() + 35 * 86_400_000).toISOString(), randomUUID()]);
}
function proofSql(actor = id("admin")) { return sqlCall("issue_report_minor_eligibility", [actor, subject, schoolA, "school_verified", "synthetic-lifecycle-age", new Date(Date.now() + 40 * 86_400_000).toISOString()]); }
function validateArgs(context, mode = "detail") { return { p_actor_user_id: context.actorId, p_enrollment_id: context.enrollmentId, p_mode: mode, p_student_id: context.studentId,
  p_as_of: context.asOf, p_source_revision: context.sourceRevision, p_recipient_epoch: context.recipientEpoch, p_detail_revision: context.detailRevision, p_expires_at: context.expiresAt }; }
let enrollmentId = uuid(v2.enrollments["student-a1"]);
const detailArgs = () => ({ p_actor_user_id: id("teacher-a"), p_enrollment_id: enrollmentId });
async function ownerState() { const state = ready(await rpc("read_school_report_access", { p_actor_user_id: subject }), "Owner access failed").owner;
  ensure(state?.enrollmentId === enrollmentId, "The dedicated subject's current enrollment changed unexpectedly"); return state; }
async function toggle(enabled) { const state = await ownerState(); return rpc("set_school_report_details", { p_actor_user_id: subject, p_enrollment_id: enrollmentId, p_enabled: enabled, p_request_id: randomUUID(),
  ...(enabled ? { p_expected_detail_revision: state.detailRevision, p_expected_recipient_epoch: state.recipientEpoch, p_notice_version: "sweet-details-2026-10-28", p_confirmed: true } : {}) }); }
function canonical() { return [
  { id: "sleep", fields: [{ id: "quality", value: "比较好" }, { id: "note", value: "LIFECYCLE_PRIVATE_SOURCE" }] },
  { id: "wake", fields: [{ id: "state", value: "比较有精神" }] }, { id: "eat", fields: [{ id: "rhythm", value: "比较规律" }] },
  { id: "exercise", fields: [{ id: "duration", value: "10–19 分钟" }] }, { id: "task", fields: [{ id: "engagement", value: "比较顺利" }] },
]; }
async function transaction(label) {
  const child = spawn("docker", ["--context", dockerContext, "exec", "-i", "-e", `PGAPPNAME=report_lifecycle_${randomUUID()}`, container,
    "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout }); child.stderr.on("data", () => {});
  let pending = null; let closed = false;
  const fail = () => { closed = true; if (pending) { clearTimeout(pending.timer); pending.reject(new Error(`${label}: controlled transaction failed; details withheld`)); pending = null; } };
  child.on("error", fail); child.on("close", fail); child.stdin.on("error", fail);
  lines.on("line", (line) => { if (!pending) return; if (line === pending.marker) { const done = pending; pending = null; clearTimeout(done.timer); done.resolve(done.lines.join("\n")); } else pending.lines.push(line); });
  const handle = { async command(statement) {
    ensure(!closed && !pending, `${label}: transaction is unavailable`);
    return new Promise((resolveResult, reject) => { const marker = `LIFECYCLE_BARRIER_${randomUUID().replaceAll("-", "")}`;
      pending = { marker, resolve: resolveResult, reject, lines: [], timer: setTimeout(() => { pending = null; child.kill("SIGTERM"); reject(new Error(`${label}: controlled transaction timed out`)); }, 12_000) };
      child.stdin.write(`${statement}\n\\echo ${marker}\n`);
    });
  }, async finish(commit = false) { if (!closed) { await handle.command(commit ? "commit;" : "rollback;"); child.stdin.end(); lines.close(); } activeTransactions.delete(handle); },
  abort() { child.stdin.end("rollback;\n"); child.kill("SIGTERM"); lines.close(); activeTransactions.delete(handle); } };
  activeTransactions.add(handle); await handle.command("begin;"); return handle;
}
async function rolledBack(label, action) { const tx = await transaction(label); try { await action(tx); await tx.finish(); } catch (error) { tx.abort(); throw error; } }
async function blocked(name, promise) {
  let complete = false; promise.then(() => { complete = true; }, () => { complete = true; });
  const end = Date.now() + 8_000;
  while (Date.now() < end) {
    ensure(!complete, `${name}: operation bypassed a held transaction lock`);
    if (Number(query(`select count(*) from pg_stat_activity where state='active' and wait_event_type='Lock' and query like ${literal(`%${name}%`)}`)) > 0) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 75));
  }
  throw new Error(`${name}: expected real lock wait was not observed`);
}

async function lifecycleChanges() {
  group = "base-proof-and-trusted-issuer";
  await rolledBack("independent-base-school", async (tx) => {
    await tx.command(`update public.student_consents set school_id=null,consent_basis='student_self_pilot',guardian_user_id=null,guardian_consented_at=null where student_user_id=${literal(subject)};`);
    const proof = json(await tx.command(`select to_jsonb(${proofSql()})::text;`), "Personal base age proof"); uuid(proof);
    const issued = json(await tx.command(`select ${issueSql()}::text;`), "Independent report purpose"); ensure(issued.status === "ready", "Personal base with no school must support separately verified current school purpose");
    const read = json(await tx.command(`select ${sqlCall("read_school_report_trend", [id("teacher-a"), issued.enrollmentId])}::text;`), "Independent automatic trend"); ensure(read.status === "ready", "Separate purpose did not establish the scoped automatic trend");
    ensure(await tx.command(`select guardian_user_id is null and guardian_consented_at is null from public.student_consents where student_user_id=${literal(subject)};`) === "t", "Age/purpose verification manufactured guardian account confirmation");
  });
  for (const oldSchool of [schoolB]) await rolledBack("previous-base-school", async (tx) => {
    await tx.command(`update public.student_consents set school_id=${literal(oldSchool)} where student_user_id=${literal(subject)};`);
    uuid(json(await tx.command(`select to_jsonb(${proofSql()})::text;`), "Previous-school base proof"));
  });
  await rolledBack("invalid-guardian-base", async (tx) => {
    ensure(await tx.command(`select private.school_report_base_valid(jsonb_populate_record(null::public.student_consents,
      (select to_jsonb(c)||jsonb_build_object('consent_basis','student_guardian','guardian_user_id',null,'guardian_consented_at',null) from public.student_consents c where student_user_id=${literal(subject)})),clock_timestamp());`) === "f", "Malformed guardian base was accepted by shared predicate");
    await tx.command(`update public.student_consents set guardian_consented_at=clock_timestamp()+interval '1 day' where student_user_id=${literal(subject)};`);
    ensure(json(await tx.command(`select ${issueSql()}::text;`), "Future guardian base").status === "denied", "A future guardian confirmation established report access");
    await tx.command(`do $guard$ begin perform ${proofSql()};raise exception 'invalid_base_accepted';exception when insufficient_privilege then null;end $guard$;`);
  });
  for (const field of ["role='学生'", `school_id=${literal(schoolB)}`]) await rolledBack("spoofed-school-operator", async (tx) => {
    await tx.command(`update public.profiles set ${field} where id=${literal(id("school-lead"))};`);
    ensure(json(await tx.command(`select ${issueSql(id("school-lead"))}::text;`), "Mismatched issuer").status === "denied", "School membership alone enabled enrollment issuance");
    ensure(json(await tx.command(`select ${sqlCall("end_school_report_enrollment", [id("school-lead"), enrollmentId, randomUUID()])}::text;`), "Mismatched termination actor").status === "denied", "School membership alone enabled termination");
    await tx.command(`do $guard$ begin perform ${proofSql(id("school-lead"))};raise exception 'invalid_operator_accepted';exception when insufficient_privilege then null;end $guard$;`);
  });
  group = "proof-delete-and-cutoff";
  await rolledBack("unrelated-proof-deletion", async (tx) => {
    const historical = randomUUID();
    await tx.command(`insert into public.minor_eligibility_assertions(id,student_user_id,school_id,verified_by,verification_basis,source_reference,verified_at,valid_until,revoked_at)
     values(${literal(historical)},${literal(subject)},${literal(schoolA)},${literal(id("admin"))},'school_verified','synthetic-old-unbound',clock_timestamp()-interval '1 day',clock_timestamp()+interval '40 days',clock_timestamp());
     delete from public.minor_eligibility_assertions where id=${literal(historical)};`);
    ensure(json(await tx.command(`select ${sqlCall("read_school_report_trend", [id("teacher-a"), enrollmentId])}::text;`), "Unbound proof deletion").status === "ready", "Deleting an unused old proof terminated unrelated current access");
  });
  await rolledBack("current-proof-deletion", async (tx) => {
    await tx.command(`delete from public.minor_eligibility_assertions where id=(select minor_assertion_id from public.school_report_enrollments where id=${literal(enrollmentId)});`);
    ensure(json(await tx.command(`select ${sqlCall("read_school_report_trend", [id("teacher-a"), enrollmentId])}::text;`), "Bound proof deletion").status === "denied", "Deleting the bound proof left content available");
    ensure(await tx.command(`select status<>'active' and minor_assertion_id is null from public.school_report_enrollments where id=${literal(enrollmentId)};`) === "t", "Bound-proof FK cleanup did not preserve terminal invalidation");
  });
  await rolledBack("trusted-minor-cutoff", async (tx) => {
    const cutoff = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const shortProof = sqlCall("issue_report_minor_eligibility", [id("admin"), subject, schoolA, "school_verified", "synthetic-lifecycle-short-age", cutoff]);
    const proofId = json(await tx.command(`select to_jsonb(${shortProof})::text;`), "Short age cutoff proof"); uuid(proofId);
    const issued = json(await tx.command(`select ${issueSql()}::text;`), "Cutoff-bound enrollment"); ensure(issued.status === "ready", "Trusted cutoff did not support a bounded enrollment");
    ensure(await tx.command(`select e.expires_at=q.valid_until and e.expires_at<=e.effective_at+interval '30 days' and e.expires_at<=e.school_registered_until and e.expires_at<=e.basis_valid_until
      from public.school_report_enrollments e join public.minor_eligibility_assertions q on q.id=e.minor_assertion_id where e.id=${literal(issued.enrollmentId)};`) === "t", "Enrollment outlived the trusted minor cutoff or processing-material deadline");
    ensure(json(await tx.command(`select ${sqlCall("read_school_report_trend", [id("teacher-a"), enrollmentId])}::text;`), "Replaced proof old enrollment").status !== "ready", "Age proof replacement resurrected the prior enrollment");
  });
  group = "terminal-lifecycle-no-resurrection";
  const mutations = [
    ["base-withdraw", `update public.student_consents set status='withdrawn' where student_user_id=${literal(subject)};`, `update public.student_consents set status='active' where student_user_id=${literal(subject)};`],
    ["adult-transition", `update public.student_consents set age_band='18_plus',consent_basis='adult_self',guardian_user_id=null,guardian_consented_at=null where student_user_id=${literal(subject)};`, `update public.student_consents set age_band='14_17',consent_basis='student_guardian',guardian_user_id=${literal(id("guardian-linked"))},guardian_consented_at=student_assented_at where student_user_id=${literal(subject)};`],
    ["student-school", `update public.profiles set school_id=${literal(schoolB)} where id=${literal(subject)};`, `update public.profiles set school_id=${literal(schoolA)} where id=${literal(subject)};`],
    ["student-role", `update public.profiles set role='专业支持者' where id=${literal(subject)};`, `update public.profiles set role='学生' where id=${literal(subject)};`],
    ["school-pause", `update public.schools set status='paused' where id=${literal(schoolA)};`, `update public.schools set status='active' where id=${literal(schoolA)};`],
  ];
  for (const [label, change, restore] of mutations) await rolledBack(label, async (tx) => {
    await tx.command(change); const lost = json(await tx.command(`select ${sqlCall("read_school_report_trend", [id("teacher-a"), enrollmentId])}::text;`), label); ensure(["denied", "expired"].includes(lost.status), `${label}: changed dependency retained content`);
    await tx.command(restore); const old = json(await tx.command(`select ${sqlCall("read_school_report_trend", [id("teacher-a"), enrollmentId])}::text;`), label); ensure(["denied", "expired"].includes(old.status), `${label}: restoration revived an old enrollment`);
  });
  await rolledBack("explicit-exit", async (tx) => {
    const result = json(await tx.command(`select ${sqlCall("end_school_report_enrollment", [subject, enrollmentId, randomUUID()])}::text;`), "Owner exit"); ensure(result.status === "ready" && result.ended, "Owner exit failed");
    ensure(json(await tx.command(`select ${sqlCall("read_school_report_trend", [id("teacher-a"), enrollmentId])}::text;`), "Exited enrollment").status === "denied", "Exited enrollment retained content");
    ensure(json(await tx.command(`select ${sqlCall("set_school_report_details", [subject, enrollmentId, true, 0, 0, randomUUID(), "sweet-details-2026-10-28", true])}::text;`), "Exited enrollment switch").status !== "ready", "Exited enrollment reopened through detail switch");
  });
  await rolledBack("school-exit-operation", async (tx) => {
    await tx.command(`select public.exit_school_pilot(${literal(schoolA)},${literal(id("admin"))},'Synthetic school lifecycle acceptance only','synthetic-lifecycle');`);
    ensure(json(await tx.command(`select ${sqlCall("read_school_report_trend", [id("teacher-a"), enrollmentId])}::text;`), "Actual school exit transaction").status === "denied", "School exit did not terminate report access");
  });
}

async function concurrency() {
  group = "read-first-and-off-first-locks";
  ready(await toggle(true), "Concurrency setup ON failed");
  const first = await transaction("read-first");
  try {
    const read = json(await first.command(`set local role service_role;select ${sqlCall("read_school_report_details", [id("teacher-a"), enrollmentId])}::text;`), "Read-first detail"); ensure(read.status === "ready", "Read-first transaction lacked current detail permission");
    const stop = rpc("set_school_report_details", { p_actor_user_id: subject, p_enrollment_id: enrollmentId, p_enabled: false, p_request_id: randomUUID() }); await blocked("set_school_report_details", stop); await first.finish(true);
    ready(await stop, "Waiting OFF failed after the authorized read completed"); denied(await rpc("read_school_report_details", detailArgs()), "OFF after completed read left future details available");
  } catch (error) { first.abort(); throw error; }
  ready(await toggle(true), "OFF-first setup ON failed");
  const stopFirst = await transaction("off-first");
  try {
    const stopped = json(await stopFirst.command(`set local role service_role;select ${sqlCall("set_school_report_details", [subject, enrollmentId, false, null, null, randomUUID()])}::text;`), "OFF-first mutation"); ensure(stopped.status === "ready" && stopped.enabled === false, "OFF-first transaction failed");
    const waiting = rpc("read_school_report_details", detailArgs()); await blocked("read_school_report_details", waiting); await stopFirst.finish(true);
    denied(await waiting, "Read waiting behind committed OFF returned detail content");
  } catch (error) { stopFirst.abort(); throw error; }
  group = "source-first-validation-lock";
  const prior = ready(await rpc("read_school_report_trend", detailArgs()), "Source version setup failed").context;
  const sourceId = randomUUID(); const source = await transaction("source-first");
  try {
    await source.command(`insert into public.sweet_records(id,user_id,school_id,records,summary,created_at) values(${literal(sourceId)},${literal(subject)},null,${literal(JSON.stringify(canonical()))}::jsonb,'LIFECYCLE_PRIVATE_SUMMARY',clock_timestamp());`);
    const waiting = rpc("validate_school_report_view", validateArgs(prior, "trend")); await blocked("validate_school_report_view", waiting); await source.finish(true);
    const result = await waiting; ensure(result.ok && result.data.status === "refresh_required", "Source change did not invalidate the older view after lock wait");
  } catch (error) { source.abort(); throw error; }
  finally { query(`delete from public.sweet_records where id=${literal(sourceId)} and user_id=${literal(subject)};`); }
  const after = await rpc("validate_school_report_view", validateArgs(prior, "trend")); ensure(after.ok && after.data.status === "refresh_required", "Returning the source set to its earlier content revived a stale view");
}

async function personalDataApi() {
  group = "personal-data-api-preserved";
  const start = "2019-05-01T16:00:00.000Z", end = "2019-05-02T16:00:00.000Z";
  const range = `user_id=eq.${subject}&created_at=gte.${encodeURIComponent(start)}&created_at=lt.${encodeURIComponent(end)}`;
  const before = await request(`/rest/v1/sweet_records?select=id&${range}`, "student-a1", "GET"); ensure(before.ok && before.data.length === 0, "Dedicated synthetic personal-save date is not empty; refusing to overwrite it");
  const records = [randomUUID(), randomUUID()];
  try {
    for (const [index, recordId] of records.entries()) {
      const result = await request("/rest/v1/sweet_records", "student-a1", "POST", { id: recordId, user_id: subject, school_id: null, records: canonical(), summary: "LIFECYCLE_PRIVATE_SUMMARY", created_at: index ? "2019-05-02T02:00:00.000Z" : "2019-05-02T01:00:00.000Z" });
      ensure(result.ok && result.data[0]?.id === recordId, "Authenticated owner could not save its personal SWEET under the existing base consent");
    }
    const read = await request(`/rest/v1/sweet_records?select=id,records,summary&${range}`, "student-a1", "GET"); ensure(read.ok && read.data.length === 2 && read.data.every((row) => Array.isArray(row.records) && row.summary === "LIFECYCLE_PRIVATE_SUMMARY"), "Owner personal read was reduced or blocked");
    const other = await request(`/rest/v1/sweet_records?select=id&id=in.(${records.join(",")})`, "teacher-a", "GET"); ensure(other.ok && other.data.length === 0, "Original SWEET rows became visible to the teacher");
    const forged = await request("/rest/v1/sweet_records", "student-a1", "POST", { id: randomUUID(), user_id: id("student-a2"), school_id: schoolA, records: canonical() }); ensure(!forged.ok, "Client supplied owner bypassed RLS");
    const removed = await request(`/rest/v1/sweet_records?${range}`, "student-a1", "DELETE"); ensure(removed.ok && removed.data.length === 2, "Owner could not delete the complete synthetic Shanghai-date set");
    const empty = await request(`/rest/v1/sweet_records?select=id&${range}`, "student-a1", "GET"); ensure(empty.ok && empty.data.length === 0, "Whole-date owner deletion did not remove the selected date");
  } finally { query(`delete from public.sweet_records where user_id=${literal(subject)} and id in(${records.map((value) => literal(value)).join(",")});`); }
}

async function expiryAndCleanup() {
  group = "natural-expiry-and-retention";
  await rolledBack("expiry-and-cleanup", async (tx) => {
    await tx.command(`select ${sqlCall("end_school_report_enrollment", [subject, enrollmentId, randomUUID()])};`);
    async function clone(age, statusValue = "active", terminal = "null") {
      const newId = randomUUID();
      await tx.command(`insert into public.school_report_enrollments(id,student_user_id,school_id,minor_assertion_id,issued_by,basis_reference,notice_reference,base_consent_snapshot,school_registered_until,basis_valid_until,effective_at,expires_at,status,terminal_at,terminal_reason,request_id)
       select ${literal(newId)},student_user_id,school_id,minor_assertion_id,issued_by,'synthetic-retention-purpose','synthetic-retention-notice',base_consent_snapshot,
       ${age}+interval '10 days',${age}+interval '10 days',${age}-interval '20 days',${age},${literal(statusValue)},${terminal},${statusValue === "active" ? "null" : "'dependency'"},${literal(randomUUID())}
       from public.school_report_enrollments where id=${literal(enrollmentId)};
       insert into public.school_report_detail_states(enrollment_id)values(${literal(newId)});`);
      return newId;
    }
    const natural = await clone("clock_timestamp()-interval '25 months'");
    const early = await clone("clock_timestamp()-interval '24 months'+interval '10 days'", "invalidated", "clock_timestamp()-interval '24 months'-interval '5 days'");
    const recent = await clone("clock_timestamp()-interval '1 day'", "invalidated", "clock_timestamp()-interval '2 days'");
    await tx.command(`insert into public.school_report_sharing_events(enrollment_id,actor_user_id,event_type,request_id)values(${literal(natural)},${literal(subject)},'issued',${literal(randomUUID())}),(${literal(early)},${literal(subject)},'invalidated',${literal(randomUUID())});
      insert into public.school_report_mode_access_audit(enrollment_id,actor_user_id,mode,outcome)values(${literal(natural)},${literal(id("teacher-a"))},'trend','ready'),(${literal(early)},${literal(id("teacher-a"))},'trend','ready');`);
    ensure(await tx.command(`select status='active' and terminal_at is null from public.school_report_enrollments where id=${literal(natural)};`) === "t", "Natural-expiry fixture was prematurely reconciled; it must exercise the active-status cleanup edge");
    const protectedCount = Number(await tx.command("select count(*) from public.school_report_enrollments where status='active' and expires_at>clock_timestamp();")); ensure(protectedCount >= 2, "Active unrelated enrollments must exist for cleanup protection");
    const cleaned = json(await tx.command("set local role service_role;select public.purge_expired_school_report_metadata()::text;reset role;"), "Metadata cleanup"); ensure(cleaned.status === "ready" && cleaned.enrollmentsDeleted >= 2, "Expired or early-terminal retention anchors were ignored");
    ensure(await tx.command(`select count(*) from public.school_report_enrollments where id in(${literal(natural)},${literal(early)});`) === "0", "Retention cleanup left eligible enrollment records");
    ensure(await tx.command(`select count(*) from public.school_report_sharing_events where enrollment_id in(${literal(natural)},${literal(early)});`) === "0", "Cleanup left eligible linked sharing events");
    ensure(await tx.command(`select count(*) from public.school_report_enrollments where id=${literal(recent)};`) === "1", "Cleanup deleted recent terminal metadata");
    ensure(Number(await tx.command("select count(*) from public.school_report_enrollments where status='active' and expires_at>clock_timestamp();")) === protectedCount, "Cleanup deleted unexpired active enrollments");
  });
  await rolledBack("expiry-denial", async (tx) => {
    await tx.command(`select ${sqlCall("end_school_report_enrollment", [subject, enrollmentId, randomUUID()])};`);
    const expired = randomUUID();
    await tx.command(`insert into public.school_report_enrollments(id,student_user_id,school_id,minor_assertion_id,issued_by,basis_reference,notice_reference,base_consent_snapshot,school_registered_until,basis_valid_until,effective_at,expires_at,request_id)
     select ${literal(expired)},student_user_id,school_id,minor_assertion_id,issued_by,'synthetic-expiry','synthetic-expiry-notice',base_consent_snapshot,clock_timestamp(),clock_timestamp(),clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',${literal(randomUUID())} from public.school_report_enrollments where id=${literal(enrollmentId)};
     insert into public.school_report_detail_states(enrollment_id)values(${literal(expired)});`);
    ensure(json(await tx.command(`select ${sqlCall("read_school_report_trend", [id("teacher-a"), expired])}::text;`), "Expired read").status === "expired", "Natural expiration waited for a scheduled job");
    ensure(await tx.command(`select terminal_at=expires_at from public.school_report_enrollments where id=${literal(expired)};`) === "t", "Natural expiry retention anchor was rewritten to read time");
  });
}

async function authDeletion() {
  group = "real-auth-delete-and-anonymization";
  const user = await request(`/auth/v1/admin/users/${uuid(subject)}`, "service", "GET"); ensure(user.ok && user.data.email === "yt-reports-student-a1@example.invalid", "Refusing deletion of a non-matching synthetic Auth identity");
  ready(await toggle(true), "Deletion fixture detail ON failed"); ready(await rpc("read_school_report_details", detailArgs()), "Deletion fixture detail read failed");
  const eventIds = query(`select coalesce(jsonb_agg(id),'[]')::text from public.school_report_sharing_events where enrollment_id=${literal(enrollmentId)};`);
  const auditIds = query(`select coalesce(jsonb_agg(id),'[]')::text from public.school_report_mode_access_audit where enrollment_id=${literal(enrollmentId)};`);
  const deleted = await request(`/auth/v1/admin/users/${uuid(subject)}`, "service", "DELETE"); ensure(deleted.ok, "Real Auth-admin deletion failed");
  for (const [table, field] of [["profiles", "id"], ["student_consents", "student_user_id"], ["sweet_records", "user_id"], ["minor_eligibility_assertions", "student_user_id"], ["school_report_enrollments", "student_user_id"]]) {
    ensure(query(`select count(*) from public.${table} where ${field}=${literal(subject)};`) === "0", "Auth deletion did not cascade an owned record category");
  }
  ensure(query(`select count(*) from public.school_report_detail_states where enrollment_id=${literal(enrollmentId)};`) === "0", "Auth deletion left detail state");
  ensure(query(`select count(*) from public.school_report_sharing_events where id in(select jsonb_array_elements_text(${literal(eventIds)}::jsonb)::uuid) and(enrollment_id is not null or actor_user_id is not null or request_id is not null or command_fingerprint is not null);`) === "0", "Auth deletion retained linkable sharing-event identifiers");
  ensure(query(`select count(*) from public.school_report_mode_access_audit where id in(select jsonb_array_elements_text(${literal(auditIds)}::jsonb)::uuid) and(enrollment_id is not null or actor_user_id is not null);`) === "0", "Auth deletion retained linkable access-audit identifiers");
  denied(await rpc("read_school_report_details", detailArgs()), "Teacher retained detail after owner Auth deletion");
  const stale = await request("/rest/v1/sweet_records?select=id", "student-a1", "GET"); ensure(!stale.ok || stale.data.length === 0, "Old owner JWT retained deleted records");
  ensure(query(`select count(*) from auth.users where id=${literal(id("student-a2"))};`) === "1", "Deletion affected the independent browser-validation subject");
}

function evidence(result, failed = false) {
  mkdirSync(dirname(evidenceFile), { recursive: true }); let previous = {};
  if (phase === "auth-delete") { try { previous = JSON.parse(readFileSync(evidenceFile, "utf8")); } catch { previous = {}; } }
  const output = { ...previous, date: "2026-10-28", scope: "Fixed disposable localhost-only report lifecycle acceptance", remoteProject: false, externalMail: false,
    constraintsDisabled: false, usesRealSqlTransactions: true, realAuthDeleteOnlyInFinalPhase: true, phase,
    ...(phase === "verify" ? { checks, groups, verificationPassed: !failed } : { authDeleteChecks: checks, authDeleteGroups: groups, authDeletePassed: !failed }),
    result, limitations: ["No production, physical-device, real-email or school-operation acceptance", "Off does not remotely erase a response already authorized before its transaction", "Cross-user or global lifecycle changes are rolled back; committed concurrency and owner-record tests use only disposable student-a1"] };
  writeFileSync(evidenceFile, JSON.stringify(output, null, 2) + "\n");
}
try {
  if (phase === "auth-delete") await authDeletion();
  else { await lifecycleChanges(); await concurrency(); await personalDataApi(); await expiryAndCleanup(); }
  evidence("passed"); console.log(JSON.stringify({ phase, checks, groups, status: "passed", remoteProject: false, sensitiveOutput: false }));
} catch (error) {
  for (const tx of activeTransactions) tx.abort();
  evidence("failed", true);
  console.error(`isolated lifecycle check failed: ${error instanceof Error ? error.message : "controlled operation failed"}`); process.exitCode = 1;
}
