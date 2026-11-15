import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// Test orchestration only. This runner cannot select a hosted Supabase project.
const [privateStatus, ...options] = process.argv.slice(2);
const communityBatch = options.includes("--group=community");
const requestedSuites = options.filter((value) => value !== "--group=community");
assert(privateStatus, "Pass the private status JSON from this disposable local stack");
const suppliedPath = resolve(privateStatus);
const statusStat = lstatSync(suppliedPath);
assert(statusStat.isFile() && !statusStat.isSymbolicLink() && statusStat.nlink === 1 && (statusStat.mode & 0o077) === 0, "Status JSON must be private, regular and single-link");
const statusPath = realpathSync(suppliedPath);
assert.equal(suppliedPath, statusPath, "Private status must not traverse a symlink");
const privateRoot = dirname(statusPath);
assert(/^\/private\/tmp\/youthtempo-isolated-role-20261028-[a-f0-9]{8}$/.test(privateRoot), "Use this batch's dedicated disposable directory");
const status = JSON.parse(readFileSync(statusPath, "utf8"));
assert.equal(status.API_URL, "http://127.0.0.1:56321", "Only this batch's loopback API is allowed");
assert(typeof status.ANON_KEY === "string" && typeof status.SERVICE_ROLE_KEY === "string", "Local credentials missing");
const config = readFileSync(join(privateRoot, "supabase/config.toml"), "utf8");
assert(config.includes(`project_id = "${basename(privateRoot)}"`), "Disposable directory and project ID must match");
assert(config.includes("port = 56321"), "Unexpected local API port");

const root = process.cwd();
const evidence = join(root, communityBatch ? "deliverables/community-acceptance-2026-10-28"
  : "deliverables/role-database-acceptance-2026-10-28");
mkdirSync(evidence, { recursive: true });
const suites = communityBatch ? [
  "tests/community-visibility.spec.ts",
  "tests/community-moderation.spec.ts",
  "tests/community-rate-limit.spec.ts",
  "tests/sweet-record-lifecycle.spec.ts",
  "tests/community-report-service-level.spec.ts",
] : [
  "tests/authenticated-permission-boundary.spec.ts",
  "tests/authenticated-api-overreach.spec.ts",
  "tests/membership-revocation.spec.ts",
  "tests/isolated-inline-role-lifecycle.spec.ts",
];
assert(requestedSuites.every((suite) => suites.includes(suite)), "Unknown suite");
const selected = requestedSuites.length ? requestedSuites : suites;
const env = { ...process.env };
// Next loads .env files itself. Override their names before startup, without
// reading or logging the credential values into the test environment.
for (const file of [".env", ".env.local", ".env.development", ".env.development.local"]) {
  if (!existsSync(join(root, file))) continue;
  for (const line of readFileSync(join(root, file), "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) env[match[1]] = "";
  }
}
for (const name of Object.keys(env)) {
  if (/^(?:SUPABASE_|NEXT_PUBLIC_SUPABASE_|E2E_|SMTP_|AI_|OPENAI_|ANTHROPIC_)/.test(name)) env[name] = "";
}
Object.assign(env, {
  NODE_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  E2E_PERMISSION_TEST_PASSWORD: `Local-role-${randomBytes(24).toString("hex")}`,
  ALLOW_E2E_FIXTURE_MUTATION: "true",
  E2E_ISOLATED_INLINE_ROLE_LIFECYCLE: "true",
  E2E_SWEET_AI_MODE: "disabled",
  REPORTS_LOCAL_INTEGRATION_ENABLED: "true", // Existing dev-only loopback CSP.
  AI_GENERATION_ENABLED: "false",
  PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3270",
  RATE_LIMIT_SECRET: randomBytes(32).toString("hex"),
});
const secretValues = [status.ANON_KEY, status.SERVICE_ROLE_KEY, env.E2E_PERMISSION_TEST_PASSWORD, env.RATE_LIMIT_SECRET];
function sanitize(text) {
  let result = text;
  for (const value of secretValues) result = result.split(value).join("[REDACTED_LOCAL_SECRET]");
  return result.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_LOCAL_SESSION]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]");
}
async function run(args, logName, extraEnv = {}) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const code = await new Promise((resolveExit, reject) => {
    child.once("error", reject); child.once("exit", resolveExit);
  });
  writeFileSync(join(evidence, logName), sanitize(output));
  assert.equal(code, 0, `Local acceptance command failed; inspect sanitized ${logName}`);
}

const appLog = join(privateRoot, "app-private.log");
const descriptor = openSync(appLog, "w", 0o600);
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "-H", "127.0.0.1", "-p", "3270"], {
  cwd: root, env, stdio: ["ignore", descriptor, descriptor],
});
closeSync(descriptor);
let appExit;
app.once("exit", (code) => { appExit = code ?? -1; });
const results = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (appExit !== undefined) throw new Error("Local app exited before readiness; private log withheld");
    try { ready = (await fetch(`${env.PLAYWRIGHT_BASE_URL}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { /* local startup */ }
    if (ready) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  assert(ready, "Local app did not become ready");
  for (const suite of selected) {
    const label = basename(suite, ".spec.ts");
    // Reset the actual virtual-school fixture before every independent suite.
    await run(["scripts/setup-permission-test-fixtures.mjs"], `${label}-fixture.log`);
    const rawResult = join(privateRoot, `${label}.json`);
    await run(["node_modules/@playwright/test/cli.js", "test", suite, "--workers=1", "--retries=0", "--trace=off", "--reporter=json",
      `--output=${join(evidence, `${label}-results`)}`,
      ...(label === "isolated-inline-role-lifecycle" ? [] : ["--project=desktop-chromium"])], `${label}-run.log`, { PLAYWRIGHT_JSON_OUTPUT_FILE: rawResult });
    chmodSync(rawResult, 0o600);
    const result = JSON.parse(readFileSync(rawResult, "utf8"));
    assert(result.stats.unexpected === 0 && result.stats.skipped === 0 && result.stats.flaky === 0, "Incomplete acceptance is not success");
    writeFileSync(join(evidence, `${label}.json`), sanitize(JSON.stringify(result, null, 2)) + "\n");
    results.push({ suite, ...result.stats });
    console.log(JSON.stringify({ suite, passed: result.stats.expected }));
  }
} finally {
  app.kill("SIGTERM");
  const log = existsSync(appLog) ? readFileSync(appLog, "utf8") : "";
  writeFileSync(join(evidence, "app.log"), sanitize(log));
  writeFileSync(join(evidence, "suite-summary.json"), JSON.stringify({ results, fixtureResetBeforeEachSuite: true, realLocalApi: true, tracesEnabled: false }, null, 2) + "\n");
}
