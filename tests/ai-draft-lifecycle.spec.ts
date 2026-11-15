import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { inlineToolsTraffic, syntheticInlineTools } from "./fixtures/synthetic-inline-tools";

type Copy = typeof zh | typeof en;
type Tool = "mood-journal" | "check-in";
const oldResult = "SYNTHETIC_OLD_DRAFT_RESULT";
const newResult = "SYNTHETIC_CURRENT_DRAFT_RESULT";

async function transport(page: Page, tool: Tool, markers = [oldResult, newResult]) {
  // Model an already dispatched transport that does not honor abort, so the
  // assertions also exercise draft/operation guards rather than only fetch.
  await page.addInitScript(() => {
    const runtime = window as typeof window & { aiDraftSettled: number };
    runtime.aiDraftSettled = 0;
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!/\/api\/ai\/(?:check-in|mood-journal)$/.test(new URL(url, location.href).pathname)) return original(...args);
      try { return await original(input, { ...args[1], signal: undefined }); }
      finally { runtime.aiDraftSettled++; }
    };
  });
  const calls: Array<{ body: Record<string, unknown>; release: () => void }> = [];
  await page.route(`**/api/ai/${tool}`, async (route) => {
    const index = calls.length;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    calls.push({ body: route.request().postDataJSON() as Record<string, unknown>, release });
    await gate;
    const marker = markers[index] || newResult;
    return route.fulfill({ json: tool === "mood-journal"
      ? { emotionReflection: marker, possibleNeed: "Synthetic need", communicationSuggestion: "Synthetic expression", smallStep: "Synthetic action", supportReminder: "Synthetic support" }
      : { summary: marker, mainAffectedAreas: [], rhythmClue: "Synthetic rhythm", smallStep: "Synthetic action", recommendedNextTool: "Synthetic tool", supportReminder: "Synthetic support" } });
  });
  return calls;
}

async function settled(page: Page, count: number) {
  await page.waitForFunction((expected) => (window as typeof window & { aiDraftSettled: number }).aiDraftSettled >= expected, count);
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 0), 0)));
}

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
  test(`${prefix || "zh"} 心情拼图改稿后旧回应和finally不影响新一轮整理`, async ({ page, baseURL }) => {
    const fixture = await syntheticInlineTools(page, baseURL!, { consentState: "active" });
    const calls = await transport(page, "mood-journal");
    try {
      await page.goto(`${prefix}/mood-journal`);
      const context = page.getByRole("textbox", { name: copy.moodJournal.reflection.context });
      await context.fill("Old synthetic reflection");
      await page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }).check();
      await page.getByRole("button", { name: copy.moodJournal.actions.organize, exact: true }).click();
      await expect.poll(() => calls.length).toBe(1);
      await context.fill("Current synthetic reflection");
      await page.getByRole("button", { name: copy.moodJournal.actions.organize, exact: true }).click();
      await expect.poll(() => calls.length).toBe(2);
      calls[0].release();
      await settled(page, 1);
      await expect(page.getByText(oldResult, { exact: true })).toHaveCount(0);
      await expect(context).toHaveValue("Current synthetic reflection");
      await expect(page.getByRole("button", { name: copy.moodJournal.actions.organizing, exact: true })).toBeDisabled();
      calls[1].release();
      await expect(page.getByText(newResult, { exact: true })).toBeVisible();
      expect(calls.map((call) => call.body.context)).toEqual(["Old synthetic reflection", "Current synthetic reflection"]);
      expect(fixture.tool.sweetWrites).toEqual([]);
      expect(fixture.state.otpSends).toBe(0);
    } finally { calls.forEach((call) => call.release()); }
  });

  test(`${prefix || "zh"} SWEET改稿阻止旧AI闭包自动保存，旧finally不清新loading`, async ({ page, baseURL }) => {
    const fixture = await syntheticInlineTools(page, baseURL!, { consentState: "active" });
    const calls = await transport(page, "check-in");
    try {
      await page.goto(`${prefix}/check-in`);
      await completeCheckIn(page, copy);
      const aiChoice = page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true });
      await aiChoice.check();
      await page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true }).click();
      await expect.poll(() => calls.length).toBe(1);
      await editExercise(page, copy);
      await aiChoice.check();
      await page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true }).click();
      await expect.poll(() => calls.length).toBe(2);
      calls[0].release();
      await settled(page, 1);
      expect(fixture.tool.sweetWrites).toEqual([]);
      await expect(page.getByText(oldResult, { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: copy.checkIn.actions.generatingAndSaving, exact: true })).toBeDisabled();
      calls[1].release();
      await expect(page.getByText(newResult, { exact: true })).toBeVisible();
      await expect.poll(() => fixture.tool.sweetWrites.length).toBe(1);
      expect(fixture.tool.sweetWrites[0]).toMatchObject({ summary: newResult,
        records: expect.arrayContaining([expect.objectContaining({ id: "exercise", fields: expect.arrayContaining([
          expect.objectContaining({ id: "duration", value: "1–9 分钟" }),
        ]) })]),
      });
      expect(fixture.state.otpSends).toBe(0);
    } finally { calls.forEach((call) => call.release()); }
  });

  test(`${prefix || "zh"} SWEET重新开始后不复活旧AI结果或自动再保存`, async ({ page, baseURL }) => {
    const fixture = await syntheticInlineTools(page, baseURL!, { consentState: "active" });
    const calls = await transport(page, "check-in");
    try {
      await page.goto(`${prefix}/check-in`);
      await completeCheckIn(page, copy);
      await page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }).check();
      await page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true }).click();
      await expect.poll(() => calls.length).toBe(1);
      calls[0].release();
      await expect(page.getByText(oldResult, { exact: true })).toBeVisible();
      await expect.poll(() => fixture.tool.sweetWrites.length).toBe(1);
      await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true }).click();
      await expect.poll(() => calls.length).toBe(2);
      await page.getByRole("button", { name: copy.checkIn.actions.reset, exact: true }).click();
      await expect(page.locator("main article button[aria-pressed='true']")).toHaveCount(0);
      calls[1].release();
      await settled(page, 2);
      await expect(page.getByText(oldResult, { exact: true })).toHaveCount(0);
      await expect(page.getByText(newResult, { exact: true })).toHaveCount(0);
      await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toHaveCount(0);
      expect(fixture.tool.sweetWrites).toHaveLength(1);
    } finally { calls.forEach((call) => call.release()); }
  });

  for (const tool of ["mood-journal", "check-in"] as const) {
    test(`${prefix || "zh"} ${tool}取消独立AI选择后旧结果不可回填或触发保存`, async ({ page, baseURL }) => {
      const fixture = await syntheticInlineTools(page, baseURL!, { consentState: "active" });
      const calls = await transport(page, tool);
      try {
        await page.goto(`${prefix}/${tool}`);
        if (tool === "check-in") await completeCheckIn(page, copy);
        else await page.getByRole("textbox", { name: copy.moodJournal.reflection.context }).fill("Synthetic reflection");
        const choice = page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true });
        await choice.check();
        const label = tool === "check-in" ? copy.checkIn.actions.generateAndSave : copy.moodJournal.actions.organize;
        await page.getByRole("button", { name: label, exact: true }).click();
        await expect.poll(() => calls.length).toBe(1);
        await choice.uncheck();
        calls[0].release();
        await settled(page, 1);
        await expect(choice).not.toBeChecked();
        await expect(page.getByText(oldResult, { exact: true })).toHaveCount(0);
        expect(fixture.tool.sweetWrites).toEqual([]);
        await page.getByRole("button", { name: label, exact: true }).click();
        expect(calls).toHaveLength(1);
        expect(fixture.state.consentPosts).toEqual([]);
        expect(fixture.state.otpSends).toBe(0);
      } finally { calls.forEach((call) => call.release()); }
    });
  }

  test(`${prefix || "zh"} 已发出的SWEET存储不假称撤销，改稿后旧完成不标记新稿已保存`, async ({ page, baseURL }) => {
    const fixture = await syntheticInlineTools(page, baseURL!, { consentState: "active" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const dispatched: Array<Record<string, unknown>> = [];
    await page.route("**/api/sweet-records*", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      dispatched.push(route.request().postDataJSON() as Record<string, unknown>);
      if (dispatched.length === 1) await gate;
      return route.fallback();
    });
    try {
      await page.goto(`${prefix}/check-in`);
      await completeCheckIn(page, copy);
      await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).click();
      await expect.poll(() => dispatched.length).toBe(1);
      await editExercise(page, copy);
      await expect(page.getByRole("button", { name: copy.checkIn.actions.generatingAndSaving, exact: true })).toBeDisabled();
      expect(dispatched).toHaveLength(1);
      release();
      await expect.poll(() => fixture.tool.sweetWrites.length).toBe(1);
      await expect(page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true })).toBeEnabled();
      await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).click();
      await expect.poll(() => fixture.tool.sweetWrites.length).toBe(2);
      await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
      expect(dispatched).toHaveLength(2);
      expect(fixture.state.aiCalls).toEqual([]);
      expect(fixture.state.otpSends).toBe(0);
    } finally { release(); }
  });
}
