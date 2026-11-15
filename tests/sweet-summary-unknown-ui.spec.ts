import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

type Copy = typeof zh | typeof en;
type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
type Row = ReturnType<Fixture["ownedRows"]>[number];
type Run = { fixture: Fixture; events: Array<{ sequence: number; event: string; state: unknown }> };
const runs = new WeakMap<Page, Run>();
const s1 = { summary: "SYNTHETIC_UNKNOWN_PERSISTED_S1", smallStep: "SYNTHETIC_UNKNOWN_STEP1", tool: "SYNTHETIC_UNKNOWN_TOOL1" };
const s2 = { summary: "SYNTHETIC_INDEPENDENT_CURRENT_S2", smallStep: "SYNTHETIC_INDEPENDENT_STEP2", tool: "SYNTHETIC_INDEPENDENT_TOOL2" };
const raw = (page: Page, copy: Copy) => page.locator("main article").getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true });
const generate = (page: Page, copy: Copy) => page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true });
const choice = (page: Page, copy: Copy) => page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true });
const completion = (page: Page, copy: Copy) => page.getByText(copy.checkIn.messages.saved, { exact: true })
  .or(page.getByText(copy.checkIn.messages.alreadySaved, { exact: true }));
function mark(page: Page, event: string, detail: unknown = {}) {
  const run = runs.get(page)!;
  run.events.push({ sequence: run.events.length + 1, event, state: { detail: structuredClone(detail),
    rows: run.fixture.ownedRows(), heads: structuredClone(run.fixture.state.heads),
    protocolRequests: structuredClone(run.fixture.state.protocolRequests), privateCacheInspected: false } });
}
async function setup(page: Page, baseURL: string, prefix: string, copy: Copy) {
  const fixture = await syntheticSweetSummary(page, baseURL); runs.set(page, { fixture, events: [] });
  await page.goto(`${prefix}/check-in`);
  for (let step = 0; step < 5; step++) {
    await expect(page.getByText(copy.checkIn.progress.step.replace("{{current}}", String(step + 1)).replace("{{total}}", "5"), { exact: true })).toBeVisible();
    const selected = page.locator("main article button[aria-pressed]").first(); await selected.focus(); await selected.press("Space");
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
  }
  await expect(page.getByTestId("inline-student-consent").getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
  return fixture;
}
async function freshReads(page: Page, prefix: string, expected: typeof s1 | typeof s2, recordId: string) {
  const run = runs.get(page)!;
  for (const mode of ["navigation", "reload", "reentry"]) {
    if (mode === "reentry") await page.goto(`${prefix}/check-in`);
    const next = page.waitForResponse((response) => response.request().method() === "GET"
      && new URL(response.url()).pathname === "/rest/v1/sweet_records");
    if (mode === "reload") await page.reload(); else await page.goto(`${prefix}/account#records`);
    const response = await next; expect(response.status()).toBe(200); const rows = await response.json() as Row[];
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ id: recordId, user_id: run.fixture.state.user.id,
      summary: expected.summary, small_step: expected.smallStep, recommended_next_tool: expected.tool });
    expect(rows[0].records).toEqual(run.fixture.ownedRows()[0].records);
    await expect(page.locator("#records").getByText(expected.summary, { exact: true })).toBeVisible();
    await expect(page.locator("#records article")).toHaveCount(1); mark(page, `fresh_account_${mode}`, { rows });
  }
}
test.afterEach(async ({ page }, info) => {
  const run = runs.get(page); if (!run) return; run.fixture.releaseAll();
  await info.attach("unknown-result-and-independent-ai-ui-evidence", { contentType: "application/json", body: JSON.stringify({
    events: run.events, final: run.fixture.snapshot(),
    scope: "Actual UI/client calls with independent synthetic persistence. No real DB atomicity/Auth/RLS/FK proof; no private React cache access.",
  }, null, 2) });
  expect(run.fixture.state.blockedExternal).toEqual([]); expect(run.fixture.state.unexpectedApi).toEqual([]);
  expect(run.fixture.state.consentPosts).toEqual([]); expect(run.fixture.state.otpSends).toBe(0); expect(run.fixture.state.otpVerifies).toBe(0);
});

for (const [prefix, locale, copy] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  for (const path of ["raw", "ai-failure-fallback"] as const) {
    test(`${locale} 首S1已提交但ACK丢失且无成功回执：取消AI后${path}不得清空`, async ({ page, baseURL }) => {
      const fixture = await setup(page, baseURL!, prefix, copy); fixture.state.afterCommitFailures = 1;
      const gate = fixture.holdInsert(); fixture.queueAi(s1); await choice(page, copy).check(); await generate(page, copy).click();
      await expect.poll(() => gate.held).toBe(true); expect(fixture.ownedRows()).toEqual([]);
      mark(page, "S1_request_pending_before_model_commit"); gate.release();
      await expect.poll(() => gate.settled).toBe(true);
      await expect(page.getByText(copy.checkIn.messages.persistenceUnknown, { exact: true })).toBeVisible();
      await expect(raw(page, copy)).toBeEnabled(); await expect(generate(page, copy)).toBeEnabled();
      await expect(completion(page, copy)).toHaveCount(0);
      expect(fixture.ownedRows()).toHaveLength(1); const persisted = fixture.ownedRows()[0];
      expect(persisted).toMatchObject({ summary: s1.summary, small_step: s1.smallStep, recommended_next_tool: s1.tool });
      expect(fixture.state.protocolRequests.filter((request) => request.method === "POST")).toHaveLength(1);
      mark(page, "S1_model_committed_response_lost_UI_unknown_no_receipt");
      await choice(page, copy).uncheck(); await expect(page.getByText(s1.summary, { exact: true })).toHaveCount(0);
      mark(page, "AI_choice_only_changed_answers_unchanged");
      if (path === "raw") await raw(page, copy).click();
      else {
        fixture.queueAi({ status: 503 }); await choice(page, copy).check(); await generate(page, copy).click();
        await expect(page.getByText("Synthetic summary unavailable", { exact: true })).toBeVisible();
      }
      await expect(raw(page, copy)).toBeEnabled(); await expect(generate(page, copy)).toBeEnabled();
      await expect(completion(page, copy)).toBeVisible();
      expect(fixture.ownedRows()).toEqual([persisted]);
      expect(fixture.state.protocolRequests.filter((request) => request.method === "POST")).toHaveLength(1);
      expect(fixture.participationDays()).toBe(1); mark(page, "unknown_S1_preserved_by_fresh_read_no_null_mutation");
      await raw(page, copy).click(); await expect(raw(page, copy)).toBeEnabled();
      expect(fixture.state.protocolRequests.filter((request) => request.method === "POST")).toHaveLength(1);
      await freshReads(page, prefix, s1, persisted.id);
    });
  }

  test(`${locale} 独立重新生成冻结h0：外部S2先保存后，手动旧S1必须冲突`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix, copy);
    fixture.queueAi({ status: 503 }); await choice(page, copy).check(); await generate(page, copy).click();
    await expect(page.getByText("Synthetic summary unavailable", { exact: true })).toBeVisible();
    await expect.poll(() => fixture.ownedRows().length).toBe(1);
    const h0 = fixture.ownedRows()[0]; expect(h0.summary).toBeNull();
    const ai = fixture.queueAi({ ...s1, hold: true });
    await page.getByRole("button", { name: copy.checkIn.actions.regenerate, exact: true }).click();
    await expect.poll(() => ai.held).toBe(true); mark(page, "independent_AI_held_after_scope_frozen", { h0 });
    const frozen = fixture.scope(); expect(frozen.headToken).toBe(h0.id);
    const external = await page.evaluate(async ({ key, scope, records, s2 }) => {
      const session = JSON.parse(localStorage.getItem(key)!);
      const response = await fetch("/api/sweet-records", { method: "POST", headers: {
        Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json",
      }, body: JSON.stringify({ operationDay: scope.operationDay, targetDay: scope.targetDay, expectedHead: scope.headToken,
        intent: "replace_summary", record: { records, summary: s2.summary, smallStep: s2.smallStep, recommendedNextTool: s2.tool } }) });
      return { status: response.status, body: await response.json() };
    }, { key: fixture.storageKey, scope: frozen, records: h0.records, s2 });
    expect(external.status).toBe(201); const latest = external.body.record as Row;
    expect(latest.summary).toBe(s2.summary); expect(fixture.ownedRows()).toEqual([latest]);
    mark(page, "other_valid_operation_saved_S2_before_old_AI_release", { latest }); ai.release();
    await expect(page.getByText(s1.summary, { exact: true })).toBeVisible();
    const manual = page.getByRole("button", { name: copy.checkIn.actions.saveToAccount, exact: true });
    await expect(manual).toBeEnabled();
    const conflict = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/sweet-records");
    await manual.click(); const response = await conflict; expect(response.status()).toBe(409);
    expect(response.request().postDataJSON().expectedHead).toBe(h0.id);
    await expect(page.getByText(copy.checkIn.messages.persistenceConflict, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toHaveCount(0);
    expect(fixture.ownedRows()).toEqual([latest]); expect(fixture.participationDays()).toBe(1);
    mark(page, "manual_S1_rejected_using_frozen_h0_not_rebased_to_S2");
    await freshReads(page, prefix, s2, latest.id);
  });
}
