import { expect, test, type Page } from "@playwright/test";
import { syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
type Row = ReturnType<Fixture["ownedRows"]>[number];
type Scope = ReturnType<Fixture["scope"]>;
type Reply = Scope & { httpStatus: number };
type Command = { operationDay: string; targetDay: string; expectedHead: string | null;
  intent: "replace_summary" | "preserve_summary" | "clear_summary" | "delete_record_cutoff";
  record?: { records: Row["records"]; summary?: string; smallStep?: string; recommendedNextTool?: string }; recordId?: string };
type Run = { fixture: Fixture; events: Array<{ sequence: number; event: string; detail: unknown; state: unknown }> };
const runs = new WeakMap<Page, Run>();
const actorB = "00000000-0000-4000-8000-000000000092";
const answers = (version: string): Row["records"] => ["sleep", "wake", "eat", "exercise", "task"].map((id) => ({
  id, title: id, label: version, fields: [{ id: `${id}_field`, title: id, value: version }],
}));
function write(scope: Scope, version: string, intent: Command["intent"] = "replace_summary"): Command {
  return { operationDay: scope.operationDay, targetDay: scope.targetDay, expectedHead: scope.headToken, intent,
    ...(intent === "delete_record_cutoff" ? {} : { record: { records: answers(version), ...(intent === "replace_summary"
      ? { summary: version, smallStep: `${version}_STEP`, recommendedNextTool: `${version}_TOOL` } : {}) } }) };
}
function mark(page: Page, event: string, detail: unknown = {}) {
  const run = runs.get(page)!;
  run.events.push({ sequence: run.events.length + 1, event, detail: structuredClone(detail), state: run.fixture.snapshot() });
}
async function request(page: Page, body?: Command, targetDay?: string, actor?: string): Promise<Reply> {
  const fixture = runs.get(page)!.fixture;
  const reply = await page.evaluate(async ({ key, body, targetDay, actor }) => {
    const session = JSON.parse(localStorage.getItem(key)!);
    // Fixture-only actor credential; this API is intercepted, never real JWT/Auth verification.
    const token = actor ? `${btoa(JSON.stringify({ alg: "none" }))}.${btoa(JSON.stringify({ sub: actor, role: "authenticated" }))}.synthetic-only`
      : session.access_token;
    const response = await fetch(`/api/sweet-records${body ? "" : targetDay ? `?targetDay=${targetDay}` : ""}`, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { ...await response.json(), httpStatus: response.status };
  }, { key: fixture.storageKey, body, targetDay, actor });
  mark(page, body ? "protocol_write_response" : "fresh_scope_response", { actor: actor ?? fixture.state.user.id, body, reply });
  return reply;
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
  await info.attach("r03-supplement-model-events", { contentType: "application/json", body: JSON.stringify({
    scope: "Direct browser protocol calls plus independent synthetic source/head model; actual account helper GET. No real SQL, Auth, locks, RLS or FK execution.",
    events: run.events, final: run.fixture.snapshot(),
  }, null, 2) });
  expect(run.fixture.state.blockedExternal).toEqual([]); expect(run.fixture.state.unexpectedApi).toEqual([]);
  expect(run.fixture.state.otpSends).toBe(0); expect(run.fixture.state.otpVerifies).toBe(0);
});

for (const [prefix, locale] of [["", "zh-CN"], ["/en", "en"]] as const) {
  test(`${locale} C09 首次相同内容ABSENT竞争仍先CAS，重新读取后串行NOOP`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const initial = await request(page);
    expect(initial.headToken).toBeNull(); const command = write(initial, "SAME");
    const gate = fixture.holdInsert(); const old = request(page, command);
    await expect.poll(() => gate.held).toBe(true); mark(page, "first_identical_write_held_before_compare", { command });
    const first = await request(page, command); expect(first.httpStatus).toBe(201);
    gate.release(); const stale = await old; expect(stale.httpStatus).toBe(409); expect(stale.status).toBe("conflict");
    expect(stale.record).toEqual(first.record); expect(stale.headToken).toBe(first.headToken);
    const current = await request(page); const repeated = await request(page, write(current, "SAME"));
    expect(repeated.httpStatus).toBe(200); expect(repeated.status).toBe("noop");
    expect(repeated.headToken).toBe(first.headToken); expect(repeated.record).toEqual(first.record);
    expect(fixture.ownedRows()).toEqual([first.record]); expect(fixture.state.heads).toHaveLength(1);
    expect(fixture.participationDays()).toBe(1); await freshAccount(page, prefix, [first.record!]);
  });

  test(`${locale} C05 合法clear后旧S1及旧null拒绝，当前主动S3仍可接受并鲜读`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const first = await request(page, write(await request(page), "S1"));
    const second = await request(page, write(first, "S2")); expect(second.httpStatus).toBe(201);
    const cleared = await request(page, write(second, "S2", "clear_summary")); expect(cleared.httpStatus).toBe(201);
    expect(cleared.record).toMatchObject({ records: answers("S2"), summary: null, small_step: null, recommended_next_tool: null });
    expect((await request(page, write(first, "S1"))).httpStatus).toBe(409);
    expect((await request(page, write(first, "S1", "clear_summary"))).httpStatus).toBe(409);
    expect(fixture.ownedRows()).toEqual([cleared.record]);
    const current = await request(page); expect(current.headToken).toBe(cleared.headToken);
    const third = await request(page, write(current, "S3")); expect(third.httpStatus).toBe(201);
    expect(third.headToken).not.toBe(cleared.headToken);
    expect(third.record).toMatchObject({ records: answers("S3"), summary: "S3", small_step: "S3_STEP", recommended_next_tool: "S3_TOOL" });
    const fresh = await request(page); expect(fresh.record).toEqual(third.record); expect(fresh.headToken).toBe(third.headToken);
    expect(fixture.ownedRows()).toEqual([third.record]); expect(fixture.participationDays()).toBe(1);
    await freshAccount(page, prefix, [third.record!]);
  });

  test(`${locale} C36 cutoff删除当前源生成墓碑，B及其他上海日保持整行不变`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix);
    const history = await request(page, write(await request(page), "A_DAY1"));
    await fixture.setNow("2026-10-31T02:00:00.000Z");
    const current = await request(page, write(await request(page), "A_DAY2"));
    const bScope = await request(page, undefined, undefined, actorB);
    const b = await request(page, write(bScope, "B_DAY2"), undefined, actorB); expect(b.httpStatus).toBe(201);
    const beforeOtherHeads = structuredClone(fixture.state.heads.filter((head) => head.userId === actorB || head.targetDay === history.targetDay));
    mark(page, "A_two_days_and_B_committed_before_current_cutoff");
    const deleted = await request(page, { ...write(current, "A_DAY2", "delete_record_cutoff"), recordId: current.record!.id });
    expect(deleted.httpStatus).toBe(201); expect(deleted.record).toBeNull(); expect(deleted.headToken).not.toBe(current.headToken);
    expect(fixture.ownedRows()).toEqual([history.record]); expect(fixture.participationDays()).toBe(1);
    expect(fixture.state.rows.filter((row) => row.user_id === actorB)).toEqual([b.record]);
    expect(fixture.state.heads.filter((head) => head.userId === actorB || head.targetDay === history.targetDay)).toEqual(beforeOtherHeads);
    expect(fixture.state.heads.find((head) => head.userId === fixture.state.user.id && head.targetDay === current.targetDay)).toEqual({
      userId: fixture.state.user.id, targetDay: current.targetDay, headToken: deleted.headToken, recordId: null,
    });
    expect((await request(page)).record).toBeNull(); expect((await request(page, undefined, history.targetDay)).record).toEqual(history.record);
    expect((await request(page, undefined, undefined, actorB)).record).toEqual(b.record);
    await freshAccount(page, prefix, [history.record!]);
  });

  test(`${locale} C23 preserve的NOOP不消耗head，clear先成功后旧preserve必须冲突`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const first = await request(page, write(await request(page), "S1"));
    const clearGate = fixture.holdInsert(); const clearPending = request(page, write(first, "S1", "clear_summary"));
    await expect.poll(() => clearGate.held).toBe(true); mark(page, "clear_held_preserve_can_compare_first");
    const preserved = await request(page, write(first, "S1", "preserve_summary"));
    expect(preserved.httpStatus).toBe(200); expect(preserved.status).toBe("noop");
    expect(preserved.headToken).toBe(first.headToken); expect(fixture.ownedRows()).toEqual([first.record]);
    clearGate.release(); const cleared = await clearPending; expect(cleared.httpStatus).toBe(201); expect(cleared.record?.summary).toBeNull();
    const second = await request(page, write(cleared, "S2")); expect(second.httpStatus).toBe(201);
    const preserveGate = fixture.holdInsert(); const preservePending = request(page, write(second, "S2", "preserve_summary"));
    await expect.poll(() => preserveGate.held).toBe(true); mark(page, "preserve_held_clear_can_compare_first");
    const clearedFirst = await request(page, write(second, "S2", "clear_summary")); expect(clearedFirst.httpStatus).toBe(201);
    preserveGate.release(); const stale = await preservePending; expect(stale.httpStatus).toBe(409); expect(stale.status).toBe("conflict");
    expect(stale.headToken).toBe(clearedFirst.headToken); expect(stale.record).toEqual(clearedFirst.record);
    expect(clearedFirst.record).toMatchObject({ records: answers("S2"), summary: null, small_step: null, recommended_next_tool: null });
    expect(fixture.ownedRows()).toEqual([clearedFirst.record]); expect(fixture.participationDays()).toBe(1);
    await freshAccount(page, prefix, [clearedFirst.record!]);
  });
}
