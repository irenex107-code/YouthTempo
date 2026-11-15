import { expect, test, type Page, type Response } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { sweetSummaryRow, syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

type Copy = typeof zh | typeof en;
type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
type Row = ReturnType<Fixture["ownedRows"]>[number];
type Fields = Pick<Row, "summary" | "small_step" | "recommended_next_tool">;
type Gate = { held: boolean; settled: boolean; wait: Promise<void>; release: () => void };
type ReadPlan = { status: number; gate: Gate; rows?: Row[] };
type Run = { fixture: Fixture; events: Array<{ sequence: number; event: string; detail: unknown }>;
  readPlans: ReadPlan[]; gates: Gate[]; consentStatus: number };
const runs = new WeakMap<Page, Run>();
const first: Fields = { summary: "SYNTHETIC_RECONCILE_S1", small_step: "SYNTHETIC_RECONCILE_STEP1", recommended_next_tool: "SYNTHETIC_RECONCILE_TOOL1" };
const second: Fields = { summary: "SYNTHETIC_RECONCILE_S2", small_step: "SYNTHETIC_RECONCILE_STEP2", recommended_next_tool: "SYNTHETIC_RECONCILE_TOOL2" };
const empty: Fields = { summary: null, small_step: null, recommended_next_tool: null };
const fields = (row: Partial<Fields>): Fields => ({ summary: row.summary ?? null,
  small_step: row.small_step ?? null, recommended_next_tool: row.recommended_next_tool ?? null });
const posts = (run: Run) => run.fixture.state.requests.filter((request) => request.method === "POST");
const panel = (page: Page) => page.getByTestId("inline-student-consent");
const raw = (page: Page, copy: Copy) => page.locator("main article").getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true });
const generate = (page: Page, copy: Copy) => page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true });
const completion = (page: Page, copy: Copy) => page.getByText(copy.checkIn.messages.saved, { exact: true })
  .or(page.getByText(copy.checkIn.messages.alreadySaved, { exact: true }));
const isSweet = (response: Response, method: string) => response.request().method() === method
  && ["/api/sweet-records", "/rest/v1/sweet_records"].includes(new URL(response.url()).pathname);
const isReconciliation = (response: Response) => response.request().method() === "GET"
  && new URL(response.url()).pathname === "/api/sweet-records";

function gate(): Gate {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { held: false, settled: false, wait, release };
}
function record(page: Page, event: string, detail: unknown = {}) {
  const run = runs.get(page)!;
  run.events.push({ sequence: run.events.length + 1, event, detail: structuredClone({ detail,
    rows: run.fixture.ownedRows(), postFields: posts(run).map((request) => fields(request.body!)),
    participationDays: run.fixture.participationDays() }) });
}
function holdRead(page: Page, status = 200) {
  const run = runs.get(page)!;
  const plan: ReadPlan = { status, gate: gate() };
  run.gates.push(plan.gate); run.readPlans.push(plan);
  return plan;
}

async function setup(page: Page, baseURL: string, prefix: string, copy: Copy) {
  const fixture = await syntheticSweetSummary(page, baseURL);
  const run: Run = { fixture, events: [], readPlans: [], gates: [], consentStatus: 200 };
  runs.set(page, run);
  const consentBody = { role: "student", policyVersion: fixture.state.consentPolicy, children: [],
    consent: { studentUserId: fixture.state.user.id, studentName: fixture.state.user.user_metadata.display_name,
      ageBand: "14_17", policyVersion: fixture.state.consentPolicy, status: "active", consentBasis: "student_self_pilot",
      studentAssentedAt: "2026-10-01T02:00:00.000Z", guardianUserId: null, guardianConsentedAt: null,
      withdrawnAt: null, hasLinkedGuardian: false } };
  await page.route("**/api/account/consent", async (route) => {
    expect(route.request().method()).toBe("GET");
    const status = run.consentStatus;
    record(page, "consent_response", { status, body: status === 200 ? consentBody : undefined });
    await route.fulfill({ status, json: status === 200 ? structuredClone(consentBody)
      : { error: "Synthetic consent verification unavailable" } });
  });
  // Capture the response at request time so editing while this gate is held
  // exercises a genuinely stale read, rather than reading new state on release.
  await page.route("**/api/sweet-records**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || url.searchParams.has("created_at") || !run.readPlans.length) return route.fallback();
    const token = route.request().headers().authorization?.replace(/^Bearer\s+/i, "") || "";
    const actor = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub as string;
    expect(actor).toBe(fixture.state.user.id);
    const capturedScope = fixture.scope(actor, url.searchParams.get("targetDay") || undefined);
    expect(capturedScope.status).toBe("ready");
    const plan = run.readPlans.shift()!;
    plan.rows = structuredClone(fixture.ownedRows()).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 50);
    plan.gate.held = true;
    record(page, "reconciliation_GET_held", { status: plan.status, query: [...url.searchParams.entries()], capturedRows: plan.rows });
    await plan.gate.wait;
    try {
      await route.fulfill({ status: plan.status, json: plan.status === 200 ? capturedScope
        : { code: "SYNTHETIC_RECONCILE_READ", message: "Synthetic reconciliation read unavailable" } });
      record(page, "reconciliation_GET_fulfilled", { status: plan.status, capturedRows: plan.rows });
    } finally { plan.gate.settled = true; }
  });
  await page.goto(`${prefix}/check-in`);
  for (let step = 0; step < 5; step++) {
    await expect(page.getByText(copy.checkIn.progress.step.replace("{{current}}", String(step + 1)).replace("{{total}}", "5"), { exact: true })).toBeVisible();
    await page.locator("main article button[aria-pressed]").first().click();
    if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
  }
  await expect(panel(page).getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
  expect(fixture.ownedRows()).toEqual([]);
  record(page, "fresh_completed_answers");
  return run;
}
async function startS1(page: Page, copy: Copy) {
  const run = runs.get(page)!;
  const insert = run.fixture.holdInsert();
  run.fixture.queueAi({ summary: first.summary!, smallStep: first.small_step!, tool: first.recommended_next_tool! });
  await page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }).check();
  await generate(page, copy).click();
  await expect.poll(() => insert.held).toBe(true);
  expect(run.fixture.ownedRows()).toEqual([]);
  record(page, "first_S1_insert_pending");
  return insert;
}
async function finishS1(page: Page, copy: Copy, insert: ReturnType<Fixture["holdInsert"]>, UIConfirmed = true) {
  const run = runs.get(page)!;
  const next = page.waitForResponse((response) => isSweet(response, "POST"));
  insert.release();
  const response = await next;
  expect(response.status()).toBe(201);
  expect(await response.finished()).toBeNull();
  const row = sweetSummaryRow(await response.json());
  await expect.poll(() => insert.settled).toBe(true);
  await expect(raw(page, copy)).toBeEnabled();
  await expect(generate(page, copy)).toBeEnabled();
  expect(run.fixture.ownedRows()).toHaveLength(1);
  expect(run.fixture.ownedRows()[0]).toMatchObject({ id: row.id, ...first });
  if (UIConfirmed) await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toBeDisabled();
  else {
    await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toHaveCount(0);
    await expect(completion(page, copy)).toHaveCount(0);
  }
  record(page, "first_S1_committed_and_operation_finished", { rowId: row.id, UIConfirmed });
  return row;
}
async function changeVerification(page: Page, copy: Copy, status: number) {
  const run = runs.get(page)!;
  run.consentStatus = status;
  const next = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/account/consent");
  if (status === 503) await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  else await panel(page).getByRole("button", { name: copy.inlineConsent.retry, exact: true }).click();
  const response = await next;
  expect(response.status()).toBe(status);
  expect(await response.finished()).toBeNull();
  if (status === 200) {
    await expect(panel(page).getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
  } else await expect(panel(page).getByRole("alert")).toBeVisible();
  record(page, "verification_UI_processed", { status });
}
async function restoreVerification(page: Page, copy: Copy) {
  await changeVerification(page, copy, 503);
  await changeVerification(page, copy, 200);
}
async function releaseRead(page: Page, copy: Copy, plan: ReadPlan) {
  const next = page.waitForResponse(isReconciliation);
  plan.gate.release();
  const response = await next;
  expect(response.status()).toBe(plan.status);
  expect(await response.finished()).toBeNull();
  await expect.poll(() => plan.gate.settled).toBe(true);
  await expect(raw(page, copy)).toBeEnabled();
  await expect(generate(page, copy)).toBeEnabled();
  record(page, "reconciliation_response_and_operation_complete", { status: plan.status, returnedRows: plan.rows });
}
async function accountReads(page: Page, prefix: string, expected: Fields) {
  const run = runs.get(page)!;
  for (const reload of [false, true]) {
    const next = page.waitForResponse((response) => isSweet(response, "GET"));
    if (reload) await page.reload(); else await page.goto(`${prefix}/account#records`);
    const response = await next;
    expect(response.status()).toBe(200);
    expect(await response.finished()).toBeNull();
    const rows = await response.json() as Row[];
    expect(rows).toHaveLength(1);
    expect(fields(rows[0])).toEqual(expected);
    expect(rows[0].id).toBe(run.fixture.ownedRows()[0].id);
    await expect(page.locator("#records article")).toHaveCount(1);
    if (expected.summary) await expect(page.locator("#records").getByText(expected.summary, { exact: true })).toBeVisible();
    else await expect(page.locator("#records")).not.toContainText(first.summary!);
    record(page, reload ? "account_reload_GET" : "account_navigation_GET", { readRows: rows });
  }
}
async function repeatRaw(page: Page, copy: Copy, expectedPosts: number) {
  const run = runs.get(page)!;
  if (await raw(page, copy).isDisabled()) {
    await raw(page, copy).dispatchEvent("click");
    await expect(raw(page, copy)).toBeDisabled();
  } else {
    await raw(page, copy).click();
    await expect(raw(page, copy)).toBeEnabled();
  }
  await expect(generate(page, copy)).toBeEnabled();
  expect(posts(run)).toHaveLength(expectedPosts);
  expect(run.fixture.ownedRows()).toHaveLength(1);
  expect(run.fixture.participationDays()).toBe(1);
  record(page, "repeated_raw_did_not_insert_or_add_participation");
}

test.afterEach(async ({ page }, info) => {
  const run = runs.get(page);
  if (!run) return;
  run.gates.forEach((held) => held.release()); run.fixture.releaseAll();
  await info.attach("sweet-summary-reconciliation-evidence", { contentType: "application/json",
    body: JSON.stringify({ events: run.events, finalSnapshot: run.fixture.snapshot(),
      scope: "Synthetic transport/rows only, not Supabase. No private cache or authorization epoch is inspected." }, null, 2) });
  expect(run.fixture.state.blockedExternal).toEqual([]);
  expect(run.fixture.state.unexpectedApi).toEqual([]);
  expect(run.fixture.state.consentPosts).toEqual([]);
  expect(run.fixture.state.otpSends).toBe(0);
  expect(run.fixture.state.otpVerifies).toBe(0);
});

for (const [prefix, locale, copy] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  test(`${locale} 协调读取失败不写null或假报成功，恢复读取后可重建S1确认`, async ({ page, baseURL }) => {
    const run = await setup(page, baseURL!, prefix, copy);
    const firstRow = await finishS1(page, copy, await startS1(page, copy));
    await restoreVerification(page, copy);
    const failed = holdRead(page, 503);
    await raw(page, copy).click();
    await expect.poll(() => failed.gate.held).toBe(true);
    expect(posts(run)).toHaveLength(1);
    await releaseRead(page, copy, failed);
    await expect(page.getByText(copy.checkIn.messages.persistenceUnavailable, { exact: true })).toBeVisible();
    await expect(completion(page, copy)).toHaveCount(0);
    expect(run.fixture.ownedRows()[0]).toMatchObject({ id: firstRow.id, ...first });
    expect(posts(run)).toHaveLength(1);
    record(page, "failed_reconciliation_preserved_S1_and_did_not_claim_success");
    const recovered = holdRead(page);
    await raw(page, copy).click();
    await expect.poll(() => recovered.gate.held).toBe(true);
    await releaseRead(page, copy, recovered);
    await expect(completion(page, copy)).toBeVisible();
    expect(run.fixture.ownedRows()[0]).toMatchObject({ id: firstRow.id, ...first });
    await repeatRaw(page, copy, 1);
    await accountReads(page, prefix, first);
  });

  test(`${locale} 授权恢复鲜读已更新S2，不得重放旧S1或再插入空版本`, async ({ page, baseURL }) => {
    const run = await setup(page, baseURL!, prefix, copy);
    const firstRow = await finishS1(page, copy, await startS1(page, copy));
    await changeVerification(page, copy, 503);
    const newer = { ...structuredClone(firstRow), ...second, id: "00000000-0000-4000-8000-000000009002",
      created_at: new Date(Date.parse(firstRow.created_at) + 1).toISOString() };
    run.fixture.replacePersistedRows([newer]);
    record(page, "storage_side_completed_newer_S2", { note: "A controlled storage-side replacement models a separate completed version, not a React cache mutation or real database write." });
    await changeVerification(page, copy, 200);
    const read = holdRead(page);
    await raw(page, copy).click();
    await expect.poll(() => read.gate.held).toBe(true);
    expect(read.rows?.[0]).toMatchObject(second);
    await releaseRead(page, copy, read);
    expect(run.fixture.ownedRows()).toHaveLength(1);
    expect(run.fixture.ownedRows()[0]).toMatchObject({ id: newer.id, ...second });
    await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toHaveCount(0);
    await repeatRaw(page, copy, 1);
    await accountReads(page, prefix, second);
  });

  test(`${locale} 协调旧读期间真实编辑，旧S1回应不得确认新稿或阻止合法null`, async ({ page, baseURL }) => {
    const run = await setup(page, baseURL!, prefix, copy);
    const firstRow = await finishS1(page, copy, await startS1(page, copy));
    await restoreVerification(page, copy);
    const read = holdRead(page);
    await raw(page, copy).click();
    await expect.poll(() => read.gate.held).toBe(true);
    await page.getByRole("button", { name: copy.checkIn.actions.previous, exact: true }).click();
    await page.locator("main article button[aria-pressed]").nth(1).click();
    await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
    record(page, "real_answer_edit_while_old_reconciliation_response_held");
    await releaseRead(page, copy, read);
    await expect(completion(page, copy)).toHaveCount(0);
    await expect(page.getByText(first.summary!, { exact: true })).toHaveCount(0);
    expect(posts(run)).toHaveLength(1);
    expect(run.fixture.ownedRows()[0]).toMatchObject({ id: firstRow.id, ...first });
    await raw(page, copy).click();
    await expect(completion(page, copy)).toBeVisible();
    await expect(raw(page, copy)).toBeDisabled();
    expect(posts(run)).toHaveLength(2);
    expect(posts(run)[1].body!.records).not.toEqual(firstRow.records);
    expect(fields(run.fixture.ownedRows()[0])).toEqual(empty);
    await repeatRaw(page, copy, 2);
    await accountReads(page, prefix, empty);
  });

  test(`${locale} S1写入在途遇核验失败恢复，成功回执保留但不回填旧UI，后续鲜读协调`, async ({ page, baseURL }) => {
    const run = await setup(page, baseURL!, prefix, copy);
    const insert = await startS1(page, copy);
    await restoreVerification(page, copy);
    const firstRow = await finishS1(page, copy, insert, false);
    const read = holdRead(page);
    await raw(page, copy).click();
    await expect.poll(() => read.gate.held).toBe(true);
    await releaseRead(page, copy, read);
    expect(run.fixture.ownedRows()[0]).toMatchObject({ id: firstRow.id, ...first });
    expect(posts(run)).toHaveLength(1);
    await repeatRaw(page, copy, 1);
    await accountReads(page, prefix, first);
  });

  test(`${locale} 鲜读承认存储已有合法null，不得以旧S1确认回放覆盖`, async ({ page, baseURL }) => {
    const run = await setup(page, baseURL!, prefix, copy);
    const firstRow = await finishS1(page, copy, await startS1(page, copy));
    await changeVerification(page, copy, 503);
    const cleared = { ...structuredClone(firstRow), ...empty, id: "00000000-0000-4000-8000-000000009003",
      created_at: new Date(Date.parse(firstRow.created_at) + 1).toISOString() };
    run.fixture.replacePersistedRows([cleared]);
    record(page, "storage_side_completed_legal_null", { note: "A controlled storage replacement models a separate authorized completed clear; this scenario tests the client's reconciliation, not authorization of that external operation." });
    await changeVerification(page, copy, 200);
    const read = holdRead(page);
    await raw(page, copy).click();
    await expect.poll(() => read.gate.held).toBe(true);
    expect(fields(read.rows![0])).toEqual(empty);
    await releaseRead(page, copy, read);
    expect(run.fixture.ownedRows()).toHaveLength(1);
    expect(run.fixture.ownedRows()[0]).toMatchObject({ id: cleared.id, ...empty });
    await expect(completion(page, copy)).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toHaveCount(0);
    await repeatRaw(page, copy, 1);
    await accountReads(page, prefix, empty);
  });

  test(`${locale} 鲜读JSON对象键重排仍识别同值答案并保留S1`, async ({ page, baseURL }) => {
    const run = await setup(page, baseURL!, prefix, copy);
    const firstRow = await finishS1(page, copy, await startS1(page, copy));
    await changeVerification(page, copy, 503);
    const reorderedRecords = firstRow.records.map((item) => ({
      fields: item.fields.map((field) => ({ value: structuredClone(field.value), title: field.title, id: field.id })),
      label: item.label, title: item.title, id: item.id,
    }));
    expect(reorderedRecords).toEqual(firstRow.records);
    expect(JSON.stringify(reorderedRecords)).not.toBe(JSON.stringify(firstRow.records));
    run.fixture.replacePersistedRows([{ ...structuredClone(firstRow), records: reorderedRecords }]);
    record(page, "storage_json_object_keys_reordered_without_content_change");
    await changeVerification(page, copy, 200);
    const read = holdRead(page);
    await raw(page, copy).click();
    await expect.poll(() => read.gate.held).toBe(true);
    expect(read.rows![0].records).toEqual(firstRow.records);
    expect(JSON.stringify(read.rows![0].records)).not.toBe(JSON.stringify(firstRow.records));
    await releaseRead(page, copy, read);
    await expect(completion(page, copy)).toBeVisible();
    await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toBeDisabled();
    expect(run.fixture.ownedRows()[0]).toMatchObject({ id: firstRow.id, ...first });
    await repeatRaw(page, copy, 1);
    await accountReads(page, prefix, first);
  });
}
