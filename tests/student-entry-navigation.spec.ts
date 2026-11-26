import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { syntheticInlineConsent } from "./fixtures/synthetic-inline-consent";

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} student can find all three garden actions and sign out`, async ({ page, baseURL }) => {
    const { state, storageKey } = await syntheticInlineConsent(page, baseURL!, { consentState: "active", ageBand: "14_17" });
    await page.goto(`${prefix}/garden`);
    const tasks = page.getByRole("navigation", { name: copy.studentActions.label });
    await expect(tasks.getByRole("button", { name: copy.studentActions.record })).toBeVisible();
    await expect(tasks.getByRole("link", { name: copy.studentActions.reflect })).toHaveAttribute("href", `${prefix}/mood-journal`);
    await expect(tasks.getByRole("link", { name: copy.studentActions.talk })).toHaveAttribute("href", `${prefix}/referral#direct-support`);
    await expect(page.getByText(copy.studentActions.countRule)).toBeVisible();
    const menu = page.getByRole("button", { name: copy.common.navbar.openMenu });
    if (await menu.isVisible()) await menu.click();
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: copy.common.navbar.nav.forParents, exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: copy.common.navbar.nav.forTeachers, exact: true })).toBeVisible();
    await header.getByRole("button", { name: copy.account.actions.signOut, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(prefix + "/account\\?signedOut=1$"));
    await expect(page.getByText(copy.account.notices.signedOut, { exact: true }).first()).toBeVisible();
    expect(state.signedIn).toBe(false);
    await page.reload();
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
    await expect(page.getByRole("textbox", { name: copy.account.visitor.email, exact: true })).toBeVisible();
  });

  test(`${prefix || "zh"} SWEET keeps all five answers through consent and saves only when asked`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!);
    const writes: Array<{ records: Array<{ id: string }> }> = [];
    let aiCalls = 0;
    await page.route("**/api/ai/check-in", route => { aiCalls++; return route.abort(); });
    await page.route("**/rest/v1/profiles?**", route => route.fulfill({ json: { id: state.user.id, role: "学生", display_name: "Student" } }));
    await page.route("**/rest/v1/sweet_records?**", async route => {
      if (route.request().method() === "GET") return route.fulfill({ json: [] });
      expect(route.request().method()).toBe("POST");
      const record = route.request().postDataJSON();
      writes.push(record);
      await route.fulfill({ status: 201, json: { id: "00000000-0000-4000-8000-000000000001", ...record } });
    });
    await page.goto(`${prefix}/check-in`);
    const steps = copy.checkIn.steps;
    for (const answer of [steps.sleep.fields.quality.options.veryGood, steps.wake.fields.state.options.veryEnergized,
      steps.eat.fields.rhythm.options.veryRegular, steps.exercise.fields.duration.options.oneToNine]) {
      await page.getByRole("button", { name: answer, exact: true }).click();
      await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
    }
    await page.getByRole("button", { name: steps.task.fields.engagement.options.smooth, exact: true }).click();
    const save = page.getByRole("button", { name: copy.studentActions.saveOnly, exact: true });
    await save.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: copy.inlineConsent.closeDialog }).click();
    expect(state.consentPosts).toHaveLength(0);
    await save.click();
    await dialog.getByRole("combobox").selectOption("14_17");
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: copy.account.consent.completeStudent }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(prefix + "/check-in$"));
    await expect(page.getByRole("checkbox", { name: copy.aiTransparency.confirm })).not.toBeChecked();
    expect(writes).toHaveLength(0);
    await save.click();
    await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0].records.map(r => r.id)).toEqual(["sleep", "wake", "eat", "exercise", "task"]);
    expect(aiCalls).toBe(0);
  });

  test(`${prefix || "zh"} a young adult can reach support without a questionnaire or a school`, async ({ page }) => {
    await page.goto(`${prefix}/for-young-people`);
    await page.getByRole("link", { name: copy.forYoungPeople.paths.youngAdults.action }).click();
    await page.getByRole("navigation", { name: copy.studentActions.label }).getByRole("link", { name: copy.studentActions.talk }).click();
    await expect(page).toHaveURL(new RegExp(prefix + "/for-young-adults#direct-support$"));
    await expect(page.getByRole("heading", { name: copy.studentActions.adultSupport, exact: true })).toBeInViewport();
    await expect(page.getByText(copy.studentActions.adultSupportBody)).toBeVisible();
  });
}
