import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

const A = "00000000-0000-4000-8000-000000000011";
const B = "00000000-0000-4000-8000-000000000012";
const ID = "00000000-0000-4000-8000-000000000013";
type Row = Record<string, unknown>;
type Options = { consent?: string; role?: string; failure?: string; empty?: boolean; adult?: boolean;
  publicEnabled?: boolean; internalEnabled?: boolean; allowlisted?: boolean; eligibilityError?: boolean };
function fixture(options: Options = {}) {
  const today = new Date().toISOString();
  const rows: Record<string, Row[]> = {
    profiles: [{ id: A, role: options.role || "学生" }, { id: B, role: "学生" }],
    student_consents: [{ student_user_id: A, status: options.consent || "active", age_band: options.adult ? "18_plus" : "14_17",
      consent_basis: options.adult ? "adult_self" : "student_self_pilot", policy_version: "2026-08-28", student_assented_at: today,
      guardian_user_id: null, guardian_consented_at: null }],
    support_cases: [A, B].map((id) => ({ id: id === A ? ID : B, student_user_id: id, case_type: options.adult ? "adult_consultation" : "youth_request",
      status: "active", need_summary: id === A ? "Own request" : "OTHER PRIVATE", appointment_status: "proposed" })),
    support_case_assignments: [ID, B].map((id) => ({ case_id: id, staff_user_id: id, assignment_role: "primary", status: "accepted" })),
    support_case_events: [ID, B].map((id) => ({ case_id: id, action: "requested", next_status: "requested", created_at: today, note: "INTERNAL NOTE", actor_id: B })),
    support_case_feedback: [{ case_id: ID, student_user_id: A, comment: "PRIVATE FEEDBACK" }, { case_id: B, student_user_id: B }],
    support_staff_applications: [ID, B].map((id) => ({ user_id: id, legal_name: id === ID ? "Own supporter" : "OTHER STAFF", category: "counselor", status: "approved", credential_number: "SECRET" })),
    admin_roles: [],
  };
  if (options.empty) rows.support_cases = [];
  const queries: Array<{ table: string; action: string; filters: Array<[string, unknown]>; columns: string; max: number | null }> = [];
  let authCalls = 0;
  const token = (id: string, expired = false) => `e30.${Buffer.from(JSON.stringify({ sub: id, exp: expired ? 1 : 9999999999 })).toString("base64url")}.synthetic`;
  const supabase = {
    auth: { getUser: async (value: string) => {
      ++authCalls;
      return [token(A), token(B)].includes(value) ? { data: { user: { id: value === token(A) ? A : B, email: "synthetic@example.invalid" } }, error: null }
        : { data: { user: null }, error: { status: 401 } };
    } },
    from(table: string) {
      const q = { table, action: "select", filters: [] as Array<[string, unknown]>, columns: "", max: null as number | null }; queries.push(q);
      let single = false;
      let payload: Row | undefined;
      const builder = {
        select(columns: string) { q.columns = columns; return builder; },
        eq(key: string, value: unknown) { q.filters.push([key, value]); return builder; },
        in(key: string, value: unknown[]) { q.filters.push([key, value]); return builder; },
        order() { return builder; }, limit(value: number) { q.max = value; return builder; },
        maybeSingle() { single = true; return builder; }, single() { single = true; return builder; },
        delete() { q.action = "delete"; return builder; },
        insert(value: Row) { q.action = "insert"; payload = value; return builder; },
        upsert(value: Row) { q.action = "upsert"; payload = value; return builder; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve().then(() => {
            if (options.failure === table || (options.eligibilityError && table === "admin_roles") || (options.consent === "error" && table === "student_consents")) {
              return { data: null, error: new Error("synthetic-private-provider-error") };
            }
            const match = (row: Row) => q.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value);
            let selected = (rows[table] || []).filter(match);
            if (q.max) selected = selected.slice(0, q.max);
            selected = selected.map((row) => Object.fromEntries(q.columns.split(",").map((k) => [k, row[k]])));
            if (q.action === "delete") rows[table] = rows[table].filter((row) => !match(row));
            if (payload) { selected = [{ id: ID, ...payload }]; rows[table].push(...selected); }
            return { data: single ? selected[0] || null : selected, error: null };
          }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const cache = new Map<string, Record<string, unknown>>();
  const mocks: Record<string, unknown> = {
    "@supabase/supabase-js": { createClient: () => supabase },
    "@/lib/operationalMonitoring": { reportOperationalError: async () => {} },
    "@/lib/rateLimit": { enforceUserRateLimit: async () => true },
    "@/lib/safety/crisisDetection": { detectCrisis: () => ({ isUrgent: false }) },
    "@/lib/i18n/server": { getRequestLocale: (req: { query: { locale: string } }) => req.query.locale,
      getServerTranslator: (locale: string) => (key: string) => key.split(".").reduce<unknown>((o, k) => (o as Row)?.[k], locale === "en" ? en : zh) },
  };
  const allowed = new Set(["lib/supabaseServer.ts", "lib/studentConsent.ts", "lib/supportWorkflow.ts", "lib/i18n/config.ts",
    "pages/api/support/cases.ts", "pages/api/support/case-action.ts", "pages/api/support/feedback.ts"]);
  function load(file: string): Record<string, unknown> {
    if (cache.has(file)) return cache.get(file)!;
    if (!allowed.has(file)) throw new Error(`Unmocked source: ${file}`);
    const loadedModule = { exports: {} as Record<string, unknown> }; cache.set(file, loadedModule.exports);
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(source, {
      module: loadedModule, exports: loadedModule.exports, Buffer, URL, Date, Error,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-key",
        FORMAL_CONSULTATION_PUBLIC_ENABLED: options.publicEnabled ? "true" : "false",
        FORMAL_CONSULTATION_INTERNAL_ENABLED: options.internalEnabled || options.eligibilityError ? "true" : "false",
        FORMAL_CONSULTATION_TEST_USER_IDS: options.allowlisted ? A : "" } },
      require: (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : load(name.replace(/^@\//, "") + ".ts"),
      fetch: () => { throw new Error("Network forbidden"); },
    }, { filename: file });
    return loadedModule.exports;
  }
  async function request(file = "pages/api/support/cases.ts", method = "GET", extra: { auth?: string | null; body?: Row; query?: Row; locale?: string } = {}) {
    const result = { status: 0, body: {} as Row, headers: {} as Record<string, string> };
    const res = { setHeader: (k: string, v: string) => { result.headers[k] = v; },
      status: (status: number) => { result.status = status; return res; }, json: (body: Row) => { result.body = body; return res; } };
    const handler = load(file).default as (req: unknown, res: unknown) => Promise<unknown>;
    await handler({ method, headers: { authorization: extra.auth === null ? "" : `Bearer ${extra.auth || token(A)}` },
      cookies: {}, body: extra.body || {}, query: { locale: extra.locale || "zh-CN", ...extra.query } }, res);
    return result;
  }
  return { rows, queries, request, token, authCalls: () => authCalls, load };
}

for (const locale of ["zh-CN", "en"]) {
  test(`P01 merged API ${locale} distinguishes adult service availability without hiding history`, async () => {
    const scenarios = [
      { options: { adult: true }, reason: "not_open", available: false },
      { options: { adult: true, internalEnabled: true }, reason: "ineligible", available: false },
      { options: { adult: true, publicEnabled: true }, reason: "available", available: true },
      { options: { adult: true, internalEnabled: true, allowlisted: true }, reason: "available", available: true },
      { options: { adult: true, eligibilityError: true }, reason: "unavailable", available: false },
      { options: { adult: true, consent: "withdrawn" }, reason: "ineligible", available: false },
    ] as const;
    for (const scenario of scenarios) {
      const f = fixture(scenario.options);
      const response = await f.request(undefined, "GET", { locale });
      expect(response.status).toBe(200);
      expect(response.body.adultAvailabilityReason).toBe(scenario.reason);
      expect(response.body.consultationAvailable).toBe(scenario.available);
      expect(response.body.canUseNewService).toBe(scenario.available);
      expect(response.body.cases).toHaveLength(1);
      expect(f.queries.every((query) => query.action === "select")).toBe(true);
    }
  });
}


for (const locale of ["zh-CN", "en"]) {
  for (const consent of ["active", "withdrawn", "error"]) {
    test(`API ${locale} ${consent}: own history independent of consent, zero writes`, async () => {
      const f = fixture({ consent });
      const r = await f.request(undefined, "GET", { locale, body: { owner: B, role: "admin" }, query: { caseId: B, student_user_id: B } });
      expect(r.status).toBe(200); expect(f.authCalls()).toBe(1);
      expect(r.headers["Cache-Control"]).toBe("no-store, max-age=0");
      expect(r.body.canUseNewService).toBe(consent === "active");
      const cases = r.body.cases as Row[];
      expect(cases).toHaveLength(1); expect(cases[0].id).toBe(ID);
      expect(cases[0].events).toEqual([{ action: "requested", status: "requested", createdAt: expect.any(String) }]);
      expect(JSON.stringify(r.body)).not.toMatch(/OTHER PRIVATE|OTHER STAFF|INTERNAL NOTE|PRIVATE FEEDBACK|credential_number|actor_id|student_user_id/);
      expect(f.queries.every((q) => q.action === "select")).toBe(true);
      expect(f.queries.find((q) => q.table === "support_cases")?.filters).toContainEqual(["student_user_id", A]);
      expect(f.queries.find((q) => q.table === "support_cases")?.max).toBe(50);
      expect(f.queries.find((q) => q.table === "support_case_events")?.max).toBe(500);
      for (const table of ["support_case_assignments", "support_case_events", "support_case_feedback"]) {
        expect(f.queries.find((q) => q.table === table)?.filters).toContainEqual(["case_id", [ID]]);
      }
    });
  }
  for (const opts of [{ adult: true }, { adult: true, consent: "withdrawn" }, { adult: true, eligibilityError: true }]) {
    test(`API ${locale} adult qualification ${JSON.stringify(opts)} does not hide history`, async () => {
      const f = fixture(opts); const r = await f.request(undefined, "GET", { locale });
      expect(r.status).toBe(200); expect(r.body.canUseNewService).toBe(false); expect(r.body.cases).toHaveLength(1);
    });
  }
  for (const failure of ["profiles", "support_cases", "support_case_assignments", "support_case_events", "support_case_feedback", "support_staff_applications"]) {
    test(`API ${locale} ${failure} failure refuses private response`, async () => {
      const f = fixture({ failure, consent: "error" }); const r = await f.request(undefined, "GET", { locale });
      expect(r.status).toBe(503); expect(r.body.cases).toBeUndefined(); expect(JSON.stringify(r.body)).not.toContain("synthetic-private");
    });
  }
  for (const role of ["家长", "学校支持人员", "专业支持人员", "平台管理员"]) {
    test(`API ${locale} role ${role} cannot gain self-history student scope`, async () => {
      const f = fixture({ role }); expect((await f.request(undefined, "GET", { locale })).status).toBe(403);
      expect(f.queries.some((q) => q.table === "support_cases")).toBe(false);
    });
  }
  test(`API ${locale} missing role and aggregate limits fail closed or stay bounded`, async () => {
    const f = fixture(); f.rows.profiles = [];
    expect((await f.request(undefined, "GET", { locale })).status).toBe(403);
    expect(f.queries.some((q) => q.table === "support_cases")).toBe(false);
    const g = fixture({ consent: "withdrawn" });
    g.rows.support_cases = Array.from({ length: 60 }, (_, i) => ({ ...g.rows.support_cases[0], id: "case-" + i }));
    g.rows.support_case_events = Array.from({ length: 600 }, () => ({ case_id: "case-0", action: "requested", created_at: "2026-11-01T00:00:00Z" }));
    const r = await g.request(undefined, "GET", { locale });
    expect(r.body.cases).toHaveLength(50); expect((r.body.cases as Row[])[0].events).toHaveLength(500);
  });
  test(`API ${locale} missing/invalid identity and other object never accepted`, async () => {
    const f = fixture(); expect((await f.request(undefined, "GET", { locale, auth: null })).status).toBe(401);
    expect((await f.request(undefined, "GET", { locale, auth: "invalid" })).status).toBe(401);
    const r = await f.request(undefined, "GET", { locale, auth: f.token(B), query: { owner: A, caseId: ID } });
    expect(r.status).toBe(200); expect((r.body.cases as Row[]).map((c) => c.id)).toEqual([B]);
  });
  test(`API ${locale} empty history reads only and historical types do not depend on consent age`, async () => {
    const f = fixture({ empty: true, consent: "withdrawn" }); const r = await f.request(undefined, "GET", { locale });
    expect(r.status).toBe(200); expect(r.body.cases).toEqual([]); expect(f.queries.every((q) => q.action === "select")).toBe(true);
    const g = fixture({ consent: "error" }); g.rows.support_cases[0].case_type = "adult_consultation";
    expect((await g.request(undefined, "GET", { locale })).body.cases).toHaveLength(1);
  });
  for (const consent of ["withdrawn", "error"]) {
    test(`API ${locale} ${consent} all original write gates retained`, async () => {
      for (const action of ["accept_assignment", "accept_appointment", "request_change", "request_reschedule", "cancel", "withdraw_authorization", "close", "cancel_appointment"]) {
        const f = fixture({ consent }); const r = await f.request("pages/api/support/case-action.ts", "POST", { locale, body: { caseId: ID, action } });
        expect([403, 503]).toContain(r.status); expect(f.queries.every((q) => q.action === "select")).toBe(true);
      }
      for (const file of ["pages/api/support/cases.ts", "pages/api/support/feedback.ts"]) {
        const f = fixture({ consent }); expect([403, 503]).toContain((await f.request(file, "POST", { locale, body: { type: "youth_request", caseId: ID, needSummary: "new", complaint: false } })).status);
        expect(f.queries.every((q) => q.action === "select")).toBe(true);
      }
    });
  }
}
