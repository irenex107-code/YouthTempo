import { createHash } from "node:crypto";
import { expect, test, type Page, type Response } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { sweetSummaryRow, syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

type Copy = typeof zh | typeof en;
type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
type Row = ReturnType<Fixture["ownedRows"]>[number];
type Fields = Pick<Row, "summary" | "small_step" | "recommended_next_tool">;
type Gate = { held: boolean; settled: boolean; wait: Promise<void>; release: () => void };
type ConsentPlan = { status: number; gate: Gate };
type Run = {
  fixture: Fixture; events: Array<{ sequence: number; elapsedMs: number; at: string; event: string; detail: unknown }>;
  started: number; locale: string; path: string; gates: Gate[]; consentPlans: ConsentPlan[];
  readPlans: Gate[]; consentReads: Array<{ status: number; hash: string }>; activeBody: object;
  pending: Set<object>; responseTasks: Promise<unknown>[]; observations: Record<string, unknown>;
};
type ReceiptGate = { armed: boolean; held: boolean; released: boolean; delivered: boolean; status: number; release: () => void };
const runs = new WeakMap<Page, Run>();
const s1: Fields = { summary: "SYNTHETIC_JOINT_PERSISTED_S1", small_step: "SYNTHETIC_JOINT_STEP1", recommended_next_tool: "SYNTHETIC_JOINT_TOOL1" };
const empty: Fields = { summary: null, small_step: null, recommended_next_tool: null };
const fields = (row: Partial<Fields>): Fields => ({ summary: row.summary ?? null,
  small_step: row.small_step ?? null, recommended_next_tool: row.recommended_next_tool ?? null });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const panel = (page: Page) => page.getByTestId("inline-student-consent");
const raw = (page: Page, copy: Copy) => page.locator("main article").getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true });
const generate = (page: Page, copy: Copy) => page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true });
const choice = (page: Page, copy: Copy) => page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true });
const completion = (page: Page, copy: Copy) => page.getByText(copy.checkIn.messages.saved, { exact: true })
  .or(page.getByText(copy.checkIn.messages.alreadySaved, { exact: true }));
const sweet = (response: Response, method: string) => response.request().method() === method
  && ["/api/sweet-records", "/rest/v1/sweet_records"].includes(new URL(response.url()).pathname);
const posts = (run: Run) => run.fixture.state.requests.filter((request) => request.method === "POST");
const deletes = (run: Run) => run.fixture.state.requests.filter((request) => request.method === "DELETE");

function gate(): Gate {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { held: false, settled: false, wait, release };
}
function mark(page: Page, event: string, detail: unknown = {}) {
  const run = runs.get(page)!;
  run.events.push({ sequence: run.events.length + 1, elapsedMs: Number((performance.now() - run.started).toFixed(3)),
    at: new Date().toISOString(), event, detail: structuredClone(detail) });
}
async function snapshot(page: Page, copy: Copy, event: string, detail: unknown = {}) {
  const run = runs.get(page)!;
  mark(page, event, { detail, rows: run.fixture.ownedRows(), postFields: posts(run).map((request) => fields(request.body!)),
    participationDays: run.fixture.participationDays(),
    ui: { ready: await panel(page).getByText(copy.inlineConsent.ready, { exact: true }).isVisible(),
      error: await panel(page).getByRole("alert").isVisible(), aiChecked: await choice(page, copy).isChecked(),
      s1Visible: await page.getByText(s1.summary!, { exact: true }).isVisible(),
      savedNotice: await completion(page, copy).isVisible() }, privateCacheInspected: false });
}
async function nonbusy(page: Page, copy: Copy, completedNull = false) {
  if (completedNull) await expect(raw(page, copy)).toBeDisabled();
  else await expect(raw(page, copy)).toBeEnabled();
  await expect(generate(page, copy)).toBeEnabled();
  await expect.poll(() => runs.get(page)!.pending.size).toBe(0);
}
async function fillAnswers(page: Page, copy: Copy, edited = false) {
  for (let step = 0; step < 5; step++) {
    await expect(page.getByText(copy.checkIn.progress.step.replace("{{current}}", String(step + 1)).replace("{{total}}", "5"), { exact: true })).toBeVisible();
    await page.locator("main article button[aria-pressed]").nth(edited && step === 3 ? 1 : 0).click();
    if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
  }
  await expect(panel(page).getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
}
async function setup(page: Page, baseURL: string, prefix: string, locale: string, path: string, copy: Copy) {
  const fixture = await syntheticSweetSummary(page, baseURL);
  const activeBody = { role: "student", policyVersion: fixture.state.consentPolicy, children: [],
    consent: { studentUserId: fixture.state.user.id, studentName: fixture.state.user.user_metadata.display_name,
      ageBand: "14_17", policyVersion: fixture.state.consentPolicy, status: "active", consentBasis: "student_self_pilot",
      studentAssentedAt: "2026-10-01T02:00:00.000Z", guardianUserId: null, guardianConsentedAt: null,
      withdrawnAt: null, hasLinkedGuardian: false } };
  const run: Run = { fixture, events: [], started: performance.now(), locale, path, gates: [], consentPlans: [],
    readPlans: [], consentReads: [], activeBody, pending: new Set(), responseTasks: [], observations: {} };
  runs.set(page, run);
  await page.route("**/api/account/consent", async (route) => {
    expect(route.request().method()).toBe("GET");
    const plan = run.consentPlans.shift();
    const status = plan?.status ?? 200;
    const body = status === 200 ? activeBody : { error: "Synthetic joint consent verification unavailable" };
    run.consentReads.push({ status, hash: hash(body) });
    if (plan) { plan.gate.held = true; mark(page, "consent_response_gate_held", { status }); await plan.gate.wait; }
    try { await route.fulfill({ status, json: structuredClone(body) });
      mark(page, "consent_response_fulfilled", { status, bodyHash: hash(body) });
    } finally { if (plan) plan.gate.settled = true; }
  });
  await page.route("**/api/sweet-records**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || url.searchParams.has("created_at") || !run.readPlans.length) return route.fallback();
    const actor = JSON.parse(Buffer.from(route.request().headers().authorization.replace(/^Bearer\s+/i, "").split(".")[1], "base64url").toString()).sub;
    expect(actor).toBe(fixture.state.user.id);
    const capturedScope = fixture.scope(actor, url.searchParams.get("targetDay") || undefined);
    expect(capturedScope.status).toBe("ready");
    const held = run.readPlans.shift()!;
    const rows = structuredClone(fixture.ownedRows()).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 50);
    held.held = true;
    mark(page, "reconciliation_GET_held", { query: [...url.searchParams.entries()], rows });
    await held.wait;
    try { await route.fulfill({ json: capturedScope }); mark(page, "reconciliation_GET_fulfilled", { rows }); }
    finally { held.settled = true; }
  });
  // Transport-only gate: the original fixture commits and returns a genuine
  // synthetic 201 first. Delay delivery of that Response to the SDK, which uses
  // response.text(), rather than changing payloads, helper code or React refs.
  // Every navigation starts disarmed, so a later legal null is never held.
  await page.addInitScript(() => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const control: ReceiptGate = { armed: false, held: false, released: false, delivered: false, status: 0,
      release: () => { control.released = true; release(); } };
    (window as typeof window & { sweetJointReceipt: ReceiptGate }).sweetJointReceipt = control;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (control.armed && method === "POST" && ["/api/sweet-records", "/rest/v1/sweet_records"].includes(new URL(url, location.href).pathname) && response.status === 201) {
        control.armed = false; control.held = true; control.status = response.status;
        await wait;
        control.delivered = true;
      }
      return response;
    };
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["/api/sweet-records", "/rest/v1/sweet_records"].includes(url.pathname)) {
      run.pending.add(request);
      mark(page, "SWEET_request_dispatched", { method: request.method(), query: [...url.searchParams.entries()],
        body: request.method() === "POST" ? request.postDataJSON() : undefined });
    }
    if (url.pathname === "/api/ai/check-in") mark(page, "AI_request_dispatched", request.postDataJSON());
  });
  page.on("requestfailed", (request) => { run.pending.delete(request); });
  page.on("response", (response) => {
    if (!["/api/sweet-records", "/rest/v1/sweet_records"].includes(new URL(response.url()).pathname)) return;
    const task = response.finished().then((error) => {
      run.pending.delete(response.request());
      mark(page, "SWEET_network_response_finished", { method: response.request().method(), status: response.status(), noError: error === null });
    }).catch(() => { run.pending.delete(response.request()); });
    run.responseTasks.push(task);
  });
  await page.goto(`${prefix}/check-in`);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await fillAnswers(page, copy);
  return run;
}
async function verify(page: Page, copy: Copy, status: number) {
  const run = runs.get(page)!; const held = gate();
  run.gates.push(held); run.consentPlans.push({ status, gate: held });
  if (status === 503) await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  else await panel(page).getByRole("button", { name: copy.inlineConsent.retry, exact: true }).click();
  await expect.poll(() => held.held).toBe(true);
  if (status === 200) await expect(panel(page).getByText(copy.inlineConsent.loading, { exact: true })).toBeVisible();
  const next = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/account/consent");
  mark(page, "consent_gate_released", { status }); held.release();
  const response = await next;
  expect(response.status()).toBe(status); expect(await response.finished()).toBeNull();
  if (status === 200) {
    expect(await response.json()).toEqual(run.activeBody);
    await expect(panel(page).getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
  } else await expect(panel(page).getByRole("alert")).toBeVisible();
  await expect.poll(() => held.settled).toBe(true);
  await snapshot(page, copy, "consent_response_processed", { status });
}
async function readAccount(page: Page, prefix: string, expected: Fields, rowId: string, phase: string) {
  const run = runs.get(page)!; const reads: Fields[] = [];
  for (const mode of ["navigate", "reload", "reenter"] as const) {
    if (mode === "reenter") await page.goto(`${prefix}/check-in`);
    const next = page.waitForResponse((response) => sweet(response, "GET"));
    if (mode === "reload") await page.reload(); else await page.goto(`${prefix}/account#records`);
    const response = await next;
    expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
    const rows = await response.json() as Row[];
    expect(rows).toHaveLength(1); expect(rows[0].id).toBe(rowId);
    expect(rows[0].records).toEqual(run.fixture.ownedRows()[0].records);
    expect(fields(rows[0])).toEqual(expected);
    await expect(page.locator("#records article")).toHaveCount(1);
    if (expected.summary) await expect(page.locator("#records").getByText(expected.summary, { exact: true })).toBeVisible();
    else await expect(page.locator("#records")).not.toContainText(s1.summary!);
    reads.push(fields(rows[0]));
    mark(page, "account_GET_and_UI_complete", { phase, mode, rows });
  }
  return reads;
}

test.afterEach(async ({ page }, info) => {
  const run = runs.get(page); if (!run) return;
  run.gates.forEach((held) => held.release()); run.fixture.releaseAll();
  if (!page.isClosed()) await page.evaluate(() => (window as typeof window & { sweetJointReceipt?: ReceiptGate }).sweetJointReceipt?.release()).catch(() => {});
  await Promise.allSettled(run.responseTasks);
  await info.attach("sweet-joint-race-evidence", { contentType: "application/json", body: JSON.stringify({
    locale: run.locale, path: run.path, events: run.events, observations: run.observations,
    consentReads: run.consentReads, activeBodyHash: hash(run.activeBody), finalSnapshot: run.fixture.snapshot(),
    scope: "Synthetic transport and storage only. The gate delays SDK fetch delivery after network201, not React/cache state. Cache registration is source/behavior inference. Legal edit controls are separate from the S1 joint-race endpoint. No actor switch occurs." }, null, 2) });
  expect(run.consentReads.filter((read) => read.status === 200).every((read) => read.hash === hash(run.activeBody))).toBe(true);
  expect(run.fixture.state.blockedExternal).toEqual([]); expect(run.fixture.state.unexpectedApi).toEqual([]);
  expect(run.fixture.state.consentPosts).toEqual([]);
  expect(run.fixture.state.otpSends).toBe(0); expect(run.fixture.state.otpVerifies).toBe(0);
});

for (const [prefix, locale, copy] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  for (const path of ["raw", "ai-failure-fallback"] as const) {
    test(`${locale} R01+R02联合 ${path}：已存S1后取消AI及核验503恢复不丢小结`, async ({ page, baseURL }) => {
      test.setTimeout(75_000);
      const run = await setup(page, baseURL!, prefix, locale, path, copy);
      expect(run.fixture.ownedRows()).toEqual([]);
      const insert = run.fixture.holdInsert();
      await page.evaluate(() => { (window as typeof window & { sweetJointReceipt: ReceiptGate }).sweetJointReceipt.armed = true; });
      run.fixture.queueAi({ summary: s1.summary!, smallStep: s1.small_step!, tool: s1.recommended_next_tool! });
      await choice(page, copy).check(); await generate(page, copy).click();
      await expect.poll(() => insert.held).toBe(true);
      expect(run.fixture.ownedRows()).toEqual([]);
      mark(page, "first_INSERT_dispatched_precommit_gate_held");
      const firstResponse = page.waitForResponse((response) => sweet(response, "POST"));
      insert.release();
      const response = await firstResponse;
      expect(response.status()).toBe(201); expect(await response.finished()).toBeNull();
      const first = sweetSummaryRow(await response.json());
      await page.waitForFunction(() => (window as typeof window & { sweetJointReceipt: ReceiptGate }).sweetJointReceipt.held);
      expect(fields(first)).toEqual(s1); expect(run.fixture.ownedRows()).toHaveLength(1);
      expect(run.fixture.ownedRows()[0]).toMatchObject({ id: first.id, ...s1 });
      expect(await page.evaluate(() => (window as typeof window & { sweetJointReceipt: ReceiptGate }).sweetJointReceipt.delivered)).toBe(false);
      await expect(completion(page, copy)).toHaveCount(0);
      await snapshot(page, copy, "S1_committed_network201_complete_SDK_delivery_held", { rowId: first.id,
        storageSucceeded: true, browserNetwork201: true, SDKResponseDelivered: false, cacheRegistered: "Not yet: save helper awaits held fetch response; no React ref inspected." });

      await choice(page, copy).uncheck();
      await expect(choice(page, copy)).not.toBeChecked();
      await expect(page.getByText(s1.summary!, { exact: true })).toHaveCount(0);
      await snapshot(page, copy, "AI_choice_changed_after_commit_before_SDK_ack", { actorUnchanged: true, answersUnchanged: true });
      await verify(page, copy, 503);
      expect(fields(run.fixture.ownedRows()[0])).toEqual(s1);
      mark(page, "SDK_success_delivery_released_while_consent_error");
      await page.evaluate(() => (window as typeof window & { sweetJointReceipt: ReceiptGate }).sweetJointReceipt.release());
      await page.waitForFunction(() => (window as typeof window & { sweetJointReceipt: ReceiptGate }).sweetJointReceipt.delivered);
      await nonbusy(page, copy);
      await expect(completion(page, copy)).toHaveCount(0);
      await expect(page.getByText(s1.summary!, { exact: true })).toHaveCount(0);
      await snapshot(page, copy, "old_success_settled_but_no_old_UI_confirmation", { cacheRegistration: "Success receipt retained per current source; UI and old access closure remain invalid. Later gated GET proves recovery path, not direct cache read." });

      const aiBefore = run.fixture.state.aiRequests.length;
      await raw(page, copy).click();
      await expect(page.getByText(copy.inlineConsent.consentNeeded, { exact: true }).first()).toBeVisible();
      await choice(page, copy).check();
      await expect(choice(page, copy)).toBeChecked();
      await expect(generate(page, copy)).toBeEnabled();
      await generate(page, copy).click();
      await expect(page.locator("main article").getByText(copy.inlineConsent.consentNeeded, { exact: true })).toBeVisible();
      await nonbusy(page, copy);
      expect(run.fixture.state.aiRequests).toHaveLength(aiBefore);
      expect(posts(run)).toHaveLength(1); expect(deletes(run)).toHaveLength(0);
      expect(fields(run.fixture.ownedRows()[0])).toEqual(s1);
      await snapshot(page, copy, "consent503_denied_new_raw_and_AI_with_AI_checked_and_no_busy", { attemptedRaw: true, attemptedAI: true, AIRequests: aiBefore });
      await verify(page, copy, 200);

      const readGate = gate(); run.gates.push(readGate);
      if (path === "raw") { run.readPlans.push(readGate); await raw(page, copy).click(); }
      else {
        const ai = run.fixture.queueAi({ status: 503, hold: true });
        await generate(page, copy).click();
        await expect.poll(() => ai.held).toBe(true);
        // The AI operation now has an independent pre-provider scope read.
        // Arm only its later preservation/reconciliation read.
        run.readPlans.push(readGate);
        const failed = page.waitForResponse((reply) => new URL(reply.url()).pathname === "/api/ai/check-in");
        mark(page, "post_recovery_AI_failure_gate_released"); ai.release();
        const failedResponse = await failed;
        expect(failedResponse.status()).toBe(503); expect(await failedResponse.finished()).toBeNull();
        await expect(page.getByText("Synthetic summary unavailable", { exact: true })).toBeVisible();
      }
      await expect.poll(() => readGate.held).toBe(true);
      expect(posts(run)).toHaveLength(1); expect(fields(run.fixture.ownedRows()[0])).toEqual(s1);
      const read = page.waitForResponse((reply) => sweet(reply, "GET") && !new URL(reply.url()).searchParams.has("created_at"));
      mark(page, "fresh_read_gate_released_after_both_invalidations"); readGate.release();
      const readResponse = await read;
      expect(readResponse.status()).toBe(200); expect(await readResponse.finished()).toBeNull();
      expect(sweetSummaryRow(await readResponse.json())).toMatchObject({ id: first.id, ...s1 });
      await nonbusy(page, copy); await expect(completion(page, copy)).toBeVisible();
      await raw(page, copy).click(); await nonbusy(page, copy);
      expect(posts(run)).toHaveLength(1); expect(deletes(run)).toHaveLength(0);
      expect(run.fixture.ownedRows()).toHaveLength(1); expect(run.fixture.participationDays()).toBe(1);
      expect(run.fixture.ownedRows()[0]).toMatchObject({ id: first.id, ...s1, records: first.records });
      expect(run.fixture.state.aiRequests).toHaveLength(path === "raw" ? 1 : 2);
      await snapshot(page, copy, "joint_race_storage_endpoint_S1_retained_before_any_legal_edit");
      const reads = await readAccount(page, prefix, s1, first.id, "joint-race-S1");
      run.observations.jointEndpoint = { rowId: first.id, fields: s1, accountReads: reads,
        POST: posts(run).length, DELETE: deletes(run).length, participationDays: run.fixture.participationDays(),
        actor: run.fixture.state.user.id, source: "actual helper reads from synthetic storage" };
      mark(page, "joint_race_oracle_passed_S1_after_all_three_reads", run.observations.jointEndpoint);

      // Explicitly separate this authorized new-draft control from the joint
      // oracle above: an intentional null with DIFFERENT answers is allowed.
      // Only raw cases run the control, yielding one Chinese/English control
      // within the four approved test definitions, not additional test cases.
      if (path === "raw") {
        await page.goto(`${prefix}/check-in`); await fillAnswers(page, copy, true);
        const cleared = page.waitForResponse((reply) => sweet(reply, "POST"));
        mark(page, "legal_new_draft_clear_started_after_S1_acceptance_reads");
        await raw(page, copy).click();
        const clearResponse = await cleared;
        expect(clearResponse.status()).toBe(201); expect(await clearResponse.finished()).toBeNull();
        const next = sweetSummaryRow(await clearResponse.json());
        await nonbusy(page, copy, true); await expect(completion(page, copy)).toBeVisible();
        expect(next.records).not.toEqual(first.records); expect(next.id).not.toBe(first.id);
        expect(fields(next)).toEqual(empty); expect(posts(run)).toHaveLength(2); expect(deletes(run)).toHaveLength(1);
        expect(posts(run)[1].body!.records).not.toEqual(first.records);
        expect(run.fixture.ownedRows()).toHaveLength(1); expect(run.fixture.participationDays()).toBe(1);
        await raw(page, copy).dispatchEvent("click"); await nonbusy(page, copy, true); expect(posts(run)).toHaveLength(2);
        const clearReads = await readAccount(page, prefix, empty, next.id, "legal-new-draft-null");
        run.observations.legalClearEndpoint = { rowId: next.id, fields: empty, answersChanged: true,
          accountReads: clearReads, POST: posts(run).length, DELETE: deletes(run).length, participationDays: run.fixture.participationDays() };
        mark(page, "legal_clear_oracle_passed_not_joint_data_loss", run.observations.legalClearEndpoint);
      }
    });
  }
}
