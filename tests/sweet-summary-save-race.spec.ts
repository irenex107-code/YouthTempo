import { expect, test, type Page, type Response } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { sweetSummaryRow, syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

type Copy = typeof zh | typeof en;
type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
type PersistedFields = { summary: string | null; small_step: string | null; recommended_next_tool: string | null };
type Event = { sequence: number; elapsedMs: number; observedAt: string; event: string; detail: unknown };
type Evidence = {
  locale: string;
  path: string;
  events: Event[];
  fixture: Fixture;
  observations: Record<string, unknown>;
};
const evidenceByPage = new WeakMap<Page, Evidence>();
const expected: PersistedFields = {
  summary: "SYNTHETIC_R01_FIRST_SUMMARY",
  small_step: "SYNTHETIC_R01_FIRST_STEP",
  recommended_next_tool: "SYNTHETIC_R01_FIRST_TOOL",
};

function fields(row: Partial<PersistedFields>): PersistedFields {
  return { summary: row.summary ?? null, small_step: row.small_step ?? null,
    recommended_next_tool: row.recommended_next_tool ?? null };
}
function isSweet(response: Response, method: string) {
  return ["/api/sweet-records", "/rest/v1/sweet_records"].includes(new URL(response.url()).pathname)
    && response.request().method() === method;
}
async function complete(page: Page, copy: Copy) {
  for (let step = 0; step < 5; step++) {
    const title = copy.checkIn.progress.step.replace("{{current}}", String(step + 1)).replace("{{total}}", "5");
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    const option = page.locator("main article button[aria-pressed]").first();
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
    if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
  }
}

test.afterEach(async ({ page }, testInfo) => {
  const evidence = evidenceByPage.get(page);
  if (!evidence) return;
  evidence.fixture.releaseAll();
  await testInfo.attach("r01-timeline-and-observations", {
    contentType: "application/json",
    body: JSON.stringify({ locale: evidence.locale, path: evidence.path, events: evidence.events,
      observations: evidence.observations,
      cacheObservation: "No private React ref is read. Cache registration is inferred from unchanged actor/answers, completed save, skipped UI confirmation and subsequent payload, together with page.tsx:399,429-432.",
      storageModel: "Existing stateful synthetic rows; not PostgreSQL or real Supabase.",
      finalSnapshot: evidence.fixture.snapshot() }, null, 2),
  });
  expect(evidence.fixture.state.blockedExternal).toEqual([]);
  expect(evidence.fixture.state.unexpectedApi).toEqual([]);
  expect(evidence.fixture.state.otpSends).toBe(0);
  expect(evidence.fixture.state.otpVerifies).toBe(0);
});

for (const [prefix, locale, copy] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  for (const path of ["raw", "ai-failure-fallback"] as const) {
    test(`R01 ${locale} ${path}: 首次保存中只切AI选择，后续保存与刷新应保留小结`, async ({ page, baseURL }) => {
      const fixture = await syntheticSweetSummary(page, baseURL!);
      const evidence: Evidence = { locale, path, events: [], fixture, observations: {} };
      evidenceByPage.set(page, evidence);
      const started = performance.now();
      const mark = (event: string, detail: unknown = {}) => evidence.events.push({
        sequence: evidence.events.length + 1, elapsedMs: Number((performance.now() - started).toFixed(3)),
        observedAt: new Date().toISOString(), event, detail: structuredClone(detail),
      });
      const snapshot = (event: string, detail: unknown = {}) => mark(event, {
        detail, rows: fixture.ownedRows(), participationDays: fixture.participationDays(),
        posts: fixture.state.requests.filter((request) => request.method === "POST").map((request) => request.body),
      });
      // Observe transport only; do not wrap fetch, touch React refs or alter fixture semantics.
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (["/api/sweet-records", "/rest/v1/sweet_records"].includes(url.pathname)) mark("sweet_request_dispatched", {
          method: request.method(), query: [...url.searchParams.entries()],
          body: request.method() === "POST" ? request.postDataJSON() : undefined,
        });
        if (url.pathname === "/api/ai/check-in") mark("ai_request_dispatched", request.postDataJSON());
      });
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (["/api/sweet-records", "/rest/v1/sweet_records"].includes(url.pathname) || url.pathname === "/api/ai/check-in") {
          mark("browser_response_headers_received", { method: response.request().method(),
            pathname: url.pathname, status: response.status() });
        }
      });
      const topSave = () => page.locator("main article").getByRole("button", {
        name: copy.checkIn.actions.saveFirst, exact: true,
      });
      const generator = () => page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true });
      const choice = page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true });
      const completion = page.getByText(copy.checkIn.messages.saved, { exact: true })
        .or(page.getByText(copy.checkIn.messages.alreadySaved, { exact: true }));

      await page.goto(`${prefix}/check-in`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await complete(page, copy);
      expect(fixture.ownedRows()).toEqual([]);
      const actor = fixture.state.user.id;
      const selected = await page.locator("main article button[aria-pressed=true]").allTextContents();
      snapshot("fresh_completed_answers_no_prior_save", { actor, selected });

      const gate = fixture.holdInsert();
      fixture.queueAi({ summary: expected.summary!, smallStep: expected.small_step!, tool: expected.recommended_next_tool! });
      await choice.check();
      mark("ai_choice_checked_before_first_generation");
      await generator().click();
      await expect.poll(() => gate.held).toBe(true);
      const firstPost = fixture.state.requests.filter((request) => request.method === "POST");
      expect(firstPost).toHaveLength(1);
      expect(fields(firstPost[0].body!)).toEqual(expected);
      const records = structuredClone(firstPost[0].body!.records);
      expect(fixture.ownedRows()).toEqual([]);
      await expect(page.getByText(expected.summary!, { exact: true })).toBeVisible();
      snapshot("first_insert_held_before_commit", { actor, records, gateHeld: gate.held });

      await choice.uncheck();
      await expect(choice).not.toBeChecked();
      await expect(page.getByText(expected.summary!, { exact: true })).toHaveCount(0);
      await expect(page.locator("main article").getByRole("button", {
        name: copy.checkIn.actions.saving, exact: true,
      })).toBeDisabled();
      expect(fixture.state.user.id).toBe(actor);
      expect(await page.locator("main article button[aria-pressed=true]").allTextContents()).toEqual(selected);
      snapshot("only_ai_choice_unchecked_while_insert_pending", {
        sameActor: true, selectedUnchanged: true,
        uiRevisionInvalidation: "Source inference: checkbox onChange calls cancelSummary, increments revision and sequence; no answer edit.",
      });

      const firstResponsePromise = page.waitForResponse((response) => isSweet(response, "POST"));
      mark("first_insert_gate_released");
      gate.release();
      const firstResponse = await firstResponsePromise;
      expect(firstResponse.status()).toBe(201);
      expect(await firstResponse.finished()).toBeNull();
      const committed = sweetSummaryRow(await firstResponse.json());
      expect(fields(committed)).toEqual(expected);
      await expect.poll(() => fixture.ownedRows().map((row) => fields(row))).toEqual([expected]);
      expect(fixture.ownedRows()[0].id).toBe(committed.id);
      snapshot("first_201_body_consumed_and_synthetic_commit_observed", { id: committed.id, status: 201 });
      await expect.poll(() => gate.settled).toBe(true);
      await expect(topSave()).toBeEnabled();
      await expect(generator()).toBeEnabled();
      await expect(choice).not.toBeChecked();
      await expect(completion).toHaveCount(0);
      expect(fixture.state.aiRequests).toHaveLength(1);
      snapshot("first_save_busy_released_without_ui_confirmation", {
        helperCompletionEvidence: "The save button is enabled only after saveCurrentRecord finally clears saving; this is stronger than route gate.settled alone.",
        cacheDirectlyRead: false,
      });
      evidence.observations.firstSave = { status: 201, rowId: committed.id, persistedFields: fields(committed),
        aiChoice: false, visibleSummary: false, successNotice: false, privateCacheRead: false };

      if (path === "raw") {
        mark("followup_raw_save_clicked");
        await topSave().click();
      } else {
        fixture.queueAi({ status: 503 });
        await choice.check();
        mark("ai_choice_rechecked_for_new_failed_generation");
        const failedAiPromise = page.waitForResponse((response) =>
          new URL(response.url()).pathname === "/api/ai/check-in");
        await generator().click();
        const failedAi = await failedAiPromise;
        expect(failedAi.status()).toBe(503);
        expect(await failedAi.finished()).toBeNull();
        await expect(page.getByText("Synthetic summary unavailable", { exact: true })).toBeVisible();
        mark("new_ai_503_received_error_shown_fallback_may_still_be_running");
      }
      await expect(completion).toBeVisible();
      await expect(topSave()).toBeEnabled();
      await expect(generator()).toBeEnabled();
      expect(fixture.state.user.id).toBe(actor);
      const posts = fixture.state.requests.filter((request) => request.method === "POST");
      posts.forEach((request) => expect(request.body!.records).toEqual(records));
      expect(fixture.ownedRows()).toHaveLength(1);
      expect(fixture.participationDays()).toBe(1);
      const afterFollowup = fields(fixture.ownedRows()[0]);
      snapshot("followup_completed_storage_snapshot", {
        notice: await completion.textContent(), aiChoice: await choice.isChecked(),
        cacheInference: posts.slice(1).some((request) => fields(request.body!).summary === null)
          ? "A later same-answer null POST demonstrates no usable S1 preservation cache for that call; source identifies the skipped registration."
          : "No null downgrade POST observed; do not infer a cache gap from hidden UI alone.",
      });

      async function readAccount(reload: boolean) {
        const responsePromise = page.waitForResponse((response) => isSweet(response, "GET"));
        mark(reload ? "account_reload_started" : "account_navigation_started");
        if (reload) await page.reload();
        else await page.goto(`${prefix}/account#records`);
        const response = await responsePromise;
        expect(response.status()).toBe(200);
        expect(await response.finished()).toBeNull();
        const rows = await response.json();
        expect(rows).toHaveLength(1);
        expect(rows[0].records).toEqual(records);
        expect(rows[0].id).toBe(fixture.ownedRows()[0].id);
        await expect(page.locator("#records article")).toHaveCount(1);
        if (rows[0].summary) {
          await expect(page.locator("#records").getByText(rows[0].summary, { exact: true })).toBeVisible();
        } else {
          await expect(page.locator("#records")).not.toContainText(expected.summary!);
        }
        snapshot(reload ? "account_reload_get_and_ui_complete" : "account_navigation_get_and_ui_complete", {
          status: response.status(), readRows: rows, uiMatchesReadSummary: true,
        });
        return fields(rows[0]);
      }
      const accountRead = await readAccount(false);
      const afterReload = await readAccount(true);
      const actual = { afterFollowup, accountRead, afterReload };
      evidence.observations.final = { actual, expected, firstRowId: committed.id,
        finalRowId: fixture.ownedRows()[0].id, postCount: posts.length,
        postFields: posts.map((request) => fields(request.body!)), participationDays: fixture.participationDays(),
        preservationHolds: Object.values(actual).every((value) => JSON.stringify(value) === JSON.stringify(expected)),
        targetSequenceCompleted: true };
      mark("preservation_oracle_evaluated_after_both_storage_rereads", evidence.observations.final);
      // Product invariant, not an assertion that the defect must occur. A fixed
      // implementation can pass with one POST and retained S1; no failure is forced.
      expect(actual, "S1 was committed before the follow-up; both persistent rereads must retain all three fields")
        .toEqual({ afterFollowup: expected, accountRead: expected, afterReload: expected });
    });
  }
}
