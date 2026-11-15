import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

type Row = Record<string, unknown>;
type Request = { method: string; headers: Record<string, string>; query: Record<string, string>; cookies: Record<string, string>; body?: Row };
type Response = { setHeader: (name: string, value: string) => void; status: (code: number) => Response; json: (body: unknown) => Response };
type Handler = (req: Request, res: Response) => Promise<unknown>;

async function isolatedModule(file: string, mocks: Record<string, unknown> = {}) {
  const source = await readFile(path.join(process.cwd(), file), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(output, { module, exports: module.exports, require: (name: string) => {
    if (!Object.hasOwn(mocks, name)) throw new Error(`Unmocked import: ${name}`);
    return mocks[name];
  }, console, Error, URL, URLSearchParams, AbortController, setTimeout, clearTimeout }, { filename: file });
  return module.exports;
}

const userId = "00000000-0000-4000-8000-000000000071";
const activeConsent = { age_band: "18_plus", consent_basis: "adult_self", status: "active", policy_version: "2026-08-28",
  student_assented_at: "2026-10-01T00:00:00Z", guardian_user_id: null, guardian_consented_at: null };
const validApplication = { category: "listening_volunteer", legalName: "Synthetic volunteer", serviceLanguages: ["zh-CN", "en"],
  ageScopes: ["18_plus"], serviceScope: "Synthetic listening support", availability: "Synthetic weekday", boundariesConfirmed: true,
  crisisRulesConfirmed: true, privacyRulesConfirmed: true };

async function harness(options: { authenticated?: boolean; consent?: Row | null; queryError?: boolean; current?: Row | null; confirmationMissing?: boolean } = {}) {
  const queries: Array<{ table: string; columns: string; filters: Array<[string, unknown]> }> = [];
  const writes: Row[] = [];
  const reports: unknown[] = [];
  let adminCalls = 0;
  const studentConsent = await isolatedModule("lib/studentConsent.ts");
  const supportWorkflow = await isolatedModule("lib/supportWorkflow.ts", { "@/lib/studentConsent": studentConsent });
  const config = await isolatedModule("lib/i18n/config.ts");
  const dictionaries = await isolatedModule("lib/i18n/dictionaries.ts", { "@/locales/en.json": en, "@/locales/zh-CN.json": zh });
  const serverI18n = await isolatedModule("lib/i18n/server.ts", { "@/lib/i18n/config": config, "@/lib/i18n/dictionaries": dictionaries });
  const supabase = { from(table: string) {
    if (!["support_staff_applications", "profiles", "student_consents"].includes(table)) throw new Error(`Unexpected table ${table}`);
    const query = { table, columns: "", filters: [] as Array<[string, unknown]> };
    let updating = false;
    queries.push(query);
    const chain = {
      select(columns: string) { query.columns = columns; return chain; },
      eq(key: string, value: unknown) { query.filters.push([key, value]); return chain; },
      async maybeSingle() {
        if (options.queryError) return { data: null, error: new Error("PRIVATE_DATABASE_DETAIL") };
        if (updating) return { data: options.confirmationMissing ? null : { user_id: userId }, error: null };
        const data = table === "profiles" ? { role: "学生" } : table === "student_consents"
          ? options.consent === undefined ? activeConsent : options.consent : options.current || null;
        return { data, error: null };
      },
      async upsert(value: Row) { writes.push(value); return { error: null }; },
      update(value: Row) { writes.push(value); updating = true; return chain; },
    };
    return chain;
  } };
  const mod = await isolatedModule("pages/api/support/staff.ts", {
    "@/lib/i18n/server": serverI18n, "@/lib/supportWorkflow": supportWorkflow, "@/lib/studentConsent": studentConsent,
    "@/lib/supabaseServer": { getAuthenticatedUser: async () => options.authenticated === false ? null : { id: userId },
      getSupabaseAdmin: () => { adminCalls += 1; return supabase; } },
    "@/lib/operationalMonitoring": { reportOperationalError: async (event: unknown) => { reports.push(event); } },
  });
  return {
    queries, writes, reports, get adminCalls() { return adminCalls; },
    async call(method = "POST", body?: Row, query: Record<string, string> = {}) {
      const result = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
      const res: Response = { setHeader(name, value) { result.headers[name] = value; },
        status(code) { result.status = code; return res; }, json(value) { result.body = value; return res; } };
      await (mod.default as Handler)({ method, headers: { authorization: "Bearer synthetic-token" }, query, cookies: {},
        body: method === "POST" ? body || validApplication : body }, res);
      expect(result.headers["Cache-Control"]).toContain("no-store");
      return result;
    },
  };
}

for (const [label, override] of [
  ["过期的使用确认版本", { policy_version: "2026-08-03" }],
  ["缺少学生本人确认", { student_assented_at: null }],
  ["已撤回的使用确认", { status: "withdrawn" }],
  ["未满18岁的学生", { age_band: "14_17", consent_basis: "student_self_pilot" }],
  ["错误的成人同意依据", { consent_basis: "student_guardian" }],
] as const) {
  test(`support/staff 拒绝${label}且不写入申请`, async () => {
    const mock = await harness({ consent: { ...activeConsent, ...override } });
    const result = await mock.call();
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: zh.supportFlow.errors.noAccess });
    expect(mock.writes).toEqual([]);
    expect(mock.queries.find((query) => query.table === "student_consents")?.columns).toContain("policy_version,student_assented_at");
    expect(mock.queries.every((query) => query.filters.some(([, value]) => value === userId))).toBe(true);
  });
}

test("support/staff 当前版本成人确认允许申请，客户端不能提交角色、状态或他人身份", async () => {
  const mock = await harness();
  const result = await mock.call("POST", { ...validApplication, user_id: "attacker-target", role: "平台管理员", status: "approved",
    reviewed_by: "attacker", evidence_path: "private-other-path" });
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ saved: true });
  expect(mock.writes).toHaveLength(1);
  expect(mock.writes[0]).toMatchObject({ user_id: userId, status: "pending", reviewed_by: null, evidence_path: null,
    category: "listening_volunteer", boundaries_confirmed: true, privacy_rules_confirmed: true, crisis_rules_confirmed: true });
  expect(mock.writes[0]).not.toHaveProperty("role");
});

const invitationConfirmation = { action: "confirm_invitation", boundariesConfirmed: true, crisisRulesConfirmed: true, privacyRulesConfirmed: true };

test("已拒绝的学校邀请不能回报已确认或写入职责", async () => {
  const mock = await harness({ current: { category: "school_duty_teacher", status: "rejected" } });
  const result = await mock.call("POST", invitationConfirmation);
  expect(result.status).toBe(409);
  expect(result.body).toEqual({ error: zh.supportFlow.errors.locked });
  expect(mock.writes).toEqual([]);
});

test("学校邀请状态并发变化导致零行更新时不回报成功", async () => {
  const mock = await harness({ current: { category: "school_duty_teacher", status: "pending" }, confirmationMissing: true });
  const result = await mock.call("POST", invitationConfirmation);
  expect(result.status).toBe(409);
  expect(result.body).toEqual({ error: zh.supportFlow.errors.locked });
  expect(mock.queries.at(-1)?.filters).toEqual([["user_id", userId], ["status", "pending"]]);
});

test("待确认学校邀请只为本人保存三项职责且确认受影响行", async () => {
  const mock = await harness({ current: { category: "school_duty_teacher", status: "pending" } });
  const result = await mock.call("POST", invitationConfirmation);
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ saved: true });
  expect(mock.writes).toHaveLength(1);
  expect(mock.writes[0]).toMatchObject({ boundaries_confirmed: true, crisis_rules_confirmed: true, privacy_rules_confirmed: true });
  expect(mock.writes[0]).not.toHaveProperty("status");
  expect(mock.queries.at(-1)?.filters).toEqual([["user_id", userId], ["status", "pending"]]);
});

test("support/staff GET query 英文在无语言cookie、未登录时返回英文且不查询数据", async () => {
  const mock = await harness({ authenticated: false });
  const result = await mock.call("GET", undefined, { locale: "en" });
  expect(result.status).toBe(401);
  expect(result.body).toEqual({ error: en.supportFlow.errors.signIn });
  expect(mock.adminCalls).toBe(0);
  expect(mock.queries).toEqual([]);
});

test("support/staff GET query 英文在服务异常时使用安全提示", async () => {
  const mock = await harness({ queryError: true });
  const result = await mock.call("GET", undefined, { locale: "en" });
  expect(result.status).toBe(503);
  expect(result.body).toEqual({ error: en.supportFlow.errors.unavailable });
  expect(JSON.stringify(result.body)).not.toContain("PRIVATE_DATABASE_DETAIL");
  expect(mock.reports).toHaveLength(1);
  expect(mock.writes).toEqual([]);
});

test("support/staff GET 只读取当前身份申请并隐藏证明文件路径", async () => {
  const mock = await harness({ current: { user_id: userId, status: "pending", evidence_path: "private/bucket/path" } });
  const result = await mock.call("GET", undefined, { locale: "en" });
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ application: { user_id: userId, status: "pending", evidence_path: "uploaded" } });
  expect(mock.queries).toHaveLength(1);
  expect(mock.queries[0].filters).toEqual([["user_id", userId]]);
  expect(mock.writes).toEqual([]);
});
