import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { sweetSummaryTraffic, syntheticSweetSummary } from "./fixtures/synthetic-sweet-summary";

type Copy = typeof zh | typeof en;
type SummaryFixture = Awaited<ReturnType<typeof syntheticSweetSummary>>;
const summaryOne = "SYNTHETIC_PERSISTED_SUMMARY_ONE";
const summaryTwo = "SYNTHETIC_PERSISTED_SUMMARY_TWO";
const fixtures = new WeakMap<Page, SummaryFixture>();

async function setup(page: Page, baseURL: string) {
  const fixture = await syntheticSweetSummary(page, baseURL);
  fixtures.set(page, fixture);
  return fixture;
}
async function complete(page: Page, copy: Copy) {
  await expect(page.getByRole("button", { name: copy.account.actions.signOut, exact: true, includeHidden: true }).first()).toBeAttached();
  const progress = (step: number) => page.getByText(copy.checkIn.progress.step
    .replace("{{current}}", String(step)).replace("{{total}}", "5"), { exact: true });
  for (let step = 0; step < 5; step++) {
    await expect(progress(step + 1)).toBeVisible();
    const option = page.locator("main article button[aria-pressed]").first();
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
    if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
  }
}
async function saveRaw(page: Page, copy: Copy) {
  await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).click();
  await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
}
async function generate(page: Page, copy: Copy) {
  await page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }).check();
  await page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true }).click();
}
async function accountHasSummary(page: Page, prefix: string, summary: string) {
  await page.goto(`${prefix}/account#records`);
  await expect(page.locator("#records").getByText(summary, { exact: true })).toBeVisible();
  await expect(page.locator("#records article")).toHaveCount(1);
}
async function saveResult(page: Page, copy: Copy) {
  await page.getByRole("button", { name: copy.checkIn.actions.saveToAccount, exact: true }).click();
  await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toBeVisible();
}
async function editExercise(page: Page, copy: Copy) {
  await page.getByRole("button", { name: copy.checkIn.actions.previous, exact: true }).click();
  await page.locator("main article button[aria-pressed]").nth(1).click();
  await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
}
async function parsed(page: Page, count: number) {
  await page.waitForFunction((expected) => (window as typeof window & { sweetSummaryParsed: number }).sweetSummaryParsed >= expected, count);
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 0), 0)));
}

test.afterEach(async ({ page }, testInfo) => {
  const fixture = fixtures.get(page);
  fixture?.releaseAll();
  if (fixture) await testInfo.attach("stateful-sweet-storage-evidence", {
    body: JSON.stringify(fixture.snapshot(), null, 2), contentType: "application/json",
  });
  const traffic = sweetSummaryTraffic.get(page);
  if (traffic) {
    expect(traffic.blockedExternal).toEqual([]);
    expect(traffic.unexpectedApi).toEqual([]);
  }
});

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} 原记录后保存小结真实执行helper写入并在刷新重新进入账户后回读`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await complete(page, copy);
    await saveRaw(page, copy);
    expect(fixture.ownedRows()).toHaveLength(1);
    expect(fixture.ownedRows()[0].summary).toBeNull();
    fixture.queueAi({ summary: summaryOne, smallStep: "SYNTHETIC_STEP_ONE", tool: "SYNTHETIC_TOOL_ONE" });
    await generate(page, copy);
    await expect(page.getByText(summaryOne, { exact: true })).toBeVisible();
    await expect.poll(() => fixture.ownedRows().map((row) => row.summary)).toEqual([summaryOne]);
    expect(fixture.ownedRows()[0]).toMatchObject({ small_step: "SYNTHETIC_STEP_ONE", recommended_next_tool: "SYNTHETIC_TOOL_ONE" });
    expect(fixture.state.requests.filter((request) => request.method === "POST")).toHaveLength(2);
    expect(fixture.participationDays()).toBe(1);
    await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toBeVisible();
    await page.reload();
    await accountHasSummary(page, prefix, summaryOne);
    await page.reload();
    await expect(page.locator("#records").getByText(summaryOne, { exact: true })).toBeVisible();
    await page.goto(`${prefix}/check-in`);
    await accountHasSummary(page, prefix, summaryOne);
    expect(fixture.participationDays()).toBe(1);
    expect(fixture.state.otpSends).toBe(0);
    expect(fixture.state.otpVerifies).toBe(0);
  });

  test(`${prefix || "zh"} S1更新S2及单独下一步变化均持久化，重复保存不增行或参与日`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await complete(page, copy);
    fixture.queueAi({ summary: summaryOne });
    await generate(page, copy);
    await expect.poll(() => fixture.ownedRows().map((row) => row.summary)).toEqual([summaryOne]);
    await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toBeVisible();
    const firstId = fixture.ownedRows()[0].id;
    fixture.queueAi({ summary: summaryTwo });
    await generate(page, copy);
    await expect.poll(() => fixture.ownedRows().map((row) => row.summary)).toEqual([summaryTwo]);
    expect(fixture.ownedRows()[0].id).not.toBe(firstId);
    expect(fixture.state.requests.filter((request) => request.method === "POST")).toHaveLength(2);
    const secondId = fixture.ownedRows()[0].id;
    await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toBeDisabled();
    await page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true }).dispatchEvent("click");
    await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
    expect(fixture.state.requests.filter((request) => request.method === "POST")).toHaveLength(2);
    expect(fixture.ownedRows()[0].id).toBe(secondId);

    fixture.queueAi({ summary: summaryTwo, smallStep: "SYNTHETIC_UPDATED_STEP", tool: "SYNTHETIC_UPDATED_TOOL" });
    await generate(page, copy);
    await expect.poll(() => fixture.ownedRows()[0]?.small_step).toBe("SYNTHETIC_UPDATED_STEP");
    expect(fixture.ownedRows()).toHaveLength(1);
    expect(fixture.ownedRows()[0]).toMatchObject({ summary: summaryTwo, recommended_next_tool: "SYNTHETIC_UPDATED_TOOL" });
    expect(fixture.state.requests.filter((request) => request.method === "POST")).toHaveLength(3);
    expect(fixture.participationDays()).toBe(1);
    expect(fixture.garden()).toMatchObject({ total: 1, thisWeek: 1, thisMonth: 1, fullSweetRecords: 1, todayParticipated: true });
    await accountHasSummary(page, prefix, summaryTwo);
    await expect(page.locator("#records")).not.toContainText(summaryOne);
    await expect(page.locator("#records")).toContainText("SYNTHETIC_UPDATED_STEP");
    await expect(page.locator("#records")).toContainText("SYNTHETIC_UPDATED_TOOL");
    await page.goto(`${prefix}/garden`);
    await expect.poll(() => fixture.state.gardenSnapshots.length).toBeGreaterThan(0);
    expect(fixture.state.gardenSnapshots.at(-1)).toMatchObject({ total: 1, fullSweetRecords: 1, todayParticipated: true });
    await expect(page.getByText(copy.garden.status.todayRecorded, { exact: true }).first()).toBeVisible();
    await expect(page.locator(".garden-fact-grid div").filter({ hasText: copy.garden.stats.totalLabel }).locator("dd")).toHaveText("1");
    await page.getByRole("button", { name: copy.garden.explore.pond.label, exact: true }).click();
    await expect(page.getByText(copy.garden.explore.pond.response, { exact: true })).toBeVisible();
  });

  test(`${prefix || "zh"} 已存S1再次生成失败与独立AI选择切换均不把小结降级为空`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await complete(page, copy);
    fixture.queueAi({ summary: summaryOne });
    await generate(page, copy);
    await expect.poll(() => fixture.ownedRows().map((row) => row.summary)).toEqual([summaryOne]);
    const id = fixture.ownedRows()[0].id;
    fixture.queueAi({ status: 503 });
    await generate(page, copy);
    await expect(page.getByText("Synthetic summary unavailable", { exact: true })).toBeVisible();
    expect(fixture.ownedRows()).toHaveLength(1);
    expect(fixture.ownedRows()[0]).toMatchObject({ id, summary: summaryOne });
    expect(fixture.state.requests.filter((request) => request.method === "POST")).toHaveLength(1);

    const choice = page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true });
    await choice.uncheck();
    await choice.check();
    fixture.queueAi({ status: 503 });
    await page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true }).click();
    await expect.poll(() => fixture.state.aiRequests.length).toBe(3);
    await parsed(page, 3);
    expect(fixture.ownedRows()[0]).toMatchObject({ id, summary: summaryOne });
    expect(fixture.state.requests.filter((request) => request.method === "POST")).toHaveLength(1);
    await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).first().click();
    expect(fixture.ownedRows()[0].summary).toBe(summaryOne);
    await accountHasSummary(page, prefix, summaryOne);
  });

  test(`${prefix || "zh"} 新S2保存失败不假报已存，顶部仅保存不降级S1，显式重试保存S2`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await complete(page, copy);
    fixture.queueAi({ summary: summaryOne });
    await generate(page, copy);
    await expect.poll(() => fixture.ownedRows().map((row) => row.summary)).toEqual([summaryOne]);
    fixture.state.insertFailures = 1;
    fixture.queueAi({ summary: summaryTwo });
    await generate(page, copy);
    await expect(page.getByText(summaryTwo, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.checkIn.messages.saveFailed, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.checkIn.actions.saveToAccount, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toHaveCount(0);
    expect(fixture.ownedRows().map((row) => row.summary)).toEqual([summaryOne]);

    await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).first().click();
    await expect(page.getByRole("button", { name: copy.checkIn.actions.saveToAccount, exact: true })).toBeVisible();
    await expect(page.getByText(copy.checkIn.messages.alreadySaved, { exact: true })).toHaveCount(0);
    await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toHaveCount(0);
    expect(fixture.ownedRows().map((row) => row.summary)).toEqual([summaryOne]);
    await saveResult(page, copy);
    await expect.poll(() => fixture.ownedRows().map((row) => row.summary)).toEqual([summaryTwo]);
    expect(fixture.ownedRows()).toHaveLength(1);
    expect(fixture.participationDays()).toBe(1);
    await accountHasSummary(page, prefix, summaryTwo);
  });

  test(`${prefix || "zh"} 首次生成失败仍存原记录，换答案后失败不复用旧答案小结`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await complete(page, copy);
    fixture.queueAi({ status: 503 });
    await generate(page, copy);
    await expect.poll(() => fixture.ownedRows().length).toBe(1);
    expect(fixture.ownedRows()[0].summary).toBeNull();
    fixture.queueAi({ summary: summaryOne });
    await generate(page, copy);
    await expect.poll(() => fixture.ownedRows().map((row) => row.summary)).toEqual([summaryOne]);
    await editExercise(page, copy);
    fixture.queueAi({ status: 503 });
    await generate(page, copy);
    await expect.poll(() => fixture.state.aiRequests.length).toBe(3);
    await parsed(page, 3);
    await expect.poll(() => fixture.ownedRows().map((row) => row.summary)).toEqual([null]);
    expect(fixture.ownedRows()[0].records).toEqual(expect.arrayContaining([expect.objectContaining({
      id: "exercise", fields: expect.arrayContaining([expect.objectContaining({ id: "duration", value: "1–9 分钟" })]),
    })]));
    expect(fixture.participationDays()).toBe(1);
    await expect(page.getByText(summaryOne, { exact: true })).toHaveCount(0);
  });

  test(`${prefix || "zh"} 旧AI回应迟到不能覆盖已保存的新答案小结S2`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await complete(page, copy);
    const old = fixture.queueAi({ summary: summaryOne, hold: true });
    await generate(page, copy);
    await expect.poll(() => old.held).toBe(true);
    await editExercise(page, copy);
    fixture.queueAi({ summary: summaryTwo });
    await generate(page, copy);
    await expect.poll(() => fixture.ownedRows().map((row) => row.summary)).toEqual([summaryTwo]);
    old.release();
    await parsed(page, 2);
    await expect(page.getByText(summaryTwo, { exact: true })).toBeVisible();
    await expect(page.getByText(summaryOne, { exact: true })).toHaveCount(0);
    expect(fixture.ownedRows().map((row) => row.summary)).toEqual([summaryTwo]);
    expect(fixture.state.requests.filter((request) => request.method === "POST")).toHaveLength(1);
    await accountHasSummary(page, prefix, summaryTwo);
  });

  test(`${prefix || "zh"} S2正在生成时旧S1手动保存不可启动，释放后只保存当前S2`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await complete(page, copy);
    fixture.state.insertFailures = 1;
    fixture.queueAi({ summary: summaryOne });
    await generate(page, copy);
    await expect(page.getByText(summaryOne, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.checkIn.messages.saveFailed, { exact: true })).toBeVisible();
    expect(fixture.ownedRows()).toEqual([]);
    const newer = fixture.queueAi({ summary: summaryTwo, hold: true });
    await generate(page, copy);
    await expect.poll(() => newer.held).toBe(true);
    await expect(page.getByRole("button", { name: copy.checkIn.actions.saveToAccount, exact: true })).toBeDisabled();
    const saveFirstButtons = page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true });
    for (let index = 0; index < await saveFirstButtons.count(); index++) await expect(saveFirstButtons.nth(index)).toBeDisabled();
    expect(fixture.state.requests.filter((request) => request.method === "POST")).toHaveLength(1);
    newer.release();
    await expect.poll(() => fixture.ownedRows().map((row) => row.summary)).toEqual([summaryTwo]);
    await expect(page.getByText(summaryTwo, { exact: true })).toBeVisible();
    expect(fixture.state.requests.filter((request) => request.method === "POST").map((request) => request.body?.summary)).toEqual([summaryOne, summaryTwo]);
    await accountHasSummary(page, prefix, summaryTwo);
  });

  test(`${prefix || "zh"} 已派发保存可完成，但旧完成不把已编辑的新稿标为已保存`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await complete(page, copy);
    const insert = fixture.holdInsert();
    fixture.queueAi({ summary: summaryOne });
    await generate(page, copy);
    await expect.poll(() => insert.held).toBe(true);
    await editExercise(page, copy);
    insert.release();
    await expect.poll(() => insert.settled).toBe(true);
    await expect(page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true })).toBeEnabled();
    expect(fixture.ownedRows().map((row) => row.summary)).toEqual([summaryOne]);
    await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toHaveCount(0);
    await expect(page.getByText(summaryOne, { exact: true })).toHaveCount(0);
    fixture.queueAi({ summary: summaryTwo });
    await generate(page, copy);
    await expect.poll(() => fixture.ownedRows().map((row) => row.summary)).toEqual([summaryTwo]);
    expect(fixture.ownedRows()).toHaveLength(1);
    expect(fixture.participationDays()).toBe(1);
  });

  test(`${prefix || "zh"} 换账号后迟到AI不保存上一账号稿`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await complete(page, copy);
    const old = fixture.queueAi({ summary: summaryOne, hold: true });
    await generate(page, copy);
    await expect.poll(() => old.held).toBe(true);
    await fixture.changeSession("second_student");
    await expect(page.locator("header")).toContainText("Second inline account");
    await expect(page.locator("main article button[aria-pressed='true']")).toHaveCount(0);
    old.release();
    await parsed(page, 1);
    expect(fixture.state.rows).toEqual([]);
    expect(fixture.state.requests.filter((request) => request.method === "POST")).toEqual([]);
    await expect(page.getByText(summaryOne, { exact: true })).toHaveCount(0);
  });

  test(`${prefix || "zh"} 跨午夜按实际保存日保留两日快照，同日重复仍不增参与日`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    await fixture.setNow("2026-10-30T15:59:00.000Z");
    await page.goto(`${prefix}/check-in`);
    await complete(page, copy);
    await saveRaw(page, copy);
    await fixture.setNow("2026-10-30T16:01:00.000Z");
    fixture.queueAi({ summary: summaryOne });
    await generate(page, copy);
    await expect.poll(() => fixture.ownedRows().length).toBe(2);
    expect(fixture.ownedRows().map((row) => row.summary)).toEqual([null, summaryOne]);
    expect(fixture.participationDays()).toBe(2);
    expect(fixture.garden()).toMatchObject({ total: 2, fullSweetRecords: 2 });
    await expect(page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true })).toBeDisabled();
    await page.getByRole("button", { name: copy.checkIn.actions.savedToAccount, exact: true }).dispatchEvent("click");
    await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
    expect(fixture.ownedRows()).toHaveLength(2);
    await page.goto(`${prefix}/account#records`);
    await expect(page.locator("#records").getByText(summaryOne, { exact: true })).toBeVisible();
    await expect(page.locator("#records article")).toHaveCount(2);
  });

  for (const urgent of [true, false]) {
    test(`${prefix || "zh"} ${urgent ? "危机" : "普通压力"}输入保持确定性分流与持久化边界`, async ({ page, baseURL }) => {
      const fixture = await setup(page, baseURL!);
      await page.goto(`${prefix}/check-in`);
      await page.getByRole("button", { name: copy.checkIn.form.expandDetails, exact: false }).click();
      await page.getByPlaceholder(copy.checkIn.steps.sleep.fields.note.placeholder, { exact: true }).fill(urgent
        ? prefix ? "I want to die" : "我现在想自杀"
        : prefix ? "I feel overwhelmed by homework" : "今天作业有点多，我觉得压力大");
      await complete(page, copy);
      if (urgent) {
        await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).click();
        await expect(page.getByRole("heading", { name: copy.aiSafety.urgent.title, exact: true })).toBeVisible();
        expect(fixture.state.aiRequests).toEqual([]);
        expect(fixture.state.rows).toEqual([]);
      } else {
        fixture.queueAi({ summary: summaryOne });
        await generate(page, copy);
        await expect.poll(() => fixture.ownedRows().map((row) => row.summary)).toEqual([summaryOne]);
        await expect(page.getByRole("heading", { name: copy.aiSafety.urgent.title, exact: true })).toHaveCount(0);
      }
      expect(fixture.state.consentPosts).toEqual([]);
      expect(fixture.state.otpSends).toBe(0);
    });
  }
}
