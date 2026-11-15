import { spawnSync } from "node:child_process";

const groups = {
  permissions: [
  "tests/authenticated-permission-boundary.spec.ts",
  "tests/authenticated-api-overreach.spec.ts",
  "tests/membership-revocation.spec.ts",
  ],
  community: ["tests/community-visibility.spec.ts", "tests/community-moderation.spec.ts"],
  sweet: ["tests/sweet-record-lifecycle.spec.ts"],
  "rate-limit": ["tests/community-rate-limit.spec.ts"],
  "report-sla": ["tests/community-report-service-level.spec.ts"],
};
const group = process.argv[2]?.replace(/^--group=/, "") || "permissions";
if (process.argv.length > 3 || !Object.hasOwn(groups, group)) {
  console.error("请选择已登记的独立验收套件组。");
  process.exit(1);
}
const suites = groups[group];

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error || result.signal) {
    console.error("权限验收子进程未正常完成，已停止后续套件。");
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const suite of suites) {
  // This script's existing target guard rejects formal/recovery projects before
  // any fixture mutation or test starts. Each suite needs a fresh relationship
  // and consent baseline; another suite may revoke them using an old session.
  run(["scripts/setup-permission-test-fixtures.mjs"]);
  run([
    "node_modules/@playwright/test/cli.js", "test", suite,
    "--project=desktop-chromium", "--workers=1", "--retries=0", "--trace=off",
  ]);
}
