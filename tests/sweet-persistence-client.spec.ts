import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { syntheticSweetBridge } from "./fixtures/synthetic-sweet-bridge";
import * as protocol from "../lib/sweetPersistenceProtocol";
import { latestSweetRecordsPerUserDay } from "../lib/sweetRecordDays";
import type { CloudSweetRecord } from "../lib/cloudRecords";
import type { SavedSweetRecordStep } from "../lib/sweetRecordTypes";
import type { SweetCommand, SweetScope } from "../lib/sweetPersistenceProtocol";

const actorA = "00000000-0000-4000-8000-000000000091";
const actorB = "00000000-0000-4000-8000-000000000092";
const today = "2026-10-30", tomorrow = "2026-10-31", historical = "2026-10-29";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const records: SavedSweetRecordStep[] = ["sleep", "wake", "eat", "exercise", "task"].map((dimension) => ({
  id: dimension, title: "SYNTHETIC", label: "SYNTHETIC",
  fields: [{ id: "answer", title: "SYNTHETIC", value: "SYNTHETIC_ANSWER" }],
}));
function row(n: number, day = today, summary = "SYNTHETIC_S1", user = actorA): CloudSweetRecord {
  return { id: id(n), user_id: user, school_id: null, records: structuredClone(records), summary,
    small_step: "SYNTHETIC_STEP", recommended_next_tool: "SYNTHETIC_TOOL", created_at: `${day}T02:00:00.000Z` };
}
function scope(record: CloudSweetRecord | null = null, operationDay = today, targetDay = today): SweetScope {
  return { operationDay, targetDay, headToken: record?.id ?? null, record: structuredClone(record) };
}
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
function packet(value: SweetScope, status = "ready") { return { ...structuredClone(value), status }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function capture<T>(promise: Promise<T>) {
  return promise.then((value) => ({ value, error: undefined as unknown }),
    (error: unknown) => ({ value: undefined, error }));
}
type ApiCall = { method: string; url: string; cache: RequestCache | undefined;
  headers: Record<string, string>; command?: SweetCommand & { locale?: string } };
type Query = { table: string; columns: string; filters: { key: string; value: unknown }[] };
type Session = { data: { session: { user: { id: string }; access_token: string } }; error: null };

/** Real current cloudRecords functions run in the VM. Only Auth, owner-filtered
 * target lookup and API transport are synthetic. No browser, SDK networking,
 * database or SQL execution is used or proved by this suite. */
async function fixture() {
  const api: ApiCall[] = [], queries: Query[] = [], events: string[] = [];
  let actor = actorA, epoch = 0, sessionCalls = 0;
  const hooks = {
    session: undefined as undefined | ((call: number) => Promise<Session>),
    target: undefined as undefined | ((query: Query) => Promise<CloudSweetRecord | null>),
    fetch: undefined as undefined | ((call: ApiCall) => Promise<Response>),
  };
  const session = (): Session => ({ data: { session: { user: { id: actor }, access_token: `SYNTHETIC_TOKEN_${actor}` } }, error: null });
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: actor } }, error: null }),
      getSession: async () => { const call = ++sessionCalls; events.push(`session:${call}`); return hooks.session ? hooks.session(call) : session(); },
    },
    from(table: string) {
      const query: Query = { table, columns: "", filters: [] };
      const chain = {
        select(columns: string) { query.columns = columns; return chain; },
        eq(key: string, value: unknown) { query.filters.push({ key, value }); return chain; },
        insert() { throw new Error("Synthetic fixture forbids direct INSERT"); },
        delete() { throw new Error("Synthetic fixture forbids direct DELETE"); },
        async maybeSingle() {
          if (table !== "sweet_records") throw new Error("Unexpected target table");
          queries.push(structuredClone(query)); events.push("target_lookup");
          const candidate = hooks.target ? await hooks.target(structuredClone(query)) : null;
          const matches = candidate && query.filters.every((filter) => candidate[filter.key as keyof CloudSweetRecord] === filter.value);
          return { data: matches ? structuredClone(candidate) : null, error: null };
        },
      };
      return chain;
    },
  };
  const sourcePath = path.join(process.cwd(), "lib/cloudRecords.ts");
  const source = await readFile(sourcePath, "utf8");
  await test.info().attach("client-helper-executed-source", { contentType: "application/json",
    body: JSON.stringify({ helper: "lib/cloudRecords.ts", helperSha256: createHash("sha256").update(source).digest("hex"),
      protocolFileSha256: createHash("sha256").update(await readFile(path.join(process.cwd(), "lib/sweetPersistenceProtocol.ts"))).digest("hex"),
      layer: "real helper VM, synthetic Auth/Data/API; no browser or SQL" }) });
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exported = {} as typeof import("../lib/cloudRecords");
  vm.runInNewContext(output, { exports: exported, URLSearchParams, Response,
    document: { documentElement: { lang: "en" } },
    console: { warn: () => { /* no private payload output */ } },
    require(name: string) {
      if (name === "@/lib/supabaseClient") return { getSupabase: () => client };
      if (name === "@/lib/sweetRecordDays") return { latestSweetRecordsPerUserDay };
      if (name === "@/lib/sweetPersistenceProtocol" || name === "./sweetPersistenceProtocol") return protocol;
      throw new Error(`Unexpected offline dependency: ${name}`);
    },
    async fetch(url: string, init: RequestInit) {
      if (!url.startsWith("/api/sweet-records?")) throw new Error("Unexpected offline transport target");
      const call: ApiCall = { method: init.method ?? "GET", url, cache: init.cache,
        headers: structuredClone(init.headers as Record<string, string>),
        ...(init.body ? { command: JSON.parse(String(init.body)) as SweetCommand & { locale?: string } } : {}) };
      api.push(call); events.push(`fetch:${call.method}`);
      if (!hooks.fetch) throw new Error("No synthetic API response specified");
      return hooks.fetch(call);
    },
  }, { filename: sourcePath });
  return { exported, hooks, api, queries, events, session,
    sessionCalls: () => sessionCalls,
    actor: () => actor,
    setActor(value: string) { actor = value; ++epoch; events.push(`actor_epoch:${epoch}`); },
    currentGuard() { const captured = epoch; return () => epoch === captured; },
  };
}

function input(summary = "SYNTHETIC_S1") { return { records: structuredClone(records), summary,
  smallStep: "SYNTHETIC_STEP", recommendedNextTool: "SYNTHETIC_TOOL" }; }

test("client rejects missing frozen scope or actor without Auth or fetch", async () => {
  const f = await fixture();
  const missingScope = await capture(f.exported.saveCloudSweetRecord(input(), actorA));
  const missingActor = await capture(f.exported.saveCloudSweetRecord(input(), "", { scope: scope(), intent: "replace_summary" }));
  expect(missingScope.error).toMatchObject({ code: "invalid_request" });
  expect(missingActor.error).toMatchObject({ code: "invalid_request" });
  expect(f.sessionCalls()).toBe(0); expect(f.api).toEqual([]); expect(f.queries).toEqual([]);
});

test("client sends one POST with frozen expected and never silently reads or retries", async () => {
  const f = await fixture(); const before = scope(row(1)); const frozen = structuredClone(before);
  f.hooks.fetch = async () => response(packet(scope(row(2)), "accepted"), 201);
  const stored = await f.exported.saveCloudSweetRecord(input(), actorA, { scope: before, intent: "replace_summary" });
  expect(stored.id).toBe(id(2)); expect(before).toEqual(frozen);
  expect(f.api).toHaveLength(1); expect(f.api[0]).toMatchObject({ method: "POST", cache: "no-store",
    headers: { authorization: `Bearer SYNTHETIC_TOKEN_${actorA}` }, command: {
      operationDay: today, targetDay: today, expectedHead: id(1), intent: "replace_summary", locale: "en", record: input(),
    } });
  expect(f.queries).toEqual([]); expect(f.sessionCalls()).toBe(1);
});

for (const advanced of [false, true]) {
  test(`client unknown commit${advanced ? " then external S2" : ""} retries only original ABSENT and fresh reads actual state`, async () => {
    const f = await fixture(); const initial = scope(); let persisted: CloudSweetRecord | null = null; let dropAck = true;
    f.hooks.fetch = async (call) => {
      if (call.method === "GET") return response(packet(scope(persisted)));
      if (call.command?.expectedHead !== (persisted?.id ?? null)) return response({ status: "conflict", writeOutcome: "not_committed" }, 409);
      persisted = row(2); f.events.push("model_commit:S1");
      if (dropAck) { dropAck = false; throw new TypeError("SYNTHETIC_ACK_DROPPED_AFTER_COMMIT"); }
      return response(packet(scope(persisted), "accepted"), 201);
    };
    const first = await capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: initial, intent: "replace_summary" }));
    expect(first.error).toMatchObject({ code: "outcome_unknown" });
    expect(f.api.map((call) => call.method)).toEqual(["POST"]);
    expect(persisted).toMatchObject({ id: id(2), summary: "SYNTHETIC_S1" });
    if (advanced) { persisted = row(3, today, "SYNTHETIC_S2"); f.events.push("model_external_commit:S2"); }
    const retry = await capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: initial, intent: "replace_summary" }));
    expect(retry.error).toMatchObject({ code: "conflict" });
    expect(f.api.map((call) => call.method)).toEqual(["POST", "POST"]);
    expect(f.api.map((call) => call.command?.expectedHead)).toEqual([null, null]);
    const fresh = await f.exported.readCloudSweetScope(actorA);
    expect(fresh.record).toEqual(persisted);
    expect(fresh.record?.summary).toBe(advanced ? "SYNTHETIC_S2" : "SYNTHETIC_S1");
    expect(f.api.map((call) => call.method)).toEqual(["POST", "POST", "GET"]);
  });
}

test("client body-delivery failure after 201 is unknown and not automatically retried", async () => {
  const f = await fixture(); let committed: CloudSweetRecord | null = null;
  f.hooks.fetch = async () => {
    committed = row(2);
    return new Response(new ReadableStream({ start(controller) { controller.error(new Error("SYNTHETIC_BODY_DROPPED")); } }), { status: 201 });
  };
  const result = await capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: scope(), intent: "replace_summary" }));
  expect(result.error).toMatchObject({ code: "outcome_unknown" });
  expect(committed).toMatchObject({ id: id(2), summary: "SYNTHETIC_S1" });
  expect(f.api).toHaveLength(1);
});

test("client checks current generation after a gated token lookup before POST", async () => {
  const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); let valid = true;
  f.hooks.session = async () => { entered.resolve(); await release.promise; return f.session(); };
  const result = capture(f.exported.saveCloudSweetRecord(input(), actorA, {
    scope: scope(), intent: "replace_summary", current: () => valid,
  }));
  await entered.promise; valid = false; release.resolve();
  expect((await result).error).toMatchObject({ code: "interrupted" });
  expect(f.api).toEqual([]);
});

test("client rejects B session returned during A token lookup without POST", async () => {
  const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
  f.hooks.session = async () => { entered.resolve(); await release.promise; return f.session(); };
  const result = capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: scope(), intent: "replace_summary" }));
  await entered.promise; f.setActor(actorB); release.resolve();
  expect((await result).error).toMatchObject({ message: "账号已变化，请确认后再继续。" });
  expect(f.api).toEqual([]); expect(f.actor()).toBe(actorB);
});

for (const gateAt of ["target_lookup", "historical_scope"] as const) {
  test(`historical delete freezes operation day before ${gateAt} crosses Shanghai midnight`, async () => {
    const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); const historicalRow = row(1, historical);
    let serverDay = today;
    f.hooks.target = async () => {
      if (gateAt === "target_lookup") { entered.resolve(); await release.promise; }
      return historicalRow;
    };
    f.hooks.fetch = async (call) => {
      expect(call.method).toBe("GET");
      const target = new URL(call.url, "http://synthetic.invalid").searchParams.get("targetDay");
      if (target) {
        expect(target).toBe(historical);
        if (gateAt === "historical_scope") { entered.resolve(); await release.promise; }
        return response(packet(scope(historicalRow, serverDay, historical)));
      }
      return response(packet(scope(null, serverDay, serverDay)));
    };
    const result = capture(f.exported.deleteCloudSweetRecord(historicalRow.id, actorA, f.currentGuard()));
    await entered.promise; serverDay = tomorrow; f.events.push("model_db_acceptance_day_advanced"); release.resolve();
    expect((await result).error).toMatchObject({ code: "scope_expired" });
    expect(f.api.map((call) => call.method)).toEqual(["GET", "GET"]);
    expect(f.api.filter((call) => call.method === "POST")).toEqual([]);
    expect(f.queries[0].filters).toEqual([{ key: "id", value: historicalRow.id }, { key: "user_id", value: actorA }]);
  });
}

test("historical delete target lookup A to B to A invalidates context despite same final UID", async () => {
  const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); const target = row(1, historical);
  f.hooks.fetch = async () => response(packet(scope()));
  f.hooks.target = async () => { entered.resolve(); await release.promise; return target; };
  const result = capture(f.exported.deleteCloudSweetRecord(target.id, actorA, f.currentGuard()));
  await entered.promise; f.setActor(actorB); f.setActor(actorA); release.resolve();
  expect((await result).error).toMatchObject({ code: "interrupted" });
  expect(f.actor()).toBe(actorA); expect(f.api.map((call) => call.method)).toEqual(["GET"]);
  expect(f.queries[0].filters).toContainEqual({ key: "user_id", value: actorA });
});

test("historical scope late response checks current again before final delete POST", async () => {
  const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); const target = row(1, historical);
  f.hooks.target = async () => target;
  f.hooks.fetch = async (call) => {
    if (new URL(call.url, "http://synthetic.invalid").searchParams.has("targetDay")) {
      entered.resolve(); await release.promise; return response(packet(scope(target, today, historical)));
    }
    return response(packet(scope()));
  };
  const result = capture(f.exported.deleteCloudSweetRecord(target.id, actorA, f.currentGuard()));
  await entered.promise; f.setActor(actorB); f.setActor(actorA); release.resolve();
  expect((await result).error).toMatchObject({ code: "interrupted" });
  expect(f.api.map((call) => call.method)).toEqual(["GET", "GET"]);
});

test("historical delete binds target owner and sends only current supplied head/day through protocol", async () => {
  const f = await fixture(); const target = row(1, historical); let currentChecks = 0;
  f.hooks.target = async () => target;
  f.hooks.fetch = async (call) => {
    if (call.method === "GET") return response(packet(new URL(call.url, "http://synthetic.invalid").searchParams.has("targetDay")
      ? scope(target, today, historical) : scope()));
    expect(call.command).toEqual({ operationDay: today, targetDay: historical, expectedHead: target.id,
      intent: "delete_day", recordId: target.id, locale: "en" });
    return response({ ...packet(scope(null, today, historical), "accepted"), headToken: id(9) }, 201);
  };
  const result = await capture(f.exported.deleteCloudSweetRecord(target.id, actorA, () => { ++currentChecks; return true; }));
  expect(result.error).toBeUndefined(); expect(currentChecks).toBeGreaterThanOrEqual(6);
  expect(f.api.map((call) => call.method)).toEqual(["GET", "GET", "POST"]);
  expect(f.queries).toEqual([{ table: "sweet_records", columns: "id,user_id,created_at", filters: [
    { key: "id", value: target.id }, { key: "user_id", value: actorA },
  ] }]);
  expect(f.api.every((call) => call.headers.authorization === `Bearer SYNTHETIC_TOKEN_${actorA}`)).toBe(true);
});

test("owner-filtered target query cannot turn B record into A deletion", async () => {
  const f = await fixture(); const target = row(1, historical, "SYNTHETIC_B", actorB);
  f.hooks.fetch = async () => response(packet(scope())); f.hooks.target = async () => target;
  const result = await capture(f.exported.deleteCloudSweetRecord(target.id, actorA, f.currentGuard()));
  expect(result.error).toMatchObject({ code: "not_found" });
  expect(f.queries[0].filters).toContainEqual({ key: "user_id", value: actorA });
  expect(f.api.map((call) => call.method)).toEqual(["GET"]);
});

test("already invalid delete context never starts scope, target or mutation transport", async () => {
  const f = await fixture();
  const result = await capture(f.exported.deleteCloudSweetRecord(id(1), actorA, () => false));
  expect(result.error).toMatchObject({ code: "interrupted" });
  expect(f.sessionCalls()).toBe(0); expect(f.api).toEqual([]); expect(f.queries).toEqual([]);
});

test("malformed owner/head reply cannot be adopted as confirmed storage", async () => {
  const f = await fixture();
  f.hooks.fetch = async () => response(packet(scope(row(1, today, "SYNTHETIC_B", actorB))));
  const read = await capture(f.exported.readCloudSweetScope(actorA));
  expect(read.error).toMatchObject({ code: "protocol_unavailable" });
  const saved = await capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: scope(), intent: "replace_summary" }));
  expect(saved.error).toMatchObject({ code: "outcome_unknown" });
  expect(f.api.map((call) => call.method)).toEqual(["GET", "POST"]);
});


type MiniData = {
  answers: Record<string, string>; completed: number; consentAccepted: boolean;
  submitting: boolean; result: unknown; message: string; isError: boolean;
};
type MiniPage = {
  data: MiniData;
  setData(value: Partial<MiniData>): void;
  onShow(): void;
  onHide?: () => void;
  generateAndSave(): Promise<void>;
  toggleConsent(): void;
  reset(): void;
  selectAnswer(event: { currentTarget: { dataset: { step: string; value: string } } }): void;
};
type MiniCall = { path: string; method: string; data?: Record<string, unknown>; retryAuthentication?: boolean };
async function miniFixture() {
  const sourcePath = path.join(process.cwd(), "miniprogram/pages/sweet/index.js");
  const source = await readFile(sourcePath, "utf8");
  await test.info().attach("mini-page-executed-source", { contentType: "application/json",
    body: JSON.stringify({ source: "miniprogram/pages/sweet/index.js", sha256: createHash("sha256").update(source).digest("hex"),
      layer: "Page definition VM only; no wx device, UI, Auth, network or database" }) });
  let definition: MiniPage | undefined, actor = actorA;
  const calls: MiniCall[] = [];
  const hooks = { api: undefined as undefined | ((call: MiniCall) => Promise<unknown>) };
  vm.runInNewContext(source, {
    Page(value: MiniPage) { definition = value; },
    require(name: string) {
      if (name !== "../../utils/api") throw new Error("Unexpected mini dependency");
      return { getSession: () => ({ user: { id: actor } }),
        async api(url: string, options: { method?: string; data?: Record<string, unknown>; retryAuthentication?: boolean } = {}) {
          const call = { path: url, method: options.method ?? "GET", retryAuthentication: options.retryAuthentication, ...(options.data ? { data: structuredClone(options.data) } : {}) };
          calls.push(call);
          if (!hooks.api) throw new Error("Missing mini API response");
          return hooks.api(call);
        } };
    },
    wx: { redirectTo() { throw new Error("Unexpected login redirect"); }, pageScrollTo() { /* not a device */ } },
  }, { filename: sourcePath });
  if (!definition) throw new Error("Mini Page was not registered");
  const page: MiniPage = { ...definition, data: structuredClone(definition.data),
    setData(value) { Object.assign(this.data, value); } };
  function fill(label = "SYNTHETIC_A") {
    for (const dimension of ["sleep", "wake", "eat", "exercise", "task"]) {
      page.selectAnswer({ currentTarget: { dataset: { step: dimension, value: label } } });
    }
    page.setData({ consentAccepted: true });
  }
  return { page, calls, hooks, fill, setActor(value: string) { actor = value; } };
}

test("mini Page freezes scope before AI and preserves that exact expected in the write", async () => {
  const f = await miniFixture(), entered = deferred<void>(), release = deferred<void>();
  const frozen = scope(row(1));
  f.hooks.api = async (call) => {
    if (call.path === "/api/sweet-records") { entered.resolve(); await release.promise; return packet(frozen); }
    if (call.path === "/api/ai/check-in") return { summary: "SYNTHETIC_MINI_S1", smallStep: "SYNTHETIC_STEP", recommendedNextTool: "SYNTHETIC_TOOL" };
    return packet(scope(row(2)), "accepted");
  };
  f.page.onShow(); f.fill();
  const saving = capture(f.page.generateAndSave());
  await entered.promise; expect(f.calls.map((call) => call.path)).toEqual(["/api/sweet-records"]);
  release.resolve(); expect((await saving).error).toBeUndefined();
  expect(f.calls.map((call) => call.path)).toEqual(["/api/sweet-records", "/api/ai/check-in", "/api/mini/records"]);
  expect(f.calls[2].data).toMatchObject({ operationDay: today, targetDay: today, expectedHead: id(1), intent: "replace_summary" });
  expect(f.calls.every((call) => call.retryAuthentication === false)).toBe(true);
  const savedRecords = (f.calls[2].data?.record as { records: Record<string, unknown>[] }).records;
  expect(savedRecords).toHaveLength(5);
  for (const step of savedRecords) {
    expect(Object.keys(step).sort()).toEqual(["fields", "id", "label", "title"]);
    for (const field of step.fields as Record<string, unknown>[]) expect(Object.keys(field).sort()).toEqual(["id", "title", "value"]);
  }
  expect(f.page.data.result).toMatchObject({ summary: "SYNTHETIC_MINI_S1" });
});

test("mini actor reset releases old busy and old finally cannot clear B operation", async () => {
  const f = await miniFixture(), aEntered = deferred<void>(), aRelease = deferred<void>();
  const bEntered = deferred<void>(), bRelease = deferred<void>(); let scopeCalls = 0;
  f.hooks.api = async (call) => {
    if (call.path === "/api/sweet-records") {
      if (++scopeCalls === 1) { aEntered.resolve(); await aRelease.promise; }
      else { bEntered.resolve(); await bRelease.promise; }
      return packet(scope());
    }
    if (call.path === "/api/ai/check-in") return { summary: "SYNTHETIC_B", smallStep: "SYNTHETIC_STEP", recommendedNextTool: "SYNTHETIC_TOOL" };
    return packet(scope(row(2, today, "SYNTHETIC_B", actorB)), "accepted");
  };
  f.page.onShow(); f.fill(); const a = capture(f.page.generateAndSave());
  await aEntered.promise; f.setActor(actorB); f.page.onShow(); const resetBusy = f.page.data.submitting; f.fill("SYNTHETIC_B");
  const b = capture(f.page.generateAndSave());
  const progress = await Promise.race([bEntered.promise.then(() => "entered"), b.then(() => "returned_before_scope")]);
  aRelease.resolve(); await a;
  const bStillOwnsBusy = f.page.data.submitting;
  bRelease.resolve(); await b;
  expect(resetBusy).toBe(false);
  expect(progress).toBe("entered");
  expect(bStillOwnsBusy).toBe(true);
  expect(f.calls.filter((call) => call.path === "/api/ai/check-in")).toHaveLength(1);
  expect(f.calls.filter((call) => call.path === "/api/mini/records")).toHaveLength(1);
  expect(f.page.data.result).toMatchObject({ summary: "SYNTHETIC_B" });
  expect(f.page.data.submitting).toBe(false);
});

test("mini hide A to B to A prevents old delayed scope from becoming a fresh AI write", async () => {
  const f = await miniFixture(), entered = deferred<void>(), release = deferred<void>();
  f.hooks.api = async (call) => {
    if (call.path === "/api/sweet-records") { entered.resolve(); await release.promise; return packet(scope(row(3, today, "SYNTHETIC_NEW_S2"))); }
    if (call.path === "/api/ai/check-in") return { summary: "SYNTHETIC_OLD_S1" };
    return packet(scope(row(4, today, "SYNTHETIC_OLD_S1")), "accepted");
  };
  f.page.onShow(); f.fill(); const old = capture(f.page.generateAndSave());
  await entered.promise;
  f.page.onHide?.(); f.setActor(actorB); f.setActor(actorA); f.page.onShow();
  release.resolve(); await old;
  expect(f.calls.map((call) => call.path)).toEqual(["/api/sweet-records"]);
  expect(f.page.data.result).toBeNull();
  expect(f.page.data.submitting).toBe(false);
});

test("GET 200 with accepted write status is unavailable rather than an authority baseline", async () => {
  const f = await fixture();
  f.hooks.fetch = async () => response(packet(scope(row(1)), "accepted"), 200);
  const result = await capture(f.exported.readCloudSweetScope(actorA));
  expect(result.error).toMatchObject({ code: "protocol_unavailable" });
  expect(f.api.map((call) => call.method)).toEqual(["GET"]);
  expect(f.queries).toEqual([]);
});

test("POST 200 with ready read status is unknown rather than confirmed persistence", async () => {
  const f = await fixture();
  f.hooks.fetch = async () => response(packet(scope(row(1)), "ready"), 200);
  const result = await capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: scope(), intent: "replace_summary" }));
  expect(result.error).toMatchObject({ code: "outcome_unknown" });
  expect(f.api.map((call) => call.method)).toEqual(["POST"]);
  expect(f.api[0].command?.expectedHead).toBeNull();
  expect(f.queries).toEqual([]);
});


test("mini AI consent becomes false while AI is held, so old result cannot POST", async () => {
  const f = await miniFixture(), entered = deferred<void>(), release = deferred<void>();
  f.hooks.api = async (call) => {
    if (call.path === "/api/sweet-records") return packet(scope());
    if (call.path === "/api/ai/check-in") {
      entered.resolve(); await release.promise;
      return { summary: "SYNTHETIC_OLD_AI", smallStep: "SYNTHETIC_STEP", recommendedNextTool: "SYNTHETIC_TOOL" };
    }
    throw new Error("Cancelled AI must not reach the persistence adapter");
  };
  f.page.onShow(); f.fill(); const old = capture(f.page.generateAndSave());
  await entered.promise; f.page.toggleConsent();
  expect(f.page.data.consentAccepted).toBe(false);
  release.resolve(); expect((await old).error).toBeUndefined();
  expect(f.calls.map((call) => call.path)).toEqual(["/api/sweet-records", "/api/ai/check-in"]);
  expect(f.page.data.result).toBeNull(); expect(f.page.data.submitting).toBe(false);
});


test("real mini api opt-out prevents auth refresh or replay after A request returns 401 while B is current", async () => {
  const sourcePath = path.join(process.cwd(), "miniprogram/utils/api.js");
  const source = await readFile(sourcePath, "utf8");
  await test.info().attach("mini-api-executed-source", { contentType: "application/json",
    body: JSON.stringify({ source: "miniprogram/utils/api.js", sha256: createHash("sha256").update(source).digest("hex"),
      layer: "actual mini api VM with synthetic wx.request; no Auth/network/device" }) });
  type FakeSession = { user: { id: string }; access_token: string; refresh_token: string };
  type WxRequest = { url: string; header: Record<string, string>; method: string; data: unknown;
    success(value: { statusCode: number; data: unknown }): void };
  const a: FakeSession = { user: { id: actorA }, access_token: "SYNTHETIC_ACCESS_A", refresh_token: "SYNTHETIC_REFRESH_A" };
  const b: FakeSession = { user: { id: actorB }, access_token: "SYNTHETIC_ACCESS_B", refresh_token: "SYNTHETIC_REFRESH_B" };
  let session = a, storageWrites = 0;
  const entered = deferred<WxRequest>(), requests: WxRequest[] = [];
  const app = { globalData: { session } };
  const moduleObject = { exports: {} as { api(path: string, options: {
    method: string; data: unknown; retryAuthentication: boolean;
  }): Promise<unknown> } };
  vm.runInNewContext(source, { module: moduleObject,
    require(name: string) {
      if (name !== "../config") throw new Error("Unexpected utility dependency");
      return { supabasePublishableKey: "SYNTHETIC_PUBLIC_KEY", supabaseUrl: "https://synthetic-auth.invalid", apiBaseUrl: "https://synthetic-api.invalid" };
    },
    getApp: () => app,
    wx: {
      getStorageSync(key: string) { expect(key).toBe("yt_session"); return session; },
      setStorageSync(_key: string, next: FakeSession) { ++storageWrites; session = next; },
      request(request: WxRequest) {
        requests.push(request);
        if (requests.length > 1) throw new Error("Unexpected auth refresh or mutation replay");
        entered.resolve(request);
      },
    },
  }, { filename: sourcePath });
  const frozen = { operationDay: today, targetDay: today, expectedHead: null,
    intent: "replace_summary", record: input() };
  const pending = capture(moduleObject.exports.api("/api/mini/records", {
    method: "POST", data: frozen, retryAuthentication: false,
  }));
  const request = await entered.promise;
  session = b; app.globalData.session = b;
  request.success({ statusCode: 401, data: { error: "请先登录。" } });
  expect((await pending).error).toMatchObject({ message: "请先登录。" });
  expect(requests).toHaveLength(1);
  expect(request.url).toBe("https://synthetic-api.invalid/api/mini/records");
  expect(request.header.authorization).toBe("Bearer SYNTHETIC_ACCESS_A");
  expect(request.data).toEqual(frozen);
  expect(storageWrites).toBe(0); expect(session).toBe(b); expect(app.globalData.session).toBe(b);
});

for (const outcome of ["unknown", "conflict"] as const) {
  test(`mini D2 ${outcome} same-draft click retains original expected and cannot overwrite external S2`, async () => {
    const f = await miniFixture(), entered = deferred<void>(), release = deferred<void>();
    const events: Record<string, unknown>[] = [];
    let persisted: CloudSweetRecord | null = null, writes = 0;
    f.hooks.api = async (call) => {
      if (call.path === "/api/sweet-records") {
        events.push({ event: "scope_read", head: persisted?.id ?? null });
        return packet(scope(persisted));
      }
      if (call.path === "/api/ai/check-in") {
        events.push({ event: "ai_result", summary: "SYNTHETIC_OLD_S1" });
        return { summary: "SYNTHETIC_OLD_S1", smallStep: "SYNTHETIC_STEP", recommendedNextTool: "SYNTHETIC_TOOL" };
      }
      if (call.path !== "/api/mini/records") throw new Error("Unexpected mini D2 transport");
      ++writes;
      events.push({ event: "write_received", attempt: writes, expected: call.data?.expectedHead });
      if (writes === 1) {
        if (outcome === "unknown") {
          persisted = row(1, today, "SYNTHETIC_OLD_S1");
          events.push({ event: "model_committed_S1", head: persisted.id });
        }
        entered.resolve(); await release.promise;
        events.push({ event: `first_${outcome}`, head: persisted?.id ?? null });
        throw new Error(outcome === "unknown" ? "SYNTHETIC_ACK_DROPPED_AFTER_COMMIT" : "SYNTHETIC_CAS_CONFLICT");
      }
      if (call.data?.expectedHead !== (persisted?.id ?? null)) {
        events.push({ event: "retry_conflict", head: persisted?.id ?? null });
        throw new Error("SYNTHETIC_CAS_CONFLICT");
      }
      const command = call.data?.record as { summary?: string };
      persisted = row(3, today, command.summary);
      events.push({ event: "retry_committed", head: persisted.id, summary: persisted.summary });
      return packet(scope(persisted), "accepted");
    };
    f.page.onShow(); f.fill("SYNTHETIC_OLD_ANSWERS");
    const first = capture(f.page.generateAndSave());
    await entered.promise;
    persisted = row(2, today, "SYNTHETIC_NEW_S2");
    events.push({ event: "model_external_S2", head: persisted.id });
    release.resolve(); expect((await first).error).toBeUndefined();
    expect(f.page.data.isError).toBe(true); expect(f.page.data.submitting).toBe(false);
    events.push({ event: "same_draft_user_click" });
    expect((await capture(f.page.generateAndSave())).error).toBeUndefined();
    events.push({ event: "final_account_model_read", record: persisted });
    await test.info().attach("mini-D2-execution", { contentType: "application/json", body: JSON.stringify({
      outcome, events, calls: f.calls, finalPersisted: persisted,
      layer: "actual mini Page VM; deterministic deferred response + synthetic CAS storage, no real SQL",
    }) });
    const posts = f.calls.filter((call) => call.path === "/api/mini/records");
    expect(posts.map((call) => call.data?.expectedHead)).toEqual([null, null]);
    expect(posts[1].data).toEqual(posts[0].data);
    expect(f.calls.filter((call) => call.path === "/api/sweet-records")).toHaveLength(1);
    expect(f.calls.filter((call) => call.path === "/api/ai/check-in")).toHaveLength(1);
    expect(persisted).toMatchObject({ id: id(2), summary: "SYNTHETIC_NEW_S2" });
    expect(f.page.data.result).toBeNull();
  });
}

test("mini real answer edit or reset establishes a new operation instead of permanently locking an old expected", async () => {
  for (const action of ["answer_edit", "reset"] as const) {
    const f = await miniFixture(), entered = deferred<void>(), release = deferred<void>();
    let persisted: CloudSweetRecord | null = null, writes = 0, aiCalls = 0;
    f.hooks.api = async (call) => {
      if (call.path === "/api/sweet-records") return packet(scope(persisted));
      if (call.path === "/api/ai/check-in") {
        ++aiCalls;
        return { summary: aiCalls === 1 ? "SYNTHETIC_OLD_S1" : "SYNTHETIC_NEW_DRAFT_S3",
          smallStep: "SYNTHETIC_STEP", recommendedNextTool: "SYNTHETIC_TOOL" };
      }
      if (call.path !== "/api/mini/records") throw new Error("Unexpected mini new-operation transport");
      if (++writes === 1) {
        entered.resolve(); await release.promise;
        throw new Error("SYNTHETIC_ACK_DROPPED_AFTER_COMMIT");
      }
      if (call.data?.expectedHead !== persisted?.id) throw new Error("New draft used an expired expected");
      persisted = row(3, today, (call.data?.record as { summary: string }).summary);
      return packet(scope(persisted), "accepted");
    };
    f.page.onShow(); f.fill("SYNTHETIC_OLD_ANSWERS");
    const first = capture(f.page.generateAndSave());
    await entered.promise;
    persisted = row(2, today, "SYNTHETIC_EXTERNAL_S2");
    release.resolve(); expect((await first).error).toBeUndefined();
    expect(f.page.data.isError).toBe(true);
    if (action === "answer_edit") {
      f.page.selectAnswer({ currentTarget: { dataset: { step: "sleep", value: "SYNTHETIC_NEW_ANSWER" } } });
    } else {
      f.page.reset();
      expect(f.page.data.consentAccepted).toBe(false);
      f.fill("SYNTHETIC_NEW_AFTER_RESET");
    }
    expect((await capture(f.page.generateAndSave())).error).toBeUndefined();
    const posts = f.calls.filter((call) => call.path === "/api/mini/records");
    expect(posts.map((call) => call.data?.expectedHead)).toEqual([null, id(2)]);
    expect(posts[1].data?.record).not.toEqual(posts[0].data?.record);
    expect(f.calls.filter((call) => call.path === "/api/sweet-records")).toHaveLength(2);
    expect(aiCalls).toBe(2);
    expect(persisted).toMatchObject({ id: id(3), summary: "SYNTHETIC_NEW_DRAFT_S3" });
    expect(f.page.data.result).toMatchObject({ summary: "SYNTHETIC_NEW_DRAFT_S3" });
    expect(f.page.data.isError).toBe(false); expect(f.page.data.submitting).toBe(false);
    await test.info().attach(`mini-new-operation-${action}`, { contentType: "application/json",
      body: JSON.stringify({ action, calls: f.calls, finalPersisted: persisted,
        layer: "real Page VM with synthetic scope/CAS only; no real database or device" }) });
  }
});

for (const code of ["08007", "40003", "XX000", "23514"]) {
  test(`B actual bridge to helper ${code}: committed unknown vs trusted rollback`, async () => {
    const f = await fixture(); let persisted: CloudSweetRecord | null = null;
    let first = true;
    const bridge = syntheticSweetBridge(actorA, async (_name, args) => {
      if (first) {
        first = false;
        if (code !== "23514") { persisted = row(2); f.events.push("model_commit_before_RPC_error"); }
        return { data: null, error: { code, message: "PRIVATE_DETAIL" } };
      }
      if (args.p_expected_head !== (persisted?.id ?? null)) return { data: { status: "conflict" }, error: null };
      persisted = row(3); return { data: packet(scope(persisted), "accepted"), error: null };
    });
    f.hooks.fetch = async (call) => {
      if (call.method === "GET") return response(packet(scope(persisted)));
      const r = await bridge.run(call.command); return response(r.body, r.status);
    };
    const original = scope();
    const a = await capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: original, intent: "replace_summary" }));
    expect(a.error).toMatchObject({ code: code === "23514" ? "write_rejected" : "outcome_unknown" });
    expect(f.api).toHaveLength(1); expect(bridge.calls).toHaveLength(1);
    expect(persisted).toEqual(code === "23514" ? null : row(2));
    const b = await capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: original, intent: "replace_summary" }));
    if (code === "23514") expect(b.value).toEqual(row(3)); else expect(b.error).toMatchObject({ code: "conflict" });
    expect(f.api.map(c => c.command?.expectedHead)).toEqual([null, null]);
    const fresh = await f.exported.readCloudSweetScope(actorA);
    expect(fresh.record).toEqual(persisted);
    expect(f.api.map(c => c.method)).toEqual(["POST", "POST", "GET"]);
  });
}

// R03-B B-T07/B-T09/B-T13: real client helper, deterministic synthetic CAS.
// These gates model dispatch/comparison/commit, not PostgreSQL locks/transactions.
for (const initialKind of ["ABSENT", "live", "tombstone"] as const) {
  test(`B-T07 same original command from ${initialKind} advances once; explicit current command may NOOP`, async () => {
    const f = await fixture();
    let persisted: CloudSweetRecord | null = initialKind === "live" ? row(1, today, "SYNTHETIC_INITIAL") : null;
    let head: string | null = initialKind === "ABSENT" ? null : initialKind === "live" ? id(1) : id(50);
    const frozen: SweetScope = { ...scope(persisted), headToken: head };
    let advances = 0;
    const otherBefore = row(90, today, "SYNTHETIC_UNRELATED_B", actorB);
    const unrelated = structuredClone(otherBefore);
    const events: Array<Record<string, unknown>> = [];
    const current = (): SweetScope => ({ ...scope(persisted), headToken: head });
    f.hooks.fetch = async (call) => {
      if (call.method === "GET") return response(packet(current()));
      const command = call.command;
      if (!command) throw new Error("Synthetic POST command missing");
      // CAS precedes even identical-content detection. Original expected never
      // becomes the current head merely because its content is already there.
      if (command.expectedHead !== head) {
        events.push({ event: "model_conflict", expected: command.expectedHead, head });
        return response({ status: "conflict", writeOutcome: "not_committed" }, 409);
      }
      const content = command.record;
      if (persisted && content && JSON.stringify(persisted.records) === JSON.stringify(content.records)
        && persisted.summary === content.summary && persisted.small_step === content.smallStep
        && persisted.recommended_next_tool === content.recommendedNextTool) {
        events.push({ event: "model_current_command_noop", head });
        return response(packet(current(), "noop"));
      }
      persisted = row(2); head = id(2); ++advances;
      events.push({ event: "model_committed", head });
      return response(packet(current(), "accepted"), 201);
    };
    const first = await f.exported.saveCloudSweetRecord(input(), actorA, { scope: frozen, intent: "replace_summary" });
    expect(first).toEqual(row(2));
    const repeated = await capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: frozen, intent: "replace_summary" }));
    expect(repeated.error).toMatchObject({ code: "conflict" });
    expect(f.api.map((call) => call.method)).toEqual(["POST", "POST"]);
    expect(f.api[1].command).toEqual(f.api[0].command);
    expect(f.api.slice(0, 2).map((call) => call.command?.expectedHead)).toEqual([frozen.headToken, frozen.headToken]);
    const fresh = await f.exported.readCloudSweetScope(actorA);
    expect(fresh).toEqual(packet({ ...scope(row(2)), headToken: id(2) }));
    const explicitCurrent = await f.exported.saveCloudSweetRecord(input(), actorA, { scope: fresh, intent: "replace_summary" });
    expect(explicitCurrent).toEqual(row(2));
    expect(f.api.map((call) => call.method)).toEqual(["POST", "POST", "GET", "POST"]);
    expect(f.api[3].command?.expectedHead).toBe(id(2));
    expect(advances).toBe(1); expect(head).toBe(id(2)); expect(persisted).toEqual(row(2));
    expect(latestSweetRecordsPerUserDay(persisted ? [persisted] : [])).toHaveLength(1);
    expect(unrelated).toEqual(otherBefore);
    await test.info().attach("B-T07-original-command-and-current-noop-model", { contentType: "application/json",
      body: JSON.stringify({ initialKind, frozen, events, calls: f.api, advances, persisted, unrelated,
        layer: "real client helper + synthetic CAS only; no database/lock/transaction proof" }) });
  });
}

for (const order of ["retry-first", "original-first"] as const) {
  test(`B-T09 unknown original still in flight; GET H0; ${order} compares first without rebasing`, async () => {
    const f = await fixture(), retryEntered = deferred<void>(), releaseRetry = deferred<void>();
    const initial = scope();
    let persisted: CloudSweetRecord | null = null, head: string | null = null, advances = 0, posts = 0;
    let heldOriginal: SweetCommand | undefined;
    let originalStatus: "accepted" | "conflict" | undefined;
    const events: Array<Record<string, unknown>> = [];
    const otherBefore = row(90, today, "SYNTHETIC_UNRELATED_B", actorB), unrelated = structuredClone(otherBefore);
    const current = (): SweetScope => ({ ...scope(persisted), headToken: head });
    function compare(command: SweetCommand, request: string) {
      events.push({ event: "model_compare", request, expected: command.expectedHead, head });
      if (command.expectedHead !== head) {
        events.push({ event: "model_conflict", request, head });
        return { status: "conflict" as const, reply: response({ status: "conflict", writeOutcome: "not_committed" }, 409) };
      }
      persisted = row(2); head = id(2); ++advances;
      events.push({ event: "model_commit", request, head });
      return { status: "accepted" as const, reply: response(packet(current(), "accepted"), 201) };
    }
    function finishOriginal() {
      if (!heldOriginal) throw new Error("Synthetic original was not dispatched");
      originalStatus = compare(heldOriginal, "original").status;
      // This server-side model result is intentionally never delivered to the
      // original client fetch, whose transport has already stopped waiting.
      events.push({ event: "model_original_response_remains_lost", status: originalStatus });
    }
    f.hooks.fetch = async (call) => {
      if (call.method === "GET") {
        events.push({ event: "model_read", head });
        return response(packet(current()));
      }
      if (!call.command) throw new Error("Synthetic POST command missing");
      if (++posts === 1) {
        heldOriginal = structuredClone(call.command);
        events.push({ event: "model_original_entered_before_compare", expected: call.command.expectedHead });
        throw new TypeError("SYNTHETIC_CLIENT_CONNECTION_LOST_ORIGINAL_STILL_IN_FLIGHT");
      }
      if (posts !== 2) throw new Error("Unexpected synthetic mutation replay");
      events.push({ event: "model_retry_entered_before_compare", expected: call.command.expectedHead });
      retryEntered.resolve(); await releaseRetry.promise;
      return compare(call.command, "retry").reply;
    };
    const first = await capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: initial, intent: "replace_summary" }));
    expect(first.error).toMatchObject({ code: "outcome_unknown" });
    expect(f.api.map((call) => call.method)).toEqual(["POST"]); expect(advances).toBe(0);
    const freshBeforeEitherCommit = await f.exported.readCloudSweetScope(actorA);
    expect(freshBeforeEitherCommit).toEqual(packet(initial));
    // This explicit retry uses the ORIGINAL scope, not the fresh read as an
    // authorization to revise head/day or to pronounce the first request failed.
    const retry = capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: initial, intent: "replace_summary" }));
    await retryEntered.promise;
    try {
      if (order === "original-first") finishOriginal();
      releaseRetry.resolve(); const second = await retry;
      if (order === "retry-first") finishOriginal();
      if (order === "retry-first") {
        expect(second.error).toBeUndefined(); expect(second.value).toEqual(row(2)); expect(originalStatus).toBe("conflict");
      } else {
        expect(second.error).toMatchObject({ code: "conflict" }); expect(originalStatus).toBe("accepted");
      }
      expect(first.error).toMatchObject({ code: "outcome_unknown" });
      expect(advances).toBe(1); expect(persisted).toEqual(row(2)); expect(head).toBe(id(2));
      expect(f.api.map((call) => call.method)).toEqual(["POST", "GET", "POST"]);
      const attempts = f.api.filter((call) => call.method === "POST");
      expect(attempts.map((call) => call.command?.expectedHead)).toEqual([null, null]);
      expect(attempts[1].command).toEqual(attempts[0].command);
      const final = await f.exported.readCloudSweetScope(actorA);
      expect(final.record).toEqual(row(2)); expect(final.headToken).toBe(id(2));
      expect(latestSweetRecordsPerUserDay(final.record ? [final.record] : [])).toHaveLength(1);
      expect(unrelated).toEqual(otherBefore);
      await test.info().attach("B-T09-unknown-inflight-client-and-cas-model", { contentType: "application/json",
        body: JSON.stringify({ order, events, calls: f.api, originalStatus, advances, final, unrelated,
          layer: "real client helper + deterministic model; GET H0 does not prove original termination; no PG locks/transactions" }) });
    } finally { releaseRetry.resolve(); }
  });
}

test("B-T13 unknown committed command crossing Shanghai day retries only original day/head and remains scoped", async () => {
  const f = await fixture(), frozen = scope();
  let serverDay = today, posts = 0;
  let persisted: CloudSweetRecord | null = null;
  const otherBefore = row(90, tomorrow, "SYNTHETIC_UNRELATED_B", actorB), unrelated = structuredClone(otherBefore);
  f.hooks.fetch = async (call) => {
    if (call.method !== "POST") throw new Error("Unexpected scope refresh after unknown");
    if (!call.command) throw new Error("Synthetic POST command missing");
    ++posts;
    if (posts === 1) {
      persisted = row(2); f.events.push("model_commit_before_day_change");
      throw new TypeError("SYNTHETIC_ACK_LOST_AFTER_COMMIT");
    }
    expect(call.command.operationDay).toBe(today); expect(call.command.targetDay).toBe(today);
    expect(serverDay).toBe(tomorrow);
    return response({ status: "scope_expired", writeOutcome: "not_committed" }, 409);
  };
  const first = await capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: frozen, intent: "replace_summary" }));
  expect(first.error).toMatchObject({ code: "outcome_unknown" });
  serverDay = tomorrow;
  const second = await capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: frozen, intent: "replace_summary" }));
  expect(second.error).toMatchObject({ code: "scope_expired" });
  expect(first.error).toMatchObject({ code: "outcome_unknown" });
  expect(f.api.map((call) => call.method)).toEqual(["POST", "POST"]);
  expect(f.api[1].command).toEqual(f.api[0].command);
  expect(f.api.map((call) => call.command?.expectedHead)).toEqual([null, null]);
  expect(persisted).toEqual(row(2)); expect(unrelated).toEqual(otherBefore);
  await test.info().attach("B-T13-unknown-cross-day-model", { contentType: "application/json",
    body: JSON.stringify({ calls: f.api, events: f.events, persisted, unrelated,
      layer: "synthetic server acceptance day only; no real clock or database mutation" }) });
});

test("B-T13 unknown original A command cannot be retried after A to B to A identity generation changes", async () => {
  const f = await fixture(), frozen = scope(), originalGuard = f.currentGuard();
  let persisted: CloudSweetRecord | null = null;
  const otherBefore = row(90, today, "SYNTHETIC_UNRELATED_B", actorB), unrelated = structuredClone(otherBefore);
  f.hooks.fetch = async () => {
    persisted = row(2);
    throw new TypeError("SYNTHETIC_ACK_LOST_AFTER_COMMIT");
  };
  const first = await capture(f.exported.saveCloudSweetRecord(input(), actorA, {
    scope: frozen, intent: "replace_summary", current: originalGuard,
  }));
  expect(first.error).toMatchObject({ code: "outcome_unknown" });
  f.setActor(actorB); f.setActor(actorA);
  const retry = await capture(f.exported.saveCloudSweetRecord(input(), actorA, {
    scope: frozen, intent: "replace_summary", current: originalGuard,
  }));
  expect(retry.error).toMatchObject({ code: "interrupted" });
  expect(first.error).toMatchObject({ code: "outcome_unknown" });
  expect(f.api).toHaveLength(1); expect(f.api[0].command).toMatchObject({ operationDay: today, targetDay: today, expectedHead: null });
  expect(persisted).toEqual(row(2)); expect(unrelated).toEqual(otherBefore); expect(f.actor()).toBe(actorA);
  await test.info().attach("B-T13-unknown-ABA-client-generation", { contentType: "application/json",
    body: JSON.stringify({ calls: f.api, events: f.events, persisted, unrelated,
      layer: "real helper + synthetic Auth generation; no real Auth/session/OTP or database verification" }) });
});

for (const [http, body, expected] of [
  [503, { status: "write_rejected" }, "outcome_unknown"],
  [503, { status: "conflict", writeOutcome: "not_committed" }, "outcome_unknown"],
  [409, { status: "conflict" }, "outcome_unknown"],
  [401, { status: "denied" }, "denied"],
  [400, { status: "invalid_request" }, "invalid_request"],
] as const) {
  test(`B response evidence ${http} ${JSON.stringify(body)} yields ${expected}`, async () => {
    const f = await fixture(); f.hooks.fetch = async () => response(body, http);
    const result = await capture(f.exported.saveCloudSweetRecord(input(), actorA, { scope: scope(), intent: "replace_summary" }));
    expect(result.error).toMatchObject({ code: expected }); expect(f.api).toHaveLength(1);
  });
}
