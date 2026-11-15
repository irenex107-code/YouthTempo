#!/usr/bin/env node
// Offline only: no process.env, network client, SQL executor, or database driver.
import { readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const usage = "Usage: node scripts/prepare-sweet-head-backfill.mjs --input <explicit-local-snapshot.json> [--restricted-plan <new-file.json> --allow-sensitive-plan]";
const args = process.argv.slice(2);
const options = new Map();
let permitPlan = false;
let invalid = false;
for (let index = 0; index < args.length; index++) {
  const value = args[index];
  if (value === "--help" || value === "-h") { console.log(usage); process.exit(0); }
  if (value === "--allow-sensitive-plan") { if (permitPlan) invalid = true; permitPlan = true; continue; }
  if (!["--input", "--restricted-plan"].includes(value) || options.has(value)
    || !args[index + 1] || args[index + 1].startsWith("--")) { invalid = true; break; }
  options.set(value, args[++index]);
}
if (invalid || !options.has("--input") || Boolean(options.has("--restricted-plan")) !== permitPlan) {
  console.error(usage); process.exit(64);
}
try {
  const inputPath = options.get("--input");
  // Refuse URLs and accidental oversized files. Only an explicit local file is read.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(inputPath)) throw new Error("invalid_local_file");
  const inputStat = await stat(inputPath);
  if (!inputStat.isFile() || inputStat.size > 64 * 1024 * 1024) throw new Error("invalid_local_file");
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const sourcePath = fileURLToPath(new URL("../lib/sweetBackfillPlan.ts", import.meta.url));
  const source = await readFile(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020, strict: true } });
  const preflightRuntime = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
  const plan = preflightRuntime.inspectSweetBackfillSnapshot(input);
  console.log(JSON.stringify(preflightRuntime.sweetBackfillPublicReport(plan), null, 2));
  if (plan.offlineAdmission !== "eligible") { process.exitCode = 2; }
  else if (permitPlan) {
    // Exclusive create and mode 0600: never overwrite an export, old plan or user file.
    await writeFile(options.get("--restricted-plan"), `${JSON.stringify({ version: 1,
      advisoryOnly: true, databaseReady: false, requiresLockedDatabaseRevalidation: true,
      sourceMutationCount: 0, heads: plan.heads }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  }
} catch {
  // Never echo arbitrary JSON, SQL-looking input, filenames, owner IDs or content.
  console.error(JSON.stringify({ error: "offline_preflight_input_or_output_unavailable", databaseReady: false }));
  process.exitCode = 1;
}
