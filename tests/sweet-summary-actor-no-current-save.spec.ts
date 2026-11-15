import { createHash } from "node:crypto";
import { expect, test, type Page, type Request as PlaywrightRequest, type Response } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { sweetSummaryRow, syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

type Copy = typeof zh | typeof en;
type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
type Row = ReturnType<Fixture["ownedRows"]>[number];
type Actor = "A" | "B";
type Gate = { armed: boolean; held: boolean; delivered: boolean; consumed: boolean; release: () => void };
type Run = {
  fixture: Fixture; locale: string; users: Record<Actor, Fixture["state"]["user"]>; ids: Record<Actor, string>;
  actorGeneration: number; started: number; oldRequest?: PlaywrightRequest;
  events: Array<{ sequence: number; elapsedMs: number; event: string; detail: unknown }>;
  pending: Set<PlaywrightRequest>; responseTasks: Promise<unknown>[]; observations: Record<string, unknown>;
};
const runs = new WeakMap<Page, Run>();
const oldA = { summary: "SYNTHETIC_C14_A_COMMITTED_S1", small_step: "SYNTHETIC_C14_A_STEP", recommended_next_tool: "SYNTHETIC_C14_A_TOOL" };
const savedB = { summary: "SYNTHETIC_C14_B_BASELINE", small_step: "SYNTHETIC_C14_B_STEP", recommended_next_tool: "SYNTHETIC_C14_B_TOOL" };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const subject = (request: PlaywrightRequest) => JSON.parse(Buffer.from(request.headers().authorization.replace(/^Bearer\s+/i, "").split(".")[1], "base64url").toString()).sub as string;
const isSweet = (request: PlaywrightRequest) => ["/api/sweet-records", "/rest/v1/sweet_records"].includes(new URL(request.url()).pathname);
const raw = (page: Page, copy: Copy) => page.locator("main article").getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true });
const generate = (page: Page, copy: Copy) => page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true });
const posts = (run: Run) => run.fixture.state.protocolRequests.filter((request) => request.method === "POST");
const rows = (run: Run, actor: Actor) => structuredClone(run.fixture.state.rows.filter((row) => row.user_id === run.ids[actor]));
const heads = (run: Run, actor: Actor) => structuredClone(run.fixture.state.heads.filter((head) => head.userId === run.ids[actor]));

function mark(page: Page, event: string, detail: unknown = {}) {
  const run = runs.get(page)!;
  run.events.push({ sequence: run.events.length + 1, elapsedMs: Number((performance.now() - run.started).toFixed(3)), event,
    detail: structuredClone({ detail, actorGeneration: run.actorGeneration, currentActor: run.fixture.state.user.id,
      modelNow: run.fixture.state.now, sourceA: rows(run, "A"), sourceB: rows(run, "B"),
      headsA: heads(run, "A"), headsB: heads(run, "B") }) });
}
async function uiSnapshot(page: Page, copy: Copy, event: string, detail: unknown = {}) {
  mark(page, event, { detail, ui: {
    oldSummary: await page.getByText(oldA.summary, { exact: true }).isVisible(),
    savedResult: await page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true }).isVisible(),
    savedStatus: await page.getByText(copy.checkIn.messages.saved, { exact: true }).isVisible(),
    alreadySavedStatus: await page.getByText(copy.checkIn.messages.alreadySaved, { exact: true }).isVisible(),
    selectedAnswer: await page.locator("main article button[aria-pressed=true]").allTextContents(),
  }, privateReactStateRead: false });
}
async function taskBarrier(page: Page) {
  // A queued task follows the old fetch/body promise continuations. No timer
  // controls the race; the gate and observable body consumption do.
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  }));
}
async function fill(page: Page, copy: Copy, option: number) {
  const choices: Array<{ step: number; option: number; selectedText: string }> = [];
  for (let step = 0; step < 5; step++) {
    await expect(page.getByText(copy.checkIn.progress.step.replace("{{current}}", String(step + 1)).replace("{{total}}", "5"), { exact: true })).toBeVisible();
    const answer = page.locator("main article button[aria-pressed]").nth(option);
    await answer.focus(); await answer.press("Space");
    await expect(answer).toHaveAttribute("aria-pressed", "true");
    choices.push({ step: step + 1, option, selectedText: (await answer.innerText()).trim() });
    if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
  }
  await expect(page.getByTestId("inline-student-consent").getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
  await expect(raw(page, copy)).toBeEnabled(); await expect(generate(page, copy)).toBeEnabled();
  mark(page, "five_required_answers_completed_via_UI", { choices });
  return choices;
}
async function changeActor(page: Page, actor: Actor) {
  const run = runs.get(page)!;
  run.fixture.state.user = structuredClone(run.users[actor]);
  run.fixture.state.consentOwner = run.ids[actor]; run.fixture.state.consentState = "active";
  run.fixture.state.signedIn = true;
  ++run.actorGeneration;
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: run.ids[actor], exp: expiresAt, role: "authenticated" })).toString("base64url");
  const session = { access_token: `${header}.${payload}.synthetic-c14-${run.actorGeneration}`, refresh_token: "synthetic-c14-refresh",
    token_type: "bearer", expires_at: expiresAt, expires_in: 3600, user: run.fixture.state.user };
  mark(page, "actor_switch_broadcast", { actor, actorId: run.ids[actor], sessionTokenHash: hash(session.access_token) });
  await page.evaluate(({ key, session }) => {
    localStorage.setItem(key, JSON.stringify(session));
    const channel = new BroadcastChannel(key); channel.postMessage({ event: "SIGNED_IN", session }); channel.close();
  }, { key: run.fixture.storageKey, session });
  await expect(page.locator("header")).toContainText(run.users[actor].user_metadata.display_name);
}
async function checkInActor(page: Page, copy: Copy, actor: Actor) {
  await changeActor(page, actor);
  await expect(page.locator("main article button[aria-pressed=true]")).toHaveCount(0);
  await expect(page.getByText(oldA.summary, { exact: true })).toHaveCount(0);
  await expect(page.getByText(savedB.summary, { exact: true })).toHaveCount(0);
  await uiSnapshot(page, copy, "mounted_check_in_actor_reset_observed", { actor });
}
async function setup(page: Page, baseURL: string, prefix: string, locale: string) {
  const fixture = await syntheticSweetSummary(page, baseURL);
  const users = { A: structuredClone(fixture.state.user), B: { ...structuredClone(fixture.state.user),
    id: "00000000-0000-4000-8000-000000000072", email: "inline-072@example.invalid", user_metadata: { display_name: "Second inline account" } } };
  const run: Run = { fixture, users, ids: { A: users.A.id, B: users.B.id }, locale, actorGeneration: 0,
    started: performance.now(), events: [], pending: new Set(), responseTasks: [], observations: {} };
  runs.set(page, run);
  // Explicit pre-existing model baseline for B makes accidental cross-actor
  // changes observable even though B performs no save in this test.
  fixture.replacePersistedRows([{ id: "00000000-0000-4000-8000-000000000074", user_id: users.B.id, school_id: null,
    created_at: fixture.state.now, ...savedB, records: ["sleep", "wake", "eat", "exercise", "task"].map((id) => ({
      id, title: id, label: "SYNTHETIC_C14_B_EXISTING", fields: [{ id: `${id}_field`, title: id, value: "SYNTHETIC_C14_B_EXISTING" }],
    })) }]);
  mark(page, "fixture_B_baseline_seeded_no_A_row_or_head");
  await page.route("**/api/account/consent", async (route) => {
    expect(route.request().method()).toBe("GET");
    const actor = subject(route.request()); expect([run.ids.A, run.ids.B]).toContain(actor);
    expect(actor).toBe(fixture.state.user.id);
    const user = actor === run.ids.A ? users.A : users.B;
    await route.fulfill({ json: { role: "student", policyVersion: fixture.state.consentPolicy, children: [],
      consent: { studentUserId: actor, studentName: user.user_metadata.display_name, ageBand: "14_17",
        policyVersion: fixture.state.consentPolicy, status: "active", consentBasis: "student_self_pilot",
        studentAssentedAt: "2026-10-01T02:00:00.000Z", guardianUserId: null, guardianConsentedAt: null,
        withdrawnAt: null, hasLinkedGuardian: false } } });
  });
  await page.addInitScript(() => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const control: Gate = { armed: false, held: false, delivered: false, consumed: false, release };
    (window as typeof window & { sweetC14OldAck: Gate }).sweetC14OldAck = control;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      const old = control.armed && method === "POST" && new URL(url, location.href).pathname === "/api/sweet-records";
      if (old) control.armed = false;
      const response = await original(input, init);
      if (old) {
        const text = response.text.bind(response); const json = response.json.bind(response);
        response.text = async () => { try { return await text(); } finally { control.consumed = true; } };
        response.json = async () => { try { return await json(); } finally { control.consumed = true; } };
        control.held = true; await wait; control.delivered = true;
      }
      return response;
    };
  });
  page.on("request", (request) => {
    if (!isSweet(request)) return;
    run.pending.add(request);
    if (request.method() === "POST" && !run.oldRequest) run.oldRequest = request;
    mark(page, "SWEET_request_dispatched", { method: request.method(), path: new URL(request.url()).pathname,
      actor: subject(request), authorizationHash: hash(request.headers().authorization),
      query: [...new URL(request.url()).searchParams.entries()], body: request.method() === "POST" ? request.postDataJSON() : undefined });
  });
  page.on("requestfailed", (request) => { run.pending.delete(request); });
  page.on("response", (response) => {
    if (!isSweet(response.request())) return;
    const task = response.finished().then(async (error) => {
      run.pending.delete(response.request());
      mark(page, "SWEET_network_response_complete", { method: response.request().method(), path: new URL(response.url()).pathname,
        actor: subject(response.request()), status: response.status(), noError: error === null,
        body: response.ok() ? await response.json() : undefined });
    }).catch(() => { run.pending.delete(response.request()); });
    run.responseTasks.push(task);
  });
  await page.goto(`${prefix}/check-in`); await expect(page.locator("html")).toHaveAttribute("lang", locale);
  return run;
}
async function accountResponse(page: Page, response: Response, actor: Actor, label: string, expected: Row) {
  const run = runs.get(page)!;
  expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
  const result = await response.json() as Row[];
  expect(subject(response.request())).toBe(run.ids[actor]);
  expect(result).toEqual([expected]);
  await expect(page.locator("#records article")).toHaveCount(1);
  await expect(page.locator("#records").getByText(expected.summary!, { exact: true })).toBeVisible();
  const other = actor === "A" ? savedB.summary : oldA.summary;
  await expect(page.locator("#records").getByText(other, { exact: true })).toHaveCount(0);
  mark(page, "fresh_account_actual_GET_and_UI_complete", { actor, label, responseRows: result });
  return result;
}
const accountGet = (run: Run, actor: Actor) => (response: Response) => response.request().method() === "GET"
  && new URL(response.url()).pathname === "/rest/v1/sweet_records" && subject(response.request()) === run.ids[actor];

test.afterEach(async ({ page }, info) => {
  const run = runs.get(page); if (!run) return;
  run.fixture.releaseAll();
  if (!page.isClosed()) await page.evaluate(() => (window as typeof window & { sweetC14OldAck?: Gate }).sweetC14OldAck?.release()).catch(() => {});
  await Promise.allSettled(run.responseTasks);
  await info.attach("r03-c14-actor-return-no-current-save-evidence", { contentType: "application/json", body: JSON.stringify({
    scenario: "C14: A S1 committed, ACK held; mounted A -> B -> A; current A answers changed and completed without saving; old ACK released.",
    locale: run.locale, events: run.events, observations: run.observations, finalSnapshot: run.fixture.snapshot(),
    scope: "Browser UI and real client helpers against the existing synthetic transport only. No real Supabase, OTP, AI provider, database, SQL/RLS/FK, or private React refs. Source created_at equals fixed fixture state.now; deterministic UUIDs identify model heads, not PostgreSQL transaction time. actorGeneration counts test-observed mounted actor transitions, not private application state. Network ACK arrives before the fetch delivery gate releases it to application code.",
  }, null, 2) });
  expect(run.fixture.state.blockedExternal).toEqual([]); expect(run.fixture.state.unexpectedApi).toEqual([]);
  expect(run.fixture.state.consentPosts).toEqual([]); expect(run.fixture.state.profileWrites).toEqual([]);
  expect(run.fixture.state.otpSends).toBe(0); expect(run.fixture.state.otpVerifies).toBe(0);
});

for (const [prefix, locale, copy] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  test(`${locale} C14 A→B→A新答案未保存：已提交S1的迟到ACK不确认当前稿，重新读账号仍为S1`, async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    const run = await setup(page, baseURL!, prefix, locale);
    const bRows = rows(run, "B"); const bHeads = heads(run, "B");
    const originalChoices = await fill(page, copy, 0);
    const insert = run.fixture.holdInsert();
    await page.evaluate(() => { (window as typeof window & { sweetC14OldAck: Gate }).sweetC14OldAck.armed = true; });
    run.fixture.queueAi({ summary: oldA.summary, smallStep: oldA.small_step, tool: oldA.recommended_next_tool });
    await page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }).check();
    const oldNetwork = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/sweet-records" && subject(response.request()) === run.ids.A, { timeout: 75_000 });
    await generate(page, copy).click(); await expect.poll(() => insert.held).toBe(true);
    expect(rows(run, "A")).toEqual([]); expect(heads(run, "A")).toEqual([]);
    const oldRequest = run.oldRequest!; const oldBody = structuredClone(oldRequest.postDataJSON());
    const oldHeaderHash = hash(oldRequest.headers().authorization); const oldBodyHash = hash(oldRequest.postData()!);
    expect(subject(oldRequest)).toBe(run.ids.A);
    expect(oldBody).toMatchObject({ operationDay: "2026-10-30", targetDay: "2026-10-30", expectedHead: null,
      intent: "replace_summary", record: { summary: oldA.summary, smallStep: oldA.small_step, recommendedNextTool: oldA.recommended_next_tool } });
    mark(page, "S1_request_captured_before_model_commit", { oldBody, oldHeaderHash, oldBodyHash, dispatchActorGeneration: 0 });
    insert.release(); const response = await oldNetwork;
    expect(response.status()).toBe(201); expect(await response.finished()).toBeNull();
    const acknowledgment = await response.json(); const committed = sweetSummaryRow(acknowledgment);
    expect(acknowledgment.status).toBe("accepted"); expect(acknowledgment.headToken).toBe(committed.id);
    expect(committed).toMatchObject({ user_id: run.ids.A, records: oldBody.record.records, created_at: run.fixture.state.now, ...oldA });
    await page.waitForFunction(() => (window as typeof window & { sweetC14OldAck: Gate }).sweetC14OldAck.held);
    expect(rows(run, "A")).toEqual([committed]);
    expect(heads(run, "A")).toEqual([{ userId: run.ids.A, targetDay: "2026-10-30", headToken: committed.id, recordId: committed.id }]);
    await uiSnapshot(page, copy, "S1_model_committed_ACK_held_before_actor_switch", { acknowledgment });

    await checkInActor(page, copy, "B"); await fill(page, copy, 1);
    expect(posts(run)).toHaveLength(1); expect(rows(run, "B")).toEqual(bRows); expect(heads(run, "B")).toEqual(bHeads);
    await uiSnapshot(page, copy, "B_answers_completed_without_save_B_baseline_unchanged");
    await checkInActor(page, copy, "A"); const currentChoices = await fill(page, copy, 2);
    expect(currentChoices.map((item) => item.selectedText)).not.toEqual(originalChoices.map((item) => item.selectedText));
    expect(run.actorGeneration).toBe(2); expect(posts(run)).toHaveLength(1); expect(run.fixture.state.aiRequests).toHaveLength(1);
    await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toHaveCount(0);
    await expect(page.getByText(copy.checkIn.messages.alreadySaved, { exact: true })).toHaveCount(0);
    await uiSnapshot(page, copy, "returned_A_new_current_answers_complete_no_save_no_AI", { originalChoices, currentChoices,
      oldDispatchActorGeneration: 0, currentActorGeneration: run.actorGeneration });
    expect(hash(oldRequest.headers().authorization)).toBe(oldHeaderHash); expect(hash(oldRequest.postData()!)).toBe(oldBodyHash);

    mark(page, "old_ACK_delivery_gate_released_after_unsaved_A_current_answers");
    await page.evaluate(() => (window as typeof window & { sweetC14OldAck: Gate }).sweetC14OldAck.release());
    await page.waitForFunction(() => (window as typeof window & { sweetC14OldAck: Gate }).sweetC14OldAck.consumed);
    await taskBarrier(page); await expect.poll(() => run.pending.size).toBe(0);
    await expect(raw(page, copy)).toBeEnabled(); await expect(generate(page, copy)).toBeEnabled();
    await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toHaveCount(0);
    await expect(page.getByText(copy.checkIn.messages.alreadySaved, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: copy.checkIn.result.title, exact: true })).toHaveCount(0);
    for (const value of Object.values(oldA)) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    await expect(page.locator("main article button[aria-pressed=true]")).toHaveText([currentChoices.at(-1)!.selectedText]);
    expect(posts(run)).toHaveLength(1); expect(posts(run)[0]).toMatchObject({ actor: run.ids.A, body: oldBody, result: acknowledgment });
    expect(run.fixture.state.aiRequests).toHaveLength(1);
    expect(rows(run, "A")).toEqual([committed]); expect(rows(run, "B")).toEqual(bRows); expect(heads(run, "B")).toEqual(bHeads);
    await uiSnapshot(page, copy, "old_ACK_body_consumed_current_A_still_unsaved_without_old_summary", { oldBodyHash, oldHeaderHash });

    const freshScope = await page.evaluate(async (key) => {
      const session = JSON.parse(localStorage.getItem(key)!);
      const reply = await fetch("/api/sweet-records", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      return { httpStatus: reply.status, body: await reply.json() };
    }, run.fixture.storageKey);
    expect(freshScope.httpStatus).toBe(200); expect(freshScope.body).toMatchObject({ status: "ready", headToken: committed.id, record: committed });
    mark(page, "actual_fresh_protocol_GET_reads_committed_S1_despite_unsaved_current_UI", freshScope);
    const aReads: Row[][] = [];
    for (const label of ["navigation", "reload", "reentry"] as const) {
      if (label === "reentry") await page.goto(`${prefix}/check-in`);
      const next = page.waitForResponse(accountGet(run, "A"));
      if (label === "reload") await page.reload(); else await page.goto(`${prefix}/account#records`);
      aReads.push(await accountResponse(page, await next, "A", label, committed));
    }
    const bRead = page.waitForResponse(accountGet(run, "B"));
    await changeActor(page, "B"); const actualB = await accountResponse(page, await bRead, "B", "mounted-account-B-unchanged", bRows[0]);
    const returnRead = page.waitForResponse(accountGet(run, "A"));
    await changeActor(page, "A"); aReads.push(await accountResponse(page, await returnRead, "A", "mounted-account-return-A", committed));
    expect(posts(run)).toHaveLength(1); expect(run.fixture.state.aiRequests).toHaveLength(1);
    expect(rows(run, "A")).toEqual([committed]); expect(rows(run, "B")).toEqual(bRows); expect(heads(run, "B")).toEqual(bHeads);
    run.observations.final = { committedS1: committed, aReads, freshScope, Bbaseline: bRows, actualB,
      oldRequestActor: subject(oldRequest), oldAuthorizationHashUnchanged: hash(oldRequest.headers().authorization) === oldHeaderHash,
      oldBodyHashUnchanged: hash(oldRequest.postData()!) === oldBodyHash, currentDraftNeverSaved: posts(run).length === 1,
      originalChoices, currentChoices, browserOnlyActorGenerationBeforeOldACK: 2 };
    mark(page, "all_fresh_owner_reads_confirm_S1_B_unchanged_current_draft_never_saved", run.observations.final);
  });
}
