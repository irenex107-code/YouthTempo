import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const raw = await readFile(new URL("../.env.local", import.meta.url), "utf8");
const local = Object.fromEntries(
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      return [key, value];
    }),
);

const allowedKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "E2E_PERMISSION_TEST_PASSWORD",
];
const childEnv = {
  ...process.env,
  PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
};
for (const key of allowedKeys) {
  if (local[key]) childEnv[key] = local[key];
}
delete childEnv.SUPABASE_SERVICE_ROLE_KEY;
delete childEnv.OPENAI_API_KEY;
delete childEnv.WECHAT_MINI_APP_SECRET;

const child = spawn(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", "tests/community-report-service-level.spec.ts"],
  { cwd: new URL("..", import.meta.url), env: childEnv, stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code || 0);
});
