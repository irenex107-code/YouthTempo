import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { syntheticInlineConsent } from "./fixtures/synthetic-inline-consent";

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  for (const signedIn of [false, true]) {
    test(`${prefix || "zh"} both age entries fit the first 320×568 screen when signed ${signedIn ? "in" : "out"}`, async ({ page, baseURL, isMobile }) => {
      test.skip(!isMobile, "This check uses a small phone viewport");
      await page.setViewportSize({ width: 320, height: 568 });
      await syntheticInlineConsent(page, baseURL!, { signedIn, consentState: "active" });
      await page.goto(`${prefix}/for-young-people`);
      const header = page.getByRole("banner");
      if (signedIn) await expect(header.getByRole("button", { name: copy.account.actions.signOut, exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      for (const choice of Object.values(copy.forYoungPeople.paths)) {
        await expect(page.getByRole("link", { name: choice.action, exact: true })).toBeInViewport({ ratio: 1 });
      }
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    });
  }

  test(`${prefix || "zh"} garden, SWEET steps and writing fields fit a 320px screen`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 664 });
    for (const [route, selector, count] of [
      ["/", ".garden-hotspot", 3],
      ["/check-in", "button[aria-current='step'], button[aria-current='step'] ~ button", 5],
      ["/mood-journal", "textarea[id^='mood-journal-']", 4],
    ] as const) {
      await page.goto(`${prefix}${route}`);
      const controls = page.locator(selector);
      await expect(controls).toHaveCount(count);
      for (const control of await controls.all()) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(320);
      }
    }
  });

  test(`${prefix || "zh"} signed-in navigation fits each viewport with a long account name`, async ({ page, baseURL, isMobile }) => {
    test.skip(isMobile, "This test sets its own viewport widths");
    const displayName = "Garden Walkthrough ".repeat(4).trim();
    await syntheticInlineConsent(page, baseURL!, { consentState: "active", displayName });
    await page.goto(`${prefix}/for-young-people`);
    const header = page.getByRole("banner");
    await expect(header.locator("a[title]")).toHaveAttribute("title", new RegExp(displayName));
    const menu = header.getByRole("button", { name: copy.common.navbar.openMenu, exact: true });
    const signOut = header.getByRole("button", { name: copy.account.actions.signOut, exact: true });
    for (const width of [1024, 1200, 1279, 1280, 1440, 768, 390, 375, 320]) {
      await page.setViewportSize({ width, height: 700 });
      await expect(signOut, `${width}px with the menu closed`).toBeInViewport({ ratio: 1 });
      for (const control of await header.locator("a:visible, button:visible").all()) {
        await expect(control, `${width}px header`).toBeInViewport({ ratio: 1 });
      }
      if (await menu.isVisible()) await menu.click();
      await expect(signOut).toBeInViewport({ ratio: 1 });
      const close = header.getByRole("button", { name: copy.common.navbar.closeMenu, exact: true });
      if (await close.isVisible()) await close.click();
    }
  });

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
    const close = header.getByRole("button", { name: copy.common.navbar.closeMenu, exact: true });
    if (await close.isVisible()) await close.click();
    await header.getByRole("button", { name: copy.account.actions.signOut, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(prefix + "/account\\?signedOut=1$"));
    await expect(page.getByText(copy.account.notices.signedOut, { exact: true }).first()).toBeVisible();
    expect(state.signedIn).toBe(false);
    await page.reload();
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
    await expect(page.getByRole("textbox", { name: copy.account.visitor.email, exact: true })).toBeVisible();
    await expect(header.getByRole("button", { name: copy.account.actions.signOut, exact: true })).toHaveCount(0);
  });

  test(`${prefix || "zh"} account shows sign out with settings closed`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!, { consentState: "active", displayName: "Alex" });
    for (const table of ["sweet_records", "wechat_identities"]) {
      await page.route(`**/rest/v1/${table}?**`, async route => {
        expect(route.request().method()).toBe("GET");
        await route.fulfill({ json: [] });
      });
    }
    await page.goto(`${prefix}/account`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toContainText("Alex");
    await expect(main.locator("details").filter({ hasText: copy.account.settings.title })).toHaveJSProperty("open", false);
    const signOut = main.getByRole("button", { name: copy.account.actions.signOut, exact: true });
    await expect(signOut).toBeInViewport({ ratio: 1 });
    await signOut.click();
    await expect(main.getByRole("textbox", { name: copy.account.visitor.email, exact: true })).toBeVisible();
    expect(state.signedIn).toBe(false);
    await page.reload();
    await expect(main.getByRole("textbox", { name: copy.account.visitor.email, exact: true })).toBeVisible();
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
    const history = page.getByRole("link", { name: copy.checkIn.historyLink, exact: true });
    await expect(history).toHaveAttribute("href", `${prefix}/account#records`);
    await expect(history).toHaveAttribute("target", "_blank");
  });

  test(`${prefix || "zh"} a young adult can reach support without a questionnaire or a school`, async ({ page, isMobile }) => {
    if (isMobile) await page.setViewportSize({ width: 390, height: 664 });
    await page.goto(`${prefix}/for-young-people`);
    const choices = copy.forYoungPeople.paths;
    const adultEntry = page.getByRole("link", { name: choices.youngAdults.action });
    await expect(page.getByRole("link", { name: choices.secondary.action })).toBeInViewport({ ratio: 1 });
    await expect(adultEntry).toBeInViewport({ ratio: 1 });
    await adultEntry.click();
    await page.getByRole("navigation", { name: copy.studentActions.label }).getByRole("link", { name: copy.studentActions.talk }).click();
    await expect(page).toHaveURL(new RegExp(prefix + "/for-young-adults#direct-support$"));
    await expect(page.getByRole("heading", { name: copy.studentActions.adultSupport, exact: true })).toBeInViewport();
    await expect(page.getByText(copy.studentActions.adultSupportBody)).toBeVisible();
    await page.getByRole("link", { name: copy.forYoungAdults.tools.items.support.action }).click();
    await expect(page.getByRole("heading", { name: copy.supportFlow.closed.title })).toBeVisible();
    const talk = page.getByRole("link", { name: copy.supportFlow.closed.referral, exact: true });
    await expect(talk).toHaveCount(1);
    await expect(talk).toHaveAttribute("href", `${prefix}/for-young-adults#direct-support`);
    await expect(page.getByRole("link", { name: copy.supportFlow.closed.record, exact: true })).toHaveAttribute("href", `${prefix}/garden?audience=adult`);
  });
}
