import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";
import { syntheticSweetBridge } from "./fixtures/synthetic-sweet-bridge";

type Copy = typeof zh | typeof en;
type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
const runs = new WeakMap<Page, Fixture>();
const s1 = { summary: "SYNTHETIC_B_S1", smallStep: "SYNTHETIC_B_STEP1", tool: "SYNTHETIC_B_TOOL1" };
const raw = (page: Page, copy: Copy) => page.locator("main article").getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true });
const manual = (page: Page, copy: Copy) => page.getByRole("button", { name: copy.checkIn.actions.saveToAccount, exact: true });
const choice = (page: Page, copy: Copy) => page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true });
const posts = (f: Fixture) => f.state.protocolRequests.filter(r => r.method === "POST");
async function setup(page: Page, baseURL: string, prefix: string, copy: Copy, code?: string) {
  let bridge: ReturnType<typeof syntheticSweetBridge> | undefined;
  const f = await syntheticSweetSummary(page, baseURL, code ? { afterCommitReply: async () => {
    bridge ??= syntheticSweetBridge(f.state.user.id, async () => ({ data: null, error: { code, message: "PRIVATE" } }), prefix ? "en" : "zh-CN");
    return bridge.run(posts(f).at(-1)!.body);
  } } : {});
  runs.set(page, f);
  await page.goto(`${prefix}/check-in`);
  await expect(page.getByRole("button", { name: copy.account.actions.signOut, exact: true, includeHidden: true }).first()).toBeAttached();
  for (let step = 0; step < 5; step++) {
    await expect(page.getByText(copy.checkIn.progress.step.replace("{{current}}", String(step + 1)).replace("{{total}}", "5"), { exact: true })).toBeVisible();
    const selected = page.locator("main article button[aria-pressed]").first();
    await selected.focus(); await selected.press("Space"); await expect(selected).toHaveAttribute("aria-pressed", "true");
    if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
  }
  await expect(page.getByTestId("inline-student-consent").getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
  return { f, bridge: () => bridge };
}
async function generate(page: Page, f: Fixture, copy: Copy) {
  f.queueAi(s1); await choice(page, copy).check();
  await page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true }).click();
  await expect(raw(page, copy)).toBeEnabled();
}
async function account(page: Page, prefix: string, f: Fixture) {
  const rows = f.ownedRows();
  for (const mode of ["navigation", "reload", "reentry"]) {
    if (mode === "reentry") await page.goto(`${prefix}/check-in`);
    const read = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname === "/rest/v1/sweet_records");
    if (mode === "reload") await page.reload(); else await page.goto(`${prefix}/account#records`);
    expect(await (await read).json()).toEqual(rows);
    await expect(page.locator("#records article")).toHaveCount(rows.length);
  }
}
test.afterEach(async ({ page }, info) => {
  const f = runs.get(page); if (!f) return; f.releaseAll();
  await info.attach("B-final-model-and-transport", { contentType: "application/json", body: JSON.stringify(f.snapshot(), null, 2) });
  expect(f.state.blockedExternal).toEqual([]); expect(f.state.unexpectedApi).toEqual([]);
  expect(f.state.consentPosts).toEqual([]);
});
for (const [prefix, locale, copy] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  for (const code of ["08007", "40003", "XX000"]) {
    test(`${locale} B committed then actual bridge ${code} stays unknown and original retry conflicts`, async ({ page, baseURL }) => {
      const { f, bridge } = await setup(page, baseURL!, prefix, copy, code);
      await generate(page, f, copy);
      await expect(page.getByText(copy.checkIn.messages.persistenceUnknown, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.checkIn.messages.saveFailed, { exact: true })).toHaveCount(0);
      const committed = structuredClone(f.ownedRows()); expect(committed).toHaveLength(1);
      expect(committed[0]).toMatchObject({ summary: s1.summary, small_step: s1.smallStep, recommended_next_tool: s1.tool });
      expect(posts(f)).toHaveLength(1); expect(bridge()!.calls).toHaveLength(1);
      expect(posts(f)[0].body).toMatchObject({ expectedHead: null, intent: "replace_summary" });
      await manual(page, copy).click();
      await expect(page.getByText(copy.checkIn.messages.persistenceConflict, { exact: true })).toBeVisible();
      const calls = structuredClone(f.state.protocolRequests);
      await manual(page, copy).click(); await raw(page, copy).click();
      expect(f.state.protocolRequests).toEqual(calls);
      expect(posts(f).map(r => r.body?.expectedHead)).toEqual([null, null]);
      expect(f.ownedRows()).toEqual(committed); expect(f.participationDays()).toBe(1);
      await account(page, prefix, f);
    });
  }
  for (const failure of ["unavailable", "network", "bad-packet", "missing", "answers"]) {
    test(`${locale} B unknown then read reconciliation ${failure} never says not saved`, async ({ page, baseURL }) => {
      const { f } = await setup(page, baseURL!, prefix, copy); f.state.afterCommitFailures = 1;
      await generate(page, f, copy);
      await expect(page.getByText(copy.checkIn.messages.persistenceUnknown, { exact: true })).toBeVisible();
      const committed = structuredClone(f.ownedRows()); expect(committed).toHaveLength(1);
      await choice(page, copy).uncheck();
      let reads = 0;
      await page.route("**/api/sweet-records**", async route => {
        if (route.request().method() !== "GET") return route.fallback();
        reads++;
        if (failure === "network") return route.abort("failed");
        if (failure === "unavailable") return route.fulfill({ status: 503, json: { status: "protocol_unavailable" } });
        const packet = structuredClone(f.scope());
        if (failure === "bad-packet") return route.fulfill({ json: { ...packet, headToken: "broken" } });
        if (failure === "missing") packet.record = null;
        if (failure === "answers") packet.record!.records[0].fields[0].value = "SYNTHETIC_DIFFERENT_ANSWER";
        return route.fulfill({ json: packet });
      });
      await raw(page, copy).click();
      await expect(page.getByText(copy.checkIn.messages.persistenceUnavailable, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.checkIn.messages.saveFailed, { exact: true })).toHaveCount(0);
      await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toHaveCount(0);
      expect(reads).toBe(1); expect(posts(f)).toHaveLength(1); expect(f.ownedRows()).toEqual(committed);
      await raw(page, copy).click();
      await expect(page.getByText(copy.checkIn.messages.persistenceUnavailable, { exact: true })).toBeVisible();
      expect(reads).toBe(2); expect(posts(f)).toHaveLength(1);
      expect(posts(f)[0].body).toMatchObject({ expectedHead: null, intent: "replace_summary" });
      expect(f.ownedRows()).toEqual(committed); expect(f.participationDays()).toBe(1);
      await account(page, prefix, f);
    });
  }
  for (const target of ["S2", "tombstone"] as const) {
    test(`${locale} B unknown fresh ${target} is current state, never permission to replay old S1`, async ({ page, baseURL }) => {
      const { f } = await setup(page, baseURL!, prefix, copy); f.state.afterCommitFailures = 1;
      await generate(page, f, copy);
      await expect(page.getByText(copy.checkIn.messages.persistenceUnknown, { exact: true })).toBeVisible();
      const before = f.scope();
      const changed = await page.evaluate(async ({ key, before, target }) => {
        const session = JSON.parse(localStorage.getItem(key)!);
        const r = await fetch("/api/sweet-records", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ operationDay: before.operationDay, targetDay: before.targetDay, expectedHead: before.headToken,
            ...(target === "tombstone" ? { intent: "delete_day", recordId: before.record!.id }
              : { intent: "replace_summary", record: { records: before.record!.records, summary: "SYNTHETIC_B_S2", smallStep: "SYNTHETIC_B_STEP2", recommendedNextTool: "SYNTHETIC_B_TOOL2" } }) }) });
        return r.status;
      }, { key: f.storageKey, before, target });
      expect(changed).toBe(201); const current = structuredClone(f.ownedRows()), head = structuredClone(f.state.heads);
      await choice(page, copy).uncheck(); await raw(page, copy).click();
      await expect(raw(page, copy)).toBeEnabled();
      if (target === "tombstone") await expect(page.getByText(copy.checkIn.messages.persistenceUnavailable, { exact: true })).toBeVisible();
      else await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
      expect(posts(f)).toHaveLength(2); expect(f.ownedRows()).toEqual(current); expect(f.state.heads).toEqual(head);
      await raw(page, copy).click(); await expect(raw(page, copy)).toBeEnabled();
      expect(posts(f)).toHaveLength(2);
      expect(posts(f)[0].body).toMatchObject({ expectedHead: null, intent: "replace_summary" });
      expect(f.ownedRows()).toEqual(current); expect(f.state.heads).toEqual(head);
      await account(page, prefix, f);
    });
  }
  test(`${locale} B definite rejection then failed read stays unavailable rather than unknown`, async ({ page, baseURL }) => {
    const { f } = await setup(page, baseURL!, prefix, copy); f.state.insertFailures = 1;
    await generate(page, f, copy);
    await expect(page.getByText(copy.checkIn.messages.saveFailed, { exact: true })).toBeVisible();
    expect(f.ownedRows()).toEqual([]);
    await choice(page, copy).uncheck(); f.state.readFailures = 1;
    await raw(page, copy).click();
    await expect(page.getByText(copy.checkIn.messages.persistenceUnavailable, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.checkIn.messages.persistenceUnknown, { exact: true })).toHaveCount(0);
    expect(posts(f)).toHaveLength(1); expect(f.ownedRows()).toEqual([]);
  });
}

test("B locale paths html lang cookie and responsive prompt visibility", async ({ page, baseURL }) => {
  const f = await syntheticSweetSummary(page, baseURL!); runs.set(page, f);
  await page.goto("/"); await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/?$/); await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect((await page.context().cookies()).find(c => c.name === "NEXT_LOCALE")?.value).toBe("en");
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await expect(page).toHaveURL(baseURL! + "/"); await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect((await page.context().cookies()).find(c => c.name === "NEXT_LOCALE")?.value).toBe("zh-CN");
});
