import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import { buildComprehensiveTrend } from "../lib/reports/comprehensive";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), enrollment = id(2), student = id(3);
const apiFiles = { access: "access.ts", current: "current.ts", history: "history.ts", details: "details.ts", setting: "details-setting.ts", validate: "validate.ts", exit: "enrollment-exit.ts", legacyCreate: "authorizations/index.ts", legacyDelete: "authorizations/[id].ts" };
type Kind = keyof typeof apiFiles;
type Row = Record<string, unknown>;
type Req = { method: string; headers: Record<string, string>; query: Row; body?: unknown; cookies: Row };
type Options = { env?: Row; authenticated?: boolean; authError?: boolean; rpcError?: boolean; finalDenied?: boolean; report?: unknown; actorId?: string; beforeRead?: () => void };
function harness(options: Options = {}) {
  const asOf = new Date().toISOString(), expires = new Date(Date.now() + 86400_000).toISOString();
  const view = { enrollmentId: enrollment, studentId: student, actorId: options.actorId || actor, asOf, sourceRevision: 1, recipientEpoch: 1, detailRevision: 0, expiresAt: expires };
  const core = buildComprehensiveTrend({ rows: [], asOf });
  const rpcCalls: Array<{ name: string; args: Row }> = [], logs: unknown[] = [];
  const seen = { auth: 0, admin: 0, rawTables: 0, chunks: 0 };
  const mocks: Record<string, unknown> = {
    "@/lib/i18n/server": { getServerTranslator: () => (key: string) => key },
    "@/lib/supabaseServer": {
      getAuthenticatedUser: async () => { seen.auth++; if (options.authError) throw new Error("PRIVATE_PROVIDER@example.invalid"); return options.authenticated === false ? null : { id: options.actorId || actor }; },
      getSupabaseAdmin: () => { seen.admin++; return { from() { seen.rawTables++; throw new Error("PRIVATE_RAW_SOURCE"); }, async rpc(name: string, args: Row) {
        rpcCalls.push({ name, args }); if (options.rpcError) return { data: null, error: { code: "XX000", message: "PRIVATE_DATABASE_BODY" } };
        if (name === "validate_school_report_view") return { data: options.finalDenied ? { status: "denied" } : { status: "ready", context: view, detailsEnabled: false }, error: null };
        if (name === "read_school_report_access") return { data: { status: "ready", version: "school-report-access-v2", viewerRole: "unavailable", eligibility: "not_available", owner: null, received: [], nextAfterId: null, recipientNextAfterId: null }, error: null };
        if (name === "read_school_report_trend") { options.beforeRead?.(); return { data: { status: "ready", context: view, report: options.report === undefined ? core : options.report }, error: null }; }
        if (name === "set_school_report_details") return { data: { status: "ready", enabled: args.p_enabled, detailRevision: 1, recipientEpoch: 1, replayed: false }, error: null };
        return { data: { status: "denied" }, error: null };
      } }; },
    },
  };
  const sandbox = vm.createContext({ Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout,
    process: { env: { NODE_ENV: "development", REPORTS_LOCAL_INTEGRATION_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321", ...options.env } },
    console: { error: (...args: unknown[]) => logs.push(args) } });
  const modules = new Map<string, Record<string, unknown>>(), nativeRequire = createRequire(path.join(process.cwd(), "package.json"));
  function load(file: string): Record<string, unknown> {
    const filename = path.resolve(file); if (modules.has(filename)) return modules.get(filename)!;
    const result = {} as Record<string, unknown>; modules.set(filename, result);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const requireModule = (name: string): unknown => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("node:")) return nativeRequire(name);
      const base = name.startsWith("@/") ? path.join(process.cwd(), name.slice(2)) : path.resolve(path.dirname(filename), name);
      if (fs.existsSync(`${base}.ts`)) return load(`${base}.ts`);
      throw new Error("Unexpected test module");
    };
    vm.runInContext(`(function(require,module,exports){${source}\n})`, sandbox, { filename })(requireModule, { exports: result }, result);
    return result;
  }
  async function invoke(kind: Kind, overrides: Partial<Req> = {}, raw?: string) {
    const post = ["history", "details", "setting", "validate", "exit", "legacyCreate"].includes(kind);
    const request: Req = { method: post ? "POST" : kind === "legacyDelete" ? "DELETE" : "GET",
      headers: { authorization: "Bearer PRIVATE_TOKEN", host: "127.0.0.1:3214", "content-type": "application/json" }, cookies: {},
      query: kind === "current" ? { enrollmentId: enrollment } : kind === "legacyDelete" ? { id: enrollment } : {},
      body: post ? { enrollmentId: enrollment, requestId: id(8), enabled: false } : undefined, ...overrides };
    const stream = raw === undefined ? null : Readable.from((async function* () { seen.chunks++; yield Buffer.from(raw); })());
    const req = stream ? Object.assign(stream, request, { body: undefined }) : request;
    const result = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
    const response = { setHeader(name: string, value: unknown) { result.headers[name.toLowerCase()] = String(value); },
      status(value: number) { result.status = value; return response; }, json(value: unknown) { result.body = value; return response; } };
    const handler = load(path.join("pages/api/reports", apiFiles[kind])).default as (req: unknown, res: unknown) => Promise<unknown>;
    await handler(req, response); return result;
  }
  return { invoke, rpcCalls, logs, seen, view, core };
}
function safe(result: { body: unknown; headers: Record<string, string> }) {
  expect(result.headers["cache-control"]).toContain("private"); expect(result.headers["cache-control"]).toContain("no-store");
  expect(JSON.stringify(result.body)).not.toMatch(/PRIVATE_|example\.invalid|sourceRevision/);
}
for (const kind of Object.keys(apiFiles) as Kind[]) {
  test(`${kind} v2门禁先于解析/认证/数据库`, async () => {
    for (const env of [{ REPORTS_LOCAL_INTEGRATION_ENABLED: "false" }, { NODE_ENV: "production" }, { NEXT_PUBLIC_SUPABASE_URL: "https://remote.example.invalid" }]) {
      const h = harness({ env }); const result = await h.invoke(kind, {}, "{PRIVATE_MALFORMED"); safe(result); expect(result.status).toBe(404);
      expect(h.seen).toEqual({ auth: 0, admin: 0, rawTables: 0, chunks: 0 }); expect(h.rpcCalls).toEqual([]);
    }
  });
}
test("v2会话拒绝和原始provider错误均不泄露", async () => {
  for (const options of [{ authenticated: false }, { authError: true }]) {
    const h = harness(options); const result = await h.invoke("access"); safe(result); expect(result.status).toBe(options.authError ? 503 : 401);
    expect(h.rpcCalls).toEqual([]); expect(JSON.stringify(h.logs)).not.toMatch(/PRIVATE_|example\.invalid/);
  }
});
test("UID来自验证会话；额外角色/学校字段、外源和非法method拒绝", async () => {
  const good = harness(); const value = await good.invoke("setting"); safe(value); expect(value.status).toBe(200);
  expect(good.rpcCalls[0]).toMatchObject({ name: "set_school_report_details", args: { p_actor_user_id: actor, p_enrollment_id: enrollment, p_enabled: false } });
  for (const overrides of [
    { body: { enrollmentId: enrollment, requestId: id(8), enabled: false, actorId: id(99) } },
    { body: { enrollmentId: enrollment, requestId: id(8), enabled: false, schoolId: id(99) } },
    { headers: { authorization: "Bearer PRIVATE_TOKEN", host: "127.0.0.1:3214", origin: "https://foreign.example.invalid" } },
    { method: "PATCH" },
  ]) { const h = harness(); const result = await h.invoke("setting", overrides); safe(result); expect([400, 403, 405]).toContain(result.status); expect(h.rpcCalls).toEqual([]); }
});
test("流式JSON、多字节4KB和畸形输入在认证前安全拒绝", async () => {
  for (const raw of ["{PRIVATE_MALFORMED", JSON.stringify({ enrollmentId: "汉".repeat(1500) })]) {
    const h = harness(); const result = await h.invoke("setting", {}, raw); safe(result); expect(result.status).toBe(400); expect(h.seen.auth).toBe(0);
  }
});
test("受限趋势输出检查和返回前失权均丢弃结果，不读raw表", async () => {
  const allowed = harness(); const good = await allowed.invoke("current"); safe(good); expect(good.status).toBe(200); expect(allowed.seen.rawTables).toBe(0);
  const denied = harness({ finalDenied: true }); const bad = await denied.invoke("current"); safe(bad); expect(bad.status).toBe(403);
  for (const change of [
    { ...allowed.core, body: "PRIVATE_SOURCE" },
    { ...allowed.core, sourceCount: 3 },
    { ...allowed.core, overview: { ...allowed.core.overview, dimensions: [{ id: "sleep", state: "category", category: "eat_regular" }] } },
  ]) { const h = harness({ report: change }); const result = await h.invoke("current"); safe(result); expect(result.status).toBe(503); }
});
test("旧自愿授权入口不再调用旧事务", async () => {
  for (const kind of ["legacyCreate", "legacyDelete"] as const) {
    const h = harness(); const result = await h.invoke(kind, { body: kind === "legacyCreate" ? {} : undefined }); safe(result);
    expect(result.status).toBe(403); expect(h.rpcCalls).toEqual([]);
  }
});
test("数据库故障日志只含固定metadata，客户端安全503", async () => {
  const h = harness({ rpcError: true }); const result = await h.invoke("access"); safe(result); expect(result.status).toBe(503);
  expect(JSON.stringify(h.logs)).not.toMatch(/PRIVATE_|example\.invalid/);
});
