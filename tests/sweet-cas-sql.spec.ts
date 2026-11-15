import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// Offline source-contract checks only. No SQL parser, PostgreSQL, Auth or network
// is invoked; these checks never establish database atomicity or RLS correctness.
const migration = readFileSync(resolve("supabase/migrations/20261031153645_sweet_atomic_scope_cas.sql"), "utf8");
const schema = readFileSync(resolve("supabase/schema.sql"), "utf8");
function fn(name: string) {
  const start = migration.indexOf(`create function ${name}(`);
  expect(start, `${name} must be defined`).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("$$;", start);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end + 3);
}
function before(source: string, first: string, later: string) {
  const a = source.indexOf(first), b = source.indexOf(later);
  expect(a, first).toBeGreaterThanOrEqual(0);
  expect(b, later).toBeGreaterThan(a);
}

const write = fn("public.sweet_scope_write");
const read = fn("public.sweet_scope_read");

test("SQL artifact is synchronized with schema and does not apply or backfill itself", () => {
  expect(schema.endsWith(migration)).toBe(true);
  expect(migration).toContain("values (true, 'closed')");
  expect(migration).not.toMatch(/^\s*(?:select|perform|call)\s+public\.sweet_scope_(?:backfill|open)\s*\(/mi);
  expect(migration).not.toMatch(/\b(?:dblink|http_post|cron\.schedule)\s*\(/i);
});

test("head is four-field non-content metadata with durable scope and Auth lifecycle", () => {
  const table = migration.slice(migration.indexOf("create table private.sweet_record_heads"), migration.indexOf("alter table private.sweet_record_heads"));
  expect(table).toContain("user_id uuid not null references auth.users(id) on delete cascade");
  expect(table).toContain("primary key (user_id, business_day)");
  expect(table).toContain("head_token uuid not null");
  expect(table).toContain("current_record_id uuid unique references public.sweet_records(id)");
  expect(table).toContain("on delete no action deferrable initially deferred");
  expect(table).not.toMatch(/\b(?:records|summary|small_step|recommended_next_tool|prompt|payload|fingerprint|expires_at|created_at)\s+(?:jsonb|text|timestamptz)/);
  expect(migration).not.toMatch(/create\s+table\s+[^;]*(?:receipt|request_history)/i);
});

test("RPC and tables have explicit access boundaries without new SECURITY DEFINER", () => {
  expect(migration).not.toMatch(/security\s+definer/i);
  expect(migration).toContain("alter table private.sweet_record_heads enable row level security");
  expect(migration).toContain("revoke all on private.sweet_record_heads from public, anon, authenticated");
  expect(migration).toContain("grant usage on schema private to service_role");
  expect(migration).toContain("revoke insert, delete on public.sweet_records from authenticated");
  expect(migration).toContain("revoke all on function %s from public,anon,authenticated,service_role");
  expect(migration).toContain("grant execute on function %s to service_role");
  expect(write).toContain("language plpgsql volatile security invoker set search_path=''");
  expect(read).toContain("language plpgsql volatile security invoker set search_path=''");
  expect(fn("private.sweet_require_service")).toContain("current_setting('transaction_isolation') <> 'read committed'");
  expect(fn("private.sweet_require_service")).toContain("current_setting('request.method',true)<>'POST'");
  expect(migration).toContain("grant select, insert, update on private.sweet_record_heads to service_role");
  expect(migration).not.toContain("grant select, insert, update, delete on private.sweet_record_heads");
  expect(migration).toContain("revoke truncate on public.sweet_records from service_role");
});

test("write locks before fresh authorization and head, not after a stale pre-read", () => {
  before(write, "perform pg_advisory_xact_lock", "select role,school_id");
  before(write, "perform pg_advisory_xact_lock", "select * into h");
  expect(write).toContain("from auth.users where id=p_actor_user_id");
  expect(write).toContain("p_student_only and role_name is distinct from '学生'");
  expect(write).toContain("role_name is null or role_name='学生'");
  for (const condition of ["policy_version='2026-08-28'", "status='active'", "student_assented_at is not null", "guardian_consented_at is not null"]) {
    expect(write).toContain(condition);
  }
});

test("one DB clock sample fixes Shanghai acceptance day before mutations", () => {
  expect(write.match(/n:=clock_timestamp\(\)/g)).toHaveLength(1);
  before(write, "select * into h", "n:=clock_timestamp()");
  before(write, "n:=clock_timestamp()", "p_operation_day is distinct from d");
  before(write, "p_operation_day is distinct from d", "h.head_token is distinct from p_expected_head");
  expect(write).toContain("(n at time zone 'Asia/Shanghai')::date");
  expect(write).toContain("not is_delete and p_target_day<>d");
  expect(write).toContain("recommended_next_tool,created_at)");
  expect(write).toContain("tool_value,n)");
  expect(write).not.toContain("now()");
});

test("CAS rejects before NOOP, any cleanup or head writes", () => {
  before(write, "h.head_token is distinct from p_expected_head", "if is_delete then");
  before(write, "h.head_token is distinct from p_expected_head", "'noop'");
  before(write, "h.head_token is distinct from p_expected_head", "update private.sweet_record_heads");
  expect(write).not.toMatch(/on\s+conflict\s+.*do\s+update/i);
  expect(write).not.toMatch(/\bexception\s+when\b/i);
});

test("accepted content replaces source only before new INSERT in the same function", () => {
  const mutation = write.slice(write.indexOf("next_id:=gen_random_uuid();prior:="));
  before(mutation, "update private.sweet_record_heads set current_record_id=null", "delete from public.sweet_records");
  before(mutation, "delete from public.sweet_records", "insert into public.sweet_records");
  before(mutation, "insert into public.sweet_records", "insert into private.sweet_record_heads");
  expect(mutation.slice(mutation.indexOf("insert into public.sweet_records"))).not.toContain("delete from public.sweet_records");
  expect(write).not.toMatch(/\b(?:commit|rollback)\s*;/i);
});

test("preserve, legitimate clear and NOOP have separate contracts", () => {
  for (const intent of ["preserve_summary", "replace_summary", "clear_summary", "delete_day", "delete_record_cutoff"]) expect(write).toContain(intent);
  expect(write).toContain("if r.records<>p_records then return private.sweet_packet('conflict'");
  expect(write).toContain("summary_value:=nullif(r.summary,'');step_value:=nullif(r.small_step,'');tool_value:=nullif(r.recommended_next_tool,'')");
  expect(write).toContain("summary_value:=null;step_value:=null;tool_value:=null");
  before(write, "return private.sweet_packet('noop'", "next_id:=gen_random_uuid();prior:=");
  expect(write).toContain("nullif(r.summary,'') is not distinct from summary_value");
  expect(write).toContain("nullif(r.small_step,'') is not distinct from step_value");
  expect(write).toContain("nullif(r.recommended_next_tool,'') is not distinct from tool_value");
});

test("delete keeps fresh tombstones and preserves mini cutoff scope", () => {
  expect(write).toContain("p_intent='delete_day' or t.id=h.current_record_id");
  expect(write).toContain("head_token=next_id");
  expect(write).toContain("else t.created_at end");
  expect(write).toContain("and created_at<=cutoff");
  expect(write).not.toContain("delete from private.sweet_record_heads");
  expect(fn("private.sweet_dml_guard")).toContain("sweet_tombstone_removal_forbidden");
});

test("ordinary and late service direct writes cannot use actor headers as context", () => {
  const guard = fn("private.sweet_dml_guard");
  expect(guard).toContain("c->>'txid' is distinct from txid_current()::text");
  expect(guard).toContain("c->>'actor' is distinct from owner_id::text");
  expect(guard).toContain("c->>'day' is distinct from local_day::text");
  expect(guard).toContain("sweet_protocol_required");
  expect(guard).not.toContain("request.headers");
  expect(guard).not.toContain("pg_trigger_depth()");
  expect(guard).toContain("not exists(select 1 from auth.users where id=owner_id)");
  expect(guard).toContain("(to_jsonb(new)-'school_id')=(to_jsonb(old)-'school_id')");
});

test("authority read is a head/record packet and never a fifty-row empty guess", () => {
  expect(read).toContain("private.sweet_head_valid");
  expect(read).toContain("'protocol_unavailable'");
  expect(fn("private.sweet_packet")).toContain("left join private.sweet_record_heads");
  expect(fn("private.sweet_packet")).toContain("left join public.sweet_records r on r.id=h.current_record_id");
  expect(read).not.toMatch(/\blimit\s+50/i);
  const valid = fn("private.sweet_head_valid");
  expect(valid).toContain("if h.user_id is null then return source_count=0");
  expect(valid).toContain("if h.current_record_id is null then return source_count=0");
});

test("preflight refuses malformed, tied, orphan and unknown dependency source states", () => {
  const audit = fn("private.sweet_protocol_audit");
  for (const code of ["invalid_time", "invalid_payload", "missing_auth_owner", "latest_time_tie", "unknown_incoming_fk", "head_inconsistent", "head_missing", "required_fk_inventory_incomplete", "orphan_followup"]) expect(audit).toContain(`'${code}'`);
  expect(audit).toContain("pg_catalog.pg_constraint");
  expect(audit).toContain("c.convalidated");
  expect(audit).toContain("c.condeferrable and c.condeferred");
  expect(audit).not.toMatch(/\blimit\s+50/i);
  expect(fn("private.sweet_records_shape")).toContain("name not in ('id','title','label','fields')");
  expect(fn("private.sweet_records_shape")).toContain("name not in ('id','title','value')");
});

test("backfill is source-preserving and opening rechecks coverage under barrier", () => {
  const fill = fn("public.sweet_scope_backfill"), open = fn("public.sweet_scope_open");
  for (const source of [fill, open]) {
    expect(source).toContain("phase='closed'");
    expect(source).toContain("pg_advisory_xact_lock(73190428,20261027)");
    expect(source).toContain("p_reviewed_dependency_impacts");
  }
  expect(fill).toContain("insert into private.sweet_record_heads");
  expect(fill).not.toMatch(/(?:delete\s+from|update|insert\s+into)\s+public\.sweet_records/i);
  before(fill, "private.sweet_protocol_audit(false)", "insert into private.sweet_record_heads");
  expect(fill).toContain("raise exception 'sweet_backfill_inconsistent'");
  before(open, "private.sweet_protocol_audit(true)", "set phase='open'");
});

// C30/C33: source contracts only. The explicit-TRUE gate implies rejection of
// FALSE, omitted (default FALSE), and SQL NULL when dependencies exist. These
// assertions do not execute those values in PL/pgSQL or prove transaction effects.
for (const [name, requireHeads, mutation] of [
  ["public.sweet_scope_backfill", false, "insert into private.sweet_record_heads"],
  ["public.sweet_scope_open", true, "update private.sweet_protocol_control set phase='open'"],
] as const) {
  test(`${name} requires explicit TRUE for dependency review, preserving the zero-dependency rule`, () => {
    const source = fn(name);
    expect(source).toContain(`${name}(p_reviewed_dependency_impacts boolean default false)`);
    expect(source).toContain("if (audit#>>'{counts,schoolFollowups}')::bigint>0 and p_reviewed_dependency_impacts is not true then");
    expect(source).not.toMatch(/\band\s+not\s+p_reviewed_dependency_impacts\b/i);
    expect(source).toContain("'code','dependency_review_required'");
    // Review state is independent of the nullable business payload.
    expect(source).not.toContain("p_summary");
    expect(source).not.toContain("p_expected_head");
  });

  test(`${name} keeps fresh closed/audit rejection before review and mutation`, () => {
    const source = fn(name);
    before(source, "perform private.sweet_require_service()", "perform pg_advisory_xact_lock");
    before(source, "perform pg_advisory_xact_lock", "phase='closed'");
    before(source, "phase='closed'", `audit:=private.sweet_protocol_audit(${requireHeads})`);
    before(source, `audit:=private.sweet_protocol_audit(${requireHeads})`, "if audit->>'status'<>'ready' then return audit; end if;");
    before(source, "if audit->>'status'<>'ready' then return audit; end if;", "p_reviewed_dependency_impacts is not true");
    before(source, "'code','dependency_review_required'", "prior:=private.sweet_context");
    before(source, "prior:=private.sweet_context", mutation);
    expect(source).not.toMatch(/\bexception\s+when\b/i);
  });
}
