import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const container = process.argv[2];
if (!/^supabase_db_youthtempo-isolated-[a-z0-9-]+$/.test(container ?? "")) {
  throw new Error("Pass the disposable youthtempo-isolated database container name");
}

function query(sql) {
  return execFileSync(
    "docker",
    ["--context", "colima-youthtempo-e2e", "exec", container,
      "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

const migrationFiles = readdirSync("supabase/migrations")
  .filter((name) => /^\d{14}_.+\.sql$/.test(name));
const applied = Number(query("select count(*) from supabase_migrations.schema_migrations"));
assert.equal(applied, migrationFiles.length, "all repository migrations must be applied");

assert.equal(
  query(`select policyname || '|' || array_to_string(roles, ',') || '|' || qual || '|' || with_check
    from pg_policies where schemaname = 'public' and tablename = 'pilot_feedback'`),
  "pilot_feedback_server_only|authenticated|false|false",
  "the feedback replay guard must be replaced by the canonical deny policy",
);
assert.equal(
  query(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`),
  "0",
  "every public application table must retain RLS",
);
assert.equal(
  query("select public from storage.buckets where id = 'support-staff-evidence'"),
  "f",
  "support evidence must remain in a private bucket",
);
assert.equal(
  query("select count(*) from public.peer_space_rooms where status <> 'closed'"),
  "0",
  "seeded adult rooms must remain closed",
);
console.log(`isolated migration assertions passed: ${applied} migrations, feedback policy, public RLS, private storage, closed rooms`);
