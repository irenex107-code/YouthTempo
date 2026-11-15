import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import zh from "../../locales/zh-CN.json";
import en from "../../locales/en.json";

export const OWNER = "00000000-0000-4000-8000-000000000011";
export const OTHER = "00000000-0000-4000-8000-000000000012";
export const NOW = "2026-11-02T16:30:00.000Z"; // Shanghai Tuesday, November 3.
export const TABLES = ["tempo_check_ins", "sweet_records"] as const;
export type ParticipationTable = typeof TABLES[number];
type Row = Record<string, unknown>;
type FaultKind = "error" | "network" | "non-json" | "null" | "object" | "empty-body"
  | "overfull" | "duplicate" | "unordered" | "missing-id" | "invalid-id" | "missing-date"
  | "invalid-date" | "hang" | "ignore-abort";
type Fault = { table: ParticipationTable; page: number; kind: FaultKind };
export type Query = {
  table: string; method: string; select: string | null; order: string | null;
  filters: Array<[string, string]>; limit: number; page: number; returned?: number;
  signal?: AbortSignal | null;
};

export const uuid = (n: number) => `10000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const history = (n: number, date: (i: number) => string, owner = OWNER, start = 1): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: uuid(start + i), user_id: owner, created_at: date(i),
    feeling: "steady", records: { private: "synthetic-body-must-not-be-read" },
    summary: "synthetic-private-summary",
  }));
export const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

export function participationFixture(options: {
  quick?: Row[]; sweet?: Row[]; consent?: string; role?: string; faults?: Fault[];
  serverPageCap?: number; manualDeadline?: boolean; rateLimited?: boolean; sharedSource?: string;
} = {}) {
  const rows: Record<string, Row[]> = {
    profiles: [{ id: OWNER, role: options.role || "学生" }, { id: OTHER, role: "学生" }],
    student_consents: [{ student_user_id: OWNER, status: options.consent || "active", age_band: "14_17",
      consent_basis: "student_self_pilot", policy_version: "2026-08-28", student_assented_at: NOW,
      guardian_user_id: null, guardian_consented_at: null }],
    tempo_check_ins: options.quick || [], sweet_records: options.sweet || [],
    tempo_reminder_preferences: [], tempo_garden_care_events: [], tempo_garden_layout_items: [],
    tempo_garden_keepsakes: [],
  };
  const queries: Query[] = [];
  const returnedIds: Record<string, string[]> = { tempo_check_ins: [], sweet_records: [] };
  const deadlines: Array<{ callback: () => void; ms: number; cleared: boolean }> = [];
  const pending: Array<() => void> = [];
  const operations: Array<{ operation: string; statusCode: number }> = [];
  const limits: Array<{ userId: string; action: string }> = [];
  const pages: Record<string, number> = {};
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://synthetic.invalid" || !url.pathname.startsWith("/rest/v1/")) {
      throw new Error("Non-synthetic transport forbidden");
    }
    const table = url.pathname.split("/").at(-1)!;
    if (!Object.hasOwn(rows, table)) throw new Error(`Unexpected synthetic table: ${table}`);
    const method = init?.method || "GET";
    const isParticipation = TABLES.includes(table as ParticipationTable) && method === "GET";
    const page = isParticipation ? pages[table] = (pages[table] || 0) + 1 : 0;
    const filters = [...url.searchParams].filter(([k]) => !["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k));
    const q: Query = { table, method, select: url.searchParams.get("select"), order: url.searchParams.get("order"),
      filters, limit: Number(url.searchParams.get("limit") || Infinity), page, signal: init?.signal };
    queries.push(q);
    if (options.consent === "error" && table === "student_consents") return response({ message: "synthetic-private-provider-error" }, 503);
    const matches = (row: Row) => filters.every(([key, filter]) => {
      const [op, ...rest] = filter.split("."); const value = rest.join(".");
      if (op === "eq") return String(row[key]) === value;
      if (op === "gt") return String(row[key]) > value;
      throw new Error(`Unexpected synthetic operator: ${op}`);
    });
    let selected = rows[table].filter(matches);
    if (q.order) {
      const orders = q.order.split(",").map((order) => order.split("."));
      selected.sort((a, b) => {
        for (const [field, direction] of orders) {
          const comparison = String(a[field]) < String(b[field]) ? -1 : String(a[field]) > String(b[field]) ? 1 : 0;
          if (comparison) return direction === "desc" ? -comparison : comparison;
        }
        return 0;
      });
    }
    const offset = Number(url.searchParams.get("offset") || 0);
    selected = selected.slice(offset, offset + Math.min(q.limit, isParticipation ? options.serverPageCap || Infinity : Infinity));
    if (method === "DELETE") rows[table] = rows[table].filter((row) => !matches(row));
    if (method === "POST") {
      const payload = JSON.parse(String(init?.body)) as Row;
      const uniqueFields = table === "tempo_garden_care_events" ? ["user_id", "care_date"]
        : table === "tempo_garden_keepsakes" ? ["user_id", "keepsake_date"] : [];
      const existing = uniqueFields.length && rows[table].find((row) => uniqueFields.every((key) => row[key] === payload[key]));
      if (existing && !new Headers(init?.headers).get("Prefer")?.includes("resolution=merge-duplicates")) {
        return response({ code: "23505", message: "synthetic unique constraint" }, 409);
      }
      const conflict = url.searchParams.get("on_conflict")?.split(",");
      if (conflict) rows[table] = rows[table].filter((row) => !conflict.every((key) => row[key] === payload[key]));
      selected = [{ id: uuid(900_000 + queries.length), created_at: NOW, ...payload }];
      rows[table].push(...selected);
    }
    const fields = q.select?.split(",");
    let data: unknown = selected.map((row) => fields ? Object.fromEntries(fields.map((key) => [key, row[key]])) : row);
    const fault = options.faults?.find((f) => f.table === table && f.page === page);
    if (fault) {
      if (fault.kind === "error") return response({ message: "synthetic-private-provider-error", code: "XX000" }, 503);
      if (fault.kind === "network") throw new Error("synthetic-private-network-error");
      if (fault.kind === "non-json") return new Response("synthetic private invalid JSON", { status: 200 });
      if (fault.kind === "empty-body") return new Response("", { status: 200 });
      if (["hang", "ignore-abort"].includes(fault.kind)) {
        return new Promise<Response>((resolve, reject) => {
          pending.push(() => resolve(response(data)));
          if (fault.kind === "hang") {
            const abort = () => reject(new DOMException("Synthetic aborted", "AbortError"));
            if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener("abort", abort, { once: true });
          }
        });
      }
      if (fault.kind === "null") data = null;
      else if (fault.kind === "object") data = { created_at: NOW };
      else {
        const batch = [...data as Row[]].map((row) => ({ ...row }));
        if (fault.kind === "overfull") while (batch.length <= 500) batch.push({ id: uuid(500_000 + batch.length), created_at: NOW });
        if (fault.kind === "duplicate") batch[0].id = returnedIds[table].at(-1);
        if (fault.kind === "unordered") batch.reverse();
        if (fault.kind === "missing-id") delete batch[0].id;
        if (fault.kind === "invalid-id") batch[0].id = "invalid-id";
        if (fault.kind === "missing-date") delete batch[0].created_at;
        if (fault.kind === "invalid-date") batch[0].created_at = "not-a-date";
        data = batch;
      }
    }
    if (isParticipation && Array.isArray(data)) {
      q.returned = data.length;
      returnedIds[table].push(...data.map((row: Row) => String(row.id)));
    }
    if (new Headers(init?.headers).get("Accept")?.includes("application/vnd.pgrst.object+json")) {
      if (!Array.isArray(data) || data.length !== 1) return response({ code: "PGRST116",
        details: `The result contains ${Array.isArray(data) ? data.length : "invalid"} rows` }, 406);
      data = data[0];
    }
    return response(data, method === "POST" ? 201 : 200);
  };
  // The installed SDK serializes and parses every query; fetch never leaves memory.
  const supabase = createClient("https://synthetic.invalid", "synthetic-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: transport },
  });
  class FixedDate extends Date {
    constructor(value: string | number | Date = NOW) { super(value instanceof Date ? value.getTime() : value); }
    static now() { return Date.parse(NOW); }
  }
  const cache = new Map<string, Record<string, unknown>>();
  const mocks: Record<string, unknown> = {
    "@/lib/supabaseServer": {
      getSupabaseAdmin: () => supabase,
      getAuthenticatedUser: async (req: { headers: { authorization?: string } }) => {
        const auth = req.headers.authorization;
        return auth === "Bearer synthetic-A" ? { id: OWNER } : auth === "Bearer synthetic-B" ? { id: OTHER } : null;
      },
    },
    "@/lib/operationalMonitoring": { reportOperationalError: async (o: { operation: string; statusCode: number }) => {
      operations.push({ operation: o.operation, statusCode: o.statusCode });
    } },
    "@/lib/rateLimit": { enforceUserRateLimit: async (o: { userId: string; action: string; res: { status: (s: number) => { json: (b: unknown) => unknown } } }) => {
      limits.push({ userId: o.userId, action: o.action });
      if (options.rateLimited) { o.res.status(429).json({ error: "Synthetic rate limit" }); return false; }
      return true;
    } },
    "@/lib/i18n/server": { getServerTranslator: (locale: string) => (key: string) => key.split(".").reduce<unknown>(
      (value, part) => (value as Row)[part], locale === "en" ? en : zh) },
  };
  const allowed = new Set(["lib/studentConsent.ts", "lib/i18n/config.ts", "lib/tempoGarden.ts", "lib/gardenCatalog.ts",
    "pages/api/garden/_shared.ts", "pages/api/garden.ts", "pages/api/garden/care.ts", "pages/api/garden/layout.ts",
    "pages/api/garden/keepsakes/index.ts", "pages/api/garden/keepsakes/[id].ts"]);
  function load(file: string): Record<string, unknown> {
    if (cache.has(file)) return cache.get(file)!;
    if (!allowed.has(file)) throw new Error(`Unmocked source forbidden: ${file}`);
    const loadedModule = { exports: {} as Record<string, unknown> }; cache.set(file, loadedModule.exports);
    const source = ts.transpileModule(file === "pages/api/garden/_shared.ts" && options.sharedSource
      ? options.sharedSource : readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      module: loadedModule, exports: loadedModule.exports, Date: FixedDate, Error, AbortController,
      setTimeout: options.manualDeadline ? (callback: () => void, ms: number) => {
        const entry = { callback, ms, cleared: false }; deadlines.push(entry); return entry;
      } : setTimeout,
      clearTimeout: options.manualDeadline ? (entry: typeof deadlines[number]) => { entry.cleared = true; } : clearTimeout,
      require: (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : load(name.replace(/^@\//, "") + ".ts"),
      fetch: () => { throw new Error("Network forbidden"); },
    }, { filename: file });
    return loadedModule.exports;
  }
  // Return a host-realm Promise so the runner's rejection matcher can await it.
  const read = async (now = new Date(NOW)) => await (load("pages/api/garden/_shared.ts").loadGardenParticipation as
    typeof import("../../pages/api/garden/_shared").loadGardenParticipation)(supabase, OWNER, now);
  async function request(file = "pages/api/garden.ts", method = "GET", body: Row = {}, locale = "zh-CN", auth: string | null = "synthetic-A", query: Row = {}) {
    const result = { status: 0, body: {} as Row, headers: {} as Record<string, string> };
    const res = { setHeader: (key: string, value: string) => { result.headers[key] = value; },
      status: (status: number) => { result.status = status; return res; },
      json: (value: Row) => { result.body = value; return res; } };
    await (load(file).default as (req: unknown, res: unknown) => Promise<unknown>)({
      method, body: { ...body, locale }, query, cookies: {}, headers: { authorization: auth ? `Bearer ${auth}` : "" },
    }, res);
    return result;
  }
  return { read, request, rows, queries, returnedIds, deadlines, operations, limits,
    fireDeadline: () => { for (const d of deadlines) if (!d.cleared) d.callback(); },
    releasePending: () => { for (const release of pending.splice(0)) release(); } };
}
