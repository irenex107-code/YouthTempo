import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

export const CONSENT_ACTOR = "60000000-0000-4000-8000-000000000017";
export const CONSENT_OTHER = "60000000-0000-4000-8000-000000000018";
export const CONSENT_DIAGNOSTIC = "PUBLIC_SYNTHETIC_CONSENT_DIAGNOSTIC";
type Row = Record<string, unknown>;
type Call = { table: string; method: string; body: unknown; filters: string };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Actual handler and pinned SDK; RPC replies are synthetic interface contracts, never SQL evidence. */
export function consentRpcFixture(initial?: "active" | "withdrawn") {
  const tables: Record<string, Row[]> = {
    profiles: [CONSENT_ACTOR, CONSENT_OTHER].map(id => ({ id, role: "学生", display_name: "PUBLIC SYNTHETIC", school_id: null })),
    guardian_student_links: [], student_consents: [], student_consent_events: [],
  };
  if (initial) tables.student_consents.push({
    student_user_id: CONSENT_ACTOR, school_id: null, age_band: "14_17", consent_basis: "student_self_pilot",
    policy_version: "2026-08-28", status: initial, student_assented_at: "2026-11-01T00:00:00.000Z",
    guardian_user_id: null, guardian_consented_at: null,
    withdrawn_at: initial === "withdrawn" ? "2026-11-02T00:00:00.000Z" : null,
    withdrawn_by: initial === "withdrawn" ? CONSENT_ACTOR : null, updated_at: "2026-11-02T00:00:00.000Z",
  });
  const calls: Call[] = [];
  const faults = { rpcError: false, missingRpc: false, outcome: "applied", consentRead: false, profileRead: false, finalRead: false, eventRead: false };
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { "content-type": "application/json" },
  });
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://consent-fixture.invalid" || !url.pathname.startsWith("/rest/v1/")) {
      throw new Error("non_synthetic_transport_forbidden");
    }
    const table = url.pathname.slice("/rest/v1/".length);

    const method = init?.method || "GET";
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ table, method, body: clone(body), filters: url.search });
    if (table === "rpc/apply_student_consent") {
      if (faults.rpcError || faults.missingRpc) return response({ code: faults.missingRpc ? "PGRST202" : "23505", message: CONSENT_DIAGNOSTIC }, faults.missingRpc ? 404 : 400);
      const p = body as Row;
      const action = p.p_action as string;
      const age = p.p_age_band as string;
      const eventType = action === "withdraw" ? "consent_withdrawn" : age === "under_14" ? "declared_under_14" : "student_assented";
      if (!["applied", "replayed"].includes(faults.outcome)) return response({ outcome: faults.outcome });
      // Declarative synthetic RPC response, not an implementation or proof of PostgreSQL rollback.
      if (faults.outcome === "applied") {
        let row = tables.student_consents.find(r => r.student_user_id === CONSENT_ACTOR);
        if (!row) { row = { student_user_id: CONSENT_ACTOR }; tables.student_consents.push(row); }
        if (action === "withdraw") Object.assign(row, { status: "withdrawn", withdrawn_at: "2026-11-17T00:00:00Z", withdrawn_by: CONSENT_ACTOR });
        else Object.assign(row, { age_band: age, consent_basis: age === "under_14" ? "not_applicable" : age === "18_plus" ? "adult_self" : "student_self_pilot",
          policy_version: "2026-08-28", status: age === "under_14" ? "ineligible" : "active",
          student_assented_at: age === "under_14" ? null : "2026-11-17T00:00:00Z", guardian_user_id: null, guardian_consented_at: null, withdrawn_at: null, withdrawn_by: null });
        row.updated_at = "2026-11-17T00:00:00.000001+00:00";
        tables.student_consent_events.push({ id: p.p_operation_id, student_user_id: CONSENT_ACTOR, actor_user_id: CONSENT_ACTOR, event_type: eventType });
      }
      return response({ outcome: faults.outcome, operationId: p.p_operation_id, eventId: p.p_operation_id,
        action, studentUserId: p.p_student_user_id, actorUserId: p.p_actor_user_id, eventType });
    }
    if (!Object.hasOwn(tables, table)) throw new Error("unexpected_synthetic_table");
    if (method !== "GET") throw new Error("legacy_mutation_forbidden");
    if ((table === "profiles" && (faults.profileRead || (faults.finalRead && calls.some(c => c.table.startsWith("rpc/")))))
      || (table === "student_consents" && faults.consentRead)
      || (table === "student_consent_events" && faults.eventRead)) return response({ code: "SYNTHETIC_FAILURE", message: CONSENT_DIAGNOSTIC }, 503);
    const matches = (row: Row) => [...url.searchParams].every(([key, value]) => {
      if (["select", "or"].includes(key)) return true;
      if (!value.startsWith("eq.")) throw new Error("unexpected_synthetic_filter");
      return String(row[key]) === value.slice(3);
    });
    let selected = tables[table].filter(matches);
    const fields = url.searchParams.get("select");
    if (fields && fields !== "*") selected = selected.map(row => Object.fromEntries(fields.split(",").map(k => [k, row[k] ?? null])));
    return response(clone(selected));
  };
  const client = createClient("https://consent-fixture.invalid", "public-synthetic-server-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: transport },
  });
  const cache = new Map<string, Record<string, unknown>>();
  function load(file: string): Record<string, unknown> {
    const found = cache.get(file); if (found) return found;
    if (!["pages/api/account/consent.ts", "lib/studentConsent.ts", "lib/guardianAccessPolicy.ts"].includes(file)) throw new Error("unexpected_application_module");
    const loaded = { exports: {} as Record<string, unknown> }; cache.set(file, loaded.exports);
    const source = ts.transpileModule(readFileSync(path.resolve(file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, { module: loaded, exports: loaded.exports, Date, Promise,
      require(name: string) {
        if (name === "@/lib/supabaseServer") return { getSupabaseAdmin: () => client,
          getAuthenticatedUser: async (req: { headers: { authorization?: string } }) =>
            req.headers.authorization === "Bearer public-synthetic-A" ? { id: CONSENT_ACTOR } : null };
        if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
        throw new Error("unexpected_application_dependency");
      }, process: { env: {} },
    }, { filename: file });
    return loaded.exports;
  }
  async function request(method: "GET" | "POST" | "DELETE", body: Row = {}, authenticated = true, query: Record<string, string | string[]> = {}) {
    const result = { status: 0, body: {} as Row, headers: {} as Record<string, string> };
    const res = { setHeader: (k: string, v: string) => { result.headers[k] = v; },
      status: (s: number) => { result.status = s; return res; }, json: (v: Row) => { result.body = v; return res; } };
    const handler = load("pages/api/account/consent.ts").default as (req: unknown, res: unknown) => Promise<unknown>;
    await handler({ method, body, query, headers: { authorization: authenticated ? "Bearer public-synthetic-A" : "" } }, res);
    return result;
  }
  const requireActive = async () => await (load("lib/studentConsent.ts").requireActiveStudentConsent as
    (client: SupabaseClient, id: string) => Promise<unknown>)(client, CONSENT_ACTOR);
  return { tables, calls, faults, request, requireActive, snapshot: () => JSON.stringify(tables),
    mutations: () => calls.filter(c => c.method !== "GET") };
}
