import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { syntheticInlineConsent } from "./fixtures/synthetic-inline-consent";
import { syntheticInlineTools } from "./fixtures/synthetic-inline-tools";

for (const [prefix, copy, urgent, ordinary] of [
  ["", zh, "我现在想自杀", "今天作业有点多，我觉得压力大"],
  ["/en", en, "I want to die", "I feel overwhelmed by homework"],
] as const) {
  for (const isUrgent of [true, false]) {
    test(`${prefix || "zh"} 原页未确认时${isUrgent ? "紧急指引仍可达" : "普通压力不触发紧急路径"}且不发送AI`, async ({ page, baseURL }) => {
      const { state } = await syntheticInlineConsent(page, baseURL!, { signedIn: false });
      await page.goto(`${prefix}/mood-journal`);
      await page.getByRole("textbox", { name: new RegExp(copy.moodJournal.reflection.context.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).fill(isUrgent ? urgent : ordinary);
      await page.getByRole("button", { name: copy.moodJournal.actions.organize, exact: true }).click();
      const title = page.getByRole("heading", { name: copy.aiSafety.urgent.title, exact: true });
      if (isUrgent) await expect(title).toBeVisible();
      else {
        await expect(title).toHaveCount(0);
        await expect(page.getByText(copy.inlineConsent.consentNeeded, { exact: true })).toBeVisible();
      }
      expect(state.aiCalls).toEqual([]);
      expect(state.consentPosts).toEqual([]);
      expect(state.otpSends).toBe(0);
      expect(state.unexpectedApi).toEqual([]);
      expect(state.blockedExternal).toEqual([]);
    });
  }

  test(`${prefix || "zh"} 仅保存入口先给紧急指引，不要求AI或基础确认且不写入`, async ({ page, baseURL }) => {
    const { state, tool } = await syntheticInlineTools(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await page.getByRole("button", { name: copy.checkIn.form.expandDetails, exact: false }).click();
    await page.getByPlaceholder(copy.checkIn.steps.sleep.fields.note.placeholder, { exact: true }).fill(urgent);
    for (let step = 0; step < 5; step += 1) {
      await page.locator("main article button[aria-pressed]").first().click();
      if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
    }
    await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).click();
    await expect(page.getByRole("heading", { name: copy.aiSafety.urgent.title, exact: true })).toBeVisible();
    expect(tool.sweetWrites).toEqual([]);
    expect(state.aiCalls).toEqual([]);
    expect(state.consentPosts).toEqual([]);
    expect(state.unexpectedApi).toEqual([]);
    expect(state.blockedExternal).toEqual([]);
  });
}
