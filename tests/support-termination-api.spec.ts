import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

// Actual handlers/helpers run with synthetic SDK/query/RPC contracts only.
// RPC replies below are fixtures, never evidence that PostgreSQL locks, SQL
// states, triggers, RLS, ACL or transaction rollback have actually executed.
const A = "00000000-0000-4000-8000-000000000011";
const B = "00000000-0000-4000-8000-000000000012";
const C = "00000000-0000-4000-8000-000000000013";
const STAFF = "00000000-0000-4000-8000-000000000014";
const R1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const R2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OLD_TIME = "2026-12-01T08:00:00.123456+00:00";
const NEW_TIME = "2026-12-02T09:30:00.654321+00:00";
const NOW = "2026-11-03T09:00:00.000Z";
type Row = Record<string, unknown>;
type RpcError = { code?: string; message?: string };
type Options = {
  consent?: "active" | "withdrawn" | "error" | "missing";
  role?: string; owner?: string; caseType?: string; status?: string;
  appointmentStatus?: string; authorization?: boolean; adult?: boolean;
  publicEnabled?: boolean; failure?: string; receipt?: Row;
  rpcData?: unknown; rpcError?: RpcError;
};
type RequestOptions = { auth?: string | null; body?: Row; query?: Row; locale?: string };
const ACTION = "pages/api/support/case-action.ts";
const CASES = "pages/api/support/cases.ts";
const FEEDBACK = "pages/api/support/feedback.ts";
const allStatuses = ["requested", "triage", "awaiting_assignment", "assigned", "active", "paused",
  "transfer_requested", "transferred", "referred", "closed", "cancelled"];
const legalStatuses: Record<string, string[]> = {
  cancel: ["requested", "triage", "awaiting_assignment", "assigned"],
  withdraw_authorization: ["active", "paused", "transfer_requested"],
  close: ["active", "paused", "transfer_requested", "transferred", "referred"],
  cancel_appointment: ["active"],
};
const nextStatus = (action: string) => action === "cancel" ? "cancelled"
  : action === "withdraw_authorization" ? "paused" : action === "close" ? "closed" : "active";
function terminationBody(action = "close", status = "active"): Row {
  return { caseId: C, action, expectedStatus: status,
    ...(action === "cancel_appointment" ? { expectedAppointmentRevision: R1 } : {}) };
}
function fixture(options: Options = {}) {
  const queries: Array<{ table: string; action: string; filters: Array<[string, unknown]>; columns: string; max: number | null }> = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const operational: unknown[] = [];
  let networkCalls = 0;
  const rows: Record<string, Row[]> = {
    profiles: [{ id: A, role: options.role || "学生" }, { id: B, role: "学生" }],
    student_consents: options.consent === "missing" ? [] : [{ student_user_id: A, status: options.consent || "active",
      age_band: options.adult ? "18_plus" : "14_17", consent_basis: options.adult ? "adult_self" : "student_self_pilot",
      policy_version: "2026-08-28", student_assented_at: NOW, guardian_user_id: null, guardian_consented_at: null }],
    support_cases: [{ id: C, student_user_id: options.owner || A, school_id: null,
      case_type: options.caseType || (options.adult ? "adult_consultation" : "youth_request"),
      status: options.status || "active", need_summary: "SYNTHETIC OWN HISTORY", availability: null,
      appointment_at: OLD_TIME, appointment_status: options.appointmentStatus || "proposed", referral_type: "medical",
      student_authorization_active: options.authorization ?? true, row_revision: R1,
      created_at: NOW, updated_at: NOW, closed_at: null }],
    support_case_assignments: [{ case_id: C, staff_user_id: STAFF, assignment_role: "primary", status: "accepted" }],
    support_staff_applications: [{ user_id: STAFF, legal_name: "Synthetic supporter", category: "counselor", status: "approved" }],
    support_case_events: [{ case_id: C, action: "requested", next_status: "requested", created_at: NOW,
      note: "SYNTHETIC INTERNAL NOTE", actor_user_id: B }],
    support_case_feedback: [], admin_roles: [],
  };
  const token = (id: string) => `e30.${Buffer.from(JSON.stringify({ sub: id, exp: 9999999999 })).toString("base64url")}.synthetic`;
  const supabase = {
    auth: { getUser: async (value: string) => [token(A), token(B)].includes(value)
      ? { data: { user: { id: value === token(A) ? A : B, email: "synthetic@example.invalid" } }, error: null }
      : { data: { user: null }, error: { status: 401 } } },
    from(table: string) {
      const query = { table, action: "select", filters: [] as Array<[string, unknown]>, columns: "", max: null as number | null };
      queries.push(query);
      let single = false;
      let payload: Row | undefined;
      const builder = {
        select(columns: string) { query.columns = columns; return builder; },
        eq(key: string, value: unknown) { query.filters.push([key, value]); return builder; },
        in(key: string, value: unknown[]) { query.filters.push([key, value]); return builder; },
        order() { return builder; }, limit(max: number) { query.max = max; return builder; },
        maybeSingle() { single = true; return builder; }, single() { single = true; return builder; },
        insert(value: Row) { query.action = "insert"; payload = value; return builder; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve().then(() => {
            if (options.failure === table || (options.consent === "error" && table === "student_consents")) {
              return { data: null, error: { message: "SYNTHETIC PRIVATE PROVIDER DETAIL" } };
            }
            let selected = (rows[table] || []).filter((row) => query.filters.every(([key, value]) =>
              Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
            if (payload) {
              const inserted = { id: C, ...payload };
              (rows[table] ||= []).push(inserted);
              selected = [inserted];
            }
            if (query.max !== null) selected = selected.slice(0, query.max);
            if (query.columns) selected = selected.map((row) => Object.fromEntries(query.columns.split(",").map((key) => [key, row[key]])));
            return { data: single ? selected[0] || null : selected, error: null };
          }).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name: string, args: Row) {
      rpcCalls.push({ name, args });
      if (options.rpcError) return { data: null, error: options.rpcError };
      if (Object.hasOwn(options, "rpcData")) return { data: options.rpcData, error: null };
      if (name === "transition_support_case") return { data: [{ case_id: C, case_status: args.p_next_status }], error: null };
      if (name !== "terminate_support_case") throw new Error("Unexpected RPC");
      // An explicit successful database reply fixture, not an SQL implementation.
      return { data: [{ case_id: C, case_action: args.p_action, case_status: nextStatus(String(args.p_action)),
        appointment_at: OLD_TIME, appointment_status: args.p_action === "cancel_appointment" ? "cancelled" : "proposed",
        referral_type: "medical", student_authorization_active: args.p_action === "cancel_appointment" ? (options.authorization ?? true) : false,
        matched_revision: R1, row_revision: R2, ...options.receipt }], error: null };
    },
  };
  const cache = new Map<string, Record<string, unknown>>();
  const mocks: Record<string, unknown> = {
    "@supabase/supabase-js": { createClient: (url: string, key: string) => {
      if (url !== "https://synthetic.invalid" || key !== "synthetic-server-key") throw new Error("Unexpected SDK configuration");
      return supabase;
    } },
    "@/lib/operationalMonitoring": { reportOperationalError: async (value: unknown) => { operational.push(value); } },
    "@/lib/rateLimit": { enforceUserRateLimit: async () => true },
    "@/lib/safety/crisisDetection": { detectCrisis: () => ({ isUrgent: false }) },
    "@/lib/i18n/server": { getRequestLocale: (req: { query: { locale: string } }) => req.query.locale,
      getServerTranslator: (locale: string) => (key: string) => key.split(".").reduce<unknown>((value, part) => (value as Row)?.[part], locale === "en" ? en : zh) },
  };
  const allowed = new Set(["lib/supabaseServer.ts", "lib/studentConsent.ts", "lib/supportWorkflow.ts", "lib/i18n/config.ts", ACTION, CASES, FEEDBACK]);
  function load(file: string): Record<string, unknown> {
    if (cache.has(file)) return cache.get(file)!;
    if (!allowed.has(file)) throw new Error(`Unmocked source: ${file}`);
    const loadedModule = { exports: {} as Record<string, unknown> };
    cache.set(file, loadedModule.exports);
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(source, {
      module: loadedModule, exports: loadedModule.exports, Buffer, URL, Date, Error,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-key",
        FORMAL_CONSULTATION_PUBLIC_ENABLED: options.publicEnabled ? "true" : "false", FORMAL_CONSULTATION_INTERNAL_ENABLED: "false" } },
      require: (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : load(name.replace(/^@\//, "") + ".ts"),
      fetch: () => { ++networkCalls; throw new Error("Network forbidden"); },
    }, { filename: file });
    return loadedModule.exports;
  }
  async function request(file = ACTION, method = "POST", extra: RequestOptions = {}) {
    const result = { status: 0, body: {} as Row, headers: {} as Record<string, string> };
    const res = { setHeader: (key: string, value: string) => { result.headers[key] = value; },
      status: (status: number) => { result.status = status; return res; }, json: (body: Row) => { result.body = body; return res; } };
    const handler = load(file).default as (req: unknown, res: unknown) => Promise<unknown>;
    await handler({ method, headers: { authorization: extra.auth === null ? "" : `Bearer ${extra.auth || token(A)}` },
      cookies: {}, body: extra.body || {}, query: { locale: extra.locale || "zh-CN", ...extra.query } }, res);
    expect(networkCalls).toBe(0);
    return result;
  }
  return { rows, queries, rpcCalls, operational, request, token };
}

for (const locale of ["zh-CN", "en"]) {
  for (const [action, statuses] of Object.entries(legalStatuses)) {
    test(`termination API ${locale} ${action}: legal states relay actual RPC result`, async () => {
      for (const status of statuses) {
        const f = fixture({ status, consent: "withdrawn" });
        const response = await f.request(ACTION, "POST", { locale, body: { ...terminationBody(action, status),
          userId: B, actorId: B, student_user_id: B, role: "平台管理员", authorizationActive: true,
          appointmentAt: "FORGED", referralType: "FORGED", note: "FORGED" } });
        expect(response.status).toBe(200);
        expect(response.headers["Cache-Control"]).toBe("no-store, max-age=0");
        expect(response.body).toMatchObject({ caseId: C, action, status: nextStatus(action),
          appointmentAt: OLD_TIME, referralType: "medical", revision: R2, matchedRevision: R1,
          authorizationActive: action === "cancel_appointment" });
        expect(f.rpcCalls).toEqual([{ name: "terminate_support_case", args: {
          p_case_id: C, p_actor_id: A, p_action: action, p_expected_status: status,
          p_expected_revision: action === "cancel_appointment" ? R1 : null,
        } }]);
        expect(f.queries.some((query) => query.table === "student_consents")).toBe(false);
        expect(f.queries.every((query) => query.action === "select")).toBe(true);
        expect(f.queries.find((query) => query.table === "support_cases")?.filters).toContainEqual(["student_user_id", A]);
      }
    });
  }
  test(`termination API ${locale} actual lock-time unrelated fields need not equal pre-read snapshot`, async () => {
    for (const action of ["cancel", "withdraw_authorization", "close"]) {
      const status = action === "cancel" ? "requested" : "active";
      const f = fixture({ status, receipt: { appointment_at: NEW_TIME, appointment_status: "accepted", referral_type: "school" } });
      const response = await f.request(ACTION, "POST", { locale, body: terminationBody(action, status) });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ appointmentAt: NEW_TIME, appointmentStatus: "accepted", referralType: "school" });
    }
  });
  test(`termination API ${locale} identity and ownership reject before any RPC`, async () => {
    for (const role of ["家长", "学校支持人员", "专业支持人员", "平台管理员"]) {
      const f = fixture({ role });
      expect((await f.request(ACTION, "POST", { locale, body: terminationBody() })).status).toBe(403);
      expect(f.rpcCalls).toHaveLength(0); expect(f.queries.some((query) => query.table === "support_cases")).toBe(false);
    }
    const f = fixture({ owner: B });
    expect((await f.request(ACTION, "POST", { locale, body: { ...terminationBody(), owner: A, role: "学生" } })).status).toBe(404);
    expect(f.rpcCalls).toHaveLength(0);
    const g = fixture();
    for (const auth of [null, "malformed", g.token(B)]) {
      const response = await g.request(ACTION, "POST", { locale, auth, body: terminationBody() });
      expect(response.status).toBe(auth === g.token(B) ? 404 : 401);
    }
    expect(g.rpcCalls).toHaveLength(0);
  });
  test(`termination API ${locale} consent read failure never authorizes new or continuing service`, async () => {
    for (const consent of ["withdrawn", "error", "missing"] as const) {
      const terminal = fixture({ consent });
      expect((await terminal.request(ACTION, "POST", { locale, body: terminationBody() })).status).toBe(200);
      expect(terminal.queries.some((query) => query.table === "student_consents")).toBe(false);
      for (const action of ["accept_assignment", "reject_assignment", "request_change", "accept_appointment", "request_reschedule"]) {
        const f = fixture({ consent, status: action.includes("assignment") ? "assigned" : "active" });
        expect([403, 503]).toContain((await f.request(ACTION, "POST", { locale, body: { caseId: C, action } })).status);
        expect(f.rpcCalls).toHaveLength(0);
      }
      for (const file of [CASES, FEEDBACK]) {
        const f = fixture({ consent, status: "closed" });
        expect([403, 503]).toContain((await f.request(file, "POST", { locale,
          body: { type: "youth_request", caseId: C, needSummary: "SYNTHETIC NEW", complaint: false } })).status);
        expect(f.queries.every((query) => query.action === "select")).toBe(true);
      }
    }
  });
}

for (const [action, statuses] of Object.entries(legalStatuses)) {
  test(`termination API ${action}: mocked DB conflicts remain 409 for every illegal original state`, async () => {
    for (const status of allStatuses.filter((value) => !statuses.includes(value))) {
      const f = fixture({ status, rpcError: { code: "40001", message: "SYNTHETIC PRIVATE SQL DETAIL" } });
      const response = await f.request(ACTION, "POST", { body: terminationBody(action, status) });
      expect(response.status).toBe(409); expect(response.body.caseId).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain("SYNTHETIC PRIVATE");
      expect(f.rpcCalls).toHaveLength(1); expect(f.rpcCalls[0].name).toBe("terminate_support_case");
    }
  });
}

test("termination API invalid/changed appointment revisions are not silently rebased", async () => {
  for (const value of [undefined, null, "invalid", [], {}]) {
    const f = fixture();
    const response = await f.request(ACTION, "POST", { body: { ...terminationBody("cancel_appointment"), expectedAppointmentRevision: value } });
    expect(response.status).toBe(400); expect(f.rpcCalls).toHaveLength(0);
  }
  const f = fixture(); f.rows.support_cases[0].row_revision = R2;
  expect((await f.request(ACTION, "POST", { body: { ...terminationBody("cancel_appointment"), expectedAppointmentRevision: R1.toUpperCase() } })).status).toBe(200);
  expect(f.rpcCalls[0].args.p_expected_revision).toBe(R1); // never replaces displayed R1 with API pre-read R2
  for (const appointmentStatus of ["none", "reschedule_requested", "cancelled"]) {
    const g = fixture({ appointmentStatus, rpcError: { code: "40001" } });
    expect((await g.request(ACTION, "POST", { body: terminationBody("cancel_appointment") })).status).toBe(409);
    expect(g.rpcCalls).toHaveLength(1);
  }
});

test("termination API errors are safe and missing new RPC never falls back to legacy", async () => {
  for (const [code, status] of [["42501", 403], ["40001", 409], ["22023", 400], ["PGRST202", 503], ["XX000", 503]] as const) {
    const f = fixture({ rpcError: { code, message: "SYNTHETIC PRIVATE SQL DETAIL" } });
    const response = await f.request(ACTION, "POST", { body: terminationBody() });
    expect(response.status).toBe(status); expect(typeof response.body.error).toBe("string");
    expect(JSON.stringify(response.body)).not.toContain("SYNTHETIC PRIVATE");
    expect(f.rpcCalls.map((call) => call.name)).toEqual(["terminate_support_case"]);
  }
  for (const failure of ["profiles", "support_cases"]) {
    const f = fixture({ failure });
    const response = await f.request(ACTION, "POST", { body: terminationBody() });
    expect(response.status).toBe(503); expect(f.rpcCalls).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toContain("SYNTHETIC PRIVATE");
  }
});

for (const [field, value] of [
  ["case_id", B], ["case_action", "cancel"], ["case_status", "active"], ["row_revision", R1],
  ["row_revision", "invalid"], ["matched_revision", null], ["appointment_status", ["proposed"]],
  ["appointment_status", "invalid"], ["referral_type", ["school"]], ["referral_type", "invalid"],
  ["student_authorization_active", true], ["student_authorization_active", "false"],
  ["appointment_at", "not-a-time"], ["appointment_at", ""], ["appointment_at", []], ["appointment_at", 123],
] as Array<[string, unknown]>) {
  test(`termination API malformed actual receipt ${field}=${JSON.stringify(value)} is unknown-safe`, async () => {
    const f = fixture({ receipt: { [field]: value } });
    const response = await f.request(ACTION, "POST", { body: terminationBody() });
    expect(response.status).toBe(503); expect(response.body.caseId).toBeUndefined();
    expect(f.rpcCalls.map((call) => call.name)).toEqual(["terminate_support_case"]);
  });
}

test("termination API missing/multiple/non-array DB receipts and appointment mismatch cannot report saved", async () => {
  for (const rpcData of [null, [], {}, [{ case_id: C }, { case_id: C }]]) {
    const f = fixture({ rpcData });
    expect((await f.request(ACTION, "POST", { body: terminationBody() })).status).toBe(503);
    expect(f.rpcCalls).toHaveLength(1);
  }
  for (const receipt of [{ matched_revision: R2 }, { appointment_status: "accepted" }]) {
    const f = fixture({ receipt });
    expect((await f.request(ACTION, "POST", { body: terminationBody("cancel_appointment") })).status).toBe(503);
  }
  const f = fixture({ receipt: { appointment_at: null } });
  expect((await f.request(ACTION, "POST", { body: terminationBody() })).status).toBe(200);
});

test("termination API false authorization is never restored and adult history may terminate with service closed", async () => {
  for (const action of Object.keys(legalStatuses)) {
    const status = action === "cancel" ? "requested" : "active";
    const f = fixture({ status, authorization: false, adult: true, publicEnabled: false, consent: "withdrawn" });
    const response = await f.request(ACTION, "POST", { body: { ...terminationBody(action, status), authorizationActive: true } });
    expect(response.status).toBe(200); expect(response.body.authorizationActive).toBe(false);
    expect(f.queries.some((query) => query.table === "student_consents" || query.table === "admin_roles")).toBe(false);
  }
});

test("termination API basic method/input/type boundaries perform no transition", async () => {
  const f = fixture();
  expect((await f.request(ACTION, "GET")).status).toBe(405);
  for (const body of [{ caseId: "invalid", action: "close" }, { caseId: C, action: null }, { caseId: C, action: "close" }]) {
    expect((await f.request(ACTION, "POST", { body })).status).toBe(400);
  }
  expect(f.rpcCalls).toHaveLength(0);
  const g = fixture({ caseType: "unknown" });
  expect((await g.request(ACTION, "POST", { body: terminationBody() })).status).toBe(403);
  expect(g.rpcCalls).toHaveLength(0);
  const h = fixture();
  expect((await h.request(ACTION, "POST", { body: { caseId: C, action: "unknown" } })).status).toBe(409);
  expect(h.rpcCalls).toHaveLength(0);
});

test("affected history GET returns only self revision, bounded events and zero writes even on consent failure", async () => {
  const f = fixture({ consent: "error" });
  f.rows.support_cases.push({ ...f.rows.support_cases[0], id: B, student_user_id: B, need_summary: "OTHER PRIVATE" });
  const response = await f.request(CASES, "GET", { query: { owner: B } });
  expect(response.status).toBe(200); expect(response.body.canUseNewService).toBe(false);
  const cases = response.body.cases as Row[];
  expect(cases).toHaveLength(1); expect(cases[0]).toMatchObject({ id: C, row_revision: R1 });
  expect(JSON.stringify(response.body)).not.toMatch(/OTHER PRIVATE|SYNTHETIC INTERNAL NOTE|student_user_id/);
  expect(f.queries.find((query) => query.table === "support_cases")?.max).toBe(50);
  expect(f.queries.find((query) => query.table === "support_case_events")?.max).toBe(500);
  expect(f.queries.every((query) => query.action === "select")).toBe(true); expect(f.rpcCalls).toHaveLength(0);
});

test("affected new, continuation and feedback keep their successful contracts under complete eligibility", async () => {
  const create = fixture();
  const created = await create.request(CASES, "POST", { body: { type: "youth_request", needSummary: "Synthetic request", availability: "Afternoon" } });
  expect(created.status).toBe(201); expect(created.body).toMatchObject({ id: C, status: "requested", urgent: false });
  expect(create.queries.find((query) => query.table === "support_cases" && query.action === "insert")).toBeDefined();
  for (const [action, status, expected, appointment] of [
    ["accept_assignment", "assigned", "active", "proposed"], ["reject_assignment", "assigned", "transfer_requested", "proposed"],
    ["request_change", "active", "transfer_requested", "proposed"], ["accept_appointment", "active", "active", "accepted"],
    ["request_reschedule", "active", "active", "reschedule_requested"],
  ]) {
    const f = fixture({ status });
    expect((await f.request(ACTION, "POST", { body: { caseId: C, action } })).body).toMatchObject({ status: expected, appointmentStatus: appointment });
    expect(f.rpcCalls.map((call) => call.name)).toEqual(["transition_support_case"]);
    expect(f.rpcCalls[0].args.p_actor_id).toBe(A); expect(f.rpcCalls[0].args.p_actor_role).toBe("student");
  }
  const feedback = fixture({ status: "closed" });
  const saved = await feedback.request(FEEDBACK, "POST", { body: { caseId: C, complaint: false, comment: "Synthetic feedback" } });
  expect(saved.status).toBe(201); expect(saved.body).toMatchObject({ saved: true, urgent: false });
  expect(feedback.queries.find((query) => query.table === "support_case_feedback" && query.action === "insert")).toBeDefined();
});

test("affected continuation denies withdrawn authorization and wrong-age/closed adult scope", async () => {
  const cases = [fixture({ authorization: false }), fixture({ caseType: "adult_consultation" }), fixture({ adult: true, publicEnabled: false })];
  for (const f of cases) {
    expect((await f.request(ACTION, "POST", { body: { caseId: C, action: "request_change" } })).status).toBe(403);
    expect(f.rpcCalls).toHaveLength(0);
  }
  const mismatch = fixture({ adult: true, caseType: "youth_request" });
  expect((await mismatch.request(ACTION, "POST", { body: { caseId: C, action: "request_change" } })).status).toBe(403);
  expect(mismatch.rpcCalls).toHaveLength(0);
});

test("account supportCases export projection remains fixed and does not add internal row revision", () => {
  const source = readFileSync("pages/api/account/data.ts", "utf8");
  const query = source.match(/rows\(supabase\.from\("support_cases"\)\.select\("([^"]+)"\)\.eq\("student_user_id", user\.id\)\.order\("created_at"\)\)/);
  expect(query).not.toBeNull();
  expect(query?.[1]).toBe("id,case_type,status,need_summary,availability,appointment_at,appointment_status,referral_type,created_at,updated_at,closed_at");
  expect(query?.[1].split(",")).not.toContain("row_revision");
});


test("affected service writes require every part of current complete consent", async () => {
  const invalid = [
    { policy_version: "old-policy" }, { student_assented_at: null }, { age_band: "under_14" },
    { consent_basis: "not_applicable" }, { consent_basis: "student_guardian", guardian_user_id: null, guardian_consented_at: NOW },
    { consent_basis: "student_guardian", guardian_user_id: B, guardian_consented_at: null },
  ];
  for (const override of invalid) {
    for (const file of [ACTION, CASES, FEEDBACK]) {
      const f = fixture({ status: file === FEEDBACK ? "closed" : "active" });
      Object.assign(f.rows.student_consents[0], override);
      const result = await f.request(file, "POST", { body: file === ACTION ? { caseId: C, action: "request_change" }
        : file === CASES ? { type: "youth_request", needSummary: "Synthetic new request" }
        : { caseId: C, complaint: false, comment: "Synthetic feedback" } });
      expect(result.status).toBe(403); expect(f.rpcCalls).toHaveLength(0);
      expect(f.queries.every((q) => q.action === "select")).toBe(true);
    }
  }
  const valid = fixture();
  Object.assign(valid.rows.student_consents[0], { consent_basis: "student_guardian", guardian_user_id: B, guardian_consented_at: NOW });
  expect((await valid.request(ACTION, "POST", { body: { caseId: C, action: "request_change" } })).status).toBe(200);
});
