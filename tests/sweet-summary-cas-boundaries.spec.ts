import { expect, test, type Page } from "@playwright/test";
import { syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
type Row = ReturnType<Fixture["ownedRows"]>[number];
type Scope = ReturnType<Fixture["scope"]>;
type Reply = Scope & { httpStatus: number; networkFailure?: boolean };
type Command = { operationDay: string; targetDay: string; expectedHead: string | null; intent: string;
  record?: { records: Row["records"]; summary?: string; smallStep?: string; recommendedNextTool?: string }; recordId?: string };
test.use({ timezoneId: "America/Los_Angeles" });
const fixtures = new WeakMap<Page, Fixture>();
const answers = (version: string): Row["records"] => ["sleep", "wake", "eat", "exercise", "task"].map((id) => ({
  id, title: id, label: version, fields: [{ id: `${id}_field`, title: id, value: version }],
}));
function change(scope: Scope, version: string, intent = "replace_summary"): Command {
  return { operationDay: scope.operationDay, targetDay: scope.targetDay, expectedHead: scope.headToken, intent,
    ...(intent.startsWith("delete_") ? {} : { record: { records: answers(version), ...(intent === "replace_summary"
      ? { summary: version, smallStep: `${version}_STEP`, recommendedNextTool: `${version}_TOOL` } : {}) } }) };
}
async function request(page: Page, fixture: Fixture, body?: Command, targetDay?: string): Promise<Reply> {
  return page.evaluate(async ({ key, body, targetDay }) => {
    const session = JSON.parse(localStorage.getItem(key)!);
    try {
      const reply = await fetch(`/api/sweet-records${body ? "" : targetDay ? `?targetDay=${targetDay}` : ""}`, {
        method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { ...await reply.json(), httpStatus: reply.status };
    } catch { return { status: "unknown", operationDay: "", targetDay: "", headToken: null, record: null, networkFailure: true, httpStatus: 0 }; }
  }, { key: fixture.storageKey, body, targetDay });
}
async function freshAccount(page: Page, prefix: string, expected: string | null, expectedRows = 1) {
  for (const mode of ["navigation", "reload", "reentry"]) {
    if (mode === "reentry") await page.goto(`${prefix}/check-in`);
    const next = page.waitForResponse((response) => response.request().method() === "GET"
      && new URL(response.url()).pathname === "/rest/v1/sweet_records");
    if (mode === "reload") await page.reload(); else await page.goto(`${prefix}/account#records`);
    const response = await next; expect(response.status()).toBe(200);
    const rows = await response.json() as Row[];
    expect(rows).toHaveLength(expectedRows);
    if (expectedRows) expect(rows[0].summary).toBe(expected);
    await expect(page.locator("#records article")).toHaveCount(expectedRows);
    if (expected) await expect(page.locator("#records p").filter({ hasText: new RegExp(`^${expected}$`) })).toBeVisible();
  }
}
async function setup(page: Page, baseURL: string, prefix: string) {
  const fixture = await syntheticSweetSummary(page, baseURL); fixtures.set(page, fixture);
  await page.goto(`${prefix}/check-in`); return fixture;
}
test.afterEach(async ({ page }, info) => {
  const fixture = fixtures.get(page); if (!fixture) return;
  fixture.releaseAll();
  await info.attach("r03-cas-synthetic-model-evidence", { contentType: "application/json", body: JSON.stringify({
    scope: "Browser protocol transport and an independent stateful CAS model only. NOT actual SQL atomicity, Auth, RLS, FK or deployed Supabase validation.",
    final: fixture.snapshot(),
  }, null, 2) });
  expect(fixture.state.blockedExternal).toEqual([]); expect(fixture.state.unexpectedApi).toEqual([]);
  expect(fixture.state.otpSends).toBe(0); expect(fixture.state.otpVerifies).toBe(0);
});

for (const [prefix, locale] of [["", "zh-CN"], ["/en", "en"]] as const) {
  test(`${locale} CAS模型：首次同ABSENT竞争与反向旧写门序`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const initial = await request(page, fixture);
    expect(initial.headToken).toBeNull();
    const gate = fixture.holdInsert(); const old = request(page, fixture, change(initial, "S1"));
    await expect.poll(() => gate.held).toBe(true);
    const newer = await request(page, fixture, change(initial, "S2"));
    expect(newer.httpStatus).toBe(201); expect(newer.record?.summary).toBe("S2");
    gate.release(); const stale = await old;
    expect(stale.httpStatus).toBe(409); expect(stale.status).toBe("conflict");
    expect(stale.headToken).toBe(newer.headToken); expect(fixture.ownedRows()).toEqual([newer.record]);
    expect(fixture.state.heads).toHaveLength(1); expect(fixture.participationDays()).toBe(1);
    await freshAccount(page, prefix, "S2");
  });

  test(`${locale} CAS模型：同基线竞争反向释放，S1先推进则旧S2必须冲突`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const initial = await request(page, fixture);
    const gate = fixture.holdInsert(); const pendingS2 = request(page, fixture, change(initial, "S2"));
    await expect.poll(() => gate.held).toBe(true);
    const acceptedS1 = await request(page, fixture, change(initial, "S1")); expect(acceptedS1.httpStatus).toBe(201);
    gate.release(); const staleS2 = await pendingS2;
    expect(staleS2.httpStatus).toBe(409); expect(staleS2.status).toBe("conflict");
    expect(staleS2.headToken).toBe(acceptedS1.headToken); expect(fixture.ownedRows()).toEqual([acceptedS1.record]);
    expect(fixture.state.heads).toHaveLength(1); await freshAccount(page, prefix, "S1");
  });

  test(`${locale} CAS模型：S2后旧S1和旧null都拒绝，当前合法clear可读回`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const initial = await request(page, fixture);
    const first = await request(page, fixture, change(initial, "S1"));
    const s2 = await request(page, fixture, change(first, "S2"));
    expect(s2.httpStatus).toBe(201);
    const oldS1 = await request(page, fixture, change(first, "S1"));
    const oldNull = await request(page, fixture, change(first, "S1", "clear_summary"));
    expect([oldS1.httpStatus, oldNull.httpStatus]).toEqual([409, 409]);
    expect(fixture.ownedRows()[0].summary).toBe("S2");
    const clear = change(s2, "S2", "clear_summary"); const cleared = await request(page, fixture, clear);
    expect(cleared.httpStatus).toBe(201); expect(cleared.headToken).not.toBe(s2.headToken);
    expect(cleared.record).toMatchObject({ summary: null, small_step: null, recommended_next_tool: null, records: answers("S2") });
    expect((await request(page, fixture, change(first, "S1"))).httpStatus).toBe(409);
    expect(fixture.participationDays()).toBe(1); await freshAccount(page, prefix, null);
  });

  test(`${locale} CAS模型：NOOP不消耗head，完整字段变化推进，preserve和clear两门序`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix);
    const first = await request(page, fixture, change(await request(page, fixture), "S1"));
    const repeated = await request(page, fixture, change(first, "S1"));
    expect(repeated.httpStatus).toBe(200); expect(repeated.status).toBe("noop"); expect(repeated.headToken).toBe(first.headToken);
    const changedStep = change(first, "S1"); changedStep.record!.smallStep = "NEW_STEP";
    const s2 = await request(page, fixture, changedStep); expect(s2.httpStatus).toBe(201);
    const preserve = change(s2, "S1", "preserve_summary"); delete preserve.record!.summary;
    const noop = await request(page, fixture, preserve); expect(noop.status).toBe("noop"); expect(noop.headToken).toBe(s2.headToken);
    const cleared = await request(page, fixture, change(s2, "S1", "clear_summary")); expect(cleared.httpStatus).toBe(201);
    expect((await request(page, fixture, preserve)).httpStatus).toBe(409);
    expect(fixture.ownedRows()).toHaveLength(1); expect(fixture.participationDays()).toBe(1);
  });

  test(`${locale} CAS模型：已提交丢ACK只能原expected重试，S2后不得恢复S1`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const initial = await request(page, fixture);
    const original = change(initial, "S1"); fixture.state.afterCommitFailures = 1;
    const unknown = await request(page, fixture, original); expect(unknown.networkFailure).toBe(true);
    expect(fixture.ownedRows()[0].summary).toBe("S1");
    const retry = await request(page, fixture, original); expect(retry.httpStatus).toBe(409);
    const current = await request(page, fixture); expect(current.record?.summary).toBe("S1");
    const s2 = await request(page, fixture, change(current, "S2")); expect(s2.httpStatus).toBe(201);
    expect((await request(page, fixture, original)).httpStatus).toBe(409);
    expect(fixture.ownedRows()).toHaveLength(1); await freshAccount(page, prefix, "S2");
  });

  test(`${locale} CAS模型：整日删除保留最少墓碑且拒绝最早ABSENT重放`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const virgin = await request(page, fixture);
    const first = await request(page, fixture, change(virgin, "S1"));
    const deleted = await request(page, fixture, { ...change(first, "S1", "delete_day"), recordId: first.record!.id });
    expect(deleted.httpStatus).toBe(201); expect(deleted.record).toBeNull(); expect(deleted.headToken).not.toBe(first.headToken);
    expect(fixture.ownedRows()).toEqual([]); expect(fixture.state.heads).toEqual([{ userId: fixture.state.user.id,
      targetDay: first.targetDay, headToken: deleted.headToken, recordId: null }]);
    expect(JSON.stringify(fixture.state.heads)).not.toContain("S1");
    expect((await request(page, fixture, change(virgin, "S1"))).httpStatus).toBe(409);
    await freshAccount(page, prefix, null, 0);
  });

  test(`${locale} CAS模型：上海日过期与当前历史删除分开，客户端时区不决定日`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); await fixture.setNow("2026-10-30T15:59:59.000Z");
    const day1 = await request(page, fixture); expect(day1.operationDay).toBe("2026-10-30");
    const pending = change(day1, "OLD"); const gate = fixture.holdInsert(); const write = request(page, fixture, pending);
    await expect.poll(() => gate.held).toBe(true); await fixture.setNow("2026-10-30T16:00:01.000Z"); gate.release();
    const expired = await write; expect(expired.httpStatus).toBe(409); expect(expired.status).toBe("scope_expired");
    expect(fixture.state.rows).toEqual([]); expect(fixture.state.heads).toEqual([]);
    const current = await request(page, fixture); expect(current.operationDay).toBe("2026-10-31");
    const today = await request(page, fixture, change(current, "NEW")); expect(today.record!.created_at).toBe(fixture.state.now);
    await fixture.setNow("2026-10-31T16:00:01.000Z");
    const history = await request(page, fixture, undefined, today.targetDay);
    expect(history.operationDay).toBe("2026-11-01"); expect(history.targetDay).toBe("2026-10-31");
    const deleted = await request(page, fixture, { ...change(history, "NEW", "delete_day"), recordId: today.record!.id });
    expect(deleted.httpStatus).toBe(201); expect(fixture.state.rows).toEqual([]);
  });

  test(`${locale} CAS模型：账号清理源和墓碑后旧在途请求不得复活`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const initial = await request(page, fixture);
    const first = await request(page, fixture, change(initial, "S1"));
    const deleted = await request(page, fixture, { ...change(first, "S1", "delete_day"), recordId: first.record!.id });
    const gate = fixture.holdInsert(); const pending = request(page, fixture, change(deleted, "LATE"));
    await expect.poll(() => gate.held).toBe(true);
    fixture.modelDeleteActor(fixture.state.user.id); gate.release();
    expect((await pending).httpStatus).toBe(403); expect(fixture.state.rows).toEqual([]); expect(fixture.state.heads).toEqual([]);
    expect((await request(page, fixture)).httpStatus).toBe(403);
  });

  test(`${locale} CAS模型：屏障阻止新旧写，损坏head和未初始化legacy不当ABSENT`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const initial = await request(page, fixture);
    fixture.state.protocolEnabled = false;
    expect((await request(page, fixture, change(initial, "S1"))).httpStatus).toBe(503);
    expect(fixture.state.rows).toEqual([]); fixture.state.protocolEnabled = true;
    const source = await request(page, fixture, change(await request(page, fixture), "S1"));
    fixture.state.heads = [];
    expect((await request(page, fixture)).httpStatus).toBe(503);
    expect((await request(page, fixture, change(initial, "BAD"))).httpStatus).toBe(503);
    expect(fixture.ownedRows()).toEqual([source.record]);
  });

  test(`${locale} CAS模型：首次失败不留ghost head，原expected显式重试可成功`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const initial = await request(page, fixture);
    const first = change(initial, "S1"); fixture.state.insertFailures = 1;
    expect((await request(page, fixture, first)).httpStatus).toBe(503);
    expect(fixture.state.rows).toEqual([]); expect(fixture.state.heads).toEqual([]);
    expect((await request(page, fixture)).headToken).toBeNull();
    expect((await request(page, fixture, first)).httpStatus).toBe(201);
    expect(fixture.state.heads).toHaveLength(1); expect(fixture.participationDays()).toBe(1);
  });

  test(`${locale} CAS模型：mini旧记录cutoff不扩大删除当前head，旧删除遇S2冲突`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const first = await request(page, fixture, change(await request(page, fixture), "S1"));
    const old = { ...structuredClone(first.record!), id: "00000000-0000-4000-8000-000000009991",
      created_at: "2026-10-30T01:59:00.000Z", summary: "OLD" };
    fixture.replacePersistedRows([old, first.record!]);
    const scope = await request(page, fixture);
    const removed = await request(page, fixture, { ...change(scope, "S1", "delete_record_cutoff"), recordId: old.id });
    expect(removed.httpStatus).toBe(201); expect(removed.headToken).toBe(scope.headToken); expect(fixture.ownedRows()).toEqual([first.record]);
    fixture.replacePersistedRows([old, first.record!]);
    const gate = fixture.holdInsert(); const pending = request(page, fixture, { ...change(scope, "S1", "delete_record_cutoff"), recordId: old.id });
    await expect.poll(() => gate.held).toBe(true); const newer = await request(page, fixture, change(scope, "S2"));
    gate.release(); expect((await pending).httpStatus).toBe(409); expect(fixture.ownedRows()).toEqual([newer.record]);
    await freshAccount(page, prefix, "S2");
  });

  test(`${locale} CAS模型：真正撤回拒绝保存但保留本人原删除能力`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix); const first = await request(page, fixture, change(await request(page, fixture), "S1"));
    fixture.state.consentState = "withdrawn";
    expect((await request(page, fixture, change(first, "S2"))).httpStatus).toBe(403);
    expect(fixture.ownedRows()).toEqual([first.record]);
    const deleted = await request(page, fixture, { ...change(first, "S1", "delete_day"), recordId: first.record!.id });
    expect(deleted.httpStatus).toBe(201); expect(fixture.state.rows).toEqual([]);
  });
}
