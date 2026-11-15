import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import type { CloudSweetRecord } from "../lib/cloudRecords";
import type { SavedSweetRecordStep } from "../lib/sweetRecordTypes";
import * as protocol from "../lib/sweetPersistenceProtocol";
import type { SweetCommand, SweetScope } from "../lib/sweetPersistenceProtocol";
import { latestSweetRecordsPerUserDay } from "../lib/sweetRecordDays";
import { buildComprehensiveDetails } from "../lib/reports/comprehensive";
import { parseReportInstant } from "../lib/reports/source";

const owner = "00000000-0000-4000-8000-000000000091";
const otherOwner = "00000000-0000-4000-8000-000000000092";
const day = "2026-10-29";
const dayEnd = "2026-10-29T16:00:00.000000Z";
const oldTime = "2026-10-29T01:00:00.000000Z";
const saveTime = "2026-10-29T02:00:00.123456+00:00";
const futureTime = "2026-10-29T03:00:00.000000Z";
const id = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const answers: SavedSweetRecordStep[] = [
  { id: "sleep", label: "SYNTHETIC", title: "SYNTHETIC", fields: [{ id: "quality", title: "SYNTHETIC", value: "比较好" }] },
  { id: "wake", label: "SYNTHETIC", title: "SYNTHETIC", fields: [{ id: "state", title: "SYNTHETIC", value: "比较有精神" }] },
  { id: "eat", label: "SYNTHETIC", title: "SYNTHETIC", fields: [{ id: "rhythm", title: "SYNTHETIC", value: "比较规律" }] },
  { id: "exercise", label: "SYNTHETIC", title: "SYNTHETIC", fields: [{ id: "duration", title: "SYNTHETIC", value: "10–19 分钟" }] },
  { id: "task", label: "SYNTHETIC", title: "SYNTHETIC", fields: [{ id: "engagement", title: "SYNTHETIC", value: "比较顺利" }] },
];
function row(number: number, createdAt: string, summary = "SYNTHETIC_NEW", userId = owner): CloudSweetRecord {
  return { id: id(number), user_id: userId, school_id: null, records: structuredClone(answers), summary,
    small_step: null, recommended_next_tool: null, created_at: createdAt };
}
function instant(value: unknown) {
  const result = parseReportInstant(value);
  if (result === null) throw new Error("Invalid synthetic timestamp");
  return result;
}
function inScope(value: CloudSweetRecord) {
  return value.user_id === owner && protocol.sweetStoredDay(value.created_at) === day;
}
type ApiRequest = { method: string; headers: Record<string, string>; body?: SweetCommand };
type ReadRequest = { table: string; filters: { key: string; value: unknown }[] };

/** Executes current production helpers. Only Auth, table reads and API transport
 * are replaced. The independent array/head models the approved all-or-nothing
 * contract; this does NOT execute PostgreSQL or prove SQL atomicity/RLS/cutoff.
 * The previous INSERT-then-best-effort-DELETE spec is archived byte-for-byte in
 * the R03 audit directory with an explicit old/new assertion mapping.
 */
async function fixture(initial: CloudSweetRecord[], options: { insertTime?: string; cleanupFailure?: boolean; insertFailure?: boolean } = {}) {
  let rows = structuredClone(initial);
  const api: ApiRequest[] = [], reads: ReadRequest[] = [], events: string[] = [], warnings: string[] = [];
  const initialScope = rows.filter(inScope).sort((a, b) => instant(b.created_at) - instant(a.created_at));
  const tied = initialScope.length > 1 && instant(initialScope[0].created_at) === instant(initialScope[1].created_at);
  let head = initialScope[0]?.id ?? null;
  let nextId = 900;
  const packet = (status: string) => ({ status, operationDay: day, targetDay: day, headToken: head,
    record: structuredClone(rows.find((value) => value.id === head) ?? null) });
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: owner } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: owner }, access_token: "SYNTHETIC_OWNER_TOKEN" } }, error: null }),
    },
    from(table: string) {
      const request: ReadRequest = { table, filters: [] };
      let limit = Infinity;
      let descending = false;
      const chain = {
        select() { return chain; },
        eq(key: string, value: unknown) { request.filters.push({ key, value }); return chain; },
        order(_key: string, order: { ascending: boolean }) { descending = !order.ascending; return chain; },
        limit(value: number) { limit = value; return chain; },
        insert() { throw new Error("Direct source INSERT is forbidden"); },
        delete() { throw new Error("Direct source DELETE is forbidden"); },
        then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
          return Promise.resolve().then(() => {
            reads.push(structuredClone(request));
            if (table !== "sweet_records") throw new Error("Unexpected synthetic table");
            let selected = rows.filter((value) => request.filters.every((filter) => value[filter.key as keyof CloudSweetRecord] === filter.value));
            if (descending) selected = selected.sort((a, b) => instant(b.created_at) - instant(a.created_at));
            return { data: structuredClone(selected.slice(0, limit)), error: null };
          }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  const filename = path.join(process.cwd(), "lib/cloudRecords.ts");
  const source = await readFile(filename, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exported = {} as typeof import("../lib/cloudRecords");
  vm.runInNewContext(output, {
    exports: exported, URLSearchParams, Response,
    console: { warn: (...values: unknown[]) => warnings.push(values.map(String).join(" ")) },
    require(name: string) {
      if (name === "@/lib/supabaseClient") return { getSupabase: () => client };
      if (name === "@/lib/sweetRecordDays") return { latestSweetRecordsPerUserDay };
      if (name === "@/lib/sweetPersistenceProtocol" || name === "./sweetPersistenceProtocol") return protocol;
      throw new Error(`Unexpected dependency: ${name}`);
    },
    async fetch(url: string, init: RequestInit) {
      if (!url.startsWith("/api/sweet-records?")) throw new Error("Unexpected synthetic URL");
      const method = init.method ?? "GET";
      const headers = init.headers as Record<string, string>;
      const command = init.body ? JSON.parse(String(init.body)) as SweetCommand : undefined;
      api.push({ method, headers: structuredClone(headers), ...(command ? { body: structuredClone(command) } : {}) });
      expect(headers.authorization).toBe("Bearer SYNTHETIC_OWNER_TOKEN");
      if (tied) return new Response(JSON.stringify({ status: "protocol_unavailable", writeOutcome: "not_committed" }), { status: 503 });
      if (method === "GET") return new Response(JSON.stringify(packet("ready")), { status: 200 });
      if (!command) throw new Error("Missing frozen command");
      expect(command.operationDay).toBe(day); expect(command.targetDay).toBe(day);
      expect(command.intent).toBe("replace_summary");
      expect(command).not.toHaveProperty("user_id"); expect(command).not.toHaveProperty("actor");
      if (command.expectedHead !== head) return new Response(JSON.stringify(packet("conflict")), { status: 409 });
      events.push("cas_matched");
      const current = rows.find((value) => value.id === head);
      if (current && JSON.stringify(current.records) === JSON.stringify(command.record!.records)
        && current.summary === (command.record!.summary || null)
        && current.small_step === (command.record!.smallStep || null)
        && current.recommended_next_tool === (command.record!.recommendedNextTool || null)) {
        events.push("noop"); return new Response(JSON.stringify(packet("noop")), { status: 200 });
      }
      // Work on a private transaction candidate. Faults never publish this array.
      const working = structuredClone(rows.filter((value) => !inScope(value)));
      events.push("detach_pointer", "delete_old_scope");
      if (options.cleanupFailure || options.insertFailure) {
        events.push(options.cleanupFailure ? "cleanup_fault" : "insert_fault", "rollback");
        return new Response(JSON.stringify({ status: "write_rejected", writeOutcome: "not_committed",
          error: "PRIVATE_SYNTHETIC_PROVIDER_DETAIL" }), { status: 503 });
      }
      const stored: CloudSweetRecord = { id: id(++nextId), user_id: owner, school_id: null,
        records: structuredClone(command.record!.records), summary: command.record!.summary || null,
        small_step: command.record!.smallStep || null, recommended_next_tool: command.record!.recommendedNextTool || null,
        created_at: options.insertTime ?? saveTime };
      working.push(stored); rows = working; head = stored.id;
      events.push("insert_new_source", "update_head", "commit");
      return new Response(JSON.stringify(packet("accepted")), { status: 201 });
    },
  }, { filename });
  return { scope: () => exported.readCloudSweetScope(owner),
    save: (scope: SweetScope, summary = "SYNTHETIC_NEW") => exported.saveCloudSweetRecord(
      { records: structuredClone(answers), summary }, owner, { scope, intent: "replace_summary" }),
    freshRead: () => exported.listCloudSweetRecords(owner), rows: () => structuredClone(rows),
    api, reads, events, warnings, head: () => head };
}
function ownedIds(rows: CloudSweetRecord[]) { return rows.filter((value) => value.user_id === owner).map((value) => value.id).sort(); }

test("等时刻legacy冲突在准入前阻断且不变更源，报告仍关闭冲突正文", async () => {
  const f = await fixture([row(1, saveTime), row(2, saveTime, "SYNTHETIC_CONFLICT"), row(3, oldTime, "SYNTHETIC_OLD")]);
  let unavailable: unknown;
  try { await f.scope(); } catch (error) { unavailable = error; }
  expect(unavailable).toMatchObject({ code: "protocol_unavailable" });
  expect(ownedIds(f.rows())).toEqual([id(1), id(2), id(3)]);
  expect(f.api.filter((request) => request.method === "POST")).toHaveLength(0);
  expect(f.events).toEqual([]);
  const details = buildComprehensiveDetails({ rows: f.rows(), asOf: futureTime });
  expect(details.items).toEqual([{ key: id(1), date: day, state: "conflict" }]);
  expect(JSON.stringify(details)).not.toContain("SYNTHETIC_CONFLICT");
  expect(JSON.stringify(details)).not.toContain("SYNTHETIC_NEW");
  const valid = await fixture([row(1, saveTime), row(3, oldTime, "SYNTHETIC_OLD")]);
  const scope = await valid.scope(); const saved = await valid.save(scope);
  expect(saved.id).toBe(id(1)); expect(valid.head()).toBe(id(1));
  expect(ownedIds(valid.rows())).toEqual([id(1), id(3)]);
  expect(valid.events).toEqual(["cas_matched", "noop"]);
  expect((await valid.freshRead())[0]).toEqual(saved);
});

test("相等返回时间也由CAS原子替换为唯一新源，不保留会误选的旧行", async () => {
  const f = await fixture([row(1, saveTime, "SYNTHETIC_OLD"), row(2, oldTime, "SYNTHETIC_OLDER")]);
  const scope = await f.scope(); const saved = await f.save(scope);
  expect(scope.headToken).toBe(id(1)); expect(saved.id).not.toBe(scope.headToken);
  expect(ownedIds(f.rows())).toEqual([saved.id]);
  expect(f.rows().find((value) => value.id === saved.id)).toEqual(saved);
  expect((await f.freshRead())[0]).toEqual(saved);
  expect(buildComprehensiveDetails({ rows: f.rows(), asOf: futureTime }).items[0]).toMatchObject({ key: saved.id, state: "available" });
});

test("旧future时间不再胜过当前已接受head，当前及后续报告都读取新源", async () => {
  const f = await fixture([row(1, futureTime, "SYNTHETIC_FUTURE"), row(2, oldTime, "SYNTHETIC_OLD")]);
  const scope = await f.scope(); const saved = await f.save(scope);
  expect(scope.headToken).toBe(id(1)); expect(ownedIds(f.rows())).toEqual([saved.id]);
  expect(f.rows().find((value) => value.id === saved.id)).toEqual(saved);
  expect((await f.freshRead())[0]).toEqual(saved);
  for (const asOf of ["2026-10-29T02:30:00Z", "2026-10-29T04:00:00Z"]) {
    expect(buildComprehensiveDetails({ rows: f.rows(), asOf }).items[0]).toMatchObject({ key: saved.id, state: "available", summary: "SYNTHETIC_NEW" });
  }
});

test("微秒邻接旧源使用冻结UUID基线，保存返回时刻不截断且只保留新源", async () => {
  const f = await fixture([row(1, "2026-10-29T02:00:00.123455Z", "SYNTHETIC_OLD"),
    row(2, "2026-10-29T02:00:00.123456Z", "SYNTHETIC_TIE"), row(3, "2026-10-29T02:00:00.123457Z", "SYNTHETIC_FUTURE")]);
  const scope = await f.scope(); const saved = await f.save(scope);
  expect(scope.headToken).toBe(id(3)); expect(saved.created_at).toBe(saveTime);
  expect(ownedIds(f.rows())).toEqual([saved.id]);
  expect(f.api.find((request) => request.method === "POST")!.body!.expectedHead).toBe(id(3));
  expect((await f.freshRead())[0]).toEqual(saved);
  expect(f.events).toEqual(["cas_matched", "detach_pointer", "delete_old_scope", "insert_new_source", "update_head", "commit"]);
});

test("全scope原子替换覆盖50条外残留，其他owner与相邻上海日期完整保留", async () => {
  const oldRows = Array.from({ length: 55 }, (_, index) => row(index + 1, `2026-10-29T01:00:${String(index).padStart(2, "0")}.000000Z`, "SYNTHETIC_OLD"));
  const other = row(61, oldTime, "SYNTHETIC_OTHER", otherOwner);
  const previous = row(62, "2026-10-28T15:59:59.999999Z", "SYNTHETIC_PREVIOUS");
  const next = row(63, dayEnd, "SYNTHETIC_NEXT");
  const f = await fixture([...oldRows, other, previous, next]);
  const scope = await f.scope(); const saved = await f.save(scope);
  expect(scope.headToken).toBe(id(55));
  expect(f.rows()).toEqual([other, previous, next, saved]);
  expect(ownedIds(f.rows())).toEqual([previous.id, next.id, saved.id].sort());
  expect((await f.freshRead()).map((value) => value.id)).toEqual([next.id, saved.id, previous.id]);
  for (const request of f.reads) expect(request.filters).toContainEqual({ key: "user_id", value: owner });
  expect(f.api.filter((request) => request.method === "POST")).toHaveLength(1);
});

test("cleanup故障使整个保存回滚且不泄露provider正文，不再假成功留两源", async () => {
  const old = row(1, oldTime, "SYNTHETIC_OLD"), other = row(2, oldTime, "SYNTHETIC_OTHER", otherOwner);
  const f = await fixture([old, other], { cleanupFailure: true });
  const scope = await f.scope(); let caught: unknown;
  try { await f.save(scope); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ code: "write_rejected" });
  expect(String(caught)).not.toContain("PRIVATE_SYNTHETIC_PROVIDER_DETAIL");
  expect(f.rows()).toEqual([old, other]); expect(f.head()).toBe(old.id);
  expect((await f.freshRead())[0]).toEqual(old);
  expect(f.events).toEqual(["cas_matched", "detach_pointer", "delete_old_scope", "cleanup_fault", "rollback"]);
  expect(f.warnings).toEqual([]);
});

test("插入故障整体回滚保留旧源，首次正常保存不执行直接空DELETE", async () => {
  const old = row(1, oldTime, "SYNTHETIC_OLD");
  const failure = await fixture([old], { insertFailure: true });
  const scope = await failure.scope();
  let rejected: unknown;
  try { await failure.save(scope); } catch (error) { rejected = error; }
  expect(rejected).toMatchObject({ code: "write_rejected" });
  expect(failure.rows()).toEqual([old]); expect(failure.head()).toBe(old.id);
  expect(failure.events).toEqual(["cas_matched", "detach_pointer", "delete_old_scope", "insert_fault", "rollback"]);
  const empty = await fixture([]); const saved = await empty.save(await empty.scope());
  expect(empty.rows()).toEqual([saved]); expect((await empty.freshRead())[0]).toEqual(saved);
  expect(empty.api.map((request) => request.method)).toEqual(["GET", "POST"]);
  expect(empty.reads.every((request) => request.table === "sweet_records")).toBe(true);
});
