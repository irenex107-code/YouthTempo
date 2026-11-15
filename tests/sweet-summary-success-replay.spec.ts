import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

// R03-A regression; original red reporter/source remain in the repro evidence directory.
type Copy = typeof zh | typeof en;
type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
type Run = { fixture: Fixture; timeline: Array<Record<string, unknown>> };
const runs = new WeakMap<Page, Run>();
const S1 = { summary: "REPRO_S1", smallStep: "REPRO_S1_STEP", tool: "REPRO_S1_TOOL" };
const S2 = { summary: "REPRO_S2", smallStep: "REPRO_S2_STEP", tool: "REPRO_S2_TOOL" };
const S3 = { summary: "REPRO_S3", smallStep: "REPRO_S3_STEP", tool: "REPRO_S3_TOOL" };
const posts = (f: Fixture) => f.state.protocolRequests.filter((p) => p.method === "POST");
const saved = (p: Page, c: Copy) => p.getByRole("button", { name: c.checkIn.actions.savedToAccount, exact: true });
const raw = (p: Page, c: Copy) => p.locator("main article").getByRole("button", { name: c.checkIn.actions.saveFirst, exact: true });
const region = (p: Page, c: Copy) => p.getByRole("region", { name: c.checkIn.conflict.title, exact: true });
function mark(page: Page, event: string, extra: Record<string, unknown> = {}) {
  const run = runs.get(page)!;
  run.timeline.push({ sequence: run.timeline.length + 1, observedAt: new Date().toISOString(),
    syntheticBusinessTime: run.fixture.state.now, event, ...extra, storage: run.fixture.snapshot() });
}
async function barrier(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  }));
}
async function setup(page: Page, baseURL: string, prefix: string, copy: Copy) {
  const f = await syntheticSweetSummary(page, baseURL, { minimalFailureReplies: true });
  runs.set(page, { fixture: f, timeline: [] });
  await page.goto(`${prefix}/check-in`);
  await expect(page.getByRole("button", { name: copy.account.actions.signOut, exact: true, includeHidden: true }).first()).toBeAttached();
  for (let step = 0; step < 5; step++) {
    await expect(page.getByText(copy.checkIn.progress.step.replace("{{current}}", String(step + 1)).replace("{{total}}", "5"), { exact: true })).toBeVisible();
    const button = page.locator("main article button[aria-pressed]").first();
    await button.click(); await expect(button).toHaveAttribute("aria-pressed", "true");
    if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
  }
  await expect(page.getByTestId("inline-student-consent").getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
  mark(page, "answers-complete"); return f;
}
async function generate(page: Page, copy: Copy) {
  await page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }).check();
  await page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true }).click();
}
function external(page: Page, f: Fixture, value = S2) {
  const externalVersion = runs.get(page)!.timeline.filter((event) => event.event === "external-completed-write").length + 1;
  const existing = f.ownedRows()[0];
  const record = posts(f)[0]?.body?.record as { records: typeof existing.records } | undefined;
  const aiRecords = (f.state.aiRequests[0]?.records as typeof existing.records | undefined)
    ?.map(({ id, title, label, fields }) => ({ id, title, label, fields }));
  f.replacePersistedRows([{ id: `eeeeeeee-eeee-4eee-8eee-${String(externalVersion).padStart(12, "0")}`,
    user_id: f.state.user.id, school_id: null, created_at: f.state.now,
    records: structuredClone(existing?.records ?? record?.records ?? aiRecords),
    summary: value.summary, small_step: value.smallStep, recommended_next_tool: value.tool }]);
  mark(page, "external-completed-write", { value }); return structuredClone(f.ownedRows());
}
async function successfulS1(page: Page, f: Fixture, copy: Copy, reviewed = false) {
  const ai = f.queueAi({ ...S1, hold: reviewed }); await generate(page, copy);
  if (reviewed) {
    await expect.poll(() => ai.held).toBe(true); external(page, f); ai.release();
    await expect(page.getByText(copy.checkIn.messages.persistenceConflict, { exact: true })).toBeVisible();
    await region(page, copy).getByRole("button", { name: copy.checkIn.conflict.view, exact: true }).click();
    await expect(region(page, copy).getByText(S2.summary, { exact: true })).toBeVisible();
    mark(page, "explicit-review-before-new-confirmation");
    await region(page, copy).getByRole("button", { name: copy.checkIn.conflict.confirmSummary, exact: true }).click();
  }
  await expect(saved(page, copy)).toBeVisible();
  await expect.poll(() => f.ownedRows()[0]?.summary).toBe(S1.summary);
  mark(page, "S1-save-success-visible", { savedButtonEnabled: await saved(page, copy).isEnabled() });
}
async function repeat(page: Page, copy: Copy, event = false) {
  const button = saved(page, copy);
  await expect(button).toBeDisabled();
  if (event) {
    // Public DOM events only. Exercise the real handler twice in one task;
    // this does not inspect or invoke private React props or refs.
    await button.evaluate((element) => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  } else if (await button.isEnabled()) await button.click();
  await expect(page.getByRole("button", { name: copy.checkIn.actions.saving, exact: true })).toHaveCount(0);
  await barrier(page); mark(page, event ? "queued-duplicate-events-settled" : "repeat-click-settled");
}
async function accountReads(page: Page, prefix: string, f: Fixture, protectedRows = f.ownedRows()) {
  for (const mode of ["navigation", "reload", "reentry"]) {
    if (mode === "reentry") await page.goto(`${prefix}/check-in`);
    const read = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/rest/v1/sweet_records");
    if (mode === "reload") await page.reload(); else await page.goto(`${prefix}/account#records`);
    const actual = await (await read).json();
    mark(page, `account-${mode}-read`, { actual });
    expect(actual).toEqual(f.ownedRows());
    await expect(page.locator("#records article")).toHaveCount(1);
    const row = f.ownedRows()[0];
    for (const value of [row.summary, row.small_step, row.recommended_next_tool]) {
      if (value) await expect(page.locator("#records")).toContainText(value);
    }
    expect.soft(actual, `account ${mode} must retain external content`).toEqual(protectedRows);
  }
}
test.afterEach(async ({ page }, info) => {
  const run = runs.get(page); if (!run) return; run.fixture.releaseAll();
  await info.attach("success-replay-timeline-and-storage", { contentType: "application/json",
    body: JSON.stringify({ timeline: run.timeline, final: run.fixture.snapshot() }, null, 2) });
  const f = run.fixture;
  expect(f.state.blockedExternal).toEqual([]); expect(f.state.unexpectedApi).toEqual([]);
  expect(f.state.otpSends).toBe(0); expect(f.state.otpVerifies).toBe(0); expect(f.state.consentPosts).toEqual([]);
});
for (const [prefix, locale, copy] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  test(`${locale} successful S1 duplicate with no external update is a no-write control`, async ({ page, baseURL }) => {
    const f = await setup(page, baseURL!, prefix, copy); await successfulS1(page, f, copy);
    const rows = f.ownedRows(); const heads = structuredClone(f.state.heads); const count = posts(f).length;
    await repeat(page, copy); await repeat(page, copy, true);
    expect(posts(f)).toHaveLength(count); expect(f.ownedRows()).toEqual(rows); expect(f.state.heads).toEqual(heads);
    await accountReads(page, prefix, f, rows);
  });
  for (const entry of ["ordinary", "reviewed"] as const) {
    test(`${locale} ${entry} successful S1 old saved button must not rebind to external S2 head`, async ({ page, baseURL }, info) => {
      const f = await setup(page, baseURL!, prefix, copy); await successfulS1(page, f, copy, entry === "reviewed");
      const original = structuredClone(posts(f).at(-1)!.body); const count = posts(f).length;
      const latest = external(page, f); const heads = structuredClone(f.state.heads);
      const requests = f.state.protocolRequests.length;
      await info.attach("saved-button-before-repeat", { contentType: "image/png", body: await saved(page, copy).screenshot() });
      await repeat(page, copy); await repeat(page, copy);
      expect(f.state.protocolRequests).toHaveLength(requests);
      const attempts = posts(f).slice(count);
      expect.soft(attempts.every((p) => JSON.stringify(p.body) === JSON.stringify(original)), "old operation must never acquire a new expected head").toBe(true);
      expect.soft(f.ownedRows(), "S2 must survive old saved-button replay").toEqual(latest);
      expect.soft(f.state.heads, "external head must not advance from old replay").toEqual(heads);
      expect(f.participationDays()).toBe(1); await accountReads(page, prefix, f, latest);
    });
  }
  test(`${locale} queued duplicate and later saved-button events must not resurrect completed S1`, async ({ page, baseURL }) => {
    const f = await setup(page, baseURL!, prefix, copy); await successfulS1(page, f, copy);
    const count = posts(f).length; external(page, f);
    const requests = f.state.protocolRequests.length;
    await repeat(page, copy, true);
    mark(page, "after-first-queued-pair", { postsAfterSuccess: posts(f).length - count });
    expect.soft(posts(f)).toHaveLength(count);
    const latest = external(page, f, S3);
    await repeat(page, copy, true);
    expect(f.state.protocolRequests).toHaveLength(requests);
    expect.soft(posts(f)).toHaveLength(count); expect.soft(f.ownedRows()).toEqual(latest);
    await accountReads(page, prefix, f, latest);
  });
  test(`${locale} late success acknowledgement cannot reopen S1 after external S2`, async ({ page, baseURL }) => {
    const f = await setup(page, baseURL!, prefix, copy);
    await page.evaluate(() => {
      const runtime = window as typeof window & { releaseAck?: () => void; ackHeld?: boolean };
      const original = Response.prototype.json;
      Response.prototype.json = async function () {
        const body = await original.call(this);
        if (new URL(this.url).pathname === "/api/sweet-records" && body.status === "accepted") {
          runtime.ackHeld = true;
          await new Promise<void>((resolve) => { runtime.releaseAck = resolve; });
        }
        return body;
      };
    });
    f.queueAi(S1); await generate(page, copy);
    await page.waitForFunction(() => (window as typeof window & { ackHeld?: boolean }).ackHeld);
    expect(f.ownedRows()[0].summary).toBe(S1.summary);
    const latest = external(page, f); const heads = structuredClone(f.state.heads);
    const count = f.state.protocolRequests.length;
    await page.getByRole("button", { name: copy.checkIn.actions.saving, exact: true }).last().dispatchEvent("click");
    await page.evaluate(() => (window as typeof window & { releaseAck?: () => void }).releaseAck?.());
    await expect(saved(page, copy)).toBeDisabled();
    await repeat(page, copy, true); await repeat(page, copy, true);
    expect(f.state.protocolRequests).toHaveLength(count);
    expect(f.ownedRows()).toEqual(latest); expect(f.state.heads).toEqual(heads);
    await accountReads(page, prefix, f, latest);
  });
  test(`${locale} explicit new generation after S1 success can save a new S3 operation`, async ({ page, baseURL }) => {
    const f = await setup(page, baseURL!, prefix, copy); await successfulS1(page, f, copy);
    const latest = external(page, f); const count = posts(f).length;
    f.queueAi(S3); mark(page, "user-explicitly-generates-new-S3"); await generate(page, copy);
    await expect(saved(page, copy)).toBeVisible(); await expect.poll(() => f.ownedRows()[0]?.summary).toBe(S3.summary);
    expect(posts(f)).toHaveLength(count + 1); expect(posts(f).at(-1)!.body).toMatchObject({ expectedHead: latest[0].id,
      intent: "replace_summary", record: { summary: S3.summary, smallStep: S3.smallStep, recommendedNextTool: S3.tool } });
    await accountReads(page, prefix, f);
  });
  test(`${locale} read-only preservation of external null does not end a pending summary retry`, async ({ page, baseURL }) => {
    const f = await setup(page, baseURL!, prefix, copy); await successfulS1(page, f, copy);
    f.state.insertFailures = 1; f.queueAi(S3); await generate(page, copy);
    const manual = page.getByRole("button", { name: copy.checkIn.actions.saveToAccount, exact: true });
    await expect(manual).toBeEnabled();
    const failed = structuredClone(posts(f).at(-1)!.body);
    const latest = external(page, f).map((row) => ({ ...row, summary: null, small_step: null, recommended_next_tool: null }));
    f.replacePersistedRows(latest); const heads = structuredClone(f.state.heads);
    const count = posts(f).length;
    await raw(page, copy).click(); await expect(raw(page, copy)).toBeEnabled();
    expect(posts(f)).toHaveLength(count); expect(f.ownedRows()).toEqual(latest);
    await expect(manual).toBeEnabled(); await manual.click();
    await expect(page.getByText(copy.checkIn.messages.persistenceConflict, { exact: true })).toBeVisible();
    expect(posts(f)).toHaveLength(count + 1); expect(posts(f).at(-1)!.body).toEqual(failed);
    expect(f.ownedRows()).toEqual(latest); expect(f.state.heads).toEqual(heads);
    await accountReads(page, prefix, f, latest);
  });
  test(`${locale} legitimate initial null save and old raw repeat preserve external S2`, async ({ page, baseURL }) => {
    const f = await setup(page, baseURL!, prefix, copy);
    await raw(page, copy).click(); await expect(raw(page, copy)).toBeDisabled();
    expect(posts(f)[0].body).toMatchObject({ expectedHead: null, intent: "clear_summary" });
    expect(f.ownedRows()[0]).toMatchObject({ summary: null, small_step: null, recommended_next_tool: null });
    mark(page, "legitimate-null-accepted"); const count = posts(f).length;
    const latest = external(page, f);
    const requests = f.state.protocolRequests.length;
    for (let i = 0; i < 2; i++) { await raw(page, copy).dispatchEvent("click"); await expect(raw(page, copy)).toBeDisabled(); }
    expect(f.state.protocolRequests).toHaveLength(requests);
    expect(posts(f)).toHaveLength(count); expect(f.ownedRows()).toEqual(latest);
    await accountReads(page, prefix, f, latest);
  });
}
