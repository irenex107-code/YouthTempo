import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

type Request = { method: string; headers: Record<string, string>; body?: unknown; cookies?: Record<string, string> };
type Response = { setHeader: (name: string, value: string) => void; status: (status: number) => Response; json: (body: unknown) => Response };
type Handler = (req: Request, res: Response) => Promise<unknown>;
type Kind = "platform" | "lead" | "teacher" | "unassigned";

async function isolatedModule(file: string, mocks: Record<string, unknown>) {
  const source = await readFile(path.join(process.cwd(), file), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require: (name: string) => {
      if (!Object.hasOwn(mocks, name)) throw new Error(`Unmocked import: ${name}`);
      return mocks[name];
    },
    console, Error, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
  }, { filename: file });
  return module.exports;
}

function response() {
  const result = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res: Response = {
    setHeader: (name, value) => { result.headers[name] = value; },
    status: (status) => { result.status = status; return res; },
    json: (body) => { result.body = body; return res; },
  };
  return { result, res };
}

const translationMock = {
  getServerTranslator: (locale?: string) => {
    const copy = locale === "en" ? en : zh;
    return (key: string) => key.split(".").reduce((value: unknown, segment) => (value as Record<string, unknown>)[segment], copy);
  },
};

function adminMock(kind: Kind, failQuery = false) {
  const queries: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
  const calls = { authentication: 0 };
  const tables: Record<string, Array<Record<string, unknown>>> = {
    schools: [{ id: "school-a", name: "Synthetic school", status: "active", created_at: "2026-01-01T00:00:00Z" }],
    school_members: [
      { school_id: "school-a", user_id: "teacher-a", email: "teacher@example.invalid", member_role: "school_support", status: "active" },
      { school_id: "school-a", user_id: "lead-a", email: "lead@example.invalid", member_role: "school_admin", status: "active" },
    ],
    profiles: [
      { id: "student-a", display_name: "Synthetic student", email: "student@example.invalid", school_id: "school-a", role: "学生" },
      { id: "teacher-a", display_name: "Synthetic teacher", email: "teacher@example.invalid", school_id: "school-a", role: "学校支持人员" },
    ],
    teacher_student_assignments: [{ school_id: "school-a", teacher_user_id: "teacher-a", student_user_id: "student-a", status: "active" }],
    guardian_student_links: [], wechat_identities: [],
  };
  const supabase = {
    from(table: string) {
      if (table === "sweet_records" || table === "school_followups") throw new Error("Private SWEET queries must never execute");
      if (!Object.hasOwn(tables, table)) throw new Error(`Unexpected table ${table}`);
      const query = { table, filters: [] as Array<[string, string, unknown]> };
      queries.push(query);
      let countOnly = false;
      const chain = {
        select(_columns: string, options?: { head?: boolean }) { countOnly = options?.head === true; return chain; },
        eq(key: string, value: unknown) { query.filters.push(["eq", key, value]); return chain; },
        in(key: string, value: unknown[]) { query.filters.push(["in", key, value]); return chain; },
        not(key: string, _operator: string, value: unknown) { query.filters.push(["not", key, value]); return chain; },
        order() { return chain; },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const data = tables[table].filter((row) => query.filters.every(([op, key, value]) => op === "eq" ? row[key] === value : op === "in" ? (value as unknown[]).includes(row[key]) : row[key] !== value));
          return Promise.resolve({ data: countOnly ? null : data, count: data.length, error: failQuery ? { message: "PRIVATE-SERVICE-DETAIL" } : null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return {
    queries, calls,
    getAdminContext: async (req: Request) => {
      calls.authentication += 1;
      if (!req.headers.authorization) throw new Error("请先登录管理员账号。");
      if (req.headers.authorization === "Bearer denied") throw new Error("当前账号没有学校工作台权限。");
      return { supabase, kind: kind === "platform" ? "platform" : "school", user: { id: kind === "lead" ? "lead-a" : "teacher-a" },
        email: "admin@example.invalid", roleLabel: kind === "platform" ? "平台管理员" : kind === "lead" ? "学校负责人" : "支持老师",
        managedSchoolIds: kind === "platform" ? [] : ["school-a"], schoolRoles: kind === "platform" ? {} : { "school-a": kind === "lead" ? "school_admin" : "school_support" },
        assignedStudentIds: kind === "unassigned" ? [] : ["student-a"],
      };
    },
  };
}

for (const kind of ["platform", "lead", "teacher", "unassigned"] as const) {
  test(`${kind} 实际overview handler只查询运营信息，不读取私人SWEET或旧跟进`, async () => {
    const mock = adminMock(kind);
    const mod = await isolatedModule("pages/api/admin/overview.ts", { "@/lib/adminAccess": { getAdminContext: mock.getAdminContext }, "@/lib/i18n/server": translationMock });
    const { res, result } = response();
    await (mod.default as Handler)({ method: "GET", headers: { authorization: "Bearer synthetic" } }, res);
    expect(result.status).toBe(200);
    expect(result.headers["Cache-Control"]).toContain("no-store");
    expect(result.body).toMatchObject({ privateRecordsRestricted: true, counts: { sweetRecords: null },
      recentRecords: [], attentionQueue: [], teacherWeeklySummaries: [], schoolMonthlyTrends: [], studentParticipationStats: [] });
    expect(mock.queries.every((query) => query.table !== "sweet_records" && query.table !== "school_followups")).toBe(true);
    expect(mock.queries.some((query) => query.table === "schools")).toBe(true);
    if (kind === "teacher" || kind === "unassigned") expect(mock.queries.some((query) => query.table === "wechat_identities")).toBe(false);
  });
}

test("overview保留方法、未登录和无管理权限拒绝，服务错误不泄露内部详情", async () => {
  for (const [method, authorization, expected] of [["POST", "Bearer synthetic", 405], ["GET", "", 401], ["GET", "Bearer denied", 403]] as const) {
    const mock = adminMock("platform");
    const mod = await isolatedModule("pages/api/admin/overview.ts", { "@/lib/adminAccess": { getAdminContext: mock.getAdminContext }, "@/lib/i18n/server": translationMock });
    const { res, result } = response();
    await (mod.default as Handler)({ method, headers: { authorization } }, res);
    expect(result.status).toBe(expected);
    expect(mock.queries).toEqual([]);
    if (method === "POST") { expect(result.headers.Allow).toBe("GET"); expect(mock.calls.authentication).toBe(0); }
  }
  const mock = adminMock("platform", true);
  const mod = await isolatedModule("pages/api/admin/overview.ts", { "@/lib/adminAccess": { getAdminContext: mock.getAdminContext }, "@/lib/i18n/server": translationMock });
  const { res, result } = response();
  await (mod.default as Handler)({ method: "GET", headers: { authorization: "Bearer synthetic" } }, res);
  expect(result.status).toBe(500);
  expect(JSON.stringify(result.body)).not.toContain("PRIVATE-SERVICE-DETAIL");
});

for (const api of ["overview", "followups"] as const) {
  for (const locale of ["zh-CN", "en"] as const) {
    test(`${api}/${locale} 鉴权只识别可信错误，内部异常不伪装为登录或权限失败`, async () => {
      const copy = locale === "en" ? en : zh;
      for (const [message, expectedStatus, expectedError] of [
        ["请先登录管理员账号。", 401, copy.adminPrivateRecords.signIn],
        ["当前账号没有学校工作台权限。", 403, copy.adminPrivateRecords.noAdminAccess],
        ["PRIVATE-SERVICE-DETAIL 没有权限记录", 500, copy.adminPrivateRecords.unavailable],
        ["PRIVATE-SERVICE-DETAIL 请先登录数据库", 500, copy.adminPrivateRecords.unavailable],
        ["PRIVATE-SERVICE-DETAIL 只能执行内部操作", 500, copy.adminPrivateRecords.unavailable],
      ] as const) {
        const mod = await isolatedModule(`pages/api/admin/${api}.ts`, {
          "@/lib/adminAccess": { getAdminContext: async () => { throw new Error(message); } },
          "@/lib/i18n/server": translationMock,
        });
        const { res, result } = response();
        await (mod.default as Handler)({ method: api === "overview" ? "GET" : "POST", headers: { authorization: "Bearer synthetic" },
          cookies: { NEXT_LOCALE: locale } }, res);
        expect(result.status).toBe(expectedStatus);
        expect(result.body).toEqual({ error: expectedError });
        expect(JSON.stringify(result.body)).not.toContain("PRIVATE-SERVICE-DETAIL");
        expect(result.headers["Cache-Control"]).toContain("no-store");
      }
    });
  }
}

for (const kind of ["platform", "lead", "teacher"] as const) {
  for (const locale of ["zh-CN", "en"] as const) {
    test(`${kind}/${locale} 旧任意recordId跟进在鉴权后拒绝，无查询或修改`, async () => {
      const mock = adminMock(kind);
      const copy = locale === "en" ? en : zh;
      const mod = await isolatedModule("pages/api/admin/followups.ts", {
        "@/lib/adminAccess": { getAdminContext: mock.getAdminContext },
        "@/lib/i18n/server": { getServerTranslator: () => (key: string) => key.split(".").reduce((value: unknown, segment) => (value as Record<string, unknown>)[segment], copy) },
      });
      const { res, result } = response();
      await (mod.default as Handler)({ method: "POST", headers: { authorization: "Bearer synthetic" }, body: { locale, schoolId: "school-a", recordId: "PRIVATE-RECORD-ID", note: "PRIVATE-NOTE" } }, res);
      expect(mock.calls.authentication).toBe(1);
      expect(result.status).toBe(403);
      expect(result.body).toEqual({ privateRecordsRestricted: true, error: copy.adminPrivateRecords.followupUnavailable });
      expect(mock.queries).toEqual([]);
      expect(result.headers["Cache-Control"]).toContain("no-store");
      expect(JSON.stringify(result.body)).not.toContain("PRIVATE-");
    });
  }
}

test("旧跟进仍拒绝错误方法、未登录和无管理权限", async () => {
  for (const [method, authorization, expected] of [["GET", "Bearer synthetic", 405], ["POST", "", 401], ["POST", "Bearer denied", 403]] as const) {
    const mock = adminMock("teacher");
    const mod = await isolatedModule("pages/api/admin/followups.ts", { "@/lib/adminAccess": { getAdminContext: mock.getAdminContext }, "@/lib/i18n/server": { getServerTranslator: () => () => "Safe message" } });
    const { res, result } = response();
    await (mod.default as Handler)({ method, headers: { authorization } }, res);
    expect(result.status).toBe(expected);
    expect(mock.queries).toEqual([]);
    if (method === "GET") expect(result.headers.Allow).toBe("POST");
  }
});

test("实际cloudRecords拒绝非本人预期且不查询，本人查询固定认证用户；退出后不查询", async () => {
  const filters: Array<[string, unknown]> = [];
  let user: { id: string } | null = { id: "current-owner" };
  let reads = 0;
  const chain = {
    select() { return chain; }, eq(key: string, value: unknown) { filters.push([key, value]); return chain; },
    order() { return chain; }, limit() { return Promise.resolve({ data: [], error: null }); },
  };
  const mod = await isolatedModule("lib/cloudRecords.ts", {
    "@/lib/supabaseClient": { getSupabase: () => ({ auth: { getUser: async () => ({ data: { user } }) }, from: (table: string) => { expect(table).toBe("sweet_records"); reads += 1; return chain; } }) },
    "@/lib/sweetRecordDays": { latestSweetRecordsPerUserDay: (rows: unknown[]) => rows },
  });
  const list = mod.listCloudSweetRecords as (attemptedOwner?: string) => Promise<unknown[]>;
  let deniedMessage = "";
  try { await list("other-student"); }
  catch (error) { deniedMessage = String((error as { message?: unknown }).message || ""); }
  expect(deniedMessage).toBe("账号已变化，请确认后再继续。");
  expect(filters).toEqual([]);
  expect(reads).toBe(0);
  expect(await list("current-owner")).toEqual([]);
  expect(filters).toEqual([["user_id", "current-owner"]]);
  expect(await list()).toEqual([]);
  expect(filters).toEqual([["user_id", "current-owner"], ["user_id", "current-owner"]]);
  user = null;
  expect(await list("other-student")).toEqual([]);
  expect(reads).toBe(2);
});
