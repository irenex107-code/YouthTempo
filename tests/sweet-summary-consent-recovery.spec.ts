import { createHash } from "node:crypto";
import { expect, test, type Page, type Response } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { sweetSummaryRow, syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

type Copy = typeof zh | typeof en;
type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
type Fields = { summary: string | null; small_step: string | null; recommended_next_tool: string | null };
type Gate = { held: boolean; settled: boolean; release: () => void; wait: Promise<void> };
type ConsentPlan = { status: number; label: string; gate: Gate };
type ConsentRead = { ordinal: number; status: number; label: string; responseBodyHash: string; completed: boolean };
type Event = { sequence: number; elapsedMs: number; at: string; event: string; detail: unknown };
type Scenario = "stable-success-control" | "recovered-raw-repeat" | "recovered-ai-fallback"
  | "continuous-failure-blocks-writes" | "recovered-real-edit-allows-null";
type Run = {
  fixture: Fixture; events: Event[]; consentReads: ConsentRead[]; successfulConsent: object;
  successfulConsentHash: string; unexpectedConsentMethods: string[]; gates: Gate[];
  pendingStorage: Set<object>; responseTasks: Promise<unknown>[]; observations: Record<string, unknown>;
  locale: string; scenario: Scenario;
};
const runs = new WeakMap<Page, Run>();
const s1: Fields = { summary: "SYNTHETIC_R02_CONFIRMED_S1", small_step: "SYNTHETIC_R02_STEP1", recommended_next_tool: "SYNTHETIC_R02_TOOL1" };
const empty: Fields = { summary: null, small_step: null, recommended_next_tool: null };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fields = (row: Partial<Fields>): Fields => ({ summary: row.summary ?? null,
  small_step: row.small_step ?? null, recommended_next_tool: row.recommended_next_tool ?? null });
const sweet = (response: Response, method: string) => response.request().method() === method
  && ["/api/sweet-records", "/rest/v1/sweet_records"].includes(new URL(response.url()).pathname);
const posts = (run: Run) => run.fixture.state.requests.filter((request) => request.method === "POST");
const panel = (page: Page) => page.getByTestId("inline-student-consent");
const rawButton = (page: Page, copy: Copy) => page.locator("main article").getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true });
const generateButton = (page: Page, copy: Copy) => page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true });

function mark(page: Page, event: string, detail: unknown = {}) {
  const run = runs.get(page)!;
  const elapsedMs = Number((performance.now() - (run.observations.started as number)).toFixed(3));
  run.events.push({ sequence: run.events.length + 1, elapsedMs, at: new Date().toISOString(), event, detail: structuredClone(detail) });
}
function gate(): Gate {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { held: false, settled: false, release, wait };
}
async function snapshot(page: Page, copy: Copy, event: string, detail: unknown = {}) {
  const run = runs.get(page)!;
  mark(page, event, { detail, rows: run.fixture.ownedRows(), postFields: posts(run).map((request) => fields(request.body!)),
    participationDays: run.fixture.participationDays(),
    ui: { consentReady: await panel(page).getByText(copy.inlineConsent.ready, { exact: true }).isVisible(),
      consentError: await panel(page).getByRole("alert").isVisible(),
      savedS1Label: await page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true }).isVisible(),
      s1Visible: await page.getByText(s1.summary!, { exact: true }).isVisible(),
      savedNotice: await page.getByText(copy.checkIn.messages.saved, { exact: true }).isVisible(),
      alreadySavedNotice: await page.getByText(copy.checkIn.messages.alreadySaved, { exact: true }).isVisible(),
    }, cachePrivateRefRead: false });
}

async function setup(page: Page, baseURL: string, prefix: string, locale: string, scenario: Scenario, copy: Copy) {
  const fixture = await syntheticSweetSummary(page, baseURL);
  // The original fixture creates studentAssentedAt with host new Date on each
  // GET. Freeze the entire successful body here, without changing that fixture.
  const successfulConsent = {
    role: "student", policyVersion: fixture.state.consentPolicy, children: [],
    consent: { studentUserId: fixture.state.user.id, studentName: fixture.state.user.user_metadata.display_name,
      ageBand: "14_17", policyVersion: fixture.state.consentPolicy, status: "active", consentBasis: "student_self_pilot",
      studentAssentedAt: "2026-10-01T02:00:00.000Z", guardianUserId: null, guardianConsentedAt: null,
      withdrawnAt: null, hasLinkedGuardian: false },
  };
  const run: Run = { fixture, events: [], consentReads: [], successfulConsent,
    successfulConsentHash: hash(successfulConsent), unexpectedConsentMethods: [], gates: [],
    pendingStorage: new Set(), responseTasks: [], observations: { started: performance.now() }, locale, scenario };
  runs.set(page, run);
  const plans: ConsentPlan[] = [];
  await page.route("**/api/account/consent", async (route) => {
    if (route.request().method() !== "GET") {
      run.unexpectedConsentMethods.push(route.request().method());
      return route.abort();
    }
    const plan = plans.shift();
    const status = plan?.status ?? 200;
    const responseBody = status === 200 ? successfulConsent : { error: "Synthetic consent verification unavailable" };
    const read: ConsentRead = { ordinal: run.consentReads.length + 1, status,
      label: plan?.label ?? "stable-active-default", responseBodyHash: hash(responseBody), completed: false };
    run.consentReads.push(read);
    mark(page, "consent_GET_received", read);
    if (plan) {
      plan.gate.held = true;
      mark(page, "consent_response_gate_held", { ordinal: read.ordinal, status, label: read.label });
      await plan.gate.wait;
    }
    try {
      await route.fulfill({ status, json: structuredClone(responseBody) });
      read.completed = true;
      mark(page, "consent_response_fulfilled", read);
    } finally { if (plan) plan.gate.settled = true; }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["/api/sweet-records", "/rest/v1/sweet_records"].includes(url.pathname)) {
      run.pendingStorage.add(request);
      mark(page, "SWEET_request_dispatched", { method: request.method(), query: [...url.searchParams.entries()],
        body: request.method() === "POST" ? request.postDataJSON() : undefined });
    }
    if (url.pathname === "/api/ai/check-in") mark(page, "AI_request_dispatched", request.postDataJSON());
  });
  page.on("requestfailed", (request) => { run.pendingStorage.delete(request); });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!["/api/sweet-records", "/rest/v1/sweet_records"].includes(url.pathname)) return;
    const task = response.finished().then((error) => {
      run.pendingStorage.delete(response.request());
      mark(page, "SWEET_response_finished", { method: response.request().method(), status: response.status(),
        finishedWithoutError: error === null });
    }).catch(() => { run.pendingStorage.delete(response.request()); });
    run.responseTasks.push(task);
  });
  await page.goto(`${prefix}/check-in`);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  for (let step = 0; step < 5; step++) {
    const progress = copy.checkIn.progress.step.replace("{{current}}", String(step + 1)).replace("{{total}}", "5");
    await expect(page.getByText(progress, { exact: true })).toBeVisible();
    await page.locator("main article button[aria-pressed]").first().click();
    if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
  }
  await expect(panel(page).getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
  expect(fixture.ownedRows()).toEqual([]);
  const insert = fixture.holdInsert();
  fixture.queueAi({ summary: s1.summary!, smallStep: s1.small_step!, tool: s1.recommended_next_tool! });
  await page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }).check();
  await generateButton(page, copy).click();
  await expect.poll(() => insert.held).toBe(true);
  expect(fixture.ownedRows()).toEqual([]);
  const responsePromise = page.waitForResponse((response) => sweet(response, "POST"));
  mark(page, "first_S1_insert_released_before_any_revalidation_failure");
  insert.release();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  expect(await response.finished()).toBeNull();
  const committed = sweetSummaryRow(await response.json());
  expect(fields(committed)).toEqual(s1);
  await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toBeDisabled();
  await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
  await expect(rawButton(page, copy)).toBeEnabled();
  await expect.poll(() => run.pendingStorage.size).toBe(0);
  expect(posts(run)).toHaveLength(1);
  expect(fixture.ownedRows()).toHaveLength(1);
  expect(fixture.ownedRows()[0]).toMatchObject({ id: committed.id, ...s1 });
  run.observations.initial = { rowId: committed.id, records: structuredClone(committed.records), actor: fixture.state.user.id,
    persistedFields: fields(committed), UIConfirmed: true, cacheRegistration: "Supported by successful current UI path in page.tsx, not a private ref read." };
  await snapshot(page, copy, "S1_persisted_and_UI_confirmed_before_revalidation", { id: committed.id, consentBodyHash: run.successfulConsentHash });

  async function verify(status: number, trigger: "focus" | "retry", label: string) {
    const held = gate(); run.gates.push(held); plans.push({ status, label, gate: held });
    mark(page, "revalidation_trigger_started", { trigger, status, label });
    if (trigger === "focus") await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    else await panel(page).getByRole("button", { name: copy.inlineConsent.retry, exact: true }).click();
    await expect.poll(() => held.held).toBe(true);
    if (trigger === "retry") await expect(panel(page).getByText(copy.inlineConsent.loading, { exact: true })).toBeVisible();
    const next = page.waitForResponse((reply) => new URL(reply.url()).pathname === "/api/account/consent");
    await snapshot(page, copy, "revalidation_gate_pending", { status, trigger, label });
    mark(page, "revalidation_gate_released", { status, label });
    held.release();
    const reply = await next;
    expect(reply.status()).toBe(status);
    expect(await reply.finished()).toBeNull();
    const body = await reply.json();
    if (status === 200) {
      expect(body).toEqual(successfulConsent);
      expect(hash(body)).toBe(run.successfulConsentHash);
      await expect(panel(page).getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
      await expect(panel(page).getByRole("alert")).toHaveCount(0);
    } else await expect(panel(page).getByRole("alert")).toBeVisible();
    await expect.poll(() => held.settled).toBe(true);
    const initial = run.observations.initial as { actor: string };
    expect(fixture.state.user.id).toBe(initial.actor);
    expect(fields(fixture.ownedRows()[0])).toEqual(s1);
    await snapshot(page, copy, "revalidation_response_and_UI_processed", { status, label, bodyHash: hash(body),
      actualConsentFieldsChanged: false, actorChanged: false, answersEdited: false });
  }
  return { run, verify };
}

async function rawSave(page: Page, copy: Copy, label: string, completedNull = false) {
  const run = runs.get(page)!;
  mark(page, "raw_save_click_started", { label, beforePosts: posts(run).length });
  if (completedNull && await rawButton(page, copy).isDisabled()) await rawButton(page, copy).dispatchEvent("click");
  else await rawButton(page, copy).click();
  // S1 stays visible in R02, so a real null write can finish with an empty
  // saveStatus. Use the real buttons' busy lifecycle and storage requests;
  // do not force a saved/alreadySaved notice that the defect does not emit.
  if (completedNull) await expect(rawButton(page, copy)).toBeDisabled();
  else await expect(rawButton(page, copy)).toBeEnabled();
  await expect(generateButton(page, copy)).toBeEnabled();
  await expect.poll(() => run.pendingStorage.size).toBe(0);
  await snapshot(page, copy, "raw_save_UI_nonbusy_and_storage_responses_complete", { label });
}
async function accountReads(page: Page, prefix: string, copy: Copy) {
  const run = runs.get(page)!;
  const read: Fields[] = [];
  for (const mode of ["navigate", "reload", "reenter"] as const) {
    if (mode === "reenter") await page.goto(`${prefix}/check-in`);
    const next = page.waitForResponse((response) => sweet(response, "GET"));
    mark(page, "account_read_started", { mode });
    if (mode === "reload") await page.reload();
    else await page.goto(`${prefix}/account#records`);
    const response = await next;
    expect(response.status()).toBe(200);
    expect(await response.finished()).toBeNull();
    const rows = await response.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(run.fixture.ownedRows()[0].id);
    expect(rows[0].records).toEqual(run.fixture.ownedRows()[0].records);
    await expect(page.locator("#records article")).toHaveCount(1);
    if (rows[0].summary) await expect(page.locator("#records").getByText(rows[0].summary, { exact: true })).toBeVisible();
    else await expect(page.locator("#records")).not.toContainText(s1.summary!);
    read.push(fields(rows[0]));
    await snapshot(page, copy, "account_GET_and_UI_complete", { mode, readRows: rows });
  }
  return read;
}

test.afterEach(async ({ page }, info) => {
  const run = runs.get(page);
  if (!run) return;
  run.gates.forEach((held) => held.release()); run.fixture.releaseAll();
  await Promise.allSettled(run.responseTasks);
  await info.attach("r02-consent-recovery-evidence", { contentType: "application/json",
    body: JSON.stringify({ locale: run.locale, scenario: run.scenario, events: run.events,
      consentReads: run.consentReads, successfulConsent: run.successfulConsent, successfulConsentHash: run.successfulConsentHash,
      observations: run.observations, finalSnapshot: run.fixture.snapshot(),
      cacheScope: "Private ref/epoch not directly inspected; separate UI snapshots, fixed consent transport, actual storage writes and fresh GETs support source-based cache inference.",
      storageScope: "Existing synthetic rows, not real Supabase/PostgreSQL." }, null, 2) });
  expect(run.consentReads.filter((read) => read.status === 200).every((read) => read.responseBodyHash === run.successfulConsentHash)).toBe(true);
  expect(run.unexpectedConsentMethods).toEqual([]);
  expect(run.fixture.state.consentPosts).toEqual([]);
  expect(run.fixture.state.blockedExternal).toEqual([]);
  expect(run.fixture.state.unexpectedApi).toEqual([]);
  expect(run.fixture.state.otpSends).toBe(0);
  expect(run.fixture.state.otpVerifies).toBe(0);
});

const scenarios: Scenario[] = ["stable-success-control", "recovered-raw-repeat", "recovered-ai-fallback",
  "continuous-failure-blocks-writes", "recovered-real-edit-allows-null"];
for (const [prefix, locale, copy] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  for (const scenario of scenarios) {
    test(`R02 ${locale} ${scenario}`, async ({ page, baseURL }) => {
      test.setTimeout(45_000);
      const { run, verify } = await setup(page, baseURL!, prefix, locale, scenario, copy);
      const initial = run.observations.initial as { rowId: string; records: unknown; actor: string };
      if (scenario === "stable-success-control") {
        await verify(200, "focus", "same-active-success-control");
      } else {
        await verify(503, "focus", "transient-verification-failure");
        if (scenario === "continuous-failure-blocks-writes") {
          for (let attempt = 1; attempt <= 2; attempt++) {
            if (attempt === 2) await verify(503, "retry", "second-consecutive-verification-failure");
            const beforeAi = run.fixture.state.aiRequests.length;
            await rawSave(page, copy, `denied-raw-${attempt}`);
            await expect(page.getByText(copy.inlineConsent.consentNeeded, { exact: true }).first()).toBeVisible();
            await generateButton(page, copy).click();
            expect(run.fixture.state.aiRequests).toHaveLength(beforeAi);
            expect(posts(run)).toHaveLength(1);
            expect(fields(run.fixture.ownedRows()[0])).toEqual(s1);
            await snapshot(page, copy, "consecutive_failure_prevented_raw_and_AI_writes", { attempt });
          }
          await verify(200, "retry", "recover_only_for_reading_no_post_recovery_submission");
        } else await verify(200, "retry", "restore_identical_active_consent");
      }

      if (scenario === "recovered-real-edit-allows-null") {
        await page.getByRole("button", { name: copy.checkIn.actions.previous, exact: true }).click();
        await page.locator("main article button[aria-pressed]").nth(1).click();
        await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
        await snapshot(page, copy, "real_answer_edit_explicitly_creates_new_draft");
      }
      if (scenario === "recovered-ai-fallback") {
        const held = run.fixture.queueAi({ status: 503, hold: true });
        await expect(page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true })).toBeChecked();
        await generateButton(page, copy).click();
        await expect.poll(() => held.held).toBe(true);
        const next = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/ai/check-in");
        mark(page, "new_AI_failure_gate_released"); held.release();
        const response = await next;
        expect(response.status()).toBe(503);
        expect(await response.finished()).toBeNull();
        await expect(page.getByText("Synthetic summary unavailable", { exact: true })).toBeVisible();
        await expect(generateButton(page, copy)).toBeEnabled();
        await expect(rawButton(page, copy)).toBeEnabled();
        await expect.poll(() => run.pendingStorage.size).toBe(0);
        await snapshot(page, copy, "AI503_fallback_and_busy_complete");
        await rawSave(page, copy, "repeat-same-answers-after-fallback");
      } else if (scenario !== "continuous-failure-blocks-writes") {
        await rawSave(page, copy, "first-post-revalidation-raw", scenario === "recovered-real-edit-allows-null");
        await rawSave(page, copy, "repeat-identical-draft-raw", scenario === "recovered-real-edit-allows-null");
      }

      const expected = scenario === "recovered-real-edit-allows-null" ? empty : s1;
      const afterActions = fields(run.fixture.ownedRows()[0]);
      const actionPosts = structuredClone(posts(run));
      if (scenario === "recovered-real-edit-allows-null") expect(actionPosts.at(-1)!.body!.records).not.toEqual(initial.records);
      else actionPosts.forEach((request) => expect(request.body!.records).toEqual(initial.records));
      expect(run.fixture.ownedRows()).toHaveLength(1);
      expect(run.fixture.participationDays()).toBe(1);
      const reads = await accountReads(page, prefix, copy);
      const actual = { afterActions, accountNavigation: reads[0], accountReload: reads[1], accountReentry: reads[2] };
      const finalRowId = run.fixture.ownedRows()[0].id;
      run.observations.final = { actual, expected, targetSequenceCompleted: true,
        initialRowId: initial.rowId, finalRowId, postCount: actionPosts.length,
        deleteCount: run.fixture.state.requests.filter((request) => request.method === "DELETE").length,
        participationDays: run.fixture.participationDays(),
        preservationHolds: Object.values(actual).every((value) => JSON.stringify(value) === JSON.stringify(expected)),
        sameSuccessfulConsentBodyEveryTime: true, consentFailureCount: run.consentReads.filter((read) => read.status === 503).length };
      mark(page, "final_business_oracle_after_navigation_reload_and_reentry", run.observations.final);
      // A correct implementation passes. Do not assert that data loss must occur.
      expect(actual, "Confirmed S1 must survive verification failure/recovery unless a real new answer draft is saved")
        .toEqual({ afterActions: expected, accountNavigation: expected, accountReload: expected, accountReentry: expected });
      expect(actionPosts).toHaveLength(scenario === "recovered-real-edit-allows-null" ? 2 : 1);
      if (scenario === "recovered-real-edit-allows-null") expect(finalRowId).not.toBe(initial.rowId);
      else expect(finalRowId).toBe(initial.rowId);
    });
  }
}
