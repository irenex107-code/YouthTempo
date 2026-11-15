import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { expect } from "@playwright/test";

export type Row = Record<string, unknown>;
type Filter = ["eq" | "neq" | "in" | "is" | "gt" | "gte" | "lt" | "lte", string, unknown];
export type Operation = { table: string; kind: string; columns: string; filters: Filter[]; from: number; to: number };
type Result = { data: Row | Row[] | null; error: { message: string; code?: string } | null; count?: number };
type Query = {
  select(columns?: string): Query; insert(input: Row | Row[]): Query; update(input: Row): Query; delete(): Query;
  eq(key: string, value: unknown): Query; neq(key: string, value: unknown): Query;
  in(key: string, value: unknown[]): Query; is(key: string, value: unknown): Query;
  gt(key: string, value: unknown): Query; gte(key: string, value: unknown): Query;
  lt(key: string, value: unknown): Query; lte(key: string, value: unknown): Query;
  order(key: string, options?: { ascending?: boolean }): Query; range(from: number, to: number): Query;
  limit(maximum: number): Query; single(): Query; maybeSingle(): Query; abortSignal(signal: AbortSignal): Query;
  then(resolve: (result: Result) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown>;
};
type Handler = (request: unknown, response: unknown) => Promise<unknown>;

export const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
export const people = { student: id(1), secondStudent: id(2), teacher: id(3), newTeacher: id(4),
  schoolLead: id(5), platformAdmin: id(6), guardian: id(7), outsider: id(8) };
export const school = id(20), otherSchool = id(21);
export const messageIds = { anonymous: id(101), named: id(102), second: id(103), self: id(104) };
const createdAt = "2026-10-30T01:00:00.000Z";
const unsafe = "SYNTHETIC_PROVIDER_PRIVATE_DETAIL";
export function message(messageId: string, changes: Row = {}): Row {
  return { id: messageId, school_id: school, sender_user_id: people.student,
    recipient_type: "teacher", recipient_user_id: people.teacher, anonymous_to_recipient: true,
    body: `Synthetic private message ${messageId}`, moderation_status: "sent", read_at: null,
    duty_status: "not_applicable", alert_delivery_status: "not_requested", created_at: createdAt, ...changes };
}
function field(row: Row, key: string): unknown {
  return key.split(/->>?/).reduce<unknown>((value, part) =>
    value && typeof value === "object" ? (value as Row)[part] : undefined, row);
}
const compare = (a: unknown, b: unknown) => String(a ?? "").localeCompare(String(b ?? ""));

/** Executes real route/helper sources with strict in-memory dependencies; never loads a network SDK. */
export async function messageAccessFixture() {
  const tables: Record<string, Row[]> = Object.fromEntries([
    "profiles", "schools", "school_members", "teacher_student_assignments", "admin_roles", "student_messages",
    "sweet_records", "guardian_student_links", "student_consents", "student_consent_events", "user_permissions",
    "wechat_identities", "community_posts", "community_comments", "community_reports", "community_blocks",
    "community_restrictions", "professional_verifications", "school_invites", "pilot_feedback", "tempo_check_ins",
    "tempo_reminder_preferences", "tempo_garden_care_events", "tempo_garden_layout_items", "tempo_garden_keepsakes",
    "peer_space_messages", "peer_space_message_reports", "peer_space_user_controls", "pilot_experience_feedback",
    "support_staff_applications", "support_staff_training_records", "support_cases", "support_case_events",
    "support_case_feedback", "support_case_assignments", "account_deletion_audits", "student_message_duty_actions",
  ].map((name) => [name, []]));
  tables.profiles = Object.entries(people).map(([name, userId]) => ({ id: userId,
    role: name === "student" || name === "secondStudent" ? "学生" : name === "guardian" ? "家长" : "学校支持人员",
    school_id: name === "outsider" ? otherSchool : school,
    email: `${name}@example.invalid`, display_name: `Synthetic ${name}`, created_at: createdAt }));
  tables.schools = [{ id: school, status: "active" }, { id: otherSchool, status: "active" }];
  tables.school_members = [people.teacher, people.newTeacher].map((userId, index) => ({ id: id(30 + index),
    school_id: school, user_id: userId, member_role: "school_support", status: "active" }));
  tables.school_members.push({ id: id(40), school_id: school, user_id: people.schoolLead, member_role: "school_admin", status: "active" });
  tables.teacher_student_assignments = [people.student, people.secondStudent].map((studentId, index) => ({
    id: id(50 + index), school_id: school, teacher_user_id: people.teacher, student_user_id: studentId,
    status: "active", created_at: createdAt, updated_at: createdAt, revoked_at: null }));
  tables.admin_roles = [{ id: id(60), email: "platformAdmin@example.invalid".toLowerCase(), status: "active" }];
  tables.student_consents = [people.student, people.secondStudent].map((studentId) => ({ student_user_id: studentId,
    status: "active", age_band: "14_17", consent_basis: "student_self_pilot" }));
  tables.student_messages = [message(messageIds.anonymous), message(messageIds.named, { anonymous_to_recipient: false }),
    message(messageIds.second, { sender_user_id: people.secondStudent }),
    message(messageIds.self, { recipient_type: "self", recipient_user_id: people.student, anonymous_to_recipient: false })];
  const state = { actor: people.teacher as string | null, queries: [] as Operation[], mutations: [] as Operation[],
    beforeQuery: undefined as ((operation: Operation) => void | Promise<void>) | undefined,
    afterQuery: undefined as ((operation: Operation) => void | Promise<void>) | undefined,
    failQuery: undefined as ((operation: Operation) => boolean) | undefined,
    zeroUpdate: false, deletes: 0, alertCalls: 0, signOutCalls: 0, consentCalls: 0,
    storageRemovals: [] as string[][], rpcCalls: [] as Row[], present: true, afterDelete: () => {}, nextId: 10000 };
  const admin = {
    async rpc(name: string, args: Row) {
      expect(name).toBe("apply_student_message_duty_action");
      state.rpcCalls.push({ name, ...args });
      const target = tables.student_messages.find((row) => row.id === args.p_message_id && row.duty_status !== "not_applicable");
      if (!target) return { data: null, error: { message: "duty_message_not_found" } };
      const previous = target.duty_status;
      Object.assign(target, { duty_status: args.p_new_status, duty_updated_by: args.p_actor_user_id, read_at: new Date().toISOString() });
      tables.student_message_duty_actions.push({ id: id(state.nextId++), message_id: target.id,
        previous_status: previous, new_status: args.p_new_status, actor_user_id: args.p_actor_user_id,
        note: args.p_note, created_at: createdAt });
      return { data: [{ message_id: target.id, duty_status: target.duty_status }], error: null };
    },
    from(table: string): Query {
      if (!Object.hasOwn(tables, table)) throw new Error(`Unexpected table ${table}`);
      const filters: Filter[] = [], orders: Array<{ key: string; ascending: boolean }> = [];
      let columns = "*", kind = "select", input: Row | Row[] = {}, single = false, representation = false;
      let start = 0, end = Infinity, maximum = Infinity;
      const add = (operator: Filter[0], key: string, value: unknown) => { filters.push([operator, key, value]); return chain; };
      const chain: Query = {
        select(value = "*") { columns = value; representation = true; return chain; },
        insert(value) { kind = "insert"; input = value; return chain; },
        update(value) { kind = "update"; input = value; return chain; }, delete() { kind = "delete"; return chain; },
        eq: (key, value) => add("eq", key, value), neq: (key, value) => add("neq", key, value),
        in: (key, value) => add("in", key, value), is: (key, value) => add("is", key, value),
        gt: (key, value) => add("gt", key, value), gte: (key, value) => add("gte", key, value),
        lt: (key, value) => add("lt", key, value), lte: (key, value) => add("lte", key, value),
        order(key, options = {}) { if (!orders.some((order) => order.key === key)) orders.push({ key, ascending: options.ascending !== false }); return chain; },
        range(from, to) { start = from; end = to; return chain; }, limit(value) { maximum = value; return chain; },
        single() { single = true; return chain; }, maybeSingle() { single = true; return chain; }, abortSignal() { return chain; },
        then(resolve, reject) {
          return (async (): Promise<Result> => {
            const operation = { table, kind, columns, filters: structuredClone(filters), from: start, to: end };
            state.queries.push(operation);
            await state.beforeQuery?.(operation);
            if (state.failQuery?.(operation)) return { data: null, error: { message: unsafe } };
            let selected = tables[table].filter((row) => filters.every(([op, key, value]) => {
              const actual = field(row, key);
              if (op === "eq" || op === "is") return actual === value;
              if (op === "neq") return actual !== null && actual !== undefined && actual !== value;
              if (op === "in") return Array.isArray(value) && value.includes(actual);
              if (actual == null) return false;
              const c = compare(actual, value);
              return op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0;
            }));
            if (kind !== "select") state.mutations.push(operation);
            if (kind === "insert") {
              const values = Array.isArray(input) ? input : [input];
              if (values.some((row) => row.id && tables[table].some((existing) => existing.id === row.id))) {
                return { data: null, error: { message: unsafe, code: "23505" } };
              }
              selected = values.map((row) => ({ id: id(state.nextId++), created_at: createdAt, ...structuredClone(row) }));
              tables[table].push(...selected);
            } else if (kind === "update") {
              if (state.zeroUpdate) selected = [];
              selected.forEach((row) => Object.assign(row, structuredClone(input)));
            } else if (kind === "delete") tables[table] = tables[table].filter((row) => !selected.includes(row));
            selected = [...selected].sort((left, right) => {
              for (const order of orders) { const value = compare(left[order.key], right[order.key]); if (value) return value * (order.ascending ? 1 : -1); }
              return 0;
            }).slice(start, Math.min(end + 1, start + maximum, start + 1000));
            const projected = selected.map((row) => structuredClone(columns === "*" ? row : Object.fromEntries(columns.split(",").map((key) => [key.trim(), row[key.trim()]]))));
            await state.afterQuery?.(operation);
            return { data: kind !== "select" && !representation ? null : single ? projected[0] ?? null : projected, error: null, count: projected.length };
          })().then(resolve, reject);
        },
      };
      return chain;
    },
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => {
      expect(bucket).toBe("support-staff-evidence"); state.storageRemovals.push(paths); return { error: null };
    } }) },
    auth: { admin: {
      deleteUser: async (userId: string) => {
        expect(userId).toBe(state.actor); ++state.deletes; state.present = false; state.afterDelete(); return { error: null };
      },
      getUserById: async (userId: string) => ({ data: { user: state.present ? { id: userId } : null }, error: state.present ? null : { status: 404, code: "user_not_found" } }),
      signOut: async () => { ++state.signOutCalls; return { error: null }; },
    } },
  };
  const cache = new Map<string, Record<string, unknown>>();
  const sourceFiles = new Set(["pages/api/messages.ts", "pages/api/account/data.ts", "pages/api/admin/message-duty.ts",
    "lib/studentMessageAccess.ts", "lib/accountDeletionReceiptServer.ts", "lib/adminAccess.ts"]);
  async function load(file: string): Promise<Record<string, unknown>> {
    const cached = cache.get(file); if (cached) return cached;
    const source = await readFile(path.resolve(file), "utf8");
    const dependencies = new Map<string, unknown>();
    for (const match of source.matchAll(/from\s+["'](@\/lib\/(?:studentMessageAccess|accountDeletionReceiptServer|adminAccess))["']/g)) {
      const name = match[1]; dependencies.set(name, await load(`${name.slice(2)}.ts`));
    }
    const imports: Record<string, unknown> = {
      "@/lib/supabaseServer": { getSupabaseAdmin: () => admin, getAuthenticatedUser: async () => {
        const profile = tables.profiles.find((row) => row.id === state.actor);
        return state.actor ? { id: state.actor, email: profile?.email ?? "missing@example.invalid", created_at: createdAt } : null;
      } },
      "@/lib/accountDataPolicy": { ACCOUNT_DATA_POLICY_VERSION: "2026-08-03", accountDataRetention: {} },
      "@/lib/messageSafety": { moderateStudentMessage: () => ({ status: "sent", reason: null }) },
      "@/lib/studentConsent": { requireActiveStudentConsent: async () => {
        ++state.consentCalls;
        const consent = tables.student_consents.find((row) => row.student_user_id === state.actor && row.status === "active");
        if (!consent) throw Object.assign(new Error("Synthetic consent required"), { statusCode: 403 });
        return consent;
      } },
      "@/lib/guardianAccessPolicy": { CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED: false,
        CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_MESSAGE: "Unavailable", isAdultWithoutGuardianFlow: () => false },
      "@/lib/i18n/config": { normalizeLocale: (locale: string) => locale === "en" ? "en" : "zh-CN" },
      "@/lib/i18n/server": { getRequestLocale: (req: Row) => (req.body as Row)?.locale === "en" ? "en" : "zh-CN",
        getServerTranslator: () => (key: string) => key },
      "@/lib/rateLimit": { enforceUserRateLimit: async () => true },
      "@/lib/pilotDutyAlerts": { isPilotDutyEnabled: () => false, isPilotDutyEmailConfigured: () => false,
        sendPilotDutyAlert: async () => { ++state.alertCalls; return "sent"; } },
      "@/lib/operationalMonitoring": { reportOperationalError: () => {} },
      "@/lib/supportWorkflow": { transitionSupportCase: async () => { throw new Error("Unexpected support transition"); } },
      "@/lib/schoolInvites": { applySchoolInvitesForUser: async () => {} },
      "node:crypto": await import("node:crypto"),
    };
    const loadedModule = { exports: {} as Record<string, unknown> }; cache.set(file, loadedModule.exports);
    expect(sourceFiles.has(file)).toBe(true);
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(output, { module: loadedModule, exports: loadedModule.exports, Date, Error, Buffer, AbortSignal, setTimeout, clearTimeout,
      console: { error() {}, warn() {} }, require(name: string) {
        if (dependencies.has(name)) return dependencies.get(name);
        if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected import ${name}`);
        return imports[name];
      } }, { filename: file, timeout: 2_000 });
    return loadedModule.exports;
  }
  return { tables, state, revoke(studentId = people.student) {
    for (const row of tables.teacher_student_assignments) if (row.teacher_user_id === people.teacher && row.student_user_id === studentId) {
      row.status = "revoked"; row.revoked_at = "2026-10-30T02:00:00.000Z";
    }
  }, async invoke(route: "messages" | "account" | "duty", method = "GET", body: Row = {}, locale = "zh-CN") {
    const file = route === "messages" ? "pages/api/messages.ts" : route === "account" ? "pages/api/account/data.ts" : "pages/api/admin/message-duty.ts";
    const mod = await load(file);
    const result = { status: 200, body: {} as Row, headers: {} as Row };
    const response = { setHeader(key: string, value: unknown) { result.headers[key] = value; },
      status(value: number) { result.status = value; return response; }, json(value: Row) { result.body = JSON.parse(JSON.stringify(value)) as Row; return response; } };
    await (mod.default as Handler)({ method, headers: { authorization: "Bearer SYNTHETIC_FIXED_SESSION" }, body: { ...body, locale }, query: { locale }, cookies: {}, socket: { remoteAddress: "127.0.0.1" } }, response);
    expect(JSON.stringify(result.body)).not.toContain(unsafe);
    return result;
  } };
}
export function listMessages(result: { body: Row }, route: "messages" | "account" = "messages"): Row[] {
  return (route === "messages" ? result.body.messages : (result.body.data as Row).messages) as Row[];
}
