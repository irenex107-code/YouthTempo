import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import en from "../locales/en.json";
import zh from "../locales/zh-CN.json";

type Row = Record<string, unknown>;
type Request = { method: string; headers: Record<string, string>; query: Row; cookies: Row; body?: Row };
type Response = { setHeader: (name: string, value: string) => void; status: (code: number) => Response; json: (body: unknown) => Response };
type Handler = (req: Request, res: Response) => Promise<unknown>;
type InvalidScope = "relationship_revoked" | "membership_revoked" | "student_moved" | "teacher_moved" | "school_archived" | "teacher_role_changed";
type Mode = "staff_get" | "staff_accept" | "student_accept" | "admin_resume" | "admin_offer" | "admin_transfer";

const ids = {
  teacher: "00000000-0000-4000-8000-000000000091",
  student: "00000000-0000-4000-8000-000000000092",
  school: "00000000-0000-4000-8000-000000000093",
  otherSchool: "00000000-0000-4000-8000-000000000094",
  case: "00000000-0000-4000-8000-000000000095",
  assignment: "00000000-0000-4000-8000-000000000096",
};
const summary = "SYNTHETIC_PRIVATE_SUPPORT_SUMMARY";
const availability = "SYNTHETIC_PRIVATE_AVAILABILITY";

async function isolatedModule(file: string, dependencies: Record<string, unknown> = {}) {
  const source = await readFile(path.join(process.cwd(), file), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(output, {
    module, exports: module.exports, require: (name: string) => {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unmocked import: ${name}`);
      return dependencies[name];
    },
    process: { env: {} }, console, Error, Date, Map, Set, URL,
  }, { filename: file });
  return module.exports;
}

async function harness(mode: Mode, options: { invalid?: InvalidScope; category?: string; queryError?: string } = {}) {
  const category = options.category || "school_duty_teacher";
  const status = mode === "student_accept" ? "assigned" : mode === "admin_resume" ? "paused"
    : mode === "admin_offer" ? "requested" : "active";
  const tables: Record<string, Row[]> = {
    profiles: [
      { id: ids.teacher, role: "学校支持人员", school_id: ids.school },
      { id: ids.student, role: "学生", school_id: ids.school },
    ],
    student_consents: [{ student_user_id: ids.student, age_band: "14_17", consent_basis: "student_self_pilot",
      status: "active", policy_version: "2026-08-28", student_assented_at: "2026-10-01T00:00:00Z",
      guardian_user_id: null, guardian_consented_at: null }],
    schools: [{ id: ids.school, status: "active" }],
    school_members: [{ user_id: ids.teacher, school_id: ids.school, member_role: "school_support", status: "active" }],
    teacher_student_assignments: [{ id: "school-assignment", teacher_user_id: ids.teacher,
      student_user_id: ids.student, school_id: ids.school, status: "active" }],
    support_staff_applications: [{ user_id: ids.teacher, category, status: "approved", age_scopes: ["14_17", "18_plus"] }],
    support_cases: [{ id: ids.case, student_user_id: ids.student, school_id: ids.school, case_type: "youth_request", status,
      need_summary: summary, availability, appointment_at: null, appointment_status: "none", referral_type: null,
      student_authorization_active: true, created_at: "2026-10-01T00:00:00Z" }],
    support_case_assignments: mode === "admin_offer" ? [] : [{ id: ids.assignment, case_id: ids.case,
      staff_user_id: mode === "admin_transfer" ? "previous-staff" : ids.teacher, assignment_role: "primary",
      status: mode === "staff_accept" ? "offered" : "accepted", offered_at: "2026-10-01T00:00:00Z" }],
  };
  if (options.invalid === "relationship_revoked") tables.teacher_student_assignments[0].status = "revoked";
  if (options.invalid === "membership_revoked") tables.school_members[0].status = "revoked";
  if (options.invalid === "student_moved") tables.profiles[1].school_id = ids.otherSchool;
  if (options.invalid === "teacher_moved") tables.profiles[0].school_id = ids.otherSchool;
  if (options.invalid === "school_archived") tables.schools[0].status = "archived";
  if (options.invalid === "teacher_role_changed") tables.profiles[0].role = "学生";
  // Non-school professionals must retain their existing case authorization even
  // when they have no school membership or teacher/student relationship.
  if (category !== "school_duty_teacher") {
    tables.profiles = tables.profiles.filter((row) => row.id !== ids.teacher);
    tables.school_members = []; tables.teacher_student_assignments = [];
  }
  const queries: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
  const writes: Array<{ table: string; operation: string; value: Row }> = [];
  const operationalReports: unknown[] = [];
  const supabase = {
    from(table: string) {
      if (!Object.hasOwn(tables, table)) throw new Error(`Unexpected table ${table}`);
      const query = { table, filters: [] as Array<[string, string, unknown]> };
      queries.push(query);
      let update: Row | undefined, insert: Row | undefined;
      function execute(single: boolean) {
        if (options.queryError === table) return { data: null, error: new Error("PRIVATE_DATABASE_DETAIL") };
        let data = tables[table].filter((row) => query.filters.every(([operator, key, value]) =>
          operator === "in" ? (value as unknown[]).includes(row[key]) : row[key] === value));
        if (update) {
          writes.push({ table, operation: "update", value: update });
          data.forEach((row) => Object.assign(row, update));
        }
        if (insert) {
          writes.push({ table, operation: "insert", value: insert });
          data = [{ id: "new-offer", ...insert }]; tables[table].push(...data);
        }
        return { data: single ? data[0] || null : data, error: null };
      }
      const chain = {
        select() { return chain; },
        eq(key: string, value: unknown) { query.filters.push(["eq", key, value]); return chain; },
        in(key: string, values: unknown[]) { query.filters.push(["in", key, values]); return chain; },
        order() { return chain; }, limit() { return chain; },
        update(value: Row) { update = value; return chain; },
        insert(value: Row) { insert = value; return chain; },
        async maybeSingle() { return execute(true); },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(execute(false)).then(resolve, reject);
        },
      };
      return chain;
    },
    async rpc(name: string, params: Row) {
      expect(name).toBe("transition_support_case");
      writes.push({ table: "support_cases", operation: "rpc", value: params });
      expect(params.p_expected_status).toBe(tables.support_cases[0].status);
      tables.support_cases[0].status = params.p_next_status;
      return { data: [tables.support_cases[0]], error: null };
    },
  };
  const consent = await isolatedModule("lib/studentConsent.ts");
  const workflow = await isolatedModule("lib/supportWorkflow.ts", { "@/lib/studentConsent": consent });
  const config = await isolatedModule("lib/i18n/config.ts");
  const dictionaries = await isolatedModule("lib/i18n/dictionaries.ts", { "@/locales/en.json": en, "@/locales/zh-CN.json": zh });
  const i18n = await isolatedModule("lib/i18n/server.ts", { "@/lib/i18n/config": config, "@/lib/i18n/dictionaries": dictionaries });
  const file = mode.startsWith("admin_") ? "pages/api/admin/support/cases.ts"
    : mode === "student_accept" ? "pages/api/support/case-action.ts" : "pages/api/support/staff-cases.ts";
  const loaded = await isolatedModule(file, {
    "@/lib/supportWorkflow": workflow, "@/lib/i18n/server": i18n,
    "@/lib/supabaseServer": { getAuthenticatedUser: async () => ({ id: mode === "student_accept" ? ids.student : ids.teacher }),
      getSupabaseAdmin: () => supabase },
    "@/lib/adminAccess": { requirePlatformAdmin: async () => ({ supabase, user: { id: "synthetic-platform-admin" } }) },
    "@/lib/operationalMonitoring": { reportOperationalError: async (event: unknown) => { operationalReports.push(event); } },
  });
  return {
    queries, writes, tables, operationalReports,
    async call() {
      const result = { status: 200, headers: {} as Record<string, string>, body: undefined as unknown };
      const res: Response = { setHeader(name, value) { result.headers[name] = value; },
        status(code) { result.status = code; return res; }, json(body) { result.body = body; return res; } };
      const body = mode === "staff_accept" ? { assignmentId: ids.assignment, decision: "accepted" }
        : mode === "student_accept" ? { caseId: ids.case, action: "accept_assignment" }
        : { caseId: ids.case, staffUserId: ids.teacher, note: "Synthetic authorized handoff",
          action: mode === "admin_resume" ? "resume" : mode === "admin_offer" ? "offer_primary" : "transfer" };
      await (loaded.default as Handler)({ method: mode === "staff_get" ? "GET" : "POST",
        // Every request uses the same synthetic old session; no refresh or
        // role claims supplied by the browser can restore revoked scope.
        headers: { authorization: "Bearer synthetic-old-session" }, query: { locale: "en" }, cookies: {}, body }, res);
      expect(result.headers["Cache-Control"]).toContain("no-store");
      return result;
    },
  };
}

test("当前学校值班老师本人负责且已接受的事项仍可读取必要内容", async () => {
  const mock = await harness("staff_get");
  const result = await mock.call();
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ assignments: [{ id: ids.assignment, caseId: ids.case, needSummary: summary, availability }] });
  expect(mock.writes).toEqual([]);
});

const invalidScopes: InvalidScope[] = ["relationship_revoked", "membership_revoked", "student_moved",
  "teacher_moved", "school_archived", "teacher_role_changed"];
for (const invalid of invalidScopes) {
  test(`学校值班老师${invalid}后旧会话不再返回事项或私密材料`, async () => {
    const mock = await harness("staff_get", { invalid });
    const result = await mock.call();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ assignments: [] });
    expect(JSON.stringify(result.body)).not.toContain(summary);
    expect(JSON.stringify(result.body)).not.toContain(availability);
    expect(mock.writes).toEqual([]);
  });
}

test("学校值班老师接受分配前重新核验当前范围，失效不会更新旧offered记录", async () => {
  for (const invalid of [undefined, ...invalidScopes]) {
    const mock = await harness("staff_accept", { invalid });
    const result = await mock.call();
    expect(result.status).toBe(invalid ? 403 : 200);
    if (invalid) {
      expect(result.body).toEqual({ error: en.supportFlow.errors.staffScope });
      expect(mock.writes).toEqual([]);
      expect(mock.tables.support_case_assignments[0].status).toBe("offered");
    } else {
      expect(result.body).toEqual({ status: "accepted" });
      expect(mock.tables.support_case_assignments[0].status).toBe("accepted");
    }
  }
});

for (const mode of ["student_accept", "admin_resume", "admin_offer", "admin_transfer"] as const) {
  test(`${mode}启用学校值班职责前核验当前范围，失效不写事项或撤销旧主要支持者`, async () => {
    for (const invalid of [undefined, ...invalidScopes]) {
      const mock = await harness(mode, { invalid });
      const before = JSON.stringify(mock.tables.support_case_assignments);
      const status = mock.tables.support_cases[0].status;
      const result = await mock.call();
      expect(result.status).toBe(invalid ? 409 : 200);
      if (invalid) {
        expect(mock.writes).toEqual([]);
        expect(mock.tables.support_cases[0].status).toBe(status);
        expect(JSON.stringify(mock.tables.support_case_assignments)).toBe(before);
        expect(JSON.stringify(result.body)).not.toContain(summary);
      } else expect(mock.writes.length).toBeGreaterThan(0);
    }
  });
}

for (const category of ["counselor", "social_worker", "listening_volunteer"]) {
  test(`${category}沿用既有事项授权，不要求校内老师身份或关系`, async () => {
    for (const mode of ["staff_get", "staff_accept", "student_accept", "admin_resume", "admin_offer"] as const) {
      const mock = await harness(mode, { category });
      const result = await mock.call();
      expect(result.status).toBe(200);
      if (mode === "staff_get") expect(result.body).toMatchObject({ assignments: [{ needSummary: summary }] });
      expect(mock.queries.some((query) => ["school_members", "teacher_student_assignments", "schools"].includes(query.table))).toBe(false);
    }
  });
}

test("当前职责查询失败时安全拒绝，不返回已读取的事项或内部数据库详情", async () => {
  const mock = await harness("staff_get", { queryError: "teacher_student_assignments" });
  const result = await mock.call();
  expect(result.status).toBe(503);
  expect(result.body).toEqual({ error: en.supportFlow.errors.unavailable });
  expect(JSON.stringify(result.body)).not.toContain(summary);
  expect(JSON.stringify(result.body)).not.toContain("PRIVATE_DATABASE_DETAIL");
  expect(mock.writes).toEqual([]);
  expect(mock.operationalReports).toHaveLength(1);
});
