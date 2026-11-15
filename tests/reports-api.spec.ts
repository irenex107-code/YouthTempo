import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { Readable } from "node:stream";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
// Historical v1 model; the current contracts are covered by reports-sharing-* tests.
test.skip(true, "Superseded voluntary period-report model; retained as historical evidence.");


const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ids = { student: id(1), other: id(2), teacher: id(11), foreignTeacher: id(12), guardian: id(21), lead: id(31), admin: id(32), school: id(101), foreignSchool: id(102), grant: id(201), foreignGrant: id(202), newGrant: id(203), proof: id(301), relation: id(401) };
const fixtureClock = Date.now();
const apiFiles = {
  access: "pages/api/reports/access.ts",
  current: "pages/api/reports/current.ts",
  create: "pages/api/reports/authorizations/index.ts",
  revoke: "pages/api/reports/authorizations/[id].ts",
};
type Request = { method: string; headers: Record<string, string>; query: Record<string, unknown>; body?: unknown; cookies: Record<string, string>; socket: { remoteAddress: string } };
type Response = { setHeader: (name: string, value: string | string[]) => void; status: (status: number) => Response; json: (body: unknown) => Response; end: () => Response };
type Handler = (req: Request, res: Response) => Promise<unknown>;
type Row = Record<string, unknown>;
type RpcCall = { name: string; args: Record<string, unknown> };
type QueryCall = { table: string; columns: string; filters: Array<[string, string, unknown]> };

function summary() {
  return { version: "sweet-period-report-v1", status: "ready", period: { start: new Date(fixtureClock - 8 * 86_400_000).toISOString(), end: new Date(fixtureClock - 86_400_000).toISOString() },
    dimensions: [{ id: "sleep", state: "category", category: "sleep_good", comparison: "unavailable" }] };
}
function fixture() {
  const stamp = fixtureClock;
  const before = new Date(stamp - 20 * 86_400_000).toISOString();
  const effective = new Date(stamp - 15 * 86_400_000).toISOString();
  const until = new Date(stamp + 5 * 86_400_000).toISOString();
  const tables: Record<string, Row[]> = {
    profiles: [
      { id: ids.student, role: "学生", school_id: ids.school, display_name: "Synthetic Student", email: "PRIVATE-STUDENT@example.invalid" },
      { id: ids.other, role: "学生", school_id: ids.foreignSchool, display_name: "PRIVATE-OTHER-STUDENT", email: "PRIVATE-OTHER@example.invalid" },
      { id: ids.teacher, role: "学校支持人员", school_id: ids.school, display_name: "Synthetic Teacher", email: "PRIVATE-TEACHER@example.invalid" },
      { id: ids.foreignTeacher, role: "学校支持人员", school_id: ids.foreignSchool, display_name: "PRIVATE-FOREIGN-TEACHER" },
      { id: ids.guardian, role: "家长", school_id: ids.school, display_name: "Synthetic Guardian" },
      { id: ids.lead, role: "学校支持人员", school_id: ids.school, display_name: "Synthetic Lead" },
      { id: ids.admin, role: "学校支持人员", school_id: null, display_name: "Synthetic Admin" },
    ],
    schools: [{ id: ids.school, status: "active" }, { id: ids.foreignSchool, status: "active" }],
    school_members: [{ id: id(501), school_id: ids.school, user_id: ids.teacher, member_role: "school_support", status: "active" },
      { id: id(502), school_id: ids.school, user_id: ids.lead, member_role: "school_admin", status: "active" }],
    teacher_student_assignments: [{ id: ids.relation, school_id: ids.school, teacher_user_id: ids.teacher, student_user_id: ids.student, status: "active" }],
    guardian_student_links: [{ id: id(402), school_id: ids.school, guardian_user_id: ids.guardian, student_user_id: ids.student, status: "active", confirmed_by: ids.admin }],
    student_consents: [{ student_user_id: ids.student, school_id: ids.school, age_band: "14_17", consent_basis: "student_guardian", policy_version: "reports-school-2026-10-27", status: "active",
      student_assented_at: before, guardian_user_id: ids.guardian, guardian_consented_at: before, withdrawn_at: null }],
    minor_eligibility_assertions: [{ id: ids.proof, student_user_id: ids.student, school_id: ids.school, verified_at: before, valid_until: until, revoked_at: null }],
    report_authorizations: [{ id: ids.grant, student_user_id: ids.student, recipient_user_id: ids.teacher, recipient_type: "teacher", school_id: ids.school,
      relationship_id: ids.relation, minor_assertion_id: ids.proof, dimensions: ["sleep"], effective_at: effective, expires_at: until, status: "active", created_at: effective },
    { id: ids.foreignGrant, student_user_id: ids.other, recipient_user_id: ids.foreignTeacher, recipient_type: "teacher", school_id: ids.foreignSchool,
      dimensions: ["eat"], effective_at: effective, expires_at: until, status: "active", created_at: effective }],
  };
  return tables;
}

function harness(options: { actor?: string; authenticated?: boolean; gate?: boolean; authFailure?: boolean; queryFailure?: boolean;
  rpcFailure?: string; returnedSummary?: unknown; lock?: (calls: RpcCall[], args: Record<string, unknown>) => boolean; env?: Record<string, string>; mutate?: (tables: Record<string, Row[]>) => void;
  onQuery?: (query: QueryCall, tables: Record<string, Row[]>) => void; immediateParserTimeout?: boolean } = {}) {
  const tables = fixture(); options.mutate?.(tables);
  const rpcCalls: RpcCall[] = [];
  const queries: QueryCall[] = [];
  const events: string[] = [];
  const observations = { auth: 0, admin: 0, bodyChunks: 0, monitored: [] as unknown[], logs: [] as unknown[] };
  const environment = { NODE_ENV: "development", REPORTS_LOCAL_INTEGRATION_ENABLED: options.gate === false ? "false" : "true", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321", ...options.env };
  const supabase = {
    from(table: string) {
      if (!["profiles", "schools", "school_members", "teacher_student_assignments", "guardian_student_links", "student_consents", "minor_eligibility_assertions", "report_authorizations"].includes(table)) {
        throw new Error("PRIVATE-UNEXPECTED-DATA-TABLE");
      }
      const call: QueryCall = { table, columns: "", filters: [] }; queries.push(call);
      let maximum = Infinity; let single = false;
      const chain = {
        select(columns: string) { call.columns = columns; return chain; },
        eq(column: string, value: unknown) { call.filters.push(["eq", column, value]); return chain; },
        neq(column: string, value: unknown) { call.filters.push(["neq", column, value]); return chain; },
        in(column: string, value: unknown[]) { call.filters.push(["in", column, value]); return chain; },
        is(column: string, value: unknown) { call.filters.push(["is", column, value]); return chain; },
        gt(column: string, value: unknown) { call.filters.push(["gt", column, value]); return chain; },
        gte(column: string, value: unknown) { call.filters.push(["gte", column, value]); return chain; },
        lte(column: string, value: unknown) { call.filters.push(["lte", column, value]); return chain; },
        not(column: string, _operator: string, value: unknown) { call.filters.push(["neq", column, value]); return chain; },
        order() { return chain; },
        limit(value: number) { maximum = value; return chain; },
        maybeSingle() { single = true; return chain; },
        single() { single = true; return chain; },
        then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
          events.push(`query:${table}:${call.columns}:${JSON.stringify(call.filters)}`);
          options.onQuery?.(call, tables);
          const data = (tables[table] || []).filter((row) => call.filters.every(([operator, key, value]) => {
            if (operator === "eq" || operator === "is") return (row[key] ?? null) === value;
            if (operator === "neq") return row[key] !== value;
            if (operator === "in") return (value as unknown[]).includes(row[key]);
            if (operator === "gt") return String(row[key]) > String(value);
            if (operator === "gte") return String(row[key]) >= String(value);
            return String(row[key]) <= String(value);
          })).slice(0, maximum);
          return Promise.resolve({ data: single ? data[0] || null : data, error: options.queryFailure ? { code: "PRIVATE_DB", message: "PRIVATE-DATABASE-DETAIL" } : null }).then(resolve, reject);
        },
      };
      return chain;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      const call = { name, args }; rpcCalls.push(call); events.push(`rpc:${name}`);
      if (options.rpcFailure === name) return { data: null, error: { code: "PRIVATE_DB", message: "PRIVATE-DATABASE-DETAIL" } };
      if (name === "lock_report_authorization") return { data: options.lock ? options.lock(rpcCalls, args) : true, error: null };
      if (name === "read_report_summary") return { data: options.returnedSummary === undefined ? summary() : options.returnedSummary, error: null };
      if (name === "create_report_authorization") return { data: ids.newGrant, error: null };
      if (name === "revoke_report_authorization") return { data: true, error: null };
      throw new Error("PRIVATE-UNEXPECTED-RPC");
    },
  };
  const modules = new Map<string, Record<string, unknown>>();
  const dictionary = (locale: string) => locale === "en" ? en : zh;
  const mocks: Record<string, unknown> = {
    "@/lib/supabaseServer": {
      getAuthenticatedUser: async (req: Request) => { observations.auth += 1; if (options.authFailure) throw new Error("PRIVATE-AUTH-DETAIL");
        return options.authenticated === false || !req.headers.authorization ? null : { id: options.actor || ids.student }; },
      getSupabaseAdmin: () => { observations.admin += 1; return supabase; },
    },
    "@/lib/i18n/server": { getServerTranslator: (locale: string) => (key: string) => key.split(".").reduce((value: unknown, segment) => (value as Record<string, unknown>)?.[segment], dictionary(locale)) || key },
    "@/lib/operationalMonitoring": { reportOperationalError: (value: unknown) => { observations.monitored.push(value); } },
  };
  function load(file: string): Record<string, unknown> {
    const resolved = path.resolve(process.cwd(), file);
    const cached = modules.get(resolved); if (cached) return cached;
    const source = fs.readFileSync(resolved, "utf8");
    const emitted = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} as Record<string, unknown> }; modules.set(resolved, module.exports);
    vm.runInNewContext(emitted, { module, exports: module.exports, process: { env: environment }, URL, URLSearchParams, Date, Set, Map, Error, Object, Array, Number, String, JSON,
      Buffer, TextEncoder, TextDecoder, AbortController, setTimeout: (callback: () => void, delay: number) => setTimeout(callback, options.immediateParserTimeout ? 0 : delay), clearTimeout,
      console: { error: (...values: unknown[]) => { observations.logs.push(values); } },
      require: (name: string) => {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        const candidate = name.startsWith("@/") ? path.join(process.cwd(), name.slice(2)) : name.startsWith(".") ? path.resolve(path.dirname(resolved), name) : null;
        if (!candidate) throw new Error(`Unmocked module ${name}`);
        return load(candidate.endsWith(".ts") ? candidate : `${candidate}.ts`);
      },
    }, { filename: file });
    modules.set(resolved, module.exports); return module.exports;
  }
  async function invoke(kind: keyof typeof apiFiles, overrides: Partial<Request> & { rawChunks?: Array<Buffer | string>; rawNeverEnds?: boolean } = {}) {
    const { rawChunks, rawNeverEnds, ...requestOverrides } = overrides;
    const base: Request = { method: kind === "create" ? "POST" : kind === "revoke" ? "DELETE" : "GET", headers: { authorization: "Bearer SYNTHETIC-PRIVATE-TOKEN", host: "127.0.0.1:3214" },
      query: kind === "current" ? { authorizationId: ids.grant } : kind === "revoke" ? { id: ids.grant } : {}, cookies: {}, socket: { remoteAddress: "127.0.0.1" },
      body: kind === "create" ? { recipientId: ids.teacher, recipientType: "teacher", dimensions: ["sleep"], requestId: id(901), confirmed: true } : kind === "revoke" ? {} : undefined,
      ...requestOverrides };
    const stream = rawNeverEnds ? new Readable({ read() {} }) : Readable.from((async function* () {
      if (!rawChunks) return;
      for (const chunk of rawChunks) { observations.bodyChunks += 1; yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); }
    })());
    const request = rawChunks === undefined && !rawNeverEnds ? base : Object.assign(stream, base, { body: undefined });
    const result = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
    const response: Response = { setHeader: (name, value) => { result.headers[name.toLowerCase()] = String(value); }, status: (value) => { result.status = value; return response; },
      json: (value) => { result.body = value; return response; }, end: () => response };
    await (load(apiFiles[kind]).default as Handler)(request, response);
    return result;
  }
  return { invoke, tables, queries, rpcCalls, events, observations };
}

function safe(result: { headers: Record<string, string>; body: unknown }) {
  expect(result.headers["cache-control"]).toContain("no-store");
  expect(result.headers["cache-control"]).toContain("private");
  expect(JSON.stringify(result.body)).not.toMatch(/PRIVATE-|@example\.invalid|SYNTHETIC-PRIVATE-TOKEN/);
}

for (const kind of Object.keys(apiFiles) as Array<keyof typeof apiFiles>) {
  test(`${kind} 默认关闭和production/远程环境先拒绝，不触碰认证与数据库`, async () => {
    const scenarios: Array<{ gate?: boolean; env?: Record<string, string> }> = [{ gate: false }, { env: { NODE_ENV: "production" } }, { env: { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic-remote.example.invalid" } }];
    for (const options of scenarios) {
      const mock = harness(options); const result = await mock.invoke(kind); safe(result);
      expect(result.status).toBe(404); expect(mock.observations.auth).toBe(0); expect(mock.observations.admin).toBe(0); expect(mock.rpcCalls).toEqual([]); expect(mock.queries).toEqual([]);
    }
  });
  test(`${kind} 开启后缺失会话401，认证故障安全失败，错误也no-store`, async () => {
    const unauthenticated = harness({ authenticated: false }); const denied = await unauthenticated.invoke(kind); safe(denied); expect(denied.status).toBe(401); expect(unauthenticated.rpcCalls).toEqual([]);
    const broken = harness({ authFailure: true }); const failed = await broken.invoke(kind); safe(failed); expect(failed.status).toBe(503); expect(broken.queries).toEqual([]);
    const unsupported = harness(); const wrong = await unsupported.invoke(kind, { method: "PATCH" }); safe(wrong); expect(wrong.status).toBe(405); expect(wrong.headers.allow).toBeTruthy();
  });
}

test("POST UID只来自已验证会话，固定policy；权限字段、确认缺失、重复或未知维度拒绝", async () => {
  const good = harness(); const created = await good.invoke("create"); safe(created); expect(created.status).toBe(201); expect(created.body).toEqual({ authorizationId: ids.newGrant });
  expect(good.rpcCalls.find((call) => call.name === "create_report_authorization")?.args).toMatchObject({ p_actor_user_id: ids.student, p_recipient_user_id: ids.teacher,
    p_recipient_type: "teacher", p_dimensions: ["sleep"], p_policy_version: "reports-2026-10-27", p_request_id: id(901) });
  const base = { recipientId: ids.teacher, recipientType: "teacher", dimensions: ["sleep"], requestId: id(901), confirmed: true };
  for (const body of [
    { ...base, userId: ids.other }, { ...base, p_actor_user_id: ids.other }, { ...base, schoolId: ids.foreignSchool }, { ...base, policyVersion: "forged" },
    { ...base, confirmed: false }, { ...base, dimensions: [] }, { ...base, dimensions: ["sleep", "sleep"] }, { ...base, dimensions: ["free_text"] },
    { ...base, recipientType: "guardian", recipientId: ids.guardian }, { ...base, requestId: "bad-id" },
  ]) {
    const mock = harness(); const result = await mock.invoke("create", { body }); safe(result); expect([400, 403]).toContain(result.status); expect(mock.rpcCalls.some((call) => call.name === "create_report_authorization")).toBe(false);
  }
});

test("写入Origin只允许同源，不把跨站请求发送给RPC", async () => {
  for (const kind of ["create", "revoke"] as const) {
    const mock = harness(); const result = await mock.invoke(kind, { headers: { authorization: "Bearer synthetic", host: "127.0.0.1:3214", origin: "https://foreign.example.invalid" } });
    safe(result); expect(result.status).toBe(403); expect(mock.rpcCalls).toEqual([]);
  }
});

test("学校新版本缺失、成人与缺少可信未成年证据均不开放", async () => {
  for (const [change, expected] of [
    [(tables: Record<string, Row[]>) => { tables.student_consents[0].policy_version = "2026-08-28"; }, "school_consent_required"],
    [(tables: Record<string, Row[]>) => { tables.student_consents[0].age_band = "18_plus"; tables.student_consents[0].consent_basis = "adult_self"; }, "not_available"],
    [(tables: Record<string, Row[]>) => { tables.minor_eligibility_assertions = []; }, "minor_verification_required"],
  ] as const) {
    const access = harness({ mutate: change }); const result = await access.invoke("access"); safe(result); expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ eligibility: expected, candidates: [], owned: [], received: [] });
    const create = harness({ mutate: change }); const denied = await create.invoke("create"); safe(denied); expect(denied.status).toBe(403);
    expect(create.rpcCalls.some((call) => call.name === "create_report_authorization")).toBe(false);
  }
});

test("guardian全局关闭：访问列表与current双重拒绝，owner仍可停止遗留guardian授权", async () => {
  const mutate = (tables: Record<string, Row[]>) => { tables.report_authorizations[0].recipient_type = "guardian"; tables.report_authorizations[0].recipient_user_id = ids.guardian; };
  const guardian = harness({ actor: ids.guardian, mutate }); const list = await guardian.invoke("access"); safe(list); expect(list.body).toMatchObject({ received: [], candidates: [] });
  const report = await guardian.invoke("current"); safe(report); expect([403, 404]).toContain(report.status); expect(guardian.rpcCalls.some((call) => call.name === "read_report_summary")).toBe(false);
  const owner = harness({ mutate }); const revoke = await owner.invoke("revoke"); safe(revoke); expect(revoke.status).toBe(200); expect(revoke.body).toEqual({ revoked: true });
  expect(owner.rpcCalls.find((call) => call.name === "revoke_report_authorization")?.args).toMatchObject({ p_actor_user_id: ids.student, p_authorization_id: ids.grant });
});

test("接收人和管理员不能撤回别人的授权，陌生ID与他人ID不泄露详情", async () => {
  for (const actor of [ids.teacher, ids.guardian, ids.lead, ids.admin, ids.other]) {
    const mock = harness({ actor }); const result = await mock.invoke("revoke"); safe(result); expect([403, 404]).toContain(result.status);
    expect(mock.rpcCalls.some((call) => call.name === "revoke_report_authorization")).toBe(false);
  }
});

test("current读取后最终lock失效或失败时丢弃已计算报告", async () => {
  const mock = harness({ actor: ids.teacher, lock: (calls) => !calls.some((call) => call.name === "read_report_summary") });
  const result = await mock.invoke("current"); safe(result); expect([403, 404]).toContain(result.status); expect(JSON.stringify(result.body)).not.toContain("sleep_good");
  const names = mock.rpcCalls.map((call) => call.name); expect(names).toContain("read_report_summary"); expect(names.lastIndexOf("lock_report_authorization")).toBeGreaterThan(names.indexOf("read_report_summary"));
  const failed = harness({ actor: ids.teacher, rpcFailure: "lock_report_authorization" }); const error = await failed.invoke("current"); safe(error); expect(error.status).toBe(503); expect(JSON.stringify(error.body)).not.toContain("sleep_good");
});

test("current执行真实handler使用会话UID，额外query和跨人授权不触发读取", async () => {
  const allowed = harness({ actor: ids.teacher }); const result = await allowed.invoke("current"); safe(result); expect(result.status).toBe(200); expect(result.body).toEqual({ summary: summary() });
  expect(allowed.rpcCalls.find((call) => call.name === "read_report_summary")?.args).toEqual({ p_actor_user_id: ids.teacher, p_authorization_id: ids.grant });
  for (const actor of [ids.other, ids.foreignTeacher, ids.lead, ids.admin]) {
    const mock = harness({ actor }); const denied = await mock.invoke("current"); safe(denied); expect([403, 404]).toContain(denied.status); expect(mock.rpcCalls.some((call) => call.name === "read_report_summary")).toBe(false);
  }
  const forged = harness({ actor: ids.teacher }); const denied = await forged.invoke("current", { query: { authorizationId: ids.grant, userId: ids.other } }); safe(denied); expect(denied.status).toBe(400); expect(forged.rpcCalls).toEqual([]);
});

test("RPC输出额外PII字段、未知category、跨维度category、重复维度或非法周期一律不发送", async () => {
  const value = summary();
  const malformed: unknown[] = [
    { ...value, email: "PRIVATE-SOURCE@example.invalid" },
    { ...value, dimensions: [{ ...value.dimensions[0], category: "sleep_invented" }] },
    { ...value, dimensions: [{ ...value.dimensions[0], category: "eat_regular" }] },
    { ...value, dimensions: [value.dimensions[0], value.dimensions[0]] },
    { ...value, dimensions: [{ ...value.dimensions[0], body: "PRIVATE-SOURCE-TEXT" }] },
    { ...value, period: { ...value.period, sourceCount: 20 } },
    { ...value, period: { start: "bad", end: "bad" } },
    { ...value, dimensions: [{ id: "sleep", state: "mixed", comparison: "different", category: "sleep_good" }] },
    { version: value.version, status: ["waiting"], dimensions: [] },
    { ...value, dimensions: [{ id: "sleep", state: ["mixed"], comparison: "unavailable" }] },
    { ...value, dimensions: [{ ...value.dimensions[0], comparison: ["unavailable"] }] },
  ];
  for (const returnedSummary of malformed) {
    const mock = harness({ actor: ids.teacher, returnedSummary }); const result = await mock.invoke("current"); safe(result); expect(result.status).toBe(503); expect(JSON.stringify(result.body)).not.toContain("sleep_good");
  }
  const firstPeriod = harness({ actor: ids.teacher, mutate: (tables) => { tables.report_authorizations[0].effective_at = new Date(fixtureClock - 8 * 86_400_000).toISOString(); },
    returnedSummary: { ...value, dimensions: [{ ...value.dimensions[0], previousCategory: "sleep_good", comparison: "same" }] } });
  const noEarlierPeriod = await firstPeriod.invoke("current"); safe(noEarlierPeriod); expect(noEarlierPeriod.status).toBe(503);
});

test("received身份只在授权lock后读取；失效不能提前查询或返回学生display_name", async () => {
  const allowed = harness({ actor: ids.teacher }); const list = await allowed.invoke("access"); safe(list); expect(list.status).toBe(200); expect(list.body).toMatchObject({ received: [{ id: ids.grant, displayName: "Synthetic Student" }] });
  const identityIndex = allowed.events.findIndex((event) => event.startsWith("query:profiles:") && event.includes("display_name") && event.includes(ids.student));
  const lockIndex = allowed.events.indexOf("rpc:lock_report_authorization"); expect(identityIndex).toBeGreaterThan(lockIndex); expect(lockIndex).toBeGreaterThanOrEqual(0);
  const denied = harness({ actor: ids.teacher, lock: () => false }); const refused = await denied.invoke("access"); safe(refused); expect(refused.body).toMatchObject({ received: [] });
  expect(denied.events.some((event) => event.startsWith("query:profiles:") && event.includes("display_name") && event.includes(ids.student))).toBe(false);
  let attempts = 0;
  const lostAfterName = harness({ actor: ids.teacher, lock: () => ++attempts === 1 }); const stale = await lostAfterName.invoke("access"); safe(stale);
  expect(stale.body).toMatchObject({ received: [] }); expect(JSON.stringify(stale.body)).not.toContain("Synthetic Student");
  const named = lostAfterName.events.findIndex((event) => event.startsWith("query:profiles:") && event.includes("display_name") && event.includes(ids.student));
  expect(lostAfterName.events.lastIndexOf("rpc:lock_report_authorization")).toBeGreaterThan(named);
  expect(allowed.queries.every((query) => !query.columns.split(",").includes("email"))).toBe(true);
});

test("数据库故障为安全503；不能按异常message伪装登录或权限结果，日志没有敏感原文", async () => {
  for (const kind of Object.keys(apiFiles) as Array<keyof typeof apiFiles>) {
    const mock = harness({ queryFailure: true }); const result = await mock.invoke(kind); safe(result); expect(result.status).toBe(503);
    expect(JSON.stringify(mock.observations.logs)).not.toMatch(/PRIVATE-DATABASE-DETAIL|SYNTHETIC-PRIVATE-TOKEN|@example\.invalid/);
  }
});

test("手动JSON解析保留no-store：合法stream、畸形JSON、多字节超限、内容类型与关闭前不消费stream", async () => {
  const base = { recipientId: ids.teacher, recipientType: "teacher", dimensions: ["sleep"], requestId: id(901), confirmed: true };
  const headers = { authorization: "Bearer synthetic", host: "127.0.0.1:3214", "content-type": "application/json" };
  const good = harness(); const accepted = await good.invoke("create", { headers, rawChunks: [JSON.stringify(base)] }); safe(accepted); expect(accepted.status).toBe(201); expect(good.observations.bodyChunks).toBe(1);
  for (const [rawChunks, suppliedHeaders] of [
    [["{PRIVATE-MALFORMED-JSON"], headers],
    [[JSON.stringify({ ...base, recipientId: "汉".repeat(1500) })], headers],
    [[JSON.stringify(base)], { authorization: "Bearer synthetic", host: "127.0.0.1:3214" }],
    [[JSON.stringify(base)], { ...headers, "content-type": "text/plain" }],
  ] as Array<[string[], Record<string, string>]>) {
    const mock = harness(); const result = await mock.invoke("create", { headers: suppliedHeaders, rawChunks }); safe(result); expect(result.status).toBe(400);
    expect(mock.observations.auth).toBe(0); expect(mock.rpcCalls).toEqual([]);
  }
  const closed = harness({ gate: false }); const refused = await closed.invoke("create", { headers, rawChunks: ["{PRIVATE-MALFORMED-JSON"] }); safe(refused); expect(refused.status).toBe(404); expect(closed.observations.bodyChunks).toBe(0);
  const timeout = harness({ immediateParserTimeout: true }); const unfinished = await timeout.invoke("create", { headers, rawNeverEnds: true }); safe(unfinished); expect(unfinished.status).toBe(400); expect(timeout.observations.auth).toBe(0);
});

test("失效owned仅保留最少管理metadata；不能继续读正文，也不能绕过新学校确认", async () => {
  const mutate = (tables: Record<string, Row[]>) => { tables.report_authorizations[0].status = "revoked"; tables.student_consents[0].policy_version = "2026-08-28"; };
  const mock = harness({ mutate }); const result = await mock.invoke("access"); safe(result); expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ eligibility: "school_consent_required", candidates: [], received: [], owned: [{ id: ids.grant, status: "revoked" }] });
  const current = await mock.invoke("current"); safe(current); expect([403, 404]).toContain(current.status); expect(mock.rpcCalls.some((call) => call.name === "read_report_summary")).toBe(false);
});

test("候选名单形成后老师关系变化，返回前移除候选并使旧active管理项失效", async () => {
  let currentTables: Record<string, Row[]> = {};
  const mock = harness({ mutate: (tables) => { currentTables = tables; },
    onQuery: (query, tables) => {
      if (query.table === "profiles" && query.columns.includes("display_name")
        && query.filters.some(([operator, key, value]) => operator === "in" && key === "id" && (value as unknown[]).includes(ids.teacher))) {
        tables.school_members[0].status = "revoked";
      }
    },
    lock: () => currentTables.school_members[0].status === "active",
  });
  const result = await mock.invoke("access"); safe(result); expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ candidates: [], owned: [{ id: ids.grant, status: "invalidated" }] });
});
