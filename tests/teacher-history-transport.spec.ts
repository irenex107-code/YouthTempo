import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";

// Actual cloudRecords transport; only synthetic SDK/DOM/network doubles are admitted.
// No Supabase client module, real fetch, credentials or environment is loaded.
const OWNER = "00000000-0000-4000-8000-000000000011";
const OTHER = "00000000-0000-4000-8000-000000000012";
const MESSAGE = "00000000-0000-4000-8000-000000000021";
const token = "SYNTHETIC-TRANSPORT-TOKEN";
type SessionReply = { data: { session: { user: { id: string }; access_token: string } | null }; error: null };
const session = (id = OWNER): SessionReply => ({ data: { session: { user: { id }, access_token: token } }, error: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
type Options = {
  getSession?: (call: number) => Promise<SessionReply>;
  json?: unknown; jsonRead?: () => Promise<unknown>; blobRead?: () => Promise<unknown>;
  ok?: boolean; networkFailure?: boolean;
  throwAt?: "create" | "element" | "append" | "click" | "remove";
  onCreate?: () => void;
};
function fixture(options: Options = {}) {
  let current = true;
  let sdkCalls = 0;
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const dom = { created: [] as unknown[], revoked: [] as string[], elements: 0, appended: 0, clicked: 0, removed: 0,
    href: "", download: "" };
  const anchor = {
    href: "", download: "",
    click() { ++dom.clicked; if (options.throwAt === "click") throw new Error("synthetic click failure"); },
    remove() { ++dom.removed; if (options.throwAt === "remove") throw new Error("synthetic remove failure"); },
  };
  const response = {
    ok: options.ok !== false,
    json: options.jsonRead || (async () => options.json ?? { messages: [], ok: true }),
    blob: options.blobRead || (async () => ({ synthetic: "blob" })),
    headers: { get: (key: string) => key === "content-disposition" ? 'attachment; filename="synthetic-export.json"' : null },
  };
  const loadedModule = { exports: {} as Record<string, unknown> };
  const source = ts.transpileModule(readFileSync("lib/cloudRecords.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, {
    module: loadedModule, exports: loadedModule.exports, Error, Date,
    require: (name: string) => {
      if (name === "@/lib/supabaseClient") return {
        getSupabase: () => ({ auth: { getSession: async () => {
          ++sdkCalls;
          return options.getSession ? options.getSession(sdkCalls) : session();
        } } }),
        signOutSupabaseSession: () => { throw new Error("Unexpected auth mutation"); },
      };
      if (name === "@/lib/sweetRecordDays") return {
        latestSweetRecordsPerUserDay: () => { throw new Error("Unrelated helper forbidden"); },
      };
      throw new Error(`Unmocked import forbidden: ${name}`);
    },
    fetch: async (path: string, init: RequestInit) => {
      if (!["/api/account/data", "/api/messages"].includes(path)) throw new Error(`Unmocked request forbidden: ${path}`);
      calls.push({ path, init });
      if (options.networkFailure) throw new Error("synthetic network failure");
      return response;
    },
    URL: {
      createObjectURL(blob: unknown) {
        if (options.throwAt === "create") throw new Error("synthetic URL failure");
        dom.created.push(blob); options.onCreate?.(); return "blob:synthetic-only";
      },
      revokeObjectURL(url: string) { dom.revoked.push(url); },
    },
    document: {
      createElement(tag: string) {
        if (tag !== "a") throw new Error("Unexpected element");
        ++dom.elements;
        if (options.throwAt === "element") throw new Error("synthetic element failure");
        return anchor;
      },
      body: { appendChild(value: typeof anchor) {
        ++dom.appended; dom.href = value.href; dom.download = value.download;
        if (options.throwAt === "append") throw new Error("synthetic append failure");
      } },
    },
    // No process, Node require, real window or fetch is available to this module.
  }, { filename: "lib/cloudRecords.ts" });
  const api = loadedModule.exports as unknown as Pick<typeof import("../lib/cloudRecords"),
    "downloadAccountDataExport" | "listStudentMessages" | "markStudentMessageRead">;
  return { api, calls, dom, isCurrent: () => current, retire: () => { current = false; }, sdkCalls: () => sdkCalls };
}

// Bridge VM promises explicitly: the installed matcher does not handle cross-realm toThrow results.
async function expectRejection(promise: Promise<unknown>, message?: string) {
  const result = await Promise.resolve(promise).then(() => ({ rejected: false, message: "" }),
    (error: unknown) => ({ rejected: true, message: error instanceof Error ? error.message : String(error) }));
  expect(result.rejected).toBe(true);
  if (message) expect(result.message).toContain(message);
}

test("transport download success verifies identity twice and cleans anchor and URL", async () => {
  const f = fixture();
  await f.api.downloadAccountDataExport(OWNER, f.isCurrent);
  expect(f.sdkCalls()).toBe(2);
  expect(f.calls).toEqual([{ path: "/api/account/data", init: { cache: "no-store", headers: { authorization: `Bearer ${token}` } } }]);
  expect(f.dom).toEqual({ created: [{ synthetic: "blob" }], revoked: ["blob:synthetic-only"], elements: 1,
    appended: 1, clicked: 1, removed: 1, href: "blob:synthetic-only", download: "synthetic-export.json" });
});

test("transport download initially retired never reads SDK or fetches", async () => {
  const f = fixture(); f.retire();
  await f.api.downloadAccountDataExport(OWNER, f.isCurrent);
  expect(f.sdkCalls()).toBe(0); expect(f.calls).toHaveLength(0); expect(f.dom.created).toHaveLength(0);
});

test("transport download retirement during token load prevents fetch", async () => {
  const gate = deferred<SessionReply>();
  const f = fixture({ getSession: () => gate.promise });
  const request = f.api.downloadAccountDataExport(OWNER, f.isCurrent);
  f.retire(); gate.resolve(session()); await request;
  expect(f.sdkCalls()).toBe(1); expect(f.calls).toHaveLength(0); expect(f.dom.created).toHaveLength(0);
});

test("transport download wrong expected owner prevents fetch", async () => {
  const f = fixture({ getSession: async () => session(OTHER) });
  await expectRejection(f.api.downloadAccountDataExport(OWNER, f.isCurrent));
  expect(f.calls).toHaveLength(0); expect(f.dom.created).toHaveLength(0);
});

test("transport late blob after retirement never creates URL", async () => {
  const gate = deferred<unknown>(); let entered!: () => void;
  const enteredPromise = new Promise<void>((r) => { entered = r; });
  const f = fixture({ blobRead: () => { entered(); return gate.promise; } });
  const request = f.api.downloadAccountDataExport(OWNER, f.isCurrent);
  await enteredPromise; f.retire(); gate.resolve({ synthetic: "late" }); await request;
  expect(f.sdkCalls()).toBe(1); expect(f.dom.created).toHaveLength(0); expect(f.dom.clicked).toBe(0);
});

test("transport second identity verification rejects changed owner before URL", async () => {
  const f = fixture({ getSession: async (call) => session(call === 1 ? OWNER : OTHER) });
  await expectRejection(f.api.downloadAccountDataExport(OWNER, f.isCurrent));
  expect(f.sdkCalls()).toBe(2); expect(f.dom.created).toHaveLength(0); expect(f.dom.clicked).toBe(0);
});

test("transport retirement immediately after URL creation still revokes it", async () => {
  let retire = () => {};
  const f = fixture({ onCreate: () => retire() }); retire = f.retire;
  await f.api.downloadAccountDataExport(OWNER, f.isCurrent);
  expect(f.dom.created).toHaveLength(1); expect(f.dom.elements).toBe(0); expect(f.dom.clicked).toBe(0);
  expect(f.dom.revoked).toEqual(["blob:synthetic-only"]);
});

for (const failure of ["element", "append", "click", "remove"] as const) {
  test(`transport ${failure} exception still revokes URL and removes allocated anchor`, async () => {
    const f = fixture({ throwAt: failure });
    await expectRejection(f.api.downloadAccountDataExport(OWNER, f.isCurrent));
    expect(f.dom.created).toHaveLength(1); expect(f.dom.revoked).toEqual(["blob:synthetic-only"]);
    expect(f.dom.removed).toBe(failure === "element" ? 0 : 1);
  });
}

for (const failure of ["bad-response", "network", "create"] as const) {
  test(`transport download ${failure} never clicks a download`, async () => {
    const f = fixture(failure === "bad-response" ? { ok: false, json: { error: "synthetic refusal" } }
      : failure === "network" ? { networkFailure: true } : { throwAt: "create" });
    await expectRejection(f.api.downloadAccountDataExport(OWNER, f.isCurrent));
    expect(f.dom.clicked).toBe(0); expect(f.dom.created).toHaveLength(0); expect(f.dom.revoked).toHaveLength(0);
  });
}

test("transport list uses expected owner and no-store and preserves payload", async () => {
  const messages = [{ id: MESSAGE, body: "SYNTHETIC HISTORY" }];
  const f = fixture({ json: { messages, pilotDutyAvailable: true, pilotDutyEmailConfigured: false } });
  const result = await f.api.listStudentMessages(OWNER, f.isCurrent);
  expect(result).toEqual({ messages, pilotDutyAvailable: true, pilotDutyEmailConfigured: false });
  expect(f.calls[0]).toEqual({ path: "/api/messages", init: { cache: "no-store", headers: { authorization: `Bearer ${token}` } } });
});

test("transport list initially stale never reads SDK or fetches", async () => {
  const f = fixture(); f.retire();
  await expectRejection(f.api.listStudentMessages(OWNER, f.isCurrent));
  expect(f.sdkCalls()).toBe(0); expect(f.calls).toHaveLength(0);
});

test("transport list retirement during token load prevents fetch", async () => {
  const gate = deferred<SessionReply>(); const f = fixture({ getSession: () => gate.promise });
  const request = f.api.listStudentMessages(OWNER, f.isCurrent);
  const rejection = expectRejection(request);
  f.retire(); gate.resolve(session()); await rejection;
  expect(f.calls).toHaveLength(0);
});

test("transport list wrong expected owner prevents fetch", async () => {
  const f = fixture({ getSession: async () => session(OTHER) });
  await expectRejection(f.api.listStudentMessages(OWNER, f.isCurrent));
  expect(f.calls).toHaveLength(0);
});

test("transport list late response after retirement cannot return private messages", async () => {
  const gate = deferred<unknown>(); let entered!: () => void;
  const enteredPromise = new Promise<void>((r) => { entered = r; });
  const f = fixture({ jsonRead: () => { entered(); return gate.promise; } });
  const request = f.api.listStudentMessages(OWNER, f.isCurrent);
  const rejection = expectRejection(request);
  await enteredPromise; f.retire(); gate.resolve({ messages: [{ body: "SYNTHETIC LATE" }] }); await rejection;
});

for (const messages of [null, {}, "malformed"]) {
  test(`transport list rejects malformed messages ${String(messages)}`, async () => {
    const f = fixture({ json: { messages } });
    await expectRejection(f.api.listStudentMessages(OWNER, f.isCurrent));
  });
}

test("transport list rejects unsuccessful response", async () => {
  const f = fixture({ ok: false, json: { error: "synthetic refusal", messages: [] } });
  await expectRejection(f.api.listStudentMessages(OWNER, f.isCurrent), "synthetic refusal");
});

test("transport mark read requires true receipt and expected owner and never retries", async () => {
  const f = fixture({ json: { ok: true } });
  await f.api.markStudentMessageRead(MESSAGE, OWNER);
  expect(f.calls).toEqual([{ path: "/api/messages", init: { method: "PATCH", cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ id: MESSAGE }) } }]);
});

for (const value of [undefined, false, null, "true", 1]) {
  test(`transport mark rejects abnormal 200 receipt ${String(value)}`, async () => {
    const f = fixture({ json: { ok: value } });
    await expectRejection(f.api.markStudentMessageRead(MESSAGE, OWNER));
    expect(f.calls).toHaveLength(1);
  });
}

test("transport mark rejects unsuccessful status even with true payload", async () => {
  const f = fixture({ ok: false, json: { ok: true } });
  await expectRejection(f.api.markStudentMessageRead(MESSAGE, OWNER));
  expect(f.calls).toHaveLength(1);
});

test("transport mark wrong expected owner cannot issue PATCH", async () => {
  const f = fixture({ getSession: async () => session(OTHER) });
  await expectRejection(f.api.markStudentMessageRead(MESSAGE, OWNER));
  expect(f.calls).toHaveLength(0);
});
