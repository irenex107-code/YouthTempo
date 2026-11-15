import { createHash } from "node:crypto";
import { expect, test, type Page, type Request as PlaywrightRequest, type Response } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { sweetSummaryRow, syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

type Copy = typeof zh | typeof en;
type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
type Row = ReturnType<Fixture["ownedRows"]>[number];
type Fields = Pick<Row, "summary" | "small_step" | "recommended_next_tool">;
type Actor = "A" | "B";
type Mode = "late-write" | "late-response";
type Transport = { armed: boolean; mode: Mode; held: boolean; delivered: boolean; consumed: boolean; release: () => void };
type Run = { fixture: Fixture; mode: Mode; locale: string; ids: Record<Actor, string>;
  users: Record<Actor, Fixture["state"]["user"]>; oldRequest?: PlaywrightRequest; started: number;
  events: Array<{ sequence: number; elapsedMs: number; at: string; event: string; detail: unknown }>;
  pending: Set<PlaywrightRequest>; responseTasks: Promise<unknown>[]; observations: Record<string, unknown> };
const runs = new WeakMap<Page, Run>();
const oldA: Fields = { summary: "SYNTHETIC_ABA_A_OLD_S1", small_step: "SYNTHETIC_ABA_OLD_STEP", recommended_next_tool: "SYNTHETIC_ABA_OLD_TOOL" };
const newA: Fields = { summary: "SYNTHETIC_ABA_A_NEW_S2", small_step: "SYNTHETIC_ABA_NEW_STEP", recommended_next_tool: "SYNTHETIC_ABA_NEW_TOOL" };
const savedB: Fields = { summary: "SYNTHETIC_ABA_B_SAVED", small_step: "SYNTHETIC_ABA_B_STEP", recommended_next_tool: "SYNTHETIC_ABA_B_TOOL" };
const fields = (row: Partial<Fields>): Fields => ({ summary: row.summary ?? null, small_step: row.small_step ?? null,
  recommended_next_tool: row.recommended_next_tool ?? null });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const subject = (request: PlaywrightRequest) => JSON.parse(Buffer.from(request.headers().authorization.replace(/^Bearer\s+/i, "").split(".")[1], "base64url").toString()).sub as string;
const sweet = (response: Response, method: string, actor?: string) => response.request().method() === method
  && ["/api/sweet-records", "/rest/v1/sweet_records"].includes(new URL(response.url()).pathname) && (!actor || subject(response.request()) === actor);
const raw = (page: Page, copy: Copy) => page.locator("main article").getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true });
const generator = (page: Page, copy: Copy) => page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true });
const posts = (run: Run) => run.fixture.state.requests.filter((request) => request.method === "POST");
const rows = (run: Run, actor: Actor) => structuredClone(run.fixture.state.rows.filter((row) => row.user_id === run.ids[actor]));

function mark(page: Page, event: string, detail: unknown = {}) {
  const run = runs.get(page)!;
  run.events.push({ sequence: run.events.length + 1, elapsedMs: Number((performance.now() - run.started).toFixed(3)),
    at: new Date().toISOString(), event, detail: structuredClone(detail) });
}
async function snapshot(page: Page, copy: Copy, event: string, detail: unknown = {}) {
  const run = runs.get(page)!;
  mark(page, event, { detail, currentActor: run.fixture.state.user.id, A: rows(run, "A"), B: rows(run, "B"),
    posts: posts(run).map((request) => request.body),
    ui: { AoldVisible: await page.getByText(oldA.summary!, { exact: true }).isVisible(),
      AnewVisible: await page.getByText(newA.summary!, { exact: true }).isVisible(),
      BVisible: await page.getByText(savedB.summary!, { exact: true }).isVisible(),
      savedResult: await page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true }).isVisible() },
    privateCacheRead: false });
}
async function taskBarrier(page: Page) {
  // A queued task runs after the current promise continuation queue. The old
  // save's pre-read is empty, so after body consumption it has no cleanup I/O.
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  }));
}
async function currentFinished(page: Page, copy: Copy) {
  const run = runs.get(page)!;
  await expect(raw(page, copy)).toBeEnabled(); await expect(generator(page, copy)).toBeEnabled();
  await expect.poll(() => [...run.pending].filter((request) => request !== run.oldRequest).length).toBe(0);
}
async function fill(page: Page, copy: Copy, option: number) {
  for (let step = 0; step < 5; step++) {
    await expect(page.getByText(copy.checkIn.progress.step.replace("{{current}}", String(step + 1)).replace("{{total}}", "5"), { exact: true })).toBeVisible();
    const answer = page.locator("main article button[aria-pressed]").nth(option);
    // Keyboard activation avoids pointer coordinates moving during the page's
    // automatic smooth scroll. Confirm input before advancing the protocol.
    await answer.focus(); await answer.press("Space");
    await expect(answer).toHaveAttribute("aria-pressed", "true");
    if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
  }
  await expect(page.getByTestId("inline-student-consent").getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
  await expect(raw(page, copy)).toBeEnabled(); await expect(generator(page, copy)).toBeEnabled();
}
async function changeActor(page: Page, actor: Actor) {
  const run = runs.get(page)!;
  run.fixture.state.user = structuredClone(run.users[actor]);
  run.fixture.state.consentOwner = run.ids[actor]; run.fixture.state.consentState = "active";
  run.fixture.state.signedIn = true;
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: run.ids[actor], exp: expiresAt, role: "authenticated" })).toString("base64url");
  const session = { access_token: `${header}.${payload}.synthetic-aba-${run.events.length}`, refresh_token: "synthetic-aba-refresh",
    token_type: "bearer", expires_at: expiresAt, expires_in: 3600, user: run.fixture.state.user };
  mark(page, "actor_switch_broadcast", { actor, id: run.ids[actor], sessionTokenHash: hash(session.access_token) });
  await page.evaluate(({ key, session }) => {
    localStorage.setItem(key, JSON.stringify(session));
    const channel = new BroadcastChannel(key); channel.postMessage({ event: "SIGNED_IN", session }); channel.close();
  }, { key: run.fixture.storageKey, session });
  await expect(page.locator("header")).toContainText(run.users[actor].user_metadata.display_name);
}
async function checkInActor(page: Page, copy: Copy, actor: Actor) {
  await changeActor(page, actor);
  await expect(page.locator("main article button[aria-pressed=true]")).toHaveCount(0);
  await expect(page.getByText(oldA.summary!, { exact: true })).toHaveCount(0);
  await expect(page.getByText(savedB.summary!, { exact: true })).toHaveCount(0);
  await snapshot(page, copy, "check_in_actor_reset_observed", { actor });
}
async function save(page: Page, copy: Copy, result: Fields, actor: Actor) {
  const run = runs.get(page)!;
  run.fixture.queueAi({ summary: result.summary!, smallStep: result.small_step!, tool: result.recommended_next_tool! });
  await page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }).check();
  const next = page.waitForResponse((response) => sweet(response, "POST", run.ids[actor]));
  await generator(page, copy).click();
  const response = await next; expect(response.status()).toBe(201); expect(await response.finished()).toBeNull();
  const row = sweetSummaryRow(await response.json());
  expect(row.user_id).toBe(run.ids[actor]); expect(fields(row)).toEqual(result);
  await currentFinished(page, copy);
  await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toBeDisabled();
  await expect(page.getByText(result.summary!, { exact: true })).toBeVisible();
  await snapshot(page, copy, "current_actor_save_confirmed", { actor, row });
  return row;
}
async function setup(page: Page, baseURL: string, prefix: string, locale: string, mode: Mode, copy: Copy) {
  const fixture = await syntheticSweetSummary(page, baseURL);
  const users = { A: structuredClone(fixture.state.user), B: { ...structuredClone(fixture.state.user),
    id: "00000000-0000-4000-8000-000000000072", email: "inline-072@example.invalid", user_metadata: { display_name: "Second inline account" } } };
  const run: Run = { fixture, users, ids: { A: users.A.id, B: users.B.id }, mode, locale,
    started: performance.now(), events: [], pending: new Set(), responseTasks: [], observations: {} };
  runs.set(page, run);
  await page.route("**/api/account/consent", async (route) => {
    expect(route.request().method()).toBe("GET");
    const actor = subject(route.request()); expect([run.ids.A, run.ids.B]).toContain(actor);
    expect(actor).toBe(run.fixture.state.user.id);
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
    const control: Transport = { armed: false, mode: "late-write", held: false, delivered: false, consumed: false, release };
    (window as typeof window & { sweetAbaOld: Transport }).sweetAbaOld = control;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      // Tag at DISPATCH, not response time: B's response may arrive first.
      const old = control.armed && method === "POST" && ["/api/sweet-records", "/rest/v1/sweet_records"].includes(new URL(url, location.href).pathname);
      if (old) control.armed = false;
      const response = await original(input, init);
      if (old) {
        const text = response.text.bind(response); const json = response.json.bind(response);
        response.text = async () => { try { return await text(); } finally { control.consumed = true; } };
        response.json = async () => { try { return await json(); } finally { control.consumed = true; } };
        if (control.mode === "late-response") { control.held = true; await wait; }
        control.delivered = true;
      }
      return response;
    };
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["/api/sweet-records", "/rest/v1/sweet_records"].includes(url.pathname)) return;
    run.pending.add(request);
    if (request.method() === "POST" && !run.oldRequest) run.oldRequest = request;
    mark(page, "SWEET_request_dispatched", { method: request.method(), actor: subject(request),
      authorizationHash: hash(request.headers().authorization), query: [...url.searchParams.entries()],
      body: request.method() === "POST" ? request.postDataJSON() : undefined });
  });
  page.on("requestfailed", (request) => { run.pending.delete(request); });
  page.on("response", (response) => {
    if (!["/api/sweet-records", "/rest/v1/sweet_records"].includes(new URL(response.url()).pathname)) return;
    const task = response.finished().then(async (error) => {
      run.pending.delete(response.request());
      mark(page, "SWEET_network_response_complete", { method: response.request().method(), actor: subject(response.request()),
        status: response.status(), noError: error === null,
        rows: response.request().method() === "GET" && response.ok() ? await response.json() : undefined });
    }).catch(() => { run.pending.delete(response.request()); });
    run.responseTasks.push(task);
  });
  await page.goto(`${prefix}/check-in`); await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await fill(page, copy, 0);
  return run;
}
async function accountResponse(page: Page, response: Response, actor: Actor, label: string) {
  const run = runs.get(page)!;
  expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
  const result = await response.json() as Row[];
  expect(result.length).toBeGreaterThan(0); expect(result.every((row) => row.user_id === run.ids[actor])).toBe(true);
  const latest = [...result].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  await expect(page.locator("#records article")).toHaveCount(1);
  await expect(page.locator("#records").getByText(latest.summary!, { exact: true })).toBeVisible();
  mark(page, "account_actual_GET_and_UI_complete", { actor, label, rows: result, actualLatest: latest });
  return latest;
}

test.afterEach(async ({ page }, info) => {
  const run = runs.get(page); if (!run) return;
  run.fixture.releaseAll();
  if (!page.isClosed()) await page.evaluate(() => (window as typeof window & { sweetAbaOld?: Transport }).sweetAbaOld?.release()).catch(() => {});
  await Promise.allSettled(run.responseTasks);
  await info.attach("sweet-actor-return-evidence", { contentType: "application/json", body: JSON.stringify({
    locale: run.locale, mode: run.mode, events: run.events, observations: run.observations,
    finalSnapshot: run.fixture.snapshot(), A: rows(run, "A"), B: rows(run, "B"),
    scope: "Existing synthetic fixture only. Captured request identity and actual helper reads; no real Supabase/JWT verification, no React cache refs. Sequence-based synthetic created_at models late insert arrival, not actual PostgreSQL transaction timing." }, null, 2) });
  expect(run.fixture.state.blockedExternal).toEqual([]); expect(run.fixture.state.unexpectedApi).toEqual([]);
  expect(run.fixture.state.consentPosts).toEqual([]); expect(run.fixture.state.otpSends).toBe(0); expect(run.fixture.state.otpVerifies).toBe(0);
});

for (const [prefix, locale, copy] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  for (const mode of ["late-write", "late-response"] as const) {
    test(`${locale} actor A→B保存→A新稿：${mode}旧请求不得取代A最新内容`, async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      const run = await setup(page, baseURL!, prefix, locale, mode, copy);
      const insert = run.fixture.holdInsert();
      await page.evaluate((mode) => { const control = (window as typeof window & { sweetAbaOld: Transport }).sweetAbaOld;
        control.mode = mode; control.armed = true; }, mode);
      run.fixture.queueAi({ summary: oldA.summary!, smallStep: oldA.small_step!, tool: oldA.recommended_next_tool! });
      await page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }).check();
      const oldNetwork = page.waitForResponse((response) => sweet(response, "POST", run.ids.A)
        && response.request().postDataJSON().record?.summary === oldA.summary, { timeout: 75_000 });
      await generator(page, copy).click(); await expect.poll(() => insert.held).toBe(true);
      expect(run.fixture.state.rows).toEqual([]);
      const oldRequest = run.oldRequest!; const oldHeaderHash = hash(oldRequest.headers().authorization);
      expect(subject(oldRequest)).toBe(run.ids.A); expect(oldRequest.postDataJSON()).toMatchObject({ intent: "replace_summary", record: { summary: oldA.summary, smallStep: oldA.small_step, recommendedNextTool: oldA.recommended_next_tool } });
      expect(run.fixture.state.requests.filter((request) => request.method === "GET").at(-1)?.returnedIds).toEqual([]);
      const originalRecords = structuredClone(oldRequest.postDataJSON().record.records);
      await snapshot(page, copy, "old_A_POST_captured_with_empty_preread", { actor: run.ids.A, authorizationHash: oldHeaderHash, originalRecords });
      if (mode === "late-response") {
        insert.release(); const response = await oldNetwork;
        expect(response.status()).toBe(201); expect(await response.finished()).toBeNull();
        expect(fields(sweetSummaryRow(await response.json()))).toEqual(oldA);
        await page.waitForFunction(() => (window as typeof window & { sweetAbaOld: Transport }).sweetAbaOld.held);
        expect(rows(run, "A").map(fields)).toEqual([oldA]);
        await snapshot(page, copy, "old_A_committed_before_switch_only_SDK_response_is_held");
      } else await snapshot(page, copy, "old_A_write_is_still_precommit_before_switch");

      await checkInActor(page, copy, "B"); await fill(page, copy, 1);
      const bRow = await save(page, copy, savedB, "B");
      expect(bRow.records).not.toEqual(originalRecords); expect(rows(run, "B")).toEqual([bRow]);
      await checkInActor(page, copy, "A"); await fill(page, copy, 2);
      const aRow = await save(page, copy, newA, "A");
      expect(aRow.records).not.toEqual(originalRecords); expect(aRow.records).not.toEqual(bRow.records);
      expect(rows(run, "B")).toEqual([bRow]);
      const newRequest = run.fixture.state.requests.filter((request) => request.method === "POST").at(-1)!;
      expect(newRequest.body!.user_id).toBe(run.ids.A);
      await snapshot(page, copy, "B_saved_and_A_new_S2_confirmed_before_old_release", { bRow, aRow });
      expect(hash(oldRequest.headers().authorization)).toBe(oldHeaderHash); expect(subject(oldRequest)).toBe(run.ids.A);

      if (mode === "late-write") {
        mark(page, "old_A_late_write_gate_released_after_B_and_Anew"); insert.release();
        const response = await oldNetwork;
        expect(response.status()).toBe(409); expect(await response.finished()).toBeNull();
        expect(response.request()).toBe(oldRequest); expect(subject(response.request())).toBe(run.ids.A);
        const conflict = await response.json();
        expect(conflict.status).toBe("conflict");
        expect(conflict.headToken).toBe(aRow.id);
        expect(conflict.record).toMatchObject({ user_id: run.ids.A, ...newA, records: aRow.records });
      } else {
        mark(page, "old_A_SDK_response_gate_released_after_B_and_Anew");
        await page.evaluate(() => (window as typeof window & { sweetAbaOld: Transport }).sweetAbaOld.release());
      }
      await page.waitForFunction(() => (window as typeof window & { sweetAbaOld: Transport }).sweetAbaOld.consumed);
      await taskBarrier(page); await expect.poll(() => run.pending.size).toBe(0);
      await currentFinished(page, copy);
      await expect(page.getByText(newA.summary!, { exact: true })).toBeVisible();
      await expect(page.getByText(oldA.summary!, { exact: true })).toHaveCount(0);
      await expect(page.getByText(savedB.summary!, { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toBeDisabled();
      expect(rows(run, "B")).toEqual([bRow]); expect(rows(run, "A").some((row) => row.id === aRow.id)).toBe(true);
      await snapshot(page, copy, "old_body_consumed_task_barrier_UI_still_Anew", { oldHeaderHash, oldActor: subject(oldRequest) });
      const before = posts(run).length; expect(before).toBe(3);
      await raw(page, copy).click(); await currentFinished(page, copy); await taskBarrier(page);
      expect(posts(run)).toHaveLength(before);
      await snapshot(page, copy, "current_A_raw_deduplicates_after_old_completion", { noNewPOST: true });
      run.observations.afterOldCompletion = { UI: "Anew S2 remains saved; no old callback projection", A: rows(run, "A"), B: rows(run, "B"),
        oldActor: subject(oldRequest), oldHeaderHashUnchanged: hash(oldRequest.headers().authorization) === oldHeaderHash,
        rawAddedPOST: false, cacheScope: "No private ref sampled; current S2 saved label and no-POST raw confirm observable receipt behavior." };

      const aReads: Row[] = [];
      for (const label of ["navigation", "reload", "reentry"] as const) {
        if (label === "reentry") await page.goto(`${prefix}/check-in`);
        const next = page.waitForResponse((response) => sweet(response, "GET", run.ids.A));
        if (label === "reload") await page.reload(); else await page.goto(`${prefix}/account#records`);
        aReads.push(await accountResponse(page, await next, "A", label));
      }
      // Original fixture init scripts seed A on a full reload. Change B on the
      // mounted Account page instead: its real actor effect fetches B records.
      const bRead = page.waitForResponse((response) => sweet(response, "GET", run.ids.B));
      await changeActor(page, "B");
      const actualB = await accountResponse(page, await bRead, "B", "mounted-account-actor-refresh");
      expect(actualB).toEqual(bRow); expect(rows(run, "B")).toEqual([bRow]);
      const returnRead = page.waitForResponse((response) => sweet(response, "GET", run.ids.A));
      await changeActor(page, "A");
      aReads.push(await accountResponse(page, await returnRead, "A", "mounted-account-return-A"));
      run.observations.final = { expectedA: aRow, actualAReads: aReads, expectedB: bRow, actualB,
        physicalA: rows(run, "A"), physicalB: rows(run, "B"), currentActor: run.fixture.state.user.id };
      mark(page, "all_owner_reads_complete_before_correctness_oracle", run.observations.final);
      // Correct business oracle, deliberately last so even a regression keeps
      // the complete identities, B checks and account/reload/reentry evidence.
      // No expected-failure marker and no assertion requiring the bug to occur.
      expect(aReads.map((row) => ({ fields: fields(row), records: row.records })),
        "A's latest persisted content must remain its new S2 after the old request finishes")
        .toEqual(aReads.map(() => ({ fields: newA, records: aRow.records })));
    });
  }
}
