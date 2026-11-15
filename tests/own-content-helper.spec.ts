import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import type { OwnContentKind } from "../lib/cloudRecords";

// Execute the actual cloudRecords helpers. No SDK module, environment, real timer,
// network, storage, DOM or download operation is admitted to this VM.
const OWNER = "00000000-0000-4000-8000-000000000011";
const OTHER = "00000000-0000-4000-8000-000000000012";
const POST = "00000000-0000-4000-8000-000000000021";
const COMMENT = "00000000-0000-4000-8000-000000000022";
const MESSAGE = "00000000-0000-4000-8000-000000000023";
const CONTROL = "00000000-0000-4000-8000-000000000024";
const ROOM = "00000000-0000-4000-8000-000000000031";
const NOW = "2026-11-04T01:00:00.000Z";
const SECRET = "SYNTHETIC UNRELATED EXPORT TEXT";
type Row = Record<string, unknown>;
type ExportData = { formatVersion: unknown; account: Row; data: Record<string, unknown> };
type SessionReply = { data: { session: { user: { id: string }; access_token: string } | null }; error: { message: string } | null };
const session = (id: string | null = OWNER): SessionReply => ({
  data: { session: id ? { user: { id }, access_token: `SYNTHETIC:${id}` } : null }, error: null,
});
const kinds: OwnContentKind[] = ["communityPosts", "communityComments", "peerSpaceMessages", "peerSpaceControls"];
const contracts = [
  { kind: "communityPosts" as const, path: "/api/community/posts", param: "postId", id: POST, result: "ok", outcome: "acknowledged" },
  { kind: "communityComments" as const, path: "/api/community/comments", param: "commentId", id: COMMENT, result: "ok", outcome: "acknowledged" },
  { kind: "peerSpaceMessages" as const, path: "/api/peer-space/messages", param: "messageId", id: MESSAGE, result: "deleted", outcome: "confirmed" },
  { kind: "peerSpaceControls" as const, path: "/api/peer-space/controls", param: "controlId", id: CONTROL, result: "removed", outcome: "confirmed" },
];
function validExport(): ExportData {
  return {
    formatVersion: 1, account: { id: OWNER, email: "synthetic@example.invalid", secret: SECRET },
    data: {
      communityPosts: [{ id: POST, author_user_id: OWNER, author_role: "student", title: "Synthetic title", body: "OWN POST", moderation_status: "published", created_at: NOW, extra: SECRET }],
      communityComments: [{ id: COMMENT, post_id: "unread-parent", author_user_id: OWNER, body: "OWN COMMENT", moderation_status: "published", created_at: NOW, extra: SECRET }],
      peerSpaceMessages: [{ id: MESSAGE, room_id: ROOM, body: "OWN PEER MESSAGE", moderation_status: "visible", created_at: NOW, deleted_at: null, extra: SECRET }],
      peerSpaceControls: [{ id: CONTROL, room_id: ROOM, control_type: "mute", created_at: NOW, extra: SECRET }],
      messages: [{ body: SECRET }], studentConsents: [{ private: SECRET }], supportCases: [{ private: SECRET }],
      ...Object.fromEntries(Array.from({ length: 27 }, (_, i) => [`unrelated${i}`, [{ private: SECRET }]])),
    },
  };
}
function rows(data: ExportData, kind: OwnContentKind): Row[] { return data.data[kind] as Row[]; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 8; ++i) await Promise.resolve(); }
type Options = {
  getSession?: (call: number) => Promise<SessionReply>;
  sdkMissing?: boolean;
  json?: unknown;
  jsonRead?: () => Promise<unknown>;
  fetchRead?: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  status?: number;
  networkFailure?: boolean;
};
function fixture(options: Options = {}) {
  let current = true, sdkCalls = 0, nextTimer = 0;
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const forbidden: string[] = [];
  const forbid = (name: string): never => { forbidden.push(name); throw new Error(`Forbidden in synthetic helper VM: ${name}`); };
  const source = ts.transpileModule(readFileSync("lib/cloudRecords.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loadedModule = { exports: {} as Record<string, unknown> };
  const response = {
    ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
    status: options.status ?? 200,
    json: options.jsonRead || (async () => options.json === undefined ? validExport() : options.json),
  };
  const storage = { getItem: () => forbid("storage read"), setItem: () => forbid("storage write"), removeItem: () => forbid("storage remove") };
  vm.runInNewContext(source, {
    module: loadedModule, exports: loadedModule.exports, Error, Date, AbortController,
    setTimeout: (callback: () => void, delay: number) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    require: (name: string) => {
      if (name === "@/lib/supabaseClient") return {
        getSupabase: () => options.sdkMissing ? null : ({ auth: { getSession: async () => {
          ++sdkCalls;
          return options.getSession ? options.getSession(sdkCalls) : session();
        } } }),
        signOutSupabaseSession: () => forbid("auth mutation"),
      };
      if (name === "@/lib/sweetRecordDays") return { latestSweetRecordsPerUserDay: () => forbid("unrelated helper") };
      return forbid(`unmocked import ${name}`);
    },
    fetch: async (path: string, init: RequestInit) => {
      const allowed = ["/api/account/data", ...contracts.map((entry) => entry.path)];
      if (!allowed.includes(path)) return forbid(`unmocked request ${path}`);
      calls.push({ path, init });
      if (options.networkFailure) throw new Error("SYNTHETIC NETWORK FAILURE WITH PRIVATE DETAIL");
      return options.fetchRead ? options.fetchRead() : response;
    },
    localStorage: storage, sessionStorage: storage,
    window: { localStorage: storage, sessionStorage: storage },
    caches: { open: () => forbid("Cache API") },
    URL: { createObjectURL: () => forbid("object URL"), revokeObjectURL: () => forbid("object URL revoke") },
    document: { createElement: () => forbid("DOM element"), body: { appendChild: () => forbid("DOM append") } },
    console: { log: () => forbid("console log"), error: () => forbid("console error"), warn: () => forbid("console warn") },
    // process and Node require are deliberately absent.
  }, { filename: "lib/cloudRecords.ts" });
  const api = loadedModule.exports as unknown as Pick<typeof import("../lib/cloudRecords"), "readOwnAccountContent" | "deleteOwnAccountContent">;
  return {
    api, calls, forbidden, timers, isCurrent: () => current, retire: () => { current = false; }, sdkCalls: () => sdkCalls,
    expire() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } },
  };
}
async function expectOutcome(promise: Promise<unknown>, outcome: "notSent" | "denied" | "unknown") {
  const result = await Promise.resolve(promise).then(
    () => ({ rejected: false, outcome: undefined as unknown, message: "" }),
    (error: unknown) => ({ rejected: true,
      outcome: error && typeof error === "object" && "outcome" in error ? error.outcome : undefined,
      message: error instanceof Error ? error.message : String(error) }),
  );
  expect(result.rejected).toBe(true);
  expect(result.outcome).toBe(outcome);
  expect(result.message).toBe("own_content_unavailable");
}

// Read projection and complete-failure boundaries.
test("helper H01 returns only four required projections and never uses full export storage or download APIs", async () => {
  const exported = validExport(); const f = fixture({ json: exported });
  const result = await f.api.readOwnAccountContent(OWNER, f.isCurrent);
  expect(result).toEqual({
    communityPosts: [{ id: POST, title: "Synthetic title", body: "OWN POST", moderation_status: "published", created_at: NOW }],
    communityComments: [{ id: COMMENT, body: "OWN COMMENT", moderation_status: "published", created_at: NOW }],
    peerSpaceMessages: [{ id: MESSAGE, room_id: ROOM, body: "OWN PEER MESSAGE", moderation_status: "visible", created_at: NOW, deleted_at: null }],
    peerSpaceControls: [{ id: CONTROL, room_id: ROOM, control_type: "mute", created_at: NOW }],
  });
  expect(JSON.stringify(result)).not.toContain(SECRET);
  expect(JSON.stringify(result)).not.toContain("author_user_id");
  expect(f.calls).toHaveLength(1); expect(f.calls[0].path).toBe("/api/account/data");
  expect(f.calls[0].init.method).toBe("GET"); expect(f.calls[0].init.cache).toBe("no-store");
  expect(f.calls[0].init.headers).toEqual({ authorization: `Bearer SYNTHETIC:${OWNER}` });
  expect(f.sdkCalls()).toBe(2); expect(f.timers.size).toBe(0); expect(f.forbidden).toEqual([]);
  expect(rows(exported, "communityPosts")[0].extra).toBe(SECRET);
});

test("helper H02 accepts four genuinely empty arrays without manufacturing unavailable data", async () => {
  const exported = validExport(); for (const kind of kinds) exported.data[kind] = [];
  const f = fixture({ json: exported });
  expect(await f.api.readOwnAccountContent(OWNER, f.isCurrent)).toEqual({ communityPosts: [], communityComments: [], peerSpaceMessages: [], peerSpaceControls: [] });
});

for (const [label, alter] of [
  ["different envelope owner", (x: ExportData) => { x.account.id = OTHER; }],
  ["missing envelope owner", (x: ExportData) => { delete x.account.id; }],
  ["wrong format version", (x: ExportData) => { x.formatVersion = 2; }],
  ["string format version", (x: ExportData) => { x.formatVersion = "1"; }],
] as const) {
  test(`helper H03 envelope ${label} rejects the complete read`, async () => {
    const exported = validExport(); alter(exported); const f = fixture({ json: exported });
    await expectOutcome(f.api.readOwnAccountContent(OWNER, f.isCurrent), "unknown"); expect(f.calls).toHaveLength(1);
  });
}
for (const value of [null, [], "malformed"] as const) {
  test(`helper H04 non-object envelope ${JSON.stringify(value)} rejects instead of empty`, async () => {
    const f = fixture({ json: value }); await expectOutcome(f.api.readOwnAccountContent(OWNER, f.isCurrent), "unknown");
  });
}
for (const kind of kinds) {
  test(`helper H05 missing ${kind} rejects the complete export projection`, async () => {
    const exported = validExport(); delete exported.data[kind]; const f = fixture({ json: exported });
    await expectOutcome(f.api.readOwnAccountContent(OWNER, f.isCurrent), "unknown");
  });
  test(`helper H06 duplicate ID in ${kind} rejects rather than making an ambiguous delete target`, async () => {
    const exported = validExport(); rows(exported, kind).push({ ...rows(exported, kind)[0] }); const f = fixture({ json: exported });
    await expectOutcome(f.api.readOwnAccountContent(OWNER, f.isCurrent), "unknown");
  });
}
for (const [label, alter] of [
  ["array has wrong shape", (x: ExportData) => { x.data.peerSpaceControls = {}; }],
  ["row is not an object", (x: ExportData) => { x.data.communityComments = [null]; }],
  ["record ID is empty", (x: ExportData) => { rows(x, "communityPosts")[0].id = ""; }],
  ["creation date is invalid", (x: ExportData) => { rows(x, "peerSpaceMessages")[0].created_at = "not-a-date"; }],
  ["post body is not a string", (x: ExportData) => { rows(x, "communityPosts")[0].body = null; }],
  ["control type is unsupported", (x: ExportData) => { rows(x, "peerSpaceControls")[0].control_type = "administrator"; }],
  ["peer room field is malformed", (x: ExportData) => { rows(x, "peerSpaceMessages")[0].room_id = false; }],
] as const) {
  test(`helper H07 ${label} fails all four arrays`, async () => {
    const exported = validExport(); alter(exported); const f = fixture({ json: exported });
    await expectOutcome(f.api.readOwnAccountContent(OWNER, f.isCurrent), "unknown");
  });
}
for (const kind of ["communityPosts", "communityComments"] as const) {
  test(`helper H08 ${kind} with another author is rejected despite own envelope`, async () => {
    const exported = validExport(); rows(exported, kind)[0].author_user_id = OTHER; const f = fixture({ json: exported });
    await expectOutcome(f.api.readOwnAccountContent(OWNER, f.isCurrent), "unknown");
  });
  test(`helper H09 ${kind} with missing author is not treated as own`, async () => {
    const exported = validExport(); delete rows(exported, kind)[0].author_user_id; const f = fixture({ json: exported });
    await expectOutcome(f.api.readOwnAccountContent(OWNER, f.isCurrent), "unknown");
  });
}
for (const [label, value] of [["null", null], ["valid timestamp", NOW]] as const) {
  test(`helper H10 deleted_at ${label} is accepted unchanged`, async () => {
    const exported = validExport(); rows(exported, "peerSpaceMessages")[0].deleted_at = value; const f = fixture({ json: exported });
    expect((await f.api.readOwnAccountContent(OWNER, f.isCurrent)).peerSpaceMessages[0].deleted_at).toBe(value);
  });
}
for (const [label, value] of [["empty", ""], ["whitespace", "   "], ["unparseable", "not-a-date"], ["impossible timestamp", "2026-99-99T99:99:99Z"], ["number", 0], ["absent", undefined]] as const) {
  test(`helper H11 deleted_at ${label} rejects complete read, including a deleted moderation status`, async () => {
    const exported = validExport(); Object.assign(rows(exported, "peerSpaceMessages")[0], { deleted_at: value, moderation_status: "deleted" }); const f = fixture({ json: exported });
    await expectOutcome(f.api.readOwnAccountContent(OWNER, f.isCurrent), "unknown");
  });
}

// Original routes/parameters, exact receipts, and refusal/unknown split.
for (const [index, contract] of contracts.entries()) {
  test(`helper H12 ${contract.kind} uses its existing DELETE parameter and exact success receipt`, async () => {
    const f = fixture({ json: { [contract.result]: true } }); const locale = index % 2 ? "en" : "zh-CN";
    expect(await f.api.deleteOwnAccountContent(contract.kind, contract.id, OWNER, locale, f.isCurrent)).toBe(contract.outcome);
    expect(f.calls).toHaveLength(1); expect(f.calls[0].path).toBe(contract.path);
    expect(f.calls[0].init.method).toBe("DELETE"); expect(f.calls[0].init.cache).toBe("no-store");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ [contract.param]: contract.id, locale });
    expect(f.calls[0].init.headers).toEqual({ authorization: `Bearer SYNTHETIC:${OWNER}`, "content-type": "application/json" });
    expect(f.sdkCalls()).toBe(2); expect(f.forbidden).toEqual([]); expect(f.timers.size).toBe(0);
  });
  test(`helper H13 ${contract.kind} never accepts missing or truthy non-boolean receipt fields`, async () => {
    for (const value of [undefined, false, "true", 1, null]) {
      const f = fixture({ json: { [contract.result]: value } });
      await expectOutcome(f.api.deleteOwnAccountContent(contract.kind, contract.id, OWNER, "en", f.isCurrent), "unknown");
      await flush(); expect(f.calls).toHaveLength(1);
    }
  });
}
for (const status of [400, 401, 403, 404, 405, 413, 429]) {
  test(`helper H14 explicit pre-write refusal ${status} is denied and never automatically replayed`, async () => {
    const f = fixture({ status, json: { error: SECRET } });
    await expectOutcome(f.api.deleteOwnAccountContent("peerSpaceMessages", MESSAGE, OWNER, "en", f.isCurrent), "denied");
    await flush(); expect(f.calls).toHaveLength(1); expect(f.sdkCalls()).toBe(1); expect(f.timers.size).toBe(0);
  });
}
for (const status of [408, 422, 500, 503]) {
  test(`helper H15 uncertain response ${status} is unknown without automatic replay`, async () => {
    const f = fixture({ status, json: { error: SECRET } });
    await expectOutcome(f.api.deleteOwnAccountContent("communityPosts", POST, OWNER, "zh-CN", f.isCurrent), "unknown");
    await flush(); expect(f.calls).toHaveLength(1);
  });
}
for (const [label, options] of [
  ["network failure", { networkFailure: true }],
  ["malformed JSON", { jsonRead: async () => { throw new Error(SECRET); } }],
] as const) {
  test(`helper H16 ${label} after dispatch is unknown and sanitized`, async () => {
    const f = fixture(options);
    await expectOutcome(f.api.deleteOwnAccountContent("peerSpaceControls", CONTROL, OWNER, "en", f.isCurrent), "unknown");
    await flush(); expect(f.calls).toHaveLength(1); expect(f.timers.size).toBe(0);
  });
}
for (const [label, options] of [
  ["missing SDK", { sdkMissing: true }],
  ["signed out", { getSession: async () => session(null) }],
  ["changed owner", { getSession: async () => session(OTHER) }],
  ["session read failed", { getSession: async () => ({ data: { session: null }, error: { message: SECRET } }) }],
] as const) {
  test(`helper H17 ${label} before dispatch is notSent and cannot fetch`, async () => {
    const f = fixture(options);
    await expectOutcome(f.api.deleteOwnAccountContent("peerSpaceMessages", MESSAGE, OWNER, "en", f.isCurrent), "notSent");
    expect(f.calls).toHaveLength(0); expect(f.timers.size).toBe(0);
  });
}

// Actor/request retirement and deterministic timer boundaries; no sleeps or real timers.
test("helper H18 initially retired operation cannot dispatch DELETE", async () => {
  const f = fixture({ json: { deleted: true } }); f.retire();
  await expectOutcome(f.api.deleteOwnAccountContent("peerSpaceMessages", MESSAGE, OWNER, "en", f.isCurrent), "notSent");
  expect(f.calls).toHaveLength(0);
});
for (const operation of ["read", "delete"] as const) {
  test(`helper H19 ${operation} token that resolves after retirement never reaches fetch`, async () => {
    const gate = deferred<SessionReply>(); const f = fixture({ getSession: () => gate.promise });
    const request = operation === "read" ? f.api.readOwnAccountContent(OWNER, f.isCurrent)
      : f.api.deleteOwnAccountContent("peerSpaceMessages", MESSAGE, OWNER, "en", f.isCurrent);
    const rejected = expectOutcome(request, "notSent"); f.retire(); gate.resolve(session()); await rejected;
    expect(f.calls).toHaveLength(0);
  });
  test(`helper H20 late ${operation} JSON after retirement cannot be adopted or replayed`, async () => {
    const gate = deferred<unknown>(); const entered = deferred<void>();
    const f = fixture({ jsonRead: () => { entered.resolve(); return gate.promise; } });
    const request = operation === "read" ? f.api.readOwnAccountContent(OWNER, f.isCurrent)
      : f.api.deleteOwnAccountContent("peerSpaceMessages", MESSAGE, OWNER, "en", f.isCurrent);
    const rejected = expectOutcome(request, "unknown"); await entered.promise; f.retire();
    gate.resolve(operation === "read" ? validExport() : { deleted: true }); await rejected;
    await flush(); expect(f.calls).toHaveLength(1); expect(f.timers.size).toBe(0);
  });
  test(`helper H21 second session check catches changed owner during ${operation}`, async () => {
    const f = fixture({ getSession: async (call) => session(call === 1 ? OWNER : OTHER), json: operation === "read" ? validExport() : { deleted: true } });
    const request = operation === "read" ? f.api.readOwnAccountContent(OWNER, f.isCurrent)
      : f.api.deleteOwnAccountContent("peerSpaceMessages", MESSAGE, OWNER, "en", f.isCurrent);
    await expectOutcome(request, "unknown"); expect(f.calls).toHaveLength(1); expect(f.sdkCalls()).toBe(2);
  });
}

test("helper H22 timeout while token is pending is notSent; its late token cannot dispatch", async () => {
  const gate = deferred<SessionReply>(); const f = fixture({ getSession: () => gate.promise });
  const request = f.api.deleteOwnAccountContent("peerSpaceMessages", MESSAGE, OWNER, "en", f.isCurrent);
  const rejected = expectOutcome(request, "notSent");
  expect([...f.timers.values()].map((timer) => timer.delay)).toEqual([10_000]);
  f.expire(); await rejected; gate.resolve(session()); await flush();
  expect(f.calls).toHaveLength(0); expect(f.timers.size).toBe(0);
});

test("helper H23 in-flight DELETE timeout aborts locally and never replays a late successful response", async () => {
  const gate = deferred<{ ok: boolean; status: number; json: () => Promise<unknown> }>();
  const entered = deferred<void>(); const f = fixture({ fetchRead: () => { entered.resolve(); return gate.promise; } });
  const request = f.api.deleteOwnAccountContent("peerSpaceMessages", MESSAGE, OWNER, "en", f.isCurrent);
  const rejected = expectOutcome(request, "unknown"); await entered.promise;
  const signal = f.calls[0].init.signal; expect(signal?.aborted).toBe(false);
  f.expire(); await rejected; expect(signal?.aborted).toBe(true);
  gate.resolve({ ok: true, status: 200, json: async () => ({ deleted: true }) }); await flush();
  expect(f.calls).toHaveLength(1); expect(f.timers.size).toBe(0);
});

test("helper H24 JSON-read timeout remains unknown after late JSON, with no repeat DELETE", async () => {
  const gate = deferred<unknown>(); const entered = deferred<void>();
  const f = fixture({ jsonRead: () => { entered.resolve(); return gate.promise; } });
  const request = f.api.deleteOwnAccountContent("peerSpaceControls", CONTROL, OWNER, "en", f.isCurrent);
  const rejected = expectOutcome(request, "unknown"); await entered.promise; f.expire(); await rejected;
  gate.resolve({ removed: true }); await flush(); expect(f.calls).toHaveLength(1);
});

test("helper H25 timeout during final session verification cannot return a successful read", async () => {
  const gate = deferred<SessionReply>(); const entered = deferred<void>();
  const f = fixture({ getSession: async (call) => { if (call === 1) return session(); entered.resolve(); return gate.promise; } });
  const request = f.api.readOwnAccountContent(OWNER, f.isCurrent); const rejected = expectOutcome(request, "unknown");
  await entered.promise; f.expire(); await rejected; gate.resolve(session()); await flush(); expect(f.calls).toHaveLength(1);
});

test("helper H26 unsuccessful complete-export GET is not returned as four empty arrays", async () => {
  const f = fixture({ status: 503, json: { error: "SYNTHETIC unrelated query failure", data: {} } });
  await expectOutcome(f.api.readOwnAccountContent(OWNER, f.isCurrent), "unknown"); expect(f.calls).toHaveLength(1);
});
