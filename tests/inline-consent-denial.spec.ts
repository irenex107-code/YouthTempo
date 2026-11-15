import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { syntheticInlineTools } from "./fixtures/synthetic-inline-tools";
import { draftCanary, syntheticInlineConsent } from "./fixtures/synthetic-inline-consent";

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} 保存前同意已失效时显示本页确认与具体原因，保留回答且不写入`, async ({ page, baseURL }) => {
    const { state, tool } = await syntheticInlineTools(page, baseURL!, { consentState: "active" });
    await page.goto(`${prefix}/check-in`);
    for (let step = 0; step < 5; step += 1) {
      await page.locator("main article button[aria-pressed]").first().click();
      if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
    }
    await expect(page.getByTestId("inline-student-consent").getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
    state.consentState = "withdrawn";
    await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).click();
    await expect(page.getByText(copy.inlineConsent.consentNeeded, { exact: true })).toBeVisible();
    await expect(page.getByTestId("inline-student-consent").getByRole("checkbox")).toBeVisible();
    await expect(page.locator("main article button[aria-pressed]").first()).toHaveAttribute("aria-pressed", "true");
    expect(tool.sweetWrites).toEqual([]); expect(state.aiCalls).toEqual([]);
    expect(state.consentPosts).toEqual([]); expect(state.unexpectedApi).toEqual([]); expect(state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} AI资格被服务端拒绝后原页重新核对确认且保留感受文字`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!, { consentState: "active" });
    await page.route("**/api/ai/mood-journal", async (route) => {
      state.consentState = "withdrawn";
      return route.fulfill({ status: 403, json: { error: copy.inlineConsent.consentNeeded } });
    });
    await page.goto(`${prefix}/mood-journal`);
    const draft = page.getByRole("textbox", { name: copy.moodJournal.reflection.context, exact: false });
    await draft.fill(draftCanary);
    await expect(page.getByTestId("inline-student-consent").getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }).check();
    await page.getByRole("button", { name: copy.moodJournal.actions.organize, exact: true }).click();
    await expect(page.getByTestId("inline-student-consent").getByRole("checkbox")).toBeVisible();
    await expect(draft).toHaveValue(draftCanary);
    expect(state.consentPosts).toEqual([]); expect(state.unexpectedApi).toEqual([]); expect(state.blockedExternal).toEqual([]);
  });
}
