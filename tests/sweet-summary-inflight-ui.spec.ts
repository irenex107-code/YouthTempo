import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { inlineToolsTraffic, syntheticInlineTools } from "./fixtures/synthetic-inline-tools";

type Copy = typeof zh | typeof en;
async function completeCheckIn(page: Page, copy: Copy) {
  for (let step = 0; step < 5; step++) {
    await page.locator("main article button[aria-pressed]").first().click();
    if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
  }
}
async function editExercise(page: Page, copy: Copy) {
  await page.getByRole("button", { name: copy.checkIn.actions.previous, exact: true }).click();
  await page.locator("main article button[aria-pressed]").nth(1).click();
  await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
}
test.afterEach(async ({ page }) => {
  const traffic = inlineToolsTraffic.get(page);
  if (traffic) { expect(traffic.blockedExternal).toEqual([]); expect(traffic.unexpectedApi).toEqual([]); }
});

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} R03等价传输：已发出的SWEET存储不假称撤销，改稿后旧完成不标记新稿已保存`, async ({ page, baseURL }, info) => {
    // Mirror ai-draft-lifecycle.spec.ts:175 without editing that original test.
    // Only the gate endpoint follows the approved RPC/API transport change.
    const fixture = await syntheticInlineTools(page, baseURL!, { consentState: "active" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const dispatched: Array<Record<string, unknown>> = [];
    const events: Array<{ sequence: number; event: string; detail: unknown }> = [];
    const mark = (event: string, detail: unknown = {}) => events.push({ sequence: events.length + 1, event,
      detail: structuredClone({ detail, protocolRequests: fixture.tool.sweetProtocolRequests, acceptedWrites: fixture.tool.sweetWrites }) });
    await page.route("**/api/sweet-records*", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      dispatched.push(route.request().postDataJSON() as Record<string, unknown>);
      mark("protocol_POST_dispatched_before_model_compare");
      if (dispatched.length === 1) await gate;
      return route.fallback();
    });
    try {
      await page.goto(`${prefix}/check-in`);
      await completeCheckIn(page, copy);
      await expect(page.getByTestId("inline-student-consent").getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).click();
      await expect.poll(() => dispatched.length).toBe(1);
      await editExercise(page, copy);
      await expect(page.getByRole("button", { name: copy.checkIn.actions.generatingAndSaving, exact: true })).toBeDisabled();
      expect(dispatched).toHaveLength(1);
      mark("real_edit_while_original_model_write_pending_busy_retained");
      release();
      await expect.poll(() => fixture.tool.sweetWrites.length).toBe(1);
      await expect(page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true })).toBeEnabled();
      await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toHaveCount(0);
      mark("old_model_write_committed_but_new_draft_not_confirmed");
      await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).click();
      await expect.poll(() => fixture.tool.sweetWrites.length).toBe(2);
      await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
      expect(dispatched).toHaveLength(2);
      expect(fixture.state.aiCalls).toEqual([]);
      expect(fixture.state.otpSends).toBe(0);
      // Extra R03 protocol/source-read evidence; these do not replace any old oracle.
      expect(dispatched[0].expectedHead).toBeNull(); expect(dispatched[1].expectedHead).not.toBeNull();
      expect(fixture.tool.sweetWrites[1].records).not.toEqual(fixture.tool.sweetWrites[0].records);
      const fresh = await page.evaluate(async (key) => {
        const session = JSON.parse(localStorage.getItem(key)!);
        const response = await fetch("/api/sweet-records", { headers: { Authorization: `Bearer ${session.access_token}` } });
        return { status: response.status, body: await response.json() };
      }, fixture.storageKey);
      expect(fresh.status).toBe(200); expect(fresh.body.status).toBe("ready");
      expect(fresh.body.record).toMatchObject({ ...fixture.tool.sweetWrites[1], user_id: fixture.state.user.id });
      expect(fresh.body.record.id).toBe(fresh.body.headToken); mark("new_draft_confirmed_and_actual_fresh_scope_matches_second_write", fresh);
    } finally {
      release();
      await info.attach("r03-original-inflight-business-oracles-new-transport", { contentType: "application/json", body: JSON.stringify({
        original: "Unchanged ai-draft-lifecycle.spec.ts:175 still gates old REST POST and fails its transport prerequisite. This is a separate equivalent behavior test, not an original12/12 pass claim.",
        modelOnly: true, noRealDatabaseOrAuthentication: true, events, dispatched,
      }, null, 2) });
    }
  });
}
