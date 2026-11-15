import { expect, test, type Page, type Response } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { sweetSummaryRow, syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

type Copy = typeof zh | typeof en;
type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
type Fields = { summary: string | null; small_step: string | null; recommended_next_tool: string | null };
type Evidence = { fixture: Fixture; events: Array<{ sequence: number; event: string; detail: unknown }> };
const evidenceByPage = new WeakMap<Page, Evidence>();
const first: Fields = { summary: "SYNTHETIC_BOUNDARY_S1", small_step: "SYNTHETIC_BOUNDARY_STEP1", recommended_next_tool: "SYNTHETIC_BOUNDARY_TOOL1" };
const second: Fields = { summary: "SYNTHETIC_BOUNDARY_S2", small_step: "SYNTHETIC_BOUNDARY_STEP2", recommended_next_tool: "SYNTHETIC_BOUNDARY_TOOL2" };
const empty: Fields = { summary: null, small_step: null, recommended_next_tool: null };

function fields(row: Partial<Fields>): Fields {
  return { summary: row.summary ?? null, small_step: row.small_step ?? null,
    recommended_next_tool: row.recommended_next_tool ?? null };
}
function isInsert(response: Response) {
  return response.request().method() === "POST" && ["/api/sweet-records", "/rest/v1/sweet_records"].includes(new URL(response.url()).pathname);
}
function postRequests(fixture: Fixture) { return fixture.state.requests.filter((request) => request.method === "POST"); }
function topSave(page: Page, copy: Copy) {
  return page.locator("main article").getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true });
}
function generator(page: Page, copy: Copy) {
  return page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true });
}
function choice(page: Page, copy: Copy) {
  return page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true });
}
function completion(page: Page, copy: Copy) {
  return page.getByText(copy.checkIn.messages.saved, { exact: true })
    .or(page.getByText(copy.checkIn.messages.alreadySaved, { exact: true }));
}
function record(page: Page, event: string, detail: unknown = {}) {
  const evidence = evidenceByPage.get(page)!;
  evidence.events.push({ sequence: evidence.events.length + 1, event, detail: structuredClone({
    detail, rows: evidence.fixture.ownedRows(),
    postFields: postRequests(evidence.fixture).map((request) => fields(request.body!)),
    participationDays: evidence.fixture.participationDays(),
  }) });
}
async function setup(page: Page, baseURL: string, prefix: string, copy: Copy) {
  const fixture = await syntheticSweetSummary(page, baseURL);
  evidenceByPage.set(page, { fixture, events: [] });
  await page.goto(`${prefix}/check-in`);
  for (let step = 0; step < 5; step++) {
    const progress = copy.checkIn.progress.step.replace("{{current}}", String(step + 1)).replace("{{total}}", "5");
    await expect(page.getByText(progress, { exact: true })).toBeVisible();
    const option = page.locator("main article button[aria-pressed]").first();
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
    if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
  }
  expect(fixture.ownedRows()).toEqual([]);
  record(page, "fresh_answers_no_prior_confirmation");
  return fixture;
}
async function generate(page: Page, copy: Copy, fixture: Fixture, result: Fields) {
  fixture.queueAi({ summary: result.summary!, smallStep: result.small_step!, tool: result.recommended_next_tool! });
  await choice(page, copy).check();
  await generator(page, copy).click();
}
async function releaseInsert(page: Page, copy: Copy, gate: ReturnType<Fixture["holdInsert"]>, status: number) {
  const responsePromise = page.waitForResponse(isInsert);
  gate.release();
  const response = await responsePromise;
  expect(response.status()).toBe(status);
  expect(await response.finished()).toBeNull();
  const payload = sweetSummaryRow(await response.json());
  await expect.poll(() => gate.settled).toBe(true);
  await expect(topSave(page, copy)).toBeEnabled();
  await expect(generator(page, copy)).toBeEnabled();
  record(page, "held_insert_response_and_page_busy_complete", { status, payload });
  return payload;
}
async function readAccountTwice(page: Page, prefix: string, expected: Fields) {
  for (const reload of [false, true]) {
    const responsePromise = page.waitForResponse((response) => response.request().method() === "GET"
      && ["/api/sweet-records", "/rest/v1/sweet_records"].includes(new URL(response.url()).pathname));
    if (reload) await page.reload();
    else await page.goto(`${prefix}/account#records`);
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(await response.finished()).toBeNull();
    const rows = await response.json();
    expect(rows).toHaveLength(1);
    expect(fields(rows[0])).toEqual(expected);
    await expect(page.locator("#records article")).toHaveCount(1);
    if (expected.summary) {
      await expect(page.locator("#records").getByText(expected.summary, { exact: true })).toBeVisible();
    } else {
      await expect(page.locator("#records")).not.toContainText(first.summary!);
    }
    record(page, reload ? "account_reload_read" : "account_navigation_read", { readRows: rows });
  }
}

test.afterEach(async ({ page }, testInfo) => {
  const evidence = evidenceByPage.get(page);
  if (!evidence) return;
  evidence.fixture.releaseAll();
  await testInfo.attach("sweet-confirmation-boundary-evidence", {
    contentType: "application/json", body: JSON.stringify({ events: evidence.events,
      finalSnapshot: evidence.fixture.snapshot(),
      scope: "Existing synthetic rows only. No private React cache ref is inspected; confirmation behavior is inferred from payloads and UI/transport completion." }, null, 2),
  });
  expect(evidence.fixture.state.blockedExternal).toEqual([]);
  expect(evidence.fixture.state.unexpectedApi).toEqual([]);
  expect(evidence.fixture.state.otpSends).toBe(0);
  expect(evidence.fixture.state.otpVerifies).toBe(0);
});

for (const [prefix, locale, copy] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  test(`${locale} 首次INSERT未提交即失败且AI选择失效，不能伪造确认，后续raw仍能保存null`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix, copy);
    fixture.state.insertFailures = 1;
    const insert = fixture.holdInsert();
    await generate(page, copy, fixture, first);
    await expect.poll(() => insert.held).toBe(true);
    const originalRecords = structuredClone(postRequests(fixture)[0].body!.records);
    await choice(page, copy).uncheck();
    record(page, "AI_choice_changed_before_first_known_precommit_failure");
    await releaseInsert(page, copy, insert, 503);
    expect(fixture.ownedRows()).toEqual([]);
    await expect(completion(page, copy)).toHaveCount(0);
    await expect(page.getByText(first.summary!, { exact: true })).toHaveCount(0);

    await topSave(page, copy).click();
    await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
    await expect(topSave(page, copy)).toBeDisabled();
    expect(postRequests(fixture)).toHaveLength(2);
    expect(postRequests(fixture)[1].body!.records).toEqual(originalRecords);
    expect(fields(fixture.ownedRows()[0])).toEqual(empty);
    const rawId = fixture.ownedRows()[0].id;
    await topSave(page, copy).dispatchEvent("click");
    await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
    expect(postRequests(fixture)).toHaveLength(2);
    expect(fixture.ownedRows()).toHaveLength(1);
    expect(fixture.ownedRows()[0].id).toBe(rawId);
    expect(fixture.participationDays()).toBe(1);
    record(page, "raw_saved_then_deduplicated_after_failed_first_summary");
    await readAccountTwice(page, prefix, empty);
  });

  test(`${locale} 失效UI的S1成功确认后S2保存失败，raw保留S1去重，显式S2重试才推进版本`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix, copy);
    const insert = fixture.holdInsert();
    await generate(page, copy, fixture, first);
    await expect.poll(() => insert.held).toBe(true);
    await choice(page, copy).uncheck();
    const committed = await releaseInsert(page, copy, insert, 201);
    expect(fields(fixture.ownedRows()[0])).toEqual(first);
    await expect(completion(page, copy)).toHaveCount(0);
    const firstId = committed.id;

    fixture.state.insertFailures = 1;
    const failedResponsePromise = page.waitForResponse(isInsert);
    await generate(page, copy, fixture, second);
    const failedResponse = await failedResponsePromise;
    expect(failedResponse.status()).toBe(503);
    expect(await failedResponse.finished()).toBeNull();
    await expect(page.getByText(copy.checkIn.messages.saveFailed, { exact: true })).toBeVisible();
    await expect(topSave(page, copy)).toBeEnabled();
    await expect(page.getByText(second.summary!, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.checkIn.actions.saveToAccount, exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toHaveCount(0);
    expect(fixture.ownedRows()[0]).toMatchObject({ id: firstId, ...first });
    expect(postRequests(fixture)).toHaveLength(2);
    record(page, "S2_precommit_failure_preserved_confirmed_S1");

    await topSave(page, copy).click();
    // Clearing the prior failure notice is a fresh state transition from this
    // click. Together with released busy state it avoids an early rows snapshot.
    await expect(page.getByText(copy.checkIn.messages.saveFailed, { exact: true })).toHaveCount(0);
    await expect(topSave(page, copy)).toBeEnabled();
    await expect(generator(page, copy)).toBeEnabled();
    await expect(completion(page, copy)).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.checkIn.actions.saveToAccount, exact: true })).toBeVisible();
    expect(postRequests(fixture)).toHaveLength(2);
    expect(fixture.ownedRows()[0]).toMatchObject({ id: firstId, ...first });
    record(page, "raw_reused_S1_confirmation_without_extra_insert_or_false_S2_success");

    await page.getByRole("button", { name: copy.checkIn.actions.saveToAccount, exact: true }).click();
    const savedResult = page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true });
    await expect(savedResult).toBeDisabled();
    expect(fixture.ownedRows()[0]).toMatchObject(second);
    const secondId = fixture.ownedRows()[0].id;
    expect(secondId).not.toBe(firstId);
    expect(postRequests(fixture)).toHaveLength(3);
    await savedResult.dispatchEvent("click");
    await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
    await topSave(page, copy).click();
    await expect(page.getByText(copy.checkIn.messages.alreadySaved, { exact: true })).toBeVisible();
    expect(postRequests(fixture)).toHaveLength(3);
    expect(fixture.ownedRows()).toHaveLength(1);
    expect(fixture.ownedRows()[0].id).toBe(secondId);
    expect(fixture.participationDays()).toBe(1);
    record(page, "S2_explicit_retry_confirmed_and_duplicate_actions_did_not_write");
    await readAccountTwice(page, prefix, second);
  });

  test(`${locale} 保存在途答案A到B再到A属于新代际，旧成功不能阻止按原规则清空新稿小结`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix, copy);
    const insert = fixture.holdInsert();
    await generate(page, copy, fixture, first);
    await expect.poll(() => insert.held).toBe(true);
    const originalRecords = structuredClone(postRequests(fixture)[0].body!.records);
    await page.getByRole("button", { name: copy.checkIn.actions.previous, exact: true }).click();
    const options = page.locator("main article button[aria-pressed]");
    await options.nth(1).click();
    await expect(options.nth(1)).toHaveAttribute("aria-pressed", "true");
    await options.first().click();
    await expect(options.first()).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
    record(page, "real_answer_edits_A_B_A_before_old_save_completion", { originalRecords });
    const committed = await releaseInsert(page, copy, insert, 201);
    expect(fields(fixture.ownedRows()[0])).toEqual(first);
    await expect(completion(page, copy)).toHaveCount(0);
    await expect(page.getByText(first.summary!, { exact: true })).toHaveCount(0);

    await topSave(page, copy).click();
    await expect(completion(page, copy)).toBeVisible();
    await expect(topSave(page, copy)).toBeDisabled();
    expect(postRequests(fixture)).toHaveLength(2);
    expect(postRequests(fixture)[1].body!.records).toEqual(originalRecords);
    expect(fields(postRequests(fixture)[1].body!)).toEqual(empty);
    expect(fixture.ownedRows()).toHaveLength(1);
    expect(fields(fixture.ownedRows()[0])).toEqual(empty);
    expect(fixture.ownedRows()[0].id).not.toBe(committed.id);
    expect(fixture.participationDays()).toBe(1);
    record(page, "new_answer_generation_raw_legitimately_cleared_prior_summary", {
      rule: "Answer edits reset summary association even when values return to A; AI-choice-only changes do not.",
    });
    await readAccountTwice(page, prefix, empty);
  });
}
