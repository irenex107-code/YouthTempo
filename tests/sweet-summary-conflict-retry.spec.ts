import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

type Copy = typeof zh | typeof en;
type Fixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
const runs = new WeakMap<Page, Fixture>();
const s1 = { summary: "SYNTHETIC_OLD_S1", smallStep: "SYNTHETIC_OLD_STEP", tool: "SYNTHETIC_OLD_TOOL" };
const s2 = { summary: "SYNTHETIC_LATEST_S2", smallStep: "SYNTHETIC_LATEST_STEP", tool: "SYNTHETIC_LATEST_TOOL" };
const manual = (page: Page, copy: Copy) => page.getByRole("button", { name: copy.checkIn.actions.saveToAccount, exact: true });
const raw = (page: Page, copy: Copy) => page.locator("main article").getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true });
const choice = (page: Page, copy: Copy) => page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true });
const generate = (page: Page, copy: Copy) => page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true });
const posts = (fixture: Fixture) => fixture.state.protocolRequests.filter((r) => r.method === "POST");
async function setup(page: Page, baseURL: string, prefix: string, copy: Copy, batchAuth = false) {
  const fixture = await syntheticSweetSummary(page, baseURL, { minimalFailureReplies: true }); runs.set(page, fixture);
  if (batchAuth) await page.addInitScript(() => {
    const Native = window.BroadcastChannel;
    const channels: BroadcastChannel[] = [];
    Object.assign(window, { syntheticAuthChannels: channels });
    window.BroadcastChannel = class extends Native {
      constructor(name: string) { super(name); channels.push(this); }
    };
  });
  await page.goto(`${prefix}/check-in`);
  await expect(page.getByRole("button", { name: copy.account.actions.signOut, exact: true, includeHidden: true }).first()).toBeAttached();
  for (let step = 0; step < 5; step++) {
    await expect(page.getByText(copy.checkIn.progress.step.replace("{{current}}", String(step + 1)).replace("{{total}}", "5"), { exact: true })).toBeVisible();
    const selected = page.locator("main article button[aria-pressed]").first(); await selected.click();
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
  }
  await expect(page.getByTestId("inline-student-consent").getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
  return fixture;
}
function external(fixture: Fixture, summary = s2) {
  const previous = fixture.ownedRows()[0];
  fixture.replacePersistedRows([{ id: summary === s1 ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: fixture.state.user.id, school_id: null,
    created_at: fixture.state.now, records: previous?.records ?? (fixture.state.aiRequests[0]?.records as Array<{ id: string; title: string; label: string; fields: ReturnType<Fixture["ownedRows"]>[number]["records"][number]["fields"] }> | undefined)?.map(({ id, title, label, fields }) => ({ id, title, label, fields })) ?? ["sleep", "wake", "eat", "exercise", "task"].map((id) => ({ id, title: id, label: id, fields: [{ id: "test", title: "Synthetic", value: "Synthetic" }] })), summary: summary.summary,
    small_step: summary.smallStep, recommended_next_tool: summary.tool }]);
  return fixture.ownedRows()[0];
}
async function accountReads(page: Page, prefix: string, fixture: Fixture) {
  const expected = fixture.ownedRows();
  for (const mode of ["navigation", "reload", "reentry"]) {
    if (mode === "reentry") await page.goto(`${prefix}/check-in`);
    const response = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/rest/v1/sweet_records");
    if (mode === "reload") await page.reload(); else await page.goto(`${prefix}/account#records`);
    expect(await (await response).json()).toEqual(expected);
    await expect(page.locator("#records article")).toHaveCount(1);
  }
}
test.afterEach(async ({ page }, info) => {
  const fixture = runs.get(page); if (!fixture) return; fixture.releaseAll();
  await info.attach("conflict-request-and-storage-evidence", { contentType: "application/json", body: JSON.stringify(fixture.snapshot(), null, 2) });
  expect(fixture.state.blockedExternal).toEqual([]); expect(fixture.state.unexpectedApi).toEqual([]);
  expect(fixture.state.consentPosts).toEqual([]); expect(fixture.state.otpSends).toBe(0); expect(fixture.state.otpVerifies).toBe(0);
});
for (const [prefix, locale, copy] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  for (const kind of ["S1", "null-absent", "null-existing"] as const) {
    test(`${locale} R03-A reproducer ${kind}: repeated old operation cannot acquire latest head`, async ({ page, baseURL }) => {
      const fixture = await setup(page, baseURL!, prefix, copy);
      if (kind === "null-existing") external(fixture, s1);
      if (kind === "S1") {
        const ai = fixture.queueAi({ ...s1, hold: true }); await choice(page, copy).check(); await generate(page, copy).click();
        await expect.poll(() => ai.held).toBe(true);
        external(fixture); ai.release();
      } else {
        const gate = fixture.holdInsert(); await raw(page, copy).click(); await expect.poll(() => gate.held).toBe(true);
        // The held request already carries the page's actual five-dimension answers.
        const records = structuredClone(posts(fixture)[0].body!.record) as { records: ReturnType<Fixture["ownedRows"]>[number]["records"] };
        external(fixture); fixture.state.rows[0].records = records.records; gate.release();
      }
      await expect(page.getByText(copy.checkIn.messages.persistenceConflict, { exact: true })).toBeVisible();
      const original = structuredClone(posts(fixture)[0].body); const latest = fixture.ownedRows(); const heads = structuredClone(fixture.state.heads);
      expect(original!.expectedHead).toBe(kind === "null-existing" ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : null);
      // Same synthetic ID cannot be used for old and new heads.
      expect(posts(fixture)[0].result).toEqual({ status: "conflict", writeOutcome: "not_committed" });
      const button = kind === "S1" ? manual(page, copy) : raw(page, copy);
      for (let attempt = 0; attempt < 2; attempt++) {
        await button.click(); await expect(page.getByRole("button", { name: copy.checkIn.actions.saving, exact: true })).toHaveCount(0);
        // Either refuse dispatch or resend the exact old envelope. Never GET+rebase.
        expect(posts(fixture).every((request) => JSON.stringify(request.body) === JSON.stringify(original))).toBe(true);
        expect(fixture.ownedRows()).toEqual(latest); expect(fixture.state.heads).toEqual(heads);
        await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toHaveCount(0);
      }
      expect(fixture.participationDays()).toBe(1); await accountReads(page, prefix, fixture);
    });
  }
}

async function conflict(page: Page, fixture: Fixture, copy: Copy, kind: "S1" | "raw" = "S1") {
  if (kind === "S1") {
    const ai = fixture.queueAi({ ...s1, hold: true }); await choice(page, copy).check(); await generate(page, copy).click();
    await expect.poll(() => ai.held).toBe(true); external(fixture); ai.release();
  } else {
    const gate = fixture.holdInsert(); await raw(page, copy).click(); await expect.poll(() => gate.held).toBe(true);
    external(fixture); fixture.state.rows[0].records = (posts(fixture)[0].body!.record as { records: typeof fixture.state.rows[number]["records"] }).records; gate.release();
  }
  await expect(page.getByText(copy.checkIn.messages.persistenceConflict, { exact: true })).toBeVisible();
  return fixture.ownedRows()[0];
}
const region = (page: Page, copy: Copy) => page.getByRole("region", { name: copy.checkIn.conflict.title, exact: true });
const view = (page: Page, copy: Copy) => region(page, copy).getByRole("button", { name: copy.checkIn.conflict.view, exact: true });
const confirmRaw = (page: Page, copy: Copy) => region(page, copy).getByRole("button", { name: copy.checkIn.conflict.confirmRaw, exact: true });
const confirmSummary = (page: Page, copy: Copy) => region(page, copy).getByRole("button", { name: copy.checkIn.conflict.confirmSummary, exact: true });
async function review(page: Page, copy: Copy) {
  await view(page, copy).click(); await expect(confirmRaw(page, copy)).toBeEnabled();
}
async function taskBarrier(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); }; channel.port2.postMessage(null);
  }));
}
for (const [prefix, locale, copy] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  test(`${locale} review-only, failed read, cancel, then explicit new S1 uses displayed version`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix, copy); const latest = await conflict(page, fixture, copy);
    fixture.state.readFailures = 1; await view(page, copy).click(); await expect(view(page, copy)).toBeEnabled();
    await expect(confirmRaw(page, copy)).toHaveCount(0); expect(posts(fixture)).toHaveLength(1);
    await review(page, copy);
    await expect(region(page, copy).getByText(s2.summary, { exact: true })).toBeVisible();
    await expect(region(page, copy).getByText(s2.smallStep, { exact: true })).toBeVisible();
    await expect(region(page, copy).getByText(s2.tool, { exact: true })).toBeVisible();
    await expect(region(page, copy).getByText(s1.summary, { exact: true })).toBeVisible();
    expect(posts(fixture)).toHaveLength(1);
    await region(page, copy).getByRole("button", { name: copy.checkIn.conflict.cancel, exact: true }).click();
    await expect(confirmRaw(page, copy)).toHaveCount(0); expect(fixture.ownedRows()).toEqual([latest]);
    await manual(page, copy).click(); expect(posts(fixture)).toHaveLength(1);
    await review(page, copy); const reads = fixture.state.protocolRequests.filter((r) => r.method === "GET").length;
    await confirmSummary(page, copy).focus(); await confirmSummary(page, copy).press("Space");
    await expect(region(page, copy)).toHaveCount(0);
    expect(posts(fixture)).toHaveLength(2); expect(posts(fixture)[1].body).toMatchObject({ expectedHead: latest.id, intent: "replace_summary", record: { summary: s1.summary, smallStep: s1.smallStep, recommendedNextTool: s1.tool } });
    expect(fixture.state.protocolRequests.filter((r) => r.method === "GET")).toHaveLength(reads);
    expect(fixture.ownedRows()[0]).toMatchObject({ summary: s1.summary, small_step: s1.smallStep, recommended_next_tool: s1.tool, records: latest.records });
    await raw(page, copy).click(); await expect(raw(page, copy)).toBeEnabled(); expect(posts(fixture)).toHaveLength(2);
    await accountReads(page, prefix, fixture);
  });

  test(`${locale} reviewed new null is legal; old null cannot clear latest summary`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix, copy); const latest = await conflict(page, fixture, copy, "raw");
    const original = structuredClone(posts(fixture)[0].body); await raw(page, copy).click(); expect(posts(fixture)).toHaveLength(1);
    await review(page, copy); const reads = fixture.state.protocolRequests.length;
    await confirmRaw(page, copy).click(); await expect(region(page, copy)).toHaveCount(0);
    expect(posts(fixture)).toHaveLength(2); expect(posts(fixture)[0].body).toEqual(original);
    expect(posts(fixture)[1].body).toMatchObject({ expectedHead: latest.id, intent: "clear_summary" });
    expect(fixture.state.protocolRequests).toHaveLength(reads + 1);
    expect(fixture.ownedRows()[0]).toMatchObject({ records: latest.records, summary: null, small_step: null, recommended_next_tool: null });
    expect(fixture.ownedRows()[0].id).not.toBe(latest.id);
    await expect(raw(page, copy)).toBeDisabled(); await raw(page, copy).dispatchEvent("click"); expect(posts(fixture)).toHaveLength(2);
    expect(fixture.participationDays()).toBe(1); await accountReads(page, prefix, fixture);
  });

  test(`${locale} reviewed h2 cannot become h3 at confirmation; another review is required`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix, copy); const latest = await conflict(page, fixture, copy); await review(page, copy);
    const newer = { ...latest, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", summary: "SYNTHETIC_NEWER_S3" }; fixture.replacePersistedRows([newer]);
    await confirmSummary(page, copy).click(); await expect(page.getByText(copy.checkIn.messages.persistenceConflict, { exact: true })).toBeVisible();
    expect(posts(fixture)[1].body!.expectedHead).toBe(latest.id); expect(posts(fixture)[1].result!.status).toBe("conflict");
    expect(fixture.ownedRows()).toEqual([newer]); await expect(confirmRaw(page, copy)).toHaveCount(0);
    await manual(page, copy).click(); expect(posts(fixture)).toHaveLength(2);
    await review(page, copy); await expect(region(page, copy).getByText(newer.summary, { exact: true })).toBeVisible();
    await confirmSummary(page, copy).click(); await expect(region(page, copy)).toHaveCount(0);
    expect(posts(fixture)[2].body!.expectedHead).toBe(newer.id); expect(fixture.ownedRows()[0].summary).toBe(s1.summary);
  });

  test(`${locale} unknown then conflict then repeated old S1/raw never rebases`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix, copy); fixture.state.afterCommitFailures = 1;
    fixture.queueAi(s1); await choice(page, copy).check(); await generate(page, copy).click();
    await expect(page.getByText(copy.checkIn.messages.persistenceUnknown, { exact: true })).toBeVisible();
    const original = structuredClone(posts(fixture)[0].body); const latest = external(fixture);
    await manual(page, copy).click(); await expect(page.getByText(copy.checkIn.messages.persistenceConflict, { exact: true })).toBeVisible();
    expect(posts(fixture)[1].body).toEqual(original);
    const count = fixture.state.protocolRequests.length;
    await manual(page, copy).click(); await choice(page, copy).uncheck(); await raw(page, copy).click();
    expect(fixture.state.protocolRequests).toHaveLength(count); expect(fixture.ownedRows()).toEqual([latest]);
    await accountReads(page, prefix, fixture);
  });

  for (const invalidate of ["edit-roundtrip", "day", "rapid-ABA"] as const) {
    test(`${locale} reviewed confirmation expires on ${invalidate}`, async ({ page, baseURL }) => {
      const fixture = await setup(page, baseURL!, prefix, copy, invalidate === "rapid-ABA"); const latest = await conflict(page, fixture, copy); await review(page, copy);
      if (invalidate === "edit-roundtrip") {
        const options = page.locator("main article button[aria-pressed]"); await options.nth(1).click(); await options.first().click();
        await expect(confirmRaw(page, copy)).toHaveCount(0); await raw(page, copy).click();
        expect(posts(fixture)).toHaveLength(1); await review(page, copy); await confirmRaw(page, copy).click();
        await expect(region(page, copy)).toHaveCount(0); expect(posts(fixture)[1].body!.expectedHead).toBe(latest.id);
      } else if (invalidate === "day") {
        await fixture.setNow("2026-10-31T02:00:00.000Z"); await confirmSummary(page, copy).click();
        await expect(confirmRaw(page, copy)).toHaveCount(0); expect(posts(fixture)).toHaveLength(1); expect(fixture.ownedRows()).toEqual([latest]);
      } else {
        const callbacks = await page.evaluate(({ key }) => {
          const a = JSON.parse(localStorage.getItem(key)!); const b = structuredClone(a);
          b.user.id = "00000000-0000-4000-8000-000000000072";
          const claims = JSON.parse(atob(b.access_token.split(".")[1])); claims.sub = b.user.id;
          b.access_token = `${b.access_token.split(".")[0]}.${btoa(JSON.stringify(claims))}.synthetic-signature`;
          const channels = (window as typeof window & { syntheticAuthChannels: BroadcastChannel[] }).syntheticAuthChannels.filter((channel) => channel.name === key);
          // Dispatch both receiver events synchronously in ONE task. SDK auth
          // subscribers execute before their first await; React cannot render
          // between these events. No private React refs/state are inspected.
          for (const channel of channels) {
            channel.dispatchEvent(new MessageEvent("message", { data: { event: "SIGNED_IN", session: b } }));
            channel.dispatchEvent(new MessageEvent("message", { data: { event: "SIGNED_IN", session: a } }));
          }
          return channels.length;
        }, { key: fixture.storageKey });
        expect(callbacks).toBe(1);
        await expect(confirmRaw(page, copy)).toHaveCount(0); await taskBarrier(page);
        expect(posts(fixture)).toHaveLength(1); expect(fixture.ownedRows()).toEqual([latest]);
      }
    });
  }
}

for (const [prefix, locale, copy] of [["", "zh-CN", zh], ["/en", "en", en]] as const) {
  test(`${locale} denied/corrupt/late preview never grants confirmation; tombstone remains a version`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, prefix, copy); const latest = await conflict(page, fixture, copy);
    for (const mode of ["denied", "corrupt"] as const) {
      const intercept = async (route: import("@playwright/test").Route) => {
        if (route.request().method() !== "GET") return route.fallback();
        return route.fulfill(mode === "denied" ? { status: 403, json: { status: "denied" } }
          : { status: 200, json: { ...fixture.scope(), headToken: "broken-head" } });
      };
      await page.route("**/api/sweet-records**", intercept);
      await view(page, copy).click(); await expect(view(page, copy)).toBeEnabled();
      await expect(confirmRaw(page, copy)).toHaveCount(0); expect(posts(fixture)).toHaveLength(1);
      await page.unroute("**/api/sweet-records**", intercept);
      if (mode === "denied") {
        // consent.refresh after denied is a same-actor recheck, not a new intent.
        await expect(page.getByTestId("inline-student-consent").getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
      }
    }
    await page.evaluate(() => {
      const runtime = window as typeof window & { syntheticReviewParsed: number };
      runtime.syntheticReviewParsed = 0;
      const original = window.fetch.bind(window);
      window.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await original(...args);
        if (new URL(response.url).pathname === "/api/sweet-records" && (!args[1]?.method || args[1].method === "GET")) {
          const json = response.json.bind(response);
          response.json = async () => { try { return await json(); } finally { runtime.syntheticReviewParsed++; } };
        }
        return response;
      };
    });
    let release!: () => void; let held = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const intercept = async (route: import("@playwright/test").Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      held = true; await gate; return route.fulfill({ json: fixture.scope() });
    };
    await page.route("**/api/sweet-records**", intercept);
    try {
      await view(page, copy).click(); await expect.poll(() => held).toBe(true);
      await page.locator("main article button[aria-pressed]").nth(1).click(); release();
      await expect.poll(() => page.evaluate(() => (window as typeof window & { syntheticReviewParsed: number }).syntheticReviewParsed)).toBe(1);
      await taskBarrier(page);
      await expect(confirmRaw(page, copy)).toHaveCount(0); expect(posts(fixture)).toHaveLength(1);
    } finally { release(); await page.unroute("**/api/sweet-records**", intercept); }
    fixture.state.rows = []; fixture.state.heads[0].headToken = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; fixture.state.heads[0].recordId = null;
    await review(page, copy); await expect(region(page, copy).getByText(copy.checkIn.conflict.noRecord, { exact: true })).toBeVisible();
    await confirmRaw(page, copy).click(); await expect(region(page, copy)).toHaveCount(0);
    expect(posts(fixture)[1].body!.expectedHead).toBe("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(posts(fixture)[1].body!.expectedHead).not.toBe(latest.id); expect(fixture.ownedRows()[0].summary).toBeNull();
  });

  test(`${locale} conflict comparison layout, html lang and locale cookie`, async ({ page, baseURL }, info) => {
    const fixture = await setup(page, baseURL!, prefix, copy); await conflict(page, fixture, copy); await review(page, copy);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await region(page, copy).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const button of await region(page, copy).getByRole("button").all()) {
      expect(await button.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await info.attach("conflict-comparison-layout", { body: await region(page, copy).screenshot(), contentType: "image/png" });
    await page.goto(prefix || "/"); await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const target = locale === "en" ? zh : en; const nextLocale = locale === "en" ? "zh-CN" : "en";
    await page.getByRole("group", { name: copy.common.languageSwitcher.ariaLabel, exact: true }).getByRole("button", {
      name: locale === "en" ? copy.common.languageSwitcher.chinese : copy.common.languageSwitcher.english, exact: true,
    }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
    expect((await page.context().cookies()).find((cookie) => cookie.name === "NEXT_LOCALE")?.value).toBe(nextLocale);
    await expect(page.getByRole("group", { name: target.common.languageSwitcher.ariaLabel, exact: true })).toBeVisible();
  });
}
