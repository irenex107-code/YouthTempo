import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { draftCanary, resultCanary, syntheticInlineConsent } from "./fixtures/synthetic-inline-consent";

type Copy = typeof zh | typeof en;
const publicPaths = ["/for-young-people", "/for-parents", "/for-teachers", "/garden", "/community", "/referral"].sort();

async function openHeaderMenu(page: Page) {
  const toggle = page.locator("header button[aria-expanded]");
  if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
}

async function publicMenuPaths(page: Page) {
  await openHeaderMenu(page);
  const paths = await page.locator("header nav:visible a").evaluateAll((links) => links.map((link) =>
    new URL((link as HTMLAnchorElement).href).pathname.replace(/^\/en(?=\/|$)/, "")));
  return [...new Set(paths.filter((pathname) => publicPaths.includes(pathname)))].sort();
}

async function visibleExit(page: Page, copy: Copy) {
  let button = page.locator("header button:visible").filter({ hasText: copy.account.actions.signOut }).first();
  if (!await button.count()) await openHeaderMenu(page);
  button = page.locator("header button:visible").filter({ hasText: copy.account.actions.signOut }).first();
  await expect(button).toBeEnabled();
  return button;
}

async function capture(page: Page, label: string) {
  if (process.env.BUGFIX_FEEDBACK_CAPTURE !== "1") return;
  const directory = path.join(process.cwd(), "deliverables/bugfix-feedback-2026-10-29");
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${label}.png`), fullPage: false, animations: "disabled" });
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  for (const [role, target] of [["学生", "/garden"], ["家长", "/for-parents"], ["支持老师", "/account#students"],
    ["学校负责人", "/admin"], ["平台管理员", "/admin"], ["专业支持者", "/support/apply"]] as const) {
    test(`${prefix || "zh"} ${role}登录前后公共菜单稳定，角色工作入口独立`, async ({ page, baseURL }, testInfo) => {
      const fixture = await syntheticInlineConsent(page, baseURL!, { signedIn: false, role });
      await page.route("**/api/support/staff*", (route) => route.fulfill({ json: { application: null } }));
      await page.goto(`${prefix}/referral`);
      await expect(page.locator('header a[href$="/account"]').first()).toBeAttached();
      expect(await publicMenuPaths(page)).toEqual(publicPaths);
      await fixture.changeSession("second_student");
      await expect(page.locator(`header a.button-primary[href$="${target}"]:visible`).first()).toBeVisible();
      expect(await publicMenuPaths(page)).toEqual(publicPaths);
      await expect(page.locator('header nav:visible a[href$="/for-parents"]').first()).toBeVisible();
      if (role !== "学生") await expect(page.locator('header a.button-primary[href$="/garden"]')).toHaveCount(0);
      await visibleExit(page, copy);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      if (role === "家长") await capture(page, `public-menu-${prefix ? "en" : "zh"}-${testInfo.project.name}`);
      expect(fixture.state.consentPosts).toEqual([]);
      expect(fixture.state.profileWrites).toEqual([]);
      expect(fixture.state.aiCalls).toEqual([]);
      expect(fixture.state.unexpectedApi).toEqual([]);
      expect(fixture.state.blockedExternal).toEqual([]);
    });
  }

  for (const fail of [false, true]) {
    test(`${prefix || "zh"} 顶栏退出${fail ? "失败保留会话并安全重试" : "成功清会话且停留当前公共页"}`, async ({ page, baseURL }) => {
      const fixture = await syntheticInlineConsent(page, baseURL!, { consentState: "active" });
      let failLogout = fail;
      let calls = 0;
      await page.route("**/auth/v1/logout*", (route) => {
        calls++;
        return failLogout ? route.fulfill({ status: 500, json: { code: "unexpected_failure", msg: "PRIVATE_LOGOUT_DIAGNOSTIC" } })
          : route.fulfill({ status: 204 });
      });
      await page.goto(`${prefix}/referral`);
      await (await visibleExit(page, copy)).click();
      if (fail) {
        await expect(page.locator("header [role='alert']")).toHaveText(copy.account.errors.signOutFailed);
        await expect(page.locator("header")).not.toContainText("PRIVATE_LOGOUT_DIAGNOSTIC");
        expect(await page.evaluate((key) => Boolean(localStorage.getItem(key)), fixture.storageKey)).toBe(true);
        await expect(await visibleExit(page, copy)).toBeEnabled();
        failLogout = false;
        await (await visibleExit(page, copy)).click();
      }
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), fixture.storageKey)).toBeNull();
      await expect(page.locator("header button:visible").filter({ hasText: copy.account.actions.signOut })).toHaveCount(0);
      await expect(page).toHaveURL(`${baseURL}${prefix}/referral`);
      expect(await publicMenuPaths(page)).toEqual(publicPaths);
      expect(calls).toBe(fail ? 2 : 1);
      expect(fixture.state.consentPosts).toEqual([]);
      expect(fixture.state.aiCalls).toEqual([]);
      expect(fixture.state.unexpectedApi).toEqual([]);
      expect(fixture.state.blockedExternal).toEqual([]);
    });
  }

  test(`${prefix || "zh"} 顶栏拒绝未广播换号后的旧账号退出并刷新当前身份`, async ({ page, baseURL }) => {
    const fixture = await syntheticInlineConsent(page, baseURL!, { consentState: "active" });
    let logoutCalls = 0;
    await page.route("**/auth/v1/logout*", (route) => {
      logoutCalls++;
      return route.fulfill({ status: 204 });
    });
    await page.goto(`${prefix}/referral`);
    const exit = await visibleExit(page, copy);
    await expect(page.locator("header")).toContainText("Inline preview");
    fixture.state.user = { ...fixture.state.user, id: "00000000-0000-4000-8000-000000000072",
      email: "inline-072@example.invalid", user_metadata: { display_name: "Second inline account" } };
    fixture.state.consentOwner = fixture.state.user.id;
    // Storage changes without a storage event or Auth broadcast: the old A UI
    // must be rejected by the real sign-out guard, then refresh itself to B.
    await page.evaluate(({ key, user }) => {
      const session = JSON.parse(localStorage.getItem(key)!);
      const payload = btoa(JSON.stringify({ sub: user.id, exp: session.expires_at, role: "authenticated" }))
        .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
      session.user = user;
      session.access_token = `${session.access_token.split(".")[0]}.${payload}.synthetic-signature`;
      localStorage.setItem(key, JSON.stringify(session));
    }, { key: fixture.storageKey, user: fixture.state.user });
    await expect(page.locator("header")).toContainText("Inline preview");
    await exit.click();
    await expect(page.locator("header")).toContainText("Second inline account");
    await expect(page.locator("header")).not.toContainText("Inline preview");
    await expect(await visibleExit(page, copy)).toBeEnabled();
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).user.id, fixture.storageKey)).toBe(fixture.state.user.id);
    await expect(page.locator("header [role='alert']")).toHaveCount(0);
    expect(logoutCalls).toBe(0);
    expect(fixture.state.profileWrites).toEqual([]);
    expect(fixture.state.consentPosts).toEqual([]);
    expect(fixture.state.unexpectedApi).toEqual([]);
    expect(fixture.state.blockedExternal).toEqual([]);
  });

  for (const [role, target] of [["家长", "/for-parents"], ["支持老师", "/account#students"],
    ["专业支持者", "/support/apply"]] as const) {
    test(`${prefix || "zh"} 1536宽屏完整菜单、长账户名、${role}操作和退出互不重叠`, async ({ page, baseURL }, testInfo) => {
      await page.setViewportSize({ width: 1536, height: 960 });
      const displayName = "Alexandra Chen Williams School Community Participant";
      const fixture = await syntheticInlineConsent(page, baseURL!, { consentState: "active", displayName, role });
      await page.route("**/api/support/staff*", (route) => route.fulfill({ json: { application: null } }));
      await page.goto(`${prefix}/referral`);
      const header = page.locator("header");
      await expect(header.locator(`a.button-primary[href$="${target}"]:visible`)).toBeVisible();
      await expect(header.locator('a[href$="/account"]:visible')).toHaveAttribute("title", copy.common.navbar.account.greetingWithName.replace("{{name}}", displayName));
      const accountText = header.locator('a[href$="/account"]:visible span');
      await expect(accountText).toHaveText(copy.common.navbar.account.greetingWithName.replace("{{name}}", displayName));
      expect(await accountText.evaluate((element) => {
        const style = getComputedStyle(element);
        const anchor = element.parentElement!;
        return style.textOverflow === "ellipsis" && style.overflowX === "hidden" &&
          element.getBoundingClientRect().left >= anchor.getBoundingClientRect().left && element.scrollLeft === 0;
      })).toBe(true);
      await visibleExit(page, copy);
      await expect(header.locator("button[aria-expanded]")).toBeHidden();
      expect(await publicMenuPaths(page)).toEqual(publicPaths);
      const layout = await header.locator("a:visible, button:visible").evaluateAll((elements) => {
        const rectangles = elements.map((element) => {
          const { left, right, top, bottom } = element.getBoundingClientRect();
          return { name: element.textContent?.trim(), left, right, top, bottom };
        });
        const outside = rectangles.filter((rect) => rect.left < -1 || rect.right > innerWidth + 1);
        const overlaps = rectangles.flatMap((rect, index) => rectangles.slice(index + 1).filter((other) =>
          Math.min(rect.right, other.right) - Math.max(rect.left, other.left) > 1 &&
          Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) > 1)
          .map((other) => [rect.name, other.name]));
        return { outside, overlaps };
      });
      expect(layout).toEqual({ outside: [], overlaps: [] });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      if (role === "家长") await capture(page, `wide-header-${prefix ? "en" : "zh"}-${testInfo.project.name}`);
      expect(fixture.state.consentPosts).toEqual([]);
      expect(fixture.state.profileWrites).toEqual([]);
      expect(fixture.state.aiCalls).toEqual([]);
      expect(fixture.state.unexpectedApi).toEqual([]);
      expect(fixture.state.blockedExternal).toEqual([]);
    });
  }

  test(`${prefix || "zh"} 顶栏旧账号退出迟到结果不清除新账号会话或界面`, async ({ page, baseURL }) => {
    const fixture = await syntheticInlineConsent(page, baseURL!, { consentState: "active" });
    await page.addInitScript(() => {
      const runtime = window as typeof window & { feedbackLogoutSettled: number };
      runtime.feedbackLogoutSettled = 0;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args: Parameters<typeof fetch>) => {
        const input = args[0];
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (new URL(url, location.href).pathname !== "/auth/v1/logout") return originalFetch(...args);
        try { return await originalFetch(...args); }
        finally { runtime.feedbackLogoutSettled++; }
      };
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const owners: string[] = [];
    await page.route("**/auth/v1/logout*", async (route) => {
      const token = route.request().headers().authorization.split(" ")[1];
      owners.push(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub);
      await gate;
      await route.fulfill({ status: 204 });
    });
    await page.goto(`${prefix}/referral`);
    const firstId = fixture.state.user.id;
    try {
      await test.step("旧账号退出请求停在实际Auth传输", async () => {
        await (await visibleExit(page, copy)).click();
        await expect.poll(() => owners.length).toBe(1);
      });
      await test.step("切换并显示新账号", async () => {
        await fixture.changeSession("second_student");
        await openHeaderMenu(page);
        await expect(page.locator("header")).toContainText("Second inline account");
      });
      await test.step("释放旧响应并等待浏览器实际fetch完成", async () => {
        release();
        await page.waitForFunction(() => (window as typeof window & { feedbackLogoutSettled: number }).feedbackLogoutSettled === 1);
        await page.evaluate(() => new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 0), 0)));
      });
      expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).user.id, fixture.storageKey)).toBe(fixture.state.user.id);
      await expect(page.locator("header")).toContainText("Second inline account");
      await expect(page.locator("header [role='alert']")).toHaveCount(0);
      expect(owners).toEqual([firstId]);
      expect(fixture.state.blockedExternal).toEqual([]);
    } finally { release(); }
  });

  test(`${prefix || "zh"} 心情拼图缺确认时打开原页弹窗，关闭保留草稿和已选年龄`, async ({ page, baseURL }, testInfo) => {
    const { state } = await syntheticInlineConsent(page, baseURL!);
    await page.goto(`${prefix}/mood-journal`);
    const context = page.getByRole("textbox", { name: copy.moodJournal.reflection.context });
    await context.fill(draftCanary);
    const panel = page.getByTestId("inline-student-consent");
    await panel.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true }).selectOption("14_17");
    const organize = page.getByRole("button", { name: copy.moodJournal.actions.organize, exact: true });
    await organize.click();
    const dialog = page.getByRole("dialog", { name: copy.inlineConsent.title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.getByTestId("inline-student-consent")).toHaveCount(1);
    await expect(dialog.getByRole("combobox")).toHaveValue("14_17");
    await expect(dialog.getByRole("button", { name: copy.inlineConsent.closeDialog, exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await capture(page, `consent-dialog-${prefix ? "en" : "zh"}-${testInfo.project.name}`);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(organize).toBeFocused();
    await expect(context).toHaveValue(draftCanary);
    await expect(panel.getByRole("combobox")).toHaveValue("14_17");
    await expect(page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true })).not.toBeChecked();
    expect(state.consentPosts).toEqual([]);
    expect(state.aiCalls).toEqual([]);
    expect(state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 弹窗完成基础确认后留在原任务，AI仍要另选且主动提交`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!);
    await page.goto(`${prefix}/mood-journal`);
    const context = page.getByRole("textbox", { name: copy.moodJournal.reflection.context });
    await context.fill(draftCanary);
    const organize = page.getByRole("button", { name: copy.moodJournal.actions.organize, exact: true });
    await organize.click();
    const dialog = page.getByRole("dialog", { name: copy.inlineConsent.title, exact: true });
    await dialog.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true }).selectOption("14_17");
    await dialog.getByRole("checkbox", { name: copy.account.consent.acknowledgement, exact: true }).check();
    await dialog.getByRole("button", { name: copy.account.consent.completeStudent, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
    await expect(context).toHaveValue(draftCanary);
    await expect(page).toHaveURL(`${baseURL}${prefix}/mood-journal`);
    const aiChoice = page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true });
    await expect(aiChoice).not.toBeChecked();
    expect(state.aiCalls).toEqual([]);
    await organize.click();
    expect(state.aiCalls).toEqual([]);
    await aiChoice.check();
    await organize.click();
    await expect(page.getByText(resultCanary, { exact: true })).toBeVisible();
    expect(state.aiCalls).toHaveLength(1);
    expect(state.aiCalls[0]).toMatchObject({ context: draftCanary, aiNoticeAccepted: true });
    expect(state.consentPosts).toEqual([{ action: "student_assent", ageBand: "14_17" }]);
    expect(state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 访客在同一弹窗登录并确认，不丢感受或自动发送`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!, { signedIn: false });
    await page.goto(`${prefix}/mood-journal`);
    const context = page.getByRole("textbox", { name: copy.moodJournal.reflection.context });
    await context.fill(draftCanary);
    await page.getByRole("button", { name: copy.moodJournal.actions.organize, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: copy.inlineConsent.title, exact: true });
    await dialog.getByRole("textbox", { name: copy.account.visitor.email, exact: true }).fill(state.user.email);
    await dialog.getByRole("button", { name: copy.account.visitor.sendOtp, exact: true }).click();
    await dialog.getByRole("textbox", { name: copy.account.visitor.otp, exact: true }).fill("12345678");
    await dialog.getByRole("button", { name: copy.account.visitor.signIn, exact: true }).click();
    await dialog.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true }).selectOption("14_17");
    await dialog.getByRole("checkbox", { name: copy.account.consent.acknowledgement, exact: true }).check();
    await dialog.getByRole("button", { name: copy.account.consent.completeStudent, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(context).toHaveValue(draftCanary);
    await expect(page).toHaveURL(`${baseURL}${prefix}/mood-journal`);
    await expect(page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true })).not.toBeChecked();
    expect(state.otpSends).toBe(1);
    expect(state.otpVerifies).toBe(1);
    expect(state.consentPosts).toEqual([{ action: "student_assent", ageBand: "14_17" }]);
    expect(state.aiCalls).toEqual([]);
    expect(state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 弹窗确认未满14岁仍受限，不因关闭或勾选AI获得资格`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!);
    await page.goto(`${prefix}/mood-journal`);
    await page.getByRole("textbox", { name: copy.moodJournal.reflection.context }).fill(draftCanary);
    const organize = page.getByRole("button", { name: copy.moodJournal.actions.organize, exact: true });
    await organize.click();
    const dialog = page.getByRole("dialog", { name: copy.inlineConsent.title, exact: true });
    await dialog.getByRole("combobox").selectOption("under_14");
    await dialog.getByRole("checkbox", { name: copy.account.consent.acknowledgement, exact: true }).check();
    await dialog.getByRole("button", { name: copy.account.consent.completeStudent, exact: true }).click();
    await expect(dialog.getByText(copy.account.consent.ineligible, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: copy.inlineConsent.closeDialog, exact: true }).click();
    await page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }).check();
    await organize.click();
    await expect(dialog.getByText(copy.account.consent.ineligible, { exact: true })).toBeVisible();
    expect(state.consentPosts).toEqual([{ action: "student_assent", ageBand: "under_14" }]);
    expect(state.aiCalls).toEqual([]);
    expect(state.blockedExternal).toEqual([]);
  });

  for (const signedIn of [false, true]) {
    test(`${prefix || "zh"} 中学生主按钮直达花园原任务 signedIn=${signedIn}`, async ({ page, baseURL }) => {
      const { state } = await syntheticInlineConsent(page, baseURL!, { signedIn });
      await page.goto(`${prefix}/for-teens`);
      const garden = page.getByRole("link", { name: copy.ageWorkspace.primary.garden.action, exact: true }).first();
      await expect(garden).toHaveAttribute("href", `${prefix}/garden`);
      await garden.click();
      await expect(page).toHaveURL(`${baseURL}${prefix}/garden`);
      await expect(page.getByTestId("inline-student-consent")).toBeVisible();
      expect(state.consentPosts).toEqual([]);
      expect(state.aiCalls).toEqual([]);
      expect(state.blockedExternal).toEqual([]);
    });
  }

  test(`${prefix || "zh"} 花园统一说明参与天数与开放位置，提醒和纪念物保持次级`, async ({ page, baseURL }, testInfo) => {
    const { state } = await syntheticInlineConsent(page, baseURL!, { consentState: "active" });
    await page.goto(`${prefix}/garden`);
    const facts = page.locator(".garden-facts");
    await expect(facts.getByText(copy.garden.growth.rhythmSummary, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: copy.garden.scene.title, exact: true })).toBeVisible();
    const options = page.locator("[data-garden-options]");
    await expect(options).not.toHaveAttribute("open", "");
    await expect(options.getByRole("combobox")).not.toBeVisible();
    await expect(options.getByRole("button", { name: copy.garden.keepsakes.open, exact: true })).not.toBeVisible();
    await expect(page.getByRole("navigation", { name: copy.garden.actions.ariaLabel }).getByRole("button")).toHaveCount(3);
    await options.locator("summary").click();
    await expect(options.getByRole("combobox")).toBeVisible();
    await expect(options.getByText(copy.garden.reminders.description, { exact: true })).toBeVisible();
    await capture(page, `garden-feedback-${prefix ? "en" : "zh"}-${testInfo.project.name}`);
    expect(state.gardenWrites).toBe(0);
    expect(state.aiCalls).toEqual([]);
    expect(state.blockedExternal).toEqual([]);
  });
}
