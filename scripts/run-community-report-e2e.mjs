import { spawn } from "node:child_process";

// Node preserves caller-provided environment values over .env.local values.
// The shared runner resets the isolated fixture before executing this suite.
const child = spawn(
  process.execPath,
  ["--env-file-if-exists=.env.local", "scripts/run-permission-test-suites.mjs", "--group=report-sla"],
  { cwd: new URL("..", import.meta.url), env: process.env, stdio: "inherit" },
);

const forwardInterrupt = () => child.kill("SIGINT");
const forwardTerminate = () => child.kill("SIGTERM");
process.on("SIGINT", forwardInterrupt);
process.on("SIGTERM", forwardTerminate);

child.once("error", () => {
  console.error("举报服务目标验收未能启动。");
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.removeListener("SIGINT", forwardInterrupt);
  process.removeListener("SIGTERM", forwardTerminate);
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
