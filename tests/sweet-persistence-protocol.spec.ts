import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { NextApiRequest, NextApiResponse } from "next";
import * as protocol from "../lib/sweetPersistenceProtocol";
import type { CloudSweetRecord } from "../lib/cloudRecords";

const actor = "00000000-0000-4000-8000-000000000091";
const other = "00000000-0000-4000-8000-000000000092";
const head = "00000000-0000-4000-8000-000000000093";
const day = "2026-10-31";
const records = ["sleep", "wake", "eat", "exercise", "task"].map((id) => ({ id, title: id, label: id,
  fields: [{ id: "state", title: "state", value: "SYNTHETIC" }] }));
const row: CloudSweetRecord = { id: head, user_id: actor, school_id: null, records,
  summary: "S1", small_step: "one", recommended_next_tool: "Talk", created_at: "2026-10-31T02:00:00.000Z" };
const scope = { operationDay: day, targetDay: day, headToken: head, record: row };
const command = { operationDay: day, targetDay: day, expectedHead: head,
  intent: "replace_summary", record: { records, summary: "S1" } };

for (const [value, valid] of [["2024-02-29", true], ["2026-02-29", false], ["0000-01-01", false],
  ["2026-11-31", false], ["2026-10-31T00:00:00Z", false]] as const) {
  test(`日期预期值严格校验 ${value}`, () => expect(protocol.isSweetDay(value)).toBe(valid));
}
test("持久化日期采用IANA上海而不是浏览器时区或固定偏移", () => {
  expect(protocol.sweetStoredDay("2026-10-30T16:00:00Z")).toBe("2026-10-31");
  expect(protocol.sweetStoredDay("1991-07-01T15:30:00Z")).toBe("1991-07-02");
  expect(protocol.sweetStoredDay("invalid")).toBeNull();
});
test("明确ABSENT可提交，缺expected和客户端权限字段不能混入", () => {
  expect(protocol.parseSweetCommand({ ...command, expectedHead: null })).not.toBeNull();
  const absent = { ...command } as Record<string, unknown>; delete absent.expectedHead;
  expect(protocol.parseSweetCommand(absent)).toBeNull();
  for (const key of ["user_id", "actor", "role", "school_id", "created_at"]) {
    expect(protocol.parseSweetCommand({ ...command, [key]: other })).toBeNull();
  }
});
test("preserve/clear不得携非空摘要，合法null和五意图保持分离", () => {
  for (const intent of ["clear_summary", "preserve_summary"]) {
    expect(protocol.parseSweetCommand({ ...command, intent })).toBeNull();
    expect(protocol.parseSweetCommand({ ...command, intent, record: { records } })).not.toBeNull();
  }
  for (const intent of ["delete_day", "delete_record_cutoff"]) {
    expect(protocol.parseSweetCommand({ operationDay: day, targetDay: day, expectedHead: head, intent, recordId: head })).not.toBeNull();
  }
});
test("完整内容保留数组顺序并消除JSONB对象键顺序差异", () => {
  const reordered = records.map((item) => ({ fields: item.fields.map((field) => ({ value: field.value, title: field.title, id: field.id })), label: item.label, title: item.title, id: item.id }));
  expect(protocol.sweetRecordsKey(reordered)).toBe(protocol.sweetRecordsKey(records));
  expect(protocol.sweetRecordsKey([...records].reverse())).not.toBe(protocol.sweetRecordsKey(records));
  expect(protocol.validSweetRecords(records.map((item) => ({ ...item, id: "sleep" })))).toBe(false);
});
test("权威packet必须owner/head/源日一致，不把缺失字段当真实null", () => {
  expect(protocol.parseSweetReply({ ...scope, status: "ready" }, actor)).not.toBeNull();
  expect(protocol.parseSweetReply({ ...scope, status: "ready", record: { ...row, user_id: other } }, actor)).toBeNull();
  expect(protocol.parseSweetReply({ ...scope, status: "ready", headToken: other }, actor)).toBeNull();
  expect(protocol.parseSweetReply({ ...scope, status: "ready", targetDay: "2026-10-30" }, actor)).toBeNull();
  const broken = { ...row } as Record<string, unknown>; delete broken.summary;
  expect(protocol.parseSweetReply({ ...scope, status: "ready", record: broken }, actor)).toBeNull();
  expect(protocol.parseSweetReply({ ...scope, status: "ready", headToken: null, record: null }, actor)).not.toBeNull();
  expect(protocol.parseSweetReply({ ...scope, status: "ready", record: null }, actor)).not.toBeNull();
});

type RpcResult = { data: unknown; error: unknown };
function handlerFixture(options: { user?: boolean; authFailure?: boolean; result?: RpcResult; throwRpc?: boolean; nodeHeaders?: boolean } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const events: unknown[] = [];
  const exported: Record<string, unknown> = {};
  const source = readFileSync("lib/sweetPersistenceServer.ts", "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { exports: exported, require(name: string) {
    if (name === "./supabaseServer") return {
      getAuthenticatedUser: async (req: NextApiRequest) => {
        if (options.authFailure) throw new Error("PRIVATE_AUTH_DETAIL");
        if (options.nodeHeaders && req.headers.authorization !== "Bearer SYNTHETIC") return null;
        return options.user === false ? null : { id: actor };
      },
      getSupabaseAdmin: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args }); if (options.throwRpc) throw new Error("PRIVATE_NETWORK_DETAIL");
        return options.result ?? { data: { status: "accepted", ...scope }, error: null };
      } }),
    };
    if (name === "./sweetPersistenceProtocol") return protocol;
    if (name === "./i18n/server") return { getRequestLocale: () => "zh-CN", getServerTranslator: () => (key: string) => `SAFE:${key}` };
    if (name === "./operationalMonitoring") return { reportOperationalError: (value: unknown) => events.push(value) };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return { calls, events, async run(method: string, body: unknown = command, mini = false, query: Record<string, unknown> = {}, miniRoute = false) {
    let code = 0; let data: unknown; const headers: Record<string, unknown> = {};
    const req = options.nodeHeaders ? Object.assign(Object.create({ get headers() { return { authorization: "Bearer SYNTHETIC" }; } }),
      { method, body, query, cookies: {} }) as NextApiRequest : { method, body, query, cookies: {}, headers: {} } as NextApiRequest;
    const res = { setHeader: (key: string, value: unknown) => { headers[key] = value; },
      status(value: number) { code = value; return res; }, json(value: unknown) { data = value; return res; } };
    if (miniRoute) {
      const miniExports: Record<string, unknown> = {};
      const miniJs = ts.transpileModule(readFileSync("pages/api/mini/records.ts", "utf8"), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      } }).outputText;
      vm.runInNewContext(miniJs, { exports: miniExports, require(name: string) {
        if (name === "@/lib/sweetPersistenceServer") return exported;
        if (name === "@/lib/supabaseServer") return {};
        throw new Error(`Unexpected mini dependency: ${name}`);
      } });
      await (miniExports.default as (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>)(req, res as unknown as NextApiResponse);
    } else await (exported.handleSweetPersistence as (req: NextApiRequest, res: NextApiResponse, mini: boolean) => Promise<unknown>)(req, res as unknown as NextApiResponse, mini);
    return { code, data: data as Record<string, unknown>, headers };
  } };
}

test("API只把可信认证actor和固定mini策略传给同一RPC", async () => {
  const f = handlerFixture(); const reply = await f.run("POST", command, true);
  expect(reply.code).toBe(201); expect(reply.headers["Cache-Control"]).toBe("no-store");
  expect(f.calls).toEqual([{ name: "sweet_scope_write", args: {
    p_actor_user_id: actor, p_operation_day: day, p_target_day: day, p_expected_head: head,
    p_intent: "replace_summary", p_records: records, p_summary: "S1", p_small_step: null,
    p_recommended_next_tool: null, p_record_id: null, p_student_only: true,
  } }]);
});
test("API无身份或伪造字段在RPC派发前拒绝", async () => {
  const unauth = handlerFixture({ user: false }); expect((await unauth.run("POST")).code).toBe(401); expect(unauth.calls).toHaveLength(0);
  const f = handlerFixture(); expect((await f.run("POST", { ...command, user_id: other })).code).toBe(400); expect(f.calls).toHaveLength(0);
});
test("额外step或field键整体拒绝，不丢弃未知legacy字段后冒充可写或空源", async () => {
  for (const extra of ["step", "field"]) {
    const unknown = structuredClone(records) as Array<Record<string, unknown>>;
    if (extra === "step") unknown[0].dimension = "legacy extra must be reviewed";
    else (unknown[0].fields as Array<Record<string, unknown>>)[0].unknown = "legacy extra must be reviewed";
    expect(protocol.validSweetRecords(unknown)).toBe(false);
    expect(protocol.parseSweetReply({ ...scope, status: "ready", record: { ...row, records: unknown } }, actor)).toBeNull();
    const f = handlerFixture();
    expect((await f.run("POST", { ...command, record: { records: unknown, summary: "S1" } })).code).toBe(400);
    expect(f.calls).toHaveLength(0);
  }
});
test("API读取scope只携可信owner和明确目标日，不授权新写", async () => {
  const f = handlerFixture({ result: { data: { status: "ready", ...scope }, error: null } });
  expect((await f.run("GET", undefined, false, { targetDay: day })).code).toBe(200);
  expect(f.calls).toEqual([{ name: "sweet_scope_read", args: { p_actor_user_id: actor, p_target_day: day } }]);
});
for (const status of ["conflict", "scope_expired", "denied", "not_found", "protocol_unavailable"] as const) {
  test(`API ${status}拒绝不泄露数据库packet并明确无提交`, async () => {
    const f = handlerFixture({ result: { data: { status, ...scope, secret: "PRIVATE_BODY" }, error: null } });
    const result = await f.run("POST");
    expect(result.code).toBe(protocol.sweetHttpStatus(status)); expect(result.data.writeOutcome).toBe("not_committed");
    expect(JSON.stringify(result.data)).not.toContain("PRIVATE_BODY"); expect(result.data).not.toHaveProperty("record");
  });
}
test("API确认SQL拒绝与RPC传输丢响应必须分账", async () => {
  const rejected = handlerFixture({ result: { data: null, error: { code: "23514", message: "PRIVATE_DATABASE_DETAIL" } } });
  const a = await rejected.run("POST"); expect(a.data).toMatchObject({ status: "write_rejected", writeOutcome: "not_committed" });
  expect(JSON.stringify(a.data)).not.toContain("PRIVATE_DATABASE_DETAIL");
  const unknown = handlerFixture({ throwRpc: true }); const b = await unknown.run("POST");
  expect(b.data.status).toBe("outcome_unknown"); expect(b.data).not.toHaveProperty("writeOutcome"); expect(unknown.calls).toHaveLength(1);
});
test("API派发前失败可证明未提交，派发后损坏响应仍是unknown", async () => {
  const before = handlerFixture({ authFailure: true });
  expect((await before.run("POST")).data).toMatchObject({ status: "protocol_unavailable", writeOutcome: "not_committed" });
  expect(before.calls).toHaveLength(0);
  const after = handlerFixture({ result: { data: { status: "accepted", ...scope, headToken: other }, error: null } });
  expect((await after.run("POST")).data.status).toBe("outcome_unknown"); expect(after.calls).toHaveLength(1);
});
test("API未知RPC status不冒充已回滚", async () => {
  const f = handlerFixture({ result: { data: { status: "bad_contract" }, error: null } });
  const r = await f.run("POST"); expect(r.data.status).toBe("outcome_unknown"); expect(r.data).not.toHaveProperty("writeOutcome");
});

test("真实Node原型headers经mini DELETE桥保留，旧行cutoff不扩大", async () => {
  const f = handlerFixture({ nodeHeaders: true, result: { data: { status: "accepted", ...scope, record: null }, error: null } });
  const result = await f.run("DELETE", { operationDay: day, targetDay: day, expectedHead: head, recordId: head }, true, {}, true);
  expect(result.code).toBe(201);
  expect(f.calls).toHaveLength(1); expect(f.calls[0].args.p_actor_user_id).toBe(actor);
  expect(f.calls[0].args.p_intent).toBe("delete_record_cutoff"); expect(f.calls[0].args.p_student_only).toBe(true);
});
test("读写RPC成功status不能互换或掩盖坏响应", async () => {
  const write = handlerFixture({ result: { data: { status: "ready", ...scope }, error: null } });
  expect((await write.run("POST")).data.status).toBe("outcome_unknown");
  const read = handlerFixture({ result: { data: { status: "accepted", ...scope }, error: null } });
  expect((await read.run("GET")).data.status).toBe("protocol_unavailable");
});

// B-T01/02/14: classify actual returned RPC errors, never infer from text.
for (const code of ["08007", "40003", "08006", "XX000", "PGRST000", "PGRST003", "PGRST202", "PGRST999", undefined]) {
  for (const mini of [false, true]) {
    test(`B unknown RPC ${code ?? "no-code"} ${mini ? "mini" : "web"} does not assert rollback`, async () => {
      const f = handlerFixture({ result: { data: null, error: { code, message: "23514 PRIVATE_DATABASE_DETAIL", details: "PRIVATE_BODY", hint: "PRIVATE_HINT" } } });
      const r = await f.run("POST", command, mini, {}, mini);
      expect(r.code).toBe(503);
      expect(r.data).toMatchObject({ status: "outcome_unknown" });
      expect(r.data).not.toHaveProperty("writeOutcome");
      expect(JSON.stringify(r.data)).not.toMatch(/PRIVATE|23514/);
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0].args.p_expected_head).toBe(head);
      expect(f.calls[0].args.p_student_only).toBe(mini);
    });
  }
}
test("B trusted constraint rejection mini and web remain definite, read failure is unavailable", async () => {
  for (const mini of [false, true]) {
    const f = handlerFixture({ result: { data: null, error: { code: "23514", message: "PRIVATE" } } });
    const r = await f.run("POST", command, mini, {}, mini);
    expect(r.data).toMatchObject({ status: "write_rejected", writeOutcome: "not_committed" });
    expect(f.calls).toHaveLength(1);
  }
  const read = handlerFixture({ result: { data: null, error: { code: "23514" } } });
  expect((await read.run("GET")).data.status).toBe("protocol_unavailable");
});
