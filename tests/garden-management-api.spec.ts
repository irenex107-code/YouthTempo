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
type Options = { consent?: string; empty?: boolean; role?: string; failure?: string; limit?: boolean };
function fixture(options: Options = {}) {
  const today = new Date().toISOString();
  const rows: Record<string, Row[]> = {
    profiles: [{ id: A, role: options.role || "学生" }, { id: B, role: "学生" }],
    student_consents: [{ student_user_id: A, status: options.consent || "active", age_band: "14_17",
      consent_basis: "student_self_pilot", policy_version: "2026-08-28", student_assented_at: today,
      guardian_user_id: null, guardian_consented_at: null }],
    tempo_check_ins: [{ id: A, user_id: A, created_at: today }, { id: B, user_id: B, created_at: "2001-01-01" }],
    sweet_records: [], tempo_reminder_preferences: [{ user_id: A, mode: "weekly" }],
    tempo_garden_care_events: [], tempo_garden_layout_items: [{ user_id: A, slot: "flower_border", item_key: "low_fern" }],
    tempo_garden_keepsakes: [{ id: ID, user_id: A, keepsake_date: "2026-10-01", keepsake_type: "flower" },
      { id: B, user_id: B, keepsake_date: "2001-01-01", keepsake_type: "stone" }],
  };
  if (options.empty) for (const name of Object.keys(rows)) if (!['profiles', 'student_consents'].includes(name)) rows[name] = [];
  const queries: Array<{ table: string; action: string; filters: Array<[string, unknown]> }> = [];
  let authCalls = 0;
  const token = (id: string, expired = false) => `e30.${Buffer.from(JSON.stringify({ sub: id, exp: expired ? 1 : 9999999999 })).toString("base64url")}.synthetic`;
  const supabase = {
    auth: { getUser: async (value: string) => {
      ++authCalls;
      return [token(A), token(B)].includes(value) ? { data: { user: { id: value === token(A) ? A : B } }, error: null }
        : { data: { user: null }, error: { status: 401 } };
    } },
    from(table: string) {
      const q = { table, action: "select", filters: [] as Array<[string, unknown]> }; queries.push(q);
      let single = false;
      let payload: Row | undefined;
      let cursor = "";
      let pageLimit = Infinity;
      let signal: AbortSignal | undefined;
      const builder = {
        select() { return builder; },
        eq(key: string, value: unknown) { q.filters.push([key, value]); return builder; },
        order() { return builder; }, limit(value: number) { pageLimit = value; return builder; },
        gt(key: string, value: string) { if (key !== "id") throw new Error("Unexpected cursor"); cursor = value; return builder; },
        abortSignal(value: AbortSignal) { signal = value; return builder; },
        maybeSingle() { single = true; return builder; }, single() { single = true; return builder; },
        delete() { q.action = "delete"; return builder; },
        insert(value: Row) { q.action = "insert"; payload = value; return builder; },
        upsert(value: Row) { q.action = "upsert"; payload = value; return builder; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve().then(() => {
            if (signal?.aborted) throw new Error("Synthetic aborted read");
            if (options.failure === table || (options.consent === "error" && table === "student_consents")) {
              return { data: null, error: new Error("synthetic-private-provider-error") };
            }
            const match = (row: Row) => q.filters.every(([key, value]) => row[key] === value);
            let selected = (rows[table] || []).filter(match);
            if (["tempo_check_ins", "sweet_records"].includes(table) && q.action === "select") {
              selected = selected.filter((row) => String(row.id) > cursor)
                .sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, pageLimit);
            }
            if (q.action === "delete") rows[table] = rows[table].filter((row) => !match(row));
            if (payload) { selected = [{ id: ID, created_at: today, ...payload }]; rows[table].push(...selected); }
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
    "@/lib/rateLimit": { enforceUserRateLimit: async ({ res }: { res: { status: (s: number) => { json: (b: unknown) => unknown } } }) => {
      if (options.limit) { res.status(429).json({ error: "Synthetic rate limit" }); return false; } return true;
    } },
    "@/lib/i18n/server": { getServerTranslator: (locale: string) => (key: string) => key.split(".").reduce<unknown>(
      (obj, part) => (obj as Record<string, unknown>)[part], locale === "en" ? en : zh) },
  };
  const allowed = new Set(["lib/supabaseServer.ts", "lib/studentConsent.ts", "lib/i18n/config.ts", "lib/tempoGarden.ts", "lib/gardenCatalog.ts",
    "pages/api/garden/_shared.ts", "pages/api/garden.ts", "pages/api/garden/care.ts", "pages/api/garden/layout.ts", "pages/api/garden/keepsakes/index.ts", "pages/api/garden/keepsakes/[id].ts"]);
  function load(file: string): Record<string, unknown> {
    if (cache.has(file)) return cache.get(file)!;
    if (!allowed.has(file)) throw new Error(`Unmocked source: ${file}`);
    const loadedModule = { exports: {} as Record<string, unknown> }; cache.set(file, loadedModule.exports);
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(source, {
      module: loadedModule, exports: loadedModule.exports, Buffer, URL, Date, Error, AbortController, setTimeout, clearTimeout,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-key" } },
      require: (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : load(name.replace(/^@\//, "") + ".ts"),
      fetch: () => { throw new Error("Network forbidden"); },
    }, { filename: file });
    return loadedModule.exports;
  }
  async function request(file = "pages/api/garden.ts", method = "GET", extra: { auth?: string | null; body?: Row; query?: Row; locale?: string } = {}) {
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
  for (const consent of ["active", "withdrawn", "error"]) {
    test(`API ${locale} ${consent}: own GET is read-only; own DELETE preserves result`, async () => {
      const f = fixture({ consent }); const before = JSON.stringify(f.rows);
      const read = await f.request(undefined, "GET", { locale, body: { owner: B, role: "admin", canManage: true }, query: { user_id: B } });
      expect(read.status).toBe(200); expect(read.headers['Cache-Control']).toContain('no-store');
      expect(read.body.canUseGarden).toBe(consent === "active"); expect(read.body.hasExistingData).toBe(true);
      expect(read.body.keepsakes).toEqual([{ id: ID, date: "2026-10-01", type: "flower" }]);
      expect(JSON.stringify(f.rows)).toBe(before);
      expect(f.queries.every((q) => q.action === "select")).toBe(true);
      for (const q of f.queries) expect(q.filters).toContainEqual([q.table === "profiles" ? "id" : q.table === "student_consents" ? "student_user_id" : "user_id", A]);
      if (consent !== "active") { expect(read.body.canCareToday).toBe(false); expect(read.body.canAddKeepsakeToday).toBe(false); }
      const del = await f.request("pages/api/garden/keepsakes/[id].ts", "DELETE", { locale, query: { id: ID }, body: { owner: B, role: "admin" } });
      expect(del.status).toBe(200); expect(del.body).toEqual({ deleted: true, id: ID });
      expect(f.rows.tempo_garden_keepsakes).toHaveLength(1); expect(f.rows.tempo_garden_keepsakes[0].user_id).toBe(B);
      const q = f.queries.find((q) => q.action === "delete")!; expect(q.filters).toEqual([["id", ID], ["user_id", A]]);
      expect(f.authCalls()).toBe(2);
    });
  }
  test(`API ${locale} empty management does not create data`, async () => {
    const f = fixture({ consent: "withdrawn", empty: true });
    const r = await f.request(undefined, "GET", { locale });
    expect(r.status).toBe(200); expect(r.body.hasExistingData).toBe(false); expect(r.body.total).toBe(0);
    expect(f.queries.every((q) => q.action === "select")).toBe(true);
  });
  for (const auth of ["missing", "expired", "invalid", "forged"]) {
    test(`API ${locale} ${auth} session denies GET/DELETE before data access`, async () => {
      const f = fixture(); const value = auth === "missing" ? null : auth === "expired" ? f.token(A, true) : auth === "invalid" ? "broken" : f.token("forged");
      for (const [path, method] of [["pages/api/garden.ts", "GET"], ["pages/api/garden/keepsakes/[id].ts", "DELETE"]]) {
        expect((await f.request(path, method, { locale, auth: value, query: { id: ID }, body: { owner: A, role: "学生" } })).status).toBe(401);
      }
      expect(f.queries).toEqual([]);
    });
  }
  for (const failure of ["profiles", "tempo_garden_keepsakes"]) {
    test(`API ${locale} ${failure} failure returns safe error and no private payload`, async () => {
      const f = fixture({ failure });
      const r = await f.request(undefined, "GET", { locale });
      expect(r.status).toBe(503); expect(r.body).toEqual({ error: locale === "en" ? en.garden.errors.unavailable : zh.garden.errors.unavailable });
      expect(JSON.stringify(r.body)).not.toContain("provider-error");
    });
  }
  test(`API ${locale} non-student and other owner cannot manage`, async () => {
    const f = fixture({ role: "学校支持人员" });
    expect((await f.request(undefined, "GET", { locale })).status).toBe(403);
    expect((await f.request("pages/api/garden/keepsakes/[id].ts", "DELETE", { locale, query: { id: ID } })).status).toBe(403);
    const g = fixture();
    expect((await g.request("pages/api/garden/keepsakes/[id].ts", "DELETE", { locale, auth: g.token(B), query: { id: ID }, body: { owner: A, canManage: true } })).status).toBe(404);
    expect(g.rows.tempo_garden_keepsakes).toHaveLength(2);
  });
  for (const consent of ["withdrawn", "error"]) {
    test(`API ${locale} ${consent} all five new-use operations remain denied`, async () => {
      const f = fixture({ consent });
      for (const [path, method, body] of [
        ["pages/api/garden.ts", "POST", { feeling: "steady" }], ["pages/api/garden.ts", "PATCH", { reminderMode: "daily" }],
        ["pages/api/garden/care.ts", "POST", { action: "water" }], ["pages/api/garden/layout.ts", "PUT", { slot: "flower_border", itemKey: "low_fern" }],
        ["pages/api/garden/keepsakes/index.ts", "POST", { type: "flower" }],
      ] as const) expect((await f.request(path, method, { locale, body: { ...body, owner: A, role: "学生", canManage: true, consent: "active" } })).status).toBe(consent === "withdrawn" ? 403 : 503);
      expect(f.queries.every((q) => q.action === "select")).toBe(true);
    });
  }
  test(`API ${locale} deletion 404/429/503 are preserved`, async () => {
    for (const options of [{ empty: true }, { limit: true }, { failure: "tempo_garden_keepsakes" }]) {
      const f = fixture(options);
      const r = await f.request("pages/api/garden/keepsakes/[id].ts", "DELETE", { locale, query: { id: ID } });
      expect(r.status).toBe(options.empty ? 404 : options.limit ? 429 : 503); expect(r.body.deleted).toBeUndefined();
    }
  });
  test(`API ${locale} valid consent retains all five new-use paths`, async () => {
    const f = fixture();
    // low_fern keeps its original seven-participation-day requirement.
    for (let day = 1; day <= 6; ++day) f.rows.tempo_check_ins.push({ id: `10000000-0000-4000-8000-${String(day).padStart(12, "0")}`,
      user_id: A, created_at: new Date(Date.now() - day * 86400000).toISOString() });
    for (const [path, method, body, status] of [
      ["pages/api/garden.ts", "POST", { feeling: "steady" }, 201],
      ["pages/api/garden.ts", "PATCH", { reminderMode: "daily" }, 200],
      ["pages/api/garden/care.ts", "POST", { action: "water" }, 201],
      ["pages/api/garden/layout.ts", "PUT", { slot: "flower_border", itemKey: "low_fern" }, 200],
      ["pages/api/garden/keepsakes/index.ts", "POST", { type: "flower" }, 201],
    ] as const) {
      const r = await f.request(path, method, { locale, body });
      expect(r.status).toBe(status);
    }
    expect(f.queries.filter((q) => q.action !== "select")).toHaveLength(5);
  });
}

test("Shared consent behavior, key parity and existing growth rules remain intact", () => {
  const f = fixture(); const active = f.load("lib/studentConsent.ts").isActiveStudentConsent as (c: unknown) => boolean;
  const c = f.rows.student_consents[0]; expect(active(c)).toBe(true);
  for (const extra of [{ status: "withdrawn" }, { policy_version: "old" }, { student_assented_at: null }, { age_band: "under_14" }]) expect(active({ ...c, ...extra })).toBe(false);
  const growth = f.load("lib/tempoGarden.ts").gardenStage as (n: number) => string;
  expect([0, 1, 3, 7, 14, 28].map(growth)).toEqual(["seed", "sprout", "leaves", "bloom", "bloom", "bloom"]);
  function keys(o: unknown, prefix = ""): string[] { return Object.entries(o as Row).flatMap(([k, v]) => typeof v === "string" ? [prefix + k] : keys(v, prefix + k + ".")); }
  expect(keys(en).sort()).toEqual(keys(zh).sort());
});
