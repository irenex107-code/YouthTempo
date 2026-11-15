import { expect, test, type Page } from "@playwright/test";
import { parseSweetCommand } from "../lib/sweetPersistenceProtocol";
import { syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
type Row = ReturnType<Fixture["ownedRows"]>[number];
type Scope = ReturnType<Fixture["scope"]>;
type Reply = Scope & { httpStatus: number };
type Command = NonNullable<ReturnType<typeof parseSweetCommand>>;
type Run = { fixture: Fixture; events: Array<{ sequence: number; event: string; detail: unknown; state: unknown }> };
const runs = new WeakMap<Page, Run>();
const answers = (version: string): Row["records"] => ["sleep", "wake", "eat", "exercise", "task"].map((id) => ({
  id, title: id, label: version, fields: [{ id: `${id}_field`, title: id, value: version }],
}));
function change(scope: Scope, version: string, intent: "replace_summary" | "clear_summary" = "replace_summary"): Command {
  return { operationDay: scope.operationDay, targetDay: scope.targetDay, expectedHead: scope.headToken, intent,
    record: { records: answers(version), ...(intent === "replace_summary"
      ? { summary: version, smallStep: `${version}_STEP`, recommendedNextTool: `${version}_TOOL` } : {}) } };
}
function mark(page: Page, event: string, detail: unknown = {}) {
  const run = runs.get(page)!;
  run.events.push({ sequence: run.events.length + 1, event, detail: structuredClone(detail), state: run.fixture.snapshot() });
}
async function request(page: Page, body?: Command): Promise<Reply> {
  const fixture = runs.get(page)!.fixture;
  if (body) expect(parseSweetCommand(body)).not.toBeNull();
  const reply = await page.evaluate(async ({ key, body }) => {
    const session = JSON.parse(localStorage.getItem(key)!);
    const response = await fetch("/api/sweet-records", { method: body ? "POST" : "GET", headers: {
      Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json",
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { ...await response.json(), httpStatus: response.status };
  }, { key: fixture.storageKey, body });
  mark(page, body ? "protocol_write_response" : "fresh_scope_response", { body, reply }); return reply;
}
async function setup(page: Page, baseURL: string, prefix: string) {
  const fixture = await syntheticSweetSummary(page, baseURL); runs.set(page, { fixture, events: [] });
  await page.goto(`${prefix}/check-in`); return fixture;
}
async function freshAccount(page: Page, prefix: string, expected: Row[]) {
  for (const mode of ["navigation", "reload", "reentry"]) {
    if (mode === "reentry") await page.goto(`${prefix}/check-in`);
    const next = page.waitForResponse((response) => response.request().method() === "GET"
      && new URL(response.url()).pathname === "/rest/v1/sweet_records");
    if (mode === "reload") await page.reload(); else await page.goto(`${prefix}/account#records`);
    const response = await next; expect(response.status()).toBe(200);
    const rows = await response.json() as Row[]; expect(rows).toEqual(expected);
    await expect(page.locator("#records article")).toHaveCount(expected.length);
    mark(page, `actual_account_${mode}`, { rows });
  }
}
test.afterEach(async ({ page }, info) => {
  const run = runs.get(page); if (!run) return; run.fixture.releaseAll();
  await info.attach("r03-final-matrix-gap-events", { contentType: "application/json", body: JSON.stringify({
    scope: "Actual browser protocol requests, final DTO parser, independent synthetic rows/head model and actual account GET helper. No real database locks/atomicity/Auth/RLS/FK proof.",
    events: run.events, final: run.fixture.snapshot(),
  }, null, 2) });
  expect(run.fixture.state.blockedExternal).toEqual([]); expect(run.fixture.state.unexpectedApi).toEqual([]);
  expect(run.fixture.state.otpSends).toBe(0); expect(run.fixture.state.otpVerifies).toBe(0);
});

for (const [prefix, locale] of [["", "zh-CN"], ["/en", "en"]] as const) {
  test(`${locale} C03 旧null已派发并挂在比较门，S2先提交后旧null冲突零清除`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix);
    const first = await request(page, change(await request(page), "S1")); expect(first.httpStatus).toBe(201);
    const command = change(first, "S1", "clear_summary"); const gate = fixture.holdInsert();
    const pendingNull = request(page, command); await expect.poll(() => gate.held).toBe(true);
    const oldPacket = fixture.state.protocolRequests.at(-1)!;
    expect(oldPacket.method).toBe("POST"); expect(oldPacket.body).toEqual(command); expect(oldPacket.result).toBeUndefined();
    expect(fixture.ownedRows()).toEqual([first.record]); mark(page, "old_null_dispatched_and_held_before_model_compare", { command });
    const second = await request(page, change(first, "S2")); expect(second.httpStatus).toBe(201);
    const sourceBeforeRelease = structuredClone(fixture.state.rows); const headsBeforeRelease = structuredClone(fixture.state.heads);
    mark(page, "S2_committed_before_old_null_release", { second }); gate.release();
    const rejected = await pendingNull; expect(rejected.httpStatus).toBe(409); expect(rejected.status).toBe("conflict");
    expect(rejected.record).toEqual(second.record); expect(rejected.headToken).toBe(second.headToken);
    expect(fixture.state.rows).toEqual(sourceBeforeRelease); expect(fixture.state.heads).toEqual(headsBeforeRelease);
    expect(fixture.ownedRows()).toEqual([second.record]); expect(fixture.participationDays()).toBe(1);
    const fresh = await request(page); expect(fresh.record).toEqual(second.record); expect(fresh.headToken).toBe(second.headToken);
    await freshAccount(page, prefix, [second.record!]);
  });

  test(`${locale} C21 仅field.value数组顺序变化推进head且鲜读保留新顺序`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const initial = await request(page);
    const original = change(initial, "SAME"); original.record!.records[0].fields[0].value = ["ALPHA", "BETA"];
    const first = await request(page, original); expect(first.httpStatus).toBe(201);
    const reordered = change(first, "SAME"); reordered.record!.records = structuredClone(first.record!.records);
    reordered.record!.records[0].fields[0].value = ["BETA", "ALPHA"];
    const restored = structuredClone(reordered.record!); restored.records[0].fields[0].value = ["ALPHA", "BETA"];
    expect(restored).toEqual(original.record); mark(page, "only_array_order_changed_all_other_content_identical", { first, reordered });
    const second = await request(page, reordered); expect(second.httpStatus).toBe(201); expect(second.status).toBe("accepted");
    expect(second.headToken).not.toBe(first.headToken); expect(second.record?.id).not.toBe(first.record?.id);
    expect(second.record?.records).toEqual(reordered.record!.records);
    expect(second.record).toMatchObject({ summary: first.record!.summary, small_step: first.record!.small_step,
      recommended_next_tool: first.record!.recommended_next_tool });
    const fresh = await request(page); expect(fresh.record).toEqual(second.record); expect(fresh.headToken).toBe(second.headToken);
    const repeat = { ...reordered, expectedHead: fresh.headToken };
    const noop = await request(page, repeat); expect(noop.httpStatus).toBe(200); expect(noop.status).toBe("noop");
    expect(noop.headToken).toBe(second.headToken); expect(fixture.ownedRows()).toEqual([second.record]);
    expect(fixture.participationDays()).toBe(1); await freshAccount(page, prefix, [second.record!]);
  });

  test(`${locale} C37 已删目标原expected重试conflict，当前head旧目标重试not_found零改`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const first = await request(page, change(await request(page), "S1"));
    const deletion: Command = { operationDay: first.operationDay, targetDay: first.targetDay, expectedHead: first.headToken,
      intent: "delete_record_cutoff", recordId: first.record!.id };
    const removed = await request(page, deletion); expect(removed.httpStatus).toBe(201); expect(removed.record).toBeNull();
    expect(removed.headToken).not.toBe(first.headToken); const rowsBefore = structuredClone(fixture.state.rows);
    const headsBefore = structuredClone(fixture.state.heads); const cleanupsBefore = fixture.state.requests.filter((r) => r.kind === "transaction-cleanup").length;
    mark(page, "target_deleted_tombstone_committed_before_retries", { deletion, removed });
    const originalExpectedRetry = await request(page, deletion);
    expect(originalExpectedRetry.httpStatus).toBe(409); expect(originalExpectedRetry.status).toBe("conflict");
    expect(originalExpectedRetry.headToken).toBe(removed.headToken);
    const current = await request(page); expect(current.headToken).toBe(removed.headToken);
    const explicitCurrentRetry = await request(page, { ...deletion, operationDay: current.operationDay, expectedHead: current.headToken });
    expect(explicitCurrentRetry.httpStatus).toBe(404); expect(explicitCurrentRetry.status).toBe("not_found");
    expect(fixture.state.rows).toEqual(rowsBefore); expect(fixture.state.heads).toEqual(headsBefore);
    expect(fixture.state.requests.filter((r) => r.kind === "transaction-cleanup")).toHaveLength(cleanupsBefore);
    const fresh = await request(page); expect(fresh.headToken).toBe(removed.headToken); expect(fresh.record).toBeNull();
    expect(fixture.participationDays()).toBe(0); await freshAccount(page, prefix, []);
  });
}
