import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";

// Actual application handlers and scope helpers, synthetic SDK/data only.
// rpcData is an explicit reply fixture; no PostgreSQL/ACL/RLS/transaction proof.
type Row = Record<string, unknown>;
type Filter = { op: string; key: string; value: unknown };
type Query = { table: string; action: string; columns: string; filters: Filter[];
  orders: Array<{ key: string; ascending: boolean }>; range: [number, number] | null; max: number | null };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T1 = uuid(1), T2 = uuid(2), T3 = uuid(3), A = uuid(11), B = uuid(12), S1 = uuid(21), S2 = uuid(22);
const M1 = uuid(31), M2 = uuid(32), M3 = uuid(33), M4 = uuid(34), SELF = uuid(35);
const NOW = "2026-11-04T01:00:00.000Z";
const MESSAGES = "pages/api/messages.ts", EXPORT = "pages/api/account/data.ts";
const syntheticDetail = "SYNTHETIC PRIVATE DATABASE DETAIL";
type Options = {
  actor?: string; failTable?: string; failConsentRead?: number; withdrawOnConsentRead?: number;
  mutateOnConsentRead?: (rows: Record<string, Row[]>, ordinal: number) => void;
  mutateBeforeTeacherProfile?: (rows: Record<string, Row[]>, ordinal: number) => void;
  rpcData?: unknown; rpcError?: { message: string }; rpcThrow?: boolean;
};
const activeConsent = (id: string): Row => ({ student_user_id: id, age_band: "14_17", consent_basis: "student_self_pilot",
  status: "active", policy_version: "2026-08-28", student_assented_at: NOW, guardian_user_id: null, guardian_consented_at: null });
const message = (id: string, sender = A, recipient = T1, extra: Row = {}): Row => ({ id, school_id: S1,
  sender_user_id: sender, recipient_type: "teacher", recipient_user_id: recipient, anonymous_to_recipient: false,
  body: `SYNTHETIC BODY ${id}`, moderation_status: "sent", duty_status: "not_applicable", alert_delivery_status: "not_requested",
  read_at: null, created_at: NOW, ...extra });

function fixture(options: Options = {}) {
  const rows: Record<string, Row[]> = {
    profiles: [
      ...[T1, T2, T3].map(id => ({ id, role: "学校支持人员", school_id: S1, display_name: `Synthetic teacher ${id}` })),
      ...[A, B].map(id => ({ id, role: "学生", school_id: S1, display_name: `Synthetic student ${id}` })),
    ],
    schools: [{ id: S1, status: "active" }, { id: S2, status: "active" }],
    school_members: [T1, T2, T3].map(user_id => ({ id: uuid(100 + Number(user_id.slice(-2))), user_id, school_id: S1, member_role: "school_support", status: "active" })),
    teacher_student_assignments: [
      { id: uuid(41), teacher_user_id: T1, student_user_id: A, school_id: S1, status: "active" },
      { id: uuid(42), teacher_user_id: T1, student_user_id: B, school_id: S1, status: "active" },
      { id: uuid(43), teacher_user_id: T2, student_user_id: A, school_id: S1, status: "active" },
    ],
    student_consents: [activeConsent(A), activeConsent(B)],
    student_messages: [message(M1), message(M2, A, T1, { anonymous_to_recipient: true }), message(M3, A, T2), message(M4, B),
      message(SELF, A, A, { recipient_type: "self", school_id: null, moderation_status: "held" })],
    admin_roles: [],
  };
  const queries: Query[] = [], rpcCalls: Array<{ name: string; args: Row }> = [], operational: unknown[] = [];
  let networkCalls = 0, consentReads = 0, teacherProfiles = 0;
  const token = (id: string) => `e30.${Buffer.from(JSON.stringify({ sub: id, exp: 9999999999 })).toString("base64url")}.synthetic`;
  function selectedBy(row: Row, filter: Filter) {
    const value = row[filter.key];
    if (filter.op === "in") return (filter.value as unknown[]).includes(value);
    if (filter.op === "neq") return value !== filter.value;
    if (filter.op === "gt") return String(value) > String(filter.value);
    return value === filter.value;
  }
  const supabase = {
    auth: { getUser: async (value: string) => {
      const id = [T1, T2, T3, A, B].find(candidate => token(candidate) === value);
      return id ? { data: { user: { id, email: "synthetic@example.invalid", created_at: NOW } }, error: null }
        : { data: { user: null }, error: { status: 401 } };
    } },
    from(table: string) {
      const query: Query = { table, action: "select", columns: "", filters: [], orders: [], range: null, max: null };
      let single = false;
      const builder = {
        select(columns: string) { query.columns = columns; return builder; },
        eq(key: string, value: unknown) { query.filters.push({ op: "eq", key, value }); return builder; },
        neq(key: string, value: unknown) { query.filters.push({ op: "neq", key, value }); return builder; },
        is(key: string, value: unknown) { query.filters.push({ op: "is", key, value }); return builder; },
        in(key: string, value: unknown[]) { query.filters.push({ op: "in", key, value }); return builder; },
        gt(key: string, value: unknown) { query.filters.push({ op: "gt", key, value }); return builder; },
        order(key: string, value?: { ascending?: boolean }) { query.orders.push({ key, ascending: value?.ascending !== false }); return builder; },
        range(from: number, to: number) { query.range = [from, to]; return builder; },
        limit(max: number) { query.max = max; return builder; },
        maybeSingle() { single = true; return builder; }, single() { single = true; return builder; },
        update() { query.action = "update"; return builder; },
        insert() { query.action = "insert"; return builder; }, delete() { query.action = "delete"; return builder; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve().then(() => {
            // Record each actual execution: rows() intentionally reuses one builder over multiple ranges.
            queries.push(JSON.parse(JSON.stringify(query)) as Query);
            if (query.action !== "select") throw new Error(`Unexpected fixture mutation ${table}:${query.action}`);
            if (table === "profiles" && query.columns === "role,school_id") {
              options.mutateBeforeTeacherProfile?.(rows, ++teacherProfiles);
            }
            if (table === "student_consents" && query.filters.some(f => f.op === "in")) {
              ++consentReads;
              if (options.withdrawOnConsentRead === consentReads) rows.student_consents[0].status = "withdrawn";
              options.mutateOnConsentRead?.(rows, consentReads);
              if (options.failConsentRead === consentReads) return { data: null, error: { message: syntheticDetail } };
            }
            if (options.failTable === table) return { data: null, error: { message: syntheticDetail } };
            let selected = (rows[table] || []).filter(row => query.filters.every(filter => selectedBy(row, filter)));
            selected.sort((left, right) => {
              for (const order of query.orders) {
                const result = String(left[order.key] ?? "").localeCompare(String(right[order.key] ?? ""));
                if (result) return order.ascending ? result : -result;
              }
              return 0;
            });
            // PostgreSQL/PostgREST semantics: predicates apply to the full set, before limit/range.
            if (query.max !== null) selected = selected.slice(0, query.max);
            if (query.range) selected = selected.slice(query.range[0], query.range[1] + 1);
            if (query.columns && query.columns !== "*") selected = selected.map(row => Object.fromEntries(query.columns.split(",").map(key => [key, row[key]])));
            return { data: single ? selected[0] || null : selected, error: null };
          }).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name: string, args: Row) {
      rpcCalls.push({ name, args });
      if (options.rpcThrow) throw new Error(syntheticDetail);
      if (options.rpcError) return { data: null, error: options.rpcError };
      return { data: Object.hasOwn(options, "rpcData") ? options.rpcData : [{ message_id: args.p_message_id, read_at: NOW }], error: null };
    },
  };
  const cache = new Map<string, Record<string, unknown>>();
  const forbidden = () => { ++networkCalls; throw new Error("Network forbidden"); };
  const unexpected = () => { throw new Error("Unexpected privileged operation in read-only fixture"); };
  const mocks: Record<string, unknown> = {
    "@supabase/supabase-js": { createClient: (url: string, key: string) => {
      if (url !== "https://synthetic.invalid" || key !== "synthetic-server-key") throw new Error("Non-synthetic SDK configuration forbidden");
      return supabase;
    } },
    "@/lib/operationalMonitoring": { reportOperationalError: async (value: unknown) => { operational.push(value); } },
    "@/lib/messageSafety": { moderateStudentMessage: () => ({ status: "sent", reason: null }) },
    "@/lib/rateLimit": { enforceUserRateLimit: async () => true },
    "@/lib/pilotDutyAlerts": { isPilotDutyEnabled: () => true, isPilotDutyEmailConfigured: () => false, sendPilotDutyAlert: unexpected },
    "@/lib/supportWorkflow": { transitionSupportCase: unexpected },
    "@/lib/accountDeletionReceiptServer": { authAccountState: unexpected, completeDeletionAudit: unexpected,
      parseDeletionReceipt: unexpected, prepareDeletionAudit: unexpected, DeletionAttemptBusy: class extends Error {}, DeletionReceiptConflict: class extends Error {} },
    "@/lib/i18n/server": { getRequestLocale: () => "zh-CN", getServerTranslator: () => () => "User-safe localized error" },
  };
  const allowed = new Set([MESSAGES, EXPORT, "lib/supabaseServer.ts", "lib/studentConsent.ts", "lib/studentMessageAccess.ts",
    "lib/accountDataPolicy.ts", "lib/guardianAccessPolicy.ts", "lib/i18n/config.ts"]);
  function load(file: string): Record<string, unknown> {
    if (cache.has(file)) return cache.get(file)!;
    if (!allowed.has(file)) throw new Error(`Unmocked import forbidden: ${file}`);
    const loadedModule = { exports: {} as Record<string, unknown> };
    cache.set(file, loadedModule.exports);
    let source = readFileSync(file, "utf8");
    // Test visibility only: actual function body stays untouched and executes in the restricted VM.
    if (file === EXPORT) source += "\nexport { buildAccountExport as testBuildAccountExport };\n";
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, Buffer, URL, Date, Error,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-key" } },
      require: (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : load(name.replace(/^@\//, "") + ".ts"),
      fetch: forbidden, XMLHttpRequest: forbidden, WebSocket: forbidden,
    }, { filename: file });
    return loadedModule.exports;
  }
  async function request(file = MESSAGES, method = "GET", body: Row = {}, auth: string | null = token(options.actor || T1)) {
    const result = { status: 0, body: {} as Row, headers: {} as Record<string, string> };
    const res = { setHeader: (key: string, value: string) => { result.headers[key] = value; },
      status: (status: number) => { result.status = status; return res; }, json: (bodyValue: Row) => { result.body = bodyValue; return res; } };
    const handler = load(file).default as (req: unknown, res: unknown) => Promise<unknown>;
    await handler({ method, headers: { authorization: auth ? `Bearer ${auth}` : "" }, body, query: {}, cookies: {} }, res);
    expect(networkCalls).toBe(0);
    return result;
  }
  async function scope(id = options.actor || T1) {
    return (load("lib/studentMessageAccess.ts").loadTeacherMessageScope as (sdk: unknown, actor: string) => Promise<Row>)(supabase, id);
  }
  async function build(purpose: "download" | "deletionAudit", actor = options.actor || T1) {
    const result = await (load(EXPORT).testBuildAccountExport as (user: unknown, purpose: string) => Promise<{ data: { messages: Row[] } }>)(
      { id: actor, email: "synthetic@example.invalid", created_at: NOW }, purpose);
    expect(networkCalls).toBe(0);
    return result;
  }
  return { rows, queries, rpcCalls, operational, request, token, scope, build };
}

function bodyMessages(response: { body: Row }): Row[] { return response.body.messages as Row[]; }
function exportMessages(response: { body: Row }): Row[] { return (response.body.data as { messages: Row[] }).messages; }
const contains = (query: Query, op: string, key: string, value: unknown) => query.filters.some(f => f.op === op && f.key === key && f.value === value);
function expectNoMutations(f: ReturnType<typeof fixture>) {
  expect(f.queries.every(query => query.action === "select")).toBe(true);
}
function expectLimitedTeacherQueries(f: ReturnType<typeof fixture>, mode: "get" | "export") {
  const queries = f.queries.filter(query => query.table === "student_messages" && contains(query, "eq", "recipient_type", "teacher"));
  expect(queries.length).toBeGreaterThan(0);
  for (const query of queries) {
    expect(contains(query, "eq", "recipient_user_id", T1)).toBe(true);
    expect(contains(query, "eq", "school_id", S1)).toBe(true);
    const senders = query.filters.find(filter => filter.op === "in" && filter.key === "sender_user_id")?.value as string[];
    expect(senders.length).toBeGreaterThan(0); expect(senders.length).toBeLessThanOrEqual(100);
    if (mode === "get") expect(query.max).toBe(100);
    else {
      expect(query.range).not.toBeNull();
      if (!query.range) throw new Error("Expected bounded export page");
      expect(query.range[1] - query.range[0]).toBe(499);
    }
  }
}

test("teacher GET and download: original recipient, anonymous masking, no-store and scope before limits", async () => {
  for (const file of [MESSAGES, EXPORT]) {
    const f = fixture(); const response = await f.request(file);
    expect(response.status).toBe(200); expect(response.headers["Cache-Control"]).toBe("no-store, max-age=0");
    const messages = file === MESSAGES ? bodyMessages(response) : exportMessages(response);
    expect(messages.map(item => item.id).sort()).toEqual([M1, M2, M4].sort());
    expect(messages.find(item => item.id === M2)?.sender_user_id).toBeNull();
    if (file === MESSAGES) expect(messages.find(item => item.id === M2)?.sender_name).toBe("匿名学生");
    expectLimitedTeacherQueries(f, file === MESSAGES ? "get" : "export"); expectNoMutations(f);
  }
});

const invalidConsents: Array<[string, Row | null]> = [
  ["missing", null], ["withdrawn", { status: "withdrawn" }], ["pending guardian", { status: "pending_guardian" }],
  ["ineligible", { status: "ineligible" }], ["unknown status", { status: "unknown" }], ["old version", { policy_version: "2026-08-27" }],
  ["missing assent", { student_assented_at: null }], ["empty assent", { student_assented_at: "" }],
  ["under 14", { age_band: "under_14" }], ["unknown age", { age_band: null }],
  ["minor adult basis", { consent_basis: "adult_self" }], ["adult minor basis", { age_band: "18_plus" }],
  ["unknown basis", { consent_basis: "not_applicable" }],
  ["guardian missing identity", { consent_basis: "student_guardian", guardian_consented_at: NOW }],
  ["guardian missing confirmation", { consent_basis: "student_guardian", guardian_user_id: T3 }],
];
for (const [label, patch] of invalidConsents) {
  test(`complete consent ${label}: GET PATCH download all exclude the sender`, async () => {
    for (const [file, method] of [[MESSAGES, "GET"], [MESSAGES, "PATCH"], [EXPORT, "GET"]]) {
      const f = fixture();
      if (patch === null) f.rows.student_consents = f.rows.student_consents.filter(item => item.student_user_id !== A);
      else Object.assign(f.rows.student_consents[0], patch);
      const response = await f.request(file, method, { id: M1 });
      if (method === "PATCH") { expect(response.status).toBe(404); expect(f.rpcCalls).toHaveLength(0); }
      else {
        expect(response.status).toBe(200);
        const messages = file === MESSAGES ? bodyMessages(response) : exportMessages(response);
        expect(messages.map(item => item.id)).toEqual([M4]);
      }
      expectNoMutations(f);
      expect(f.queries.filter(query => query.table === "teacher_student_assignments").every(query => query.action === "select")).toBe(true);
    }
  });
}

for (const [label, patch] of [
  ["minor self", {}], ["minor guardian", { consent_basis: "student_guardian", guardian_user_id: T3, guardian_consented_at: NOW }],
  ["adult self", { age_band: "18_plus", consent_basis: "adult_self" }],
] as Array<[string, Row]>) {
  test(`complete consent valid ${label}: shared helper and all teacher paths`, async () => {
    for (const [file, method] of [[MESSAGES, "GET"], [MESSAGES, "PATCH"], [EXPORT, "GET"]]) {
      const f = fixture(); Object.assign(f.rows.student_consents[0], patch);
      // No guardian links or consent.school_id are supplied: neither is a new condition.
      expect((await f.scope()).studentIds).toContain(A);
      const response = await f.request(file, method, { id: M1, actorId: T2, role: "平台管理员", schoolId: S2 });
      expect(response.status).toBe(200);
      if (method === "PATCH") expect(f.rpcCalls).toEqual([{ name: "mark_teacher_message_read", args: { p_message_id: M1, p_teacher_id: T1 } }]);
      else expect((file === MESSAGES ? bodyMessages(response) : exportMessages(response)).some(item => item.id === M1)).toBe(true);
      expectNoMutations(f);
    }
  });
}

const scopeFailures: Array<[string, (rows: Record<string, Row[]>) => void]> = [
  ["teacher role", rows => { rows.profiles[0].role = "学生"; }],
  ["teacher school", rows => { rows.profiles[0].school_id = S2; }],
  ["school inactive", rows => { rows.schools[0].status = "inactive"; }],
  ["membership inactive", rows => { rows.school_members[0].status = "revoked"; }],
  ["membership wrong role", rows => { rows.school_members[0].member_role = "teacher"; }],
  ["membership wrong school", rows => { rows.school_members[0].school_id = S2; }],
  ["assignment ended", rows => { rows.teacher_student_assignments[0].status = "revoked"; }],
  ["assignment different teacher", rows => { rows.teacher_student_assignments[0].teacher_user_id = T2; }],
  ["assignment different school", rows => { rows.teacher_student_assignments[0].school_id = S2; }],
  ["student transferred", rows => { rows.profiles.find(item => item.id === A)!.school_id = S2; }],
  ["student role changed", rows => { rows.profiles.find(item => item.id === A)!.role = "家长"; }],
];
for (const [label, mutate] of scopeFailures) {
  test(`complete scope ${label}: actual helper and PATCH reject without fallback`, async () => {
    const f = fixture(); mutate(f.rows);
    expect((await f.scope()).studentIds).not.toContain(A);
    const response = await f.request(MESSAGES, "PATCH", { id: M1, teacherId: T2, schoolId: S1 });
    expect(response.status).toBe(404); expect(f.rpcCalls).toHaveLength(0); expectNoMutations(f);
    // Download cannot restore a teacher mailbox after role/school/relationship changes.
    const exported = await f.request(EXPORT);
    expect(exported.status).toBe(200); expect(exportMessages(exported).some(item => item.id === M1 || item.id === M2)).toBe(false);
  });
}

test("reconsent keeps assignment facts but neither old teacher restoration nor new teacher inheritance", async () => {
  for (const actor of [T1, T2, T3]) {
    const f = fixture({ actor });
    f.rows.teacher_student_assignments[0].status = "revoked";
    const originalAssignments = JSON.stringify(f.rows.teacher_student_assignments);
    f.rows.student_consents[0].status = "withdrawn";
    expect((await f.request()).status).toBe(200);
    f.rows.student_consents[0].status = "active";
    for (const file of [MESSAGES, EXPORT]) {
      const response = await f.request(file);
      const ids = (file === MESSAGES ? bodyMessages(response) : exportMessages(response)).map(item => item.id);
      expect(ids).toEqual(actor === T1 ? [M4] : actor === T2 ? [M3] : []);
    }
    expect(JSON.stringify(f.rows.teacher_student_assignments)).toBe(originalAssignments); expectNoMutations(f);
  }
});

test("message address and moderation cannot be replaced by a forged PATCH payload", async () => {
  for (const patch of [{ recipient_user_id: T2 }, { school_id: S2 }, { sender_user_id: T3 }, { moderation_status: "blocked" }]) {
    const f = fixture(); Object.assign(f.rows.student_messages[0], patch);
    const response = await f.request(MESSAGES, "PATCH", { id: M1, teacherId: T1, senderUserId: A, schoolId: S1, moderation_status: "sent" });
    expect(response.status).toBe(404); expect(f.rpcCalls).toHaveLength(0); expectNoMutations(f);
  }
});

test("teacher GET 601 assignments: 500 paging, 100 consent chunks and stable merged global limit", async () => {
  const f = fixture(); f.rows.student_messages = []; f.rows.teacher_student_assignments = []; f.rows.student_consents = [];
  for (let i = 0; i < 601; i++) {
    const id = uuid(10_000 + i);
    f.rows.profiles.push({ id, role: "学生", school_id: S1 });
    f.rows.teacher_student_assignments.push({ student_user_id: id, teacher_user_id: T1, school_id: S1, status: "active" });
    f.rows.student_consents.push(activeConsent(id));
    f.rows.student_messages.push(message(uuid(20_000 + i), id, T1, { created_at: new Date(Date.parse(NOW) + i * 1000).toISOString() }));
  }
  // Newest unauthorized rows must not consume the pre-authorized 100-message limit.
  f.rows.student_messages.push(...Array.from({ length: 120 }, (_, i) => message(uuid(30_000 + i), A, T1, { created_at: "2027-01-01T00:00:00.000Z" })));
  const response = await f.request(); expect(response.status).toBe(200);
  expect(bodyMessages(response).map(row => row.id)).toEqual(Array.from({ length: 100 }, (_, i) => uuid(20_600 - i)));
  expect(f.queries.filter(query => query.table === "teacher_student_assignments").map(query => query.range)).toEqual([[0, 499], [500, 999], [0, 499], [500, 999]]);
  const consentQueries = f.queries.filter(query => query.table === "student_consents");
  expect(consentQueries).toHaveLength(14); expect(consentQueries.every(query => (query.filters[0].value as unknown[]).length <= 100)).toBe(true);
  expectLimitedTeacherQueries(f, "get"); expectNoMutations(f);
});

test("download scopes each sender chunk before 500 pagination and preserves all authorized rows", async () => {
  const f = fixture();
  f.rows.student_messages = Array.from({ length: 1002 }, (_, i) => message(uuid(50_000 + i), A));
  f.rows.student_messages.push(...Array.from({ length: 600 }, (_, i) => message(uuid(60_000 + i), T3)));
  const response = await f.request(EXPORT); expect(response.status).toBe(200);
  expect(exportMessages(response)).toHaveLength(1002); expectLimitedTeacherQueries(f, "export");
  const reads = f.queries.filter(query => query.table === "student_messages" && contains(query, "eq", "recipient_type", "teacher"));
  expect(reads.map(query => query.range)).toEqual([[0, 499], [500, 999], [1000, 1499]]); expectNoMutations(f);
});

test("download authorizes and paginates independent sender chunks without a broad teacher query", async () => {
  const f = fixture();
  for (let i = 0; i < 101; i++) {
    const id = uuid(80_000 + i); f.rows.profiles.push({ id, role: "学生", school_id: S1 });
    f.rows.teacher_student_assignments.push({ student_user_id: id, teacher_user_id: T1, school_id: S1, status: "active" });
    f.rows.student_consents.push(activeConsent(id)); f.rows.student_messages.push(message(uuid(81_000 + i), id));
  }
  const response = await f.request(EXPORT); expect(response.status).toBe(200);
  expect(exportMessages(response)).toHaveLength(104); expectLimitedTeacherQueries(f, "export");
  const senderQueries = f.queries.filter(query => query.table === "student_messages" && contains(query, "eq", "recipient_type", "teacher"));
  expect(senderQueries).toHaveLength(2);
  expect(senderQueries.map(query => (query.filters.find(filter => filter.op === "in" && filter.key === "sender_user_id")!.value as unknown[]).length)).toEqual([100, 3]);
  expectNoMutations(f);
});

for (const file of [MESSAGES, EXPORT]) {
  test(`final scope withdrawal ${file}: raw sender is rechecked before anonymous serialization`, async () => {
    const f = fixture({ withdrawOnConsentRead: 2 });
    const response = await f.request(file); expect(response.status).toBe(200);
    expect((file === MESSAGES ? bodyMessages(response) : exportMessages(response)).map(item => item.id)).toEqual([M4]); expectNoMutations(f);
  });
  test(`final scope relationship/role changes ${file}: no stale teacher bodies`, async () => {
    for (const mutate of [
      (rows: Record<string, Row[]>) => { rows.profiles[0].role = "学生"; },
      (rows: Record<string, Row[]>) => { rows.profiles[0].school_id = S2; },
      (rows: Record<string, Row[]>) => { rows.school_members[0].status = "revoked"; },
      (rows: Record<string, Row[]>) => { rows.teacher_student_assignments[0].status = "revoked"; },
      (rows: Record<string, Row[]>) => { rows.profiles.find(row => row.id === A)!.school_id = S2; },
    ]) {
      const f = fixture({ mutateBeforeTeacherProfile: (rows, ordinal) => { if (ordinal === 2) mutate(rows); } });
      const response = await f.request(file); expect(response.status).toBe(200);
      expect((file === MESSAGES ? bodyMessages(response) : exportMessages(response)).some(row => row.id === M1 || row.id === M2)).toBe(false);
      expectNoMutations(f);
    }
  });
  for (const ordinal of [1, 2]) {
    test(`scope failure ${file} consent read ${ordinal}: safe error and no old/partial collection`, async () => {
      const f = fixture({ failConsentRead: ordinal }); const response = await f.request(file);
      expect(response.status).toBe(500); expect(JSON.stringify(response.body)).not.toContain(syntheticDetail);
      expect(response.body).not.toHaveProperty("messages"); expect(response.body).not.toHaveProperty("data"); expectNoMutations(f);
    });
  }
}

test("any failed consent chunk rejects the helper rather than returning a partial authorized collection", async () => {
  const f = fixture({ failConsentRead: 2 });
  for (let i = 0; i < 101; i++) {
    const id = uuid(70_000 + i); f.rows.profiles.push({ id, role: "学生", school_id: S1 });
    f.rows.teacher_student_assignments.push({ student_user_id: id, teacher_user_id: T1, school_id: S1, status: "active" });
    f.rows.student_consents.push(activeConsent(id));
  }
  await expect(f.scope()).rejects.toEqual({ message: syntheticDetail }); expectNoMutations(f);
});

test("student own sent history and export survive withdrawn/missing consent with original anonymous identity", async () => {
  for (const missing of [false, true]) {
    const f = fixture({ actor: A }); f.rows.student_consents = missing ? [] : [{ ...activeConsent(A), status: "withdrawn" }];
    const response = await f.request(); expect(response.status).toBe(200);
    expect(bodyMessages(response).map(item => item.id).sort()).toEqual([M1, M2, M3, SELF].sort());
    expect(bodyMessages(response).find(item => item.id === M2)?.sender_user_id).toBe(A);
    const exported = await f.request(EXPORT); expect(exported.status).toBe(200);
    expect(exportMessages(exported).map(item => item.id).sort()).toEqual([M1, M2, M3, SELF].sort()); expectNoMutations(f);
    expect(f.queries.filter(query => query.table === "student_consents" && query.filters.some(filter => filter.op === "in"))).toHaveLength(0);
  }
});

test("deletionAudit counts original internal received scope without granting teacher download rights", async () => {
  const f = fixture({ failConsentRead: 1 }); f.rows.student_consents[0].status = "withdrawn";
  f.rows.student_messages.push(message(uuid(90), T3, T1, { school_id: S2, moderation_status: "blocked", anonymous_to_recipient: true }));
  const internal = await f.build("deletionAudit");
  expect(internal.data.messages).toHaveLength(4);
  expect(internal.data.messages.find(item => item.id === uuid(90))?.sender_user_id).toBeNull();
  expect(f.queries.filter(query => query.table === "student_consents" && query.filters.some(filter => filter.op === "in"))).toHaveLength(0);
  const receivedQuery = f.queries.find(query => query.table === "student_messages" && contains(query, "eq", "recipient_user_id", T1));
  expect(receivedQuery?.filters).toEqual([{ op: "eq", key: "recipient_user_id", value: T1 }, { op: "neq", key: "sender_user_id", value: T1 }]);
  expectNoMutations(f);
  const downloaded = await fixture({ failConsentRead: 1 }).request(EXPORT); expect(downloaded.status).toBe(500);
});

for (const kind of ["school", "platform"]) {
  test(`independent ${kind} safety branch preserves its prior scope and anonymous authority`, async () => {
    const f = fixture({ failConsentRead: 1 }); f.rows.student_consents[0].status = "withdrawn";
    f.rows.student_messages[0].moderation_status = "safety_review";
    f.rows.student_messages[1].moderation_status = "safety_review";
    if (kind === "school") f.rows.school_members.push({ user_id: T1, school_id: S1, member_role: "school_admin", status: "active" });
    else {
      f.rows.admin_roles.push({ id: uuid(91), email: "synthetic@example.invalid", status: "active" });
      f.rows.student_messages[0].duty_status = "new"; f.rows.student_messages[1].duty_status = "new";
    }
    const response = await f.request(); expect(response.status).toBe(200);
    const visible = bodyMessages(response); expect(visible.some(item => item.id === M1)).toBe(true);
    const anonymous = visible.find(item => item.id === M2)!;
    expect(anonymous.sender_user_id).toBe(A); expect(anonymous.canRevealSender).toBe(true);
    expect(f.queries.filter(query => query.table === "student_consents")).toHaveLength(0); expectNoMutations(f);
    const bodyRead = f.queries.find(query => query.table === "student_messages")!;
    if (kind === "school") expect(contains(bodyRead, "eq", "moderation_status", "safety_review")).toBe(true);
    else expect(contains(bodyRead, "neq", "duty_status", "not_applicable")).toBe(true);
  });
}

const receipts: Array<[string, Options, number]> = [
  ["unique real-shaped receipt", {}, 200], ["zero rows", { rpcData: [] }, 404],
  ["null", { rpcData: null }, 500], ["null row", { rpcData: [null] }, 500], ["object", { rpcData: { message_id: M1, read_at: NOW } }, 500],
  ["two rows", { rpcData: [{ message_id: M1, read_at: NOW }, { message_id: M1, read_at: NOW }] }, 500],
  ["wrong id", { rpcData: [{ message_id: M2, read_at: NOW }] }, 500],
  ["missing timestamp", { rpcData: [{ message_id: M1 }] }, 500],
  ["invalid timestamp", { rpcData: [{ message_id: M1, read_at: "invalid" }] }, 500],
  ["nonstring timestamp", { rpcData: [{ message_id: M1, read_at: 7 }] }, 500],
  ["database error", { rpcError: { message: syntheticDetail } }, 500], ["throw", { rpcThrow: true }, 500],
];
for (const [label, options, status] of receipts) {
  test(`teacher PATCH ${label}: only valid unique receipt succeeds, no old UPDATE fallback`, async () => {
    const f = fixture(options); const response = await f.request(MESSAGES, "PATCH", { id: M1, p_teacher_id: T2, role: "平台管理员" });
    expect(response.status).toBe(status); expect(response.body.ok === true).toBe(status === 200);
    expect(JSON.stringify(response.body)).not.toContain(syntheticDetail);
    expect(f.rpcCalls).toEqual([{ name: "mark_teacher_message_read", args: { p_message_id: M1, p_teacher_id: T1 } }]); expectNoMutations(f);
  });
}

test("authentication, parent policy and unsupported methods retain existing boundaries", async () => {
  const f = fixture();
  expect((await f.request(MESSAGES, "GET", {}, null)).status).toBe(401);
  expect((await f.request(EXPORT, "GET", {}, "bad-token")).status).toBe(401);
  expect((await f.request(MESSAGES, "PUT")).status).toBe(405);
  f.rows.profiles[0].role = "家长";
  expect((await f.request()).status).toBe(403); expectNoMutations(f);
});
