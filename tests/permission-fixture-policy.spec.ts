import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import fixture from "./fixtures/permission-boundary.json";
import protectedProjects from "./fixtures/protected-supabase-projects.json";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
type Operation = { table: string; kind: string; filters: Array<[string, unknown[]]> };

/** Execute the actual fixture script with an in-memory SDK; no network client is loaded. */
async function harness() {
  const scriptPath = path.resolve("scripts/setup-permission-test-fixtures.mjs");
  const source = (await readFile(scriptPath, "utf8")).replaceAll("import.meta.url", "__scriptUrl");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const tables = new Map<string, Row[]>();
  const users: Array<{ id: string; email: string }> = [];
  const operations: Operation[] = [];
  let clientCalls = 0, creates = 0, updates = 0;
  function rows(table: string) {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  }
  const sdk = {
    auth: { admin: {
      async listUsers({ page }: { page: number }) { return { data: { users: page === 1 ? users : [] }, error: null }; },
      async createUser(input: { email: string }) {
        creates++;
        const user = { id: `00000000-0000-4000-8000-${String(users.length + 1).padStart(12, "0")}`, email: input.email };
        users.push(user);
        return { data: { user }, error: null };
      },
      async updateUserById(id: string) { updates++; return { data: { user: users.find((user) => user.id === id) }, error: null }; },
    } },
    from(table: string) {
      let kind = "", value: Row | Row[] = {}, keys = ["id"];
      const filters: Operation["filters"] = [];
      let result: Promise<Result> | undefined;
      const execute = (): Result => {
        operations.push({ table, kind, filters: structuredClone(filters) });
        const current = rows(table);
        const matches = (row: Row) => filters.every(([key, values]) => values.includes(row[key]));
        if (kind === "delete") tables.set(table, current.filter((row) => !matches(row)));
        else if (kind === "update") for (const row of current.filter(matches)) Object.assign(row, structuredClone(value));
        else if (kind === "upsert") {
          for (const row of Array.isArray(value) ? value : [value]) {
            if (table === "guardian_student_links" && row.status === "active") {
              return { data: null, error: { message: "pilot_guardian_links_inactive" } };
            }
            const previous = current.find((item) => keys.every((key) => item[key] === row[key]));
            if (previous) Object.assign(previous, structuredClone(row));
            else current.push(structuredClone(row));
          }
        } else throw new Error(`Unexpected fixture operation: ${table}/${kind}`);
        return { data: null, error: null };
      };
      const chain = {
        upsert(input: Row | Row[], options: { onConflict: string }) { kind = "upsert"; value = input; keys = options.onConflict.split(","); return chain; },
        delete() { kind = "delete"; return chain; },
        update(input: Row) { kind = "update"; value = input; return chain; },
        in(key: string, values: unknown[]) { filters.push([key, values]); return chain; },
        then(resolve: (result: Result) => unknown, reject: (reason: unknown) => unknown) {
          result ??= Promise.resolve().then(execute);
          return result.then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return {
    rows, users, operations, get clientCalls() { return clientCalls; }, get creates() { return creates; }, get updates() { return updates; },
    id(key: keyof typeof fixture.users) { return users.find((user) => user.email === fixture.users[key].email)!.id; },
    async run(env: Record<string, string> = {}) {
      const mocks: Record<string, unknown> = {
        "node:crypto": { createHmac }, "node:fs/promises": { readFile }, "node:url": { fileURLToPath },
        "@supabase/supabase-js": { createClient: () => { clientCalls++; return sdk; } },
      };
      const exports = {};
      await vm.runInNewContext(`(async () => { ${output}\n})()`, {
        __scriptUrl: pathToFileURL(scriptPath).href, module: { exports }, exports, URL,
        require(name: string) { if (!Object.hasOwn(mocks, name)) throw new Error(`Unmocked import: ${name}`); return mocks[name]; },
        process: { argv: ["node", scriptPath], env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
          SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key", E2E_PERMISSION_TEST_PASSWORD: "synthetic-long-password",
          ALLOW_E2E_FIXTURE_MUTATION: "true", ...env } },
        console: { log() {} },
      }, { filename: scriptPath, timeout: 2_000 });
    },
  };
}

test("实际fixture脚本保留原角色/分配，三名学生均使用本人确认且家长关系关闭", async () => {
  const mock = await harness();
  await mock.run();
  expect(mock.creates).toBe(10);
  expect(mock.rows("schools")).toHaveLength(2);
  expect(mock.rows("sweet_records")).toHaveLength(3);
  expect(mock.rows("teacher_student_assignments")).toHaveLength(2);
  expect(mock.rows("teacher_student_assignments").every((row) => row.status === "active")).toBe(true);
  expect(mock.rows("guardian_student_links")).toHaveLength(2);
  for (const row of mock.rows("guardian_student_links")) expect(row).toMatchObject({ status: "revoked", revoked_at: expect.any(String) });
  expect(mock.rows("student_consents")).toHaveLength(3);
  for (const key of ["studentOne", "studentTwo", "studentThree"] as const) {
    expect(mock.rows("student_consents").find((row) => row.student_user_id === mock.id(key))).toMatchObject({
      school_id: fixture.schools[fixture.users[key].school as keyof typeof fixture.schools].id, status: "active", age_band: "14_17",
      policy_version: "2026-08-28", consent_basis: "student_self_pilot", student_assented_at: expect.any(String),
      guardian_user_id: null, guardian_consented_at: null, withdrawn_at: null, withdrawn_by: null,
    });
  }
  for (const [key, definition] of Object.entries(fixture.users)) {
    expect(mock.rows("profiles").find((row) => row.id === mock.id(key as keyof typeof fixture.users))?.role).toBe(definition.role);
  }
});

test("重复reset恢复被改动的成员、分配、确认和记录，清理不触及外部学校或非fixture账号", async () => {
  const mock = await harness();
  await mock.run();
  const schoolA = fixture.schools.a.id, schoolB = fixture.schools.b.id;
  const teacher = mock.id("teacherOne"), student = mock.id("studentOne"), guardian = mock.id("guardianOne");
  const outsideMembership = { school_id: "outside-school", user_id: teacher, status: "active" };
  const outsideAssignment = { school_id: schoolA, teacher_user_id: teacher, student_user_id: "outside-student", status: "active" };
  const outsideLink = { school_id: schoolA, guardian_user_id: "outside-guardian", student_user_id: student, status: "revoked" };
  mock.rows("school_members").push(outsideMembership, { school_id: schoolB, user_id: teacher, status: "active" });
  mock.rows("teacher_student_assignments").push(outsideAssignment, { school_id: schoolA, teacher_user_id: teacher, student_user_id: mock.id("studentTwo"), status: "active" });
  mock.rows("guardian_student_links").push(outsideLink, { school_id: schoolB, guardian_user_id: guardian, student_user_id: mock.id("studentThree"), status: "active" });
  Object.assign(mock.rows("profiles").find((row) => row.id === teacher)!, { role: "学生", school_id: schoolB });
  Object.assign(mock.rows("teacher_student_assignments")[0], { status: "revoked" });
  Object.assign(mock.rows("student_consents")[0], { status: "withdrawn", guardian_user_id: guardian, guardian_consented_at: "old" });
  mock.rows("student_consents").splice(2, 1);
  Object.assign(mock.rows("sweet_records")[0], { summary: "changed", school_id: schoolB });
  await mock.run();
  expect(mock.creates).toBe(10);
  expect(mock.updates).toBe(10);
  expect(mock.rows("school_members")).toContainEqual(outsideMembership);
  expect(mock.rows("school_members").filter((row) => row.school_id === schoolB && row.user_id === teacher)).toEqual([]);
  expect(mock.rows("teacher_student_assignments")).toHaveLength(3);
  expect(mock.rows("teacher_student_assignments")).toContainEqual(outsideAssignment);
  expect(mock.rows("guardian_student_links")).toContainEqual(outsideLink);
  expect(mock.rows("guardian_student_links").find((row) => row.school_id === schoolB && row.guardian_user_id === guardian)?.status).toBe("revoked");
  expect(mock.rows("student_consents")).toHaveLength(3);
  expect(mock.rows("student_consents").every((row) => row.status === "active" && row.guardian_user_id === null && row.consent_basis === "student_self_pilot")).toBe(true);
  expect(mock.rows("profiles").find((row) => row.id === teacher)).toMatchObject({ role: fixture.users.teacherOne.role, school_id: schoolA });
  expect(mock.rows("sweet_records").find((row) => row.id === fixture.records.studentOne.id)).toMatchObject({ summary: fixture.records.studentOne.summary, school_id: schoolA });
});

for (const [label, ref] of Object.entries(protectedProjects)) {
  test(`实际fixture脚本在创建客户端前拒绝受保护的${label}项目`, async () => {
    const mock = await harness();
    await expect(mock.run({ NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co` })).rejects.toThrow(/拒绝在受保护/);
    expect(mock.clientCalls).toBe(0);
    expect(mock.operations).toEqual([]);
  });
}

test("实际fixture脚本缺少显式隔离变更标记时不创建客户端", async () => {
  const mock = await harness();
  await expect(mock.run({ ALLOW_E2E_FIXTURE_MUTATION: "false" })).rejects.toThrow(/必须显式设置/);
  expect(mock.clientCalls).toBe(0);
  expect(mock.operations).toEqual([]);
});
