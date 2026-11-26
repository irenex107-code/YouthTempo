import { expect, test, type Locator, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { draftCanary, inlineConsentTraffic, privateDiagnostic, resultCanary, syntheticInlineConsent } from "./fixtures/synthetic-inline-consent";

type Copy = typeof zh | typeof en;
function panel(page: Page) { return page.getByTestId("inline-student-consent"); }
function age(page: Page, copy: Copy) { return panel(page).getByRole("combobox", { name: copy.account.consent.ageRange, exact: true }); }
function assent(page: Page, copy: Copy) { return panel(page).getByRole("button", { name: copy.account.consent.completeStudent, exact: true }); }
function acknowledgement(page: Page, copy: Copy) { return panel(page).getByRole("checkbox", { name: copy.account.consent.acknowledgement, exact: true }); }
function context(page: Page, copy: Copy) { return page.getByRole("textbox", { name: copy.moodJournal.reflection.context }); }
function organize(page: Page, copy: Copy) { return page.getByRole("button", { name: copy.moodJournal.actions.organize, exact: true }); }
function aiChoice(page: Page, copy: Copy) { return page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }); }
async function expectReady(page: Page) {
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("heading")).toHaveCount(0);
  await expect(panel(page).getByRole("status")).toBeVisible();
}
async function clickIfEnabled(button: Locator) {
  await expect(button).toBeVisible();
  if (await button.isEnabled()) await button.click();
}
async function confirm(page: Page, copy: Copy, ageBand = "14_17") {
  await expect(age(page, copy)).toBeVisible();
  await age(page, copy).selectOption(ageBand);
  await acknowledgement(page, copy).check();
  await assent(page, copy).click();
}
async function assertDraftIsMemoryOnly(page: Page) {
  const stores = await page.evaluate(() => ({
    local: Object.values(localStorage).join(" "), session: Object.values(sessionStorage).join(" "),
  }));
  expect(stores.local).not.toContain(draftCanary);
  expect(stores.session).not.toContain(draftCanary);
  expect(stores.local).not.toContain(resultCanary);
  expect(stores.session).not.toContain(resultCanary);
}

test.afterEach(async ({ page }) => {
  const traffic = inlineConsentTraffic.get(page);
  if (traffic) {
    expect(traffic.blockedExternal, "No request may escape to an external origin").toEqual([]);
    expect(traffic.unexpectedApi, "Every API must have an explicit synthetic response").toEqual([]);
  }
});

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} 心情拼图在原页确认，保留草稿，不自动调用AI`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!);
    await page.goto(`${prefix}/mood-journal`);
    await context(page, copy).fill(draftCanary);
    await expect(assent(page, copy)).toBeDisabled();
    await age(page, copy).selectOption("14_17");
    await expect(assent(page, copy)).toBeDisabled();
    await clickIfEnabled(organize(page, copy));
    expect(state.consentPosts).toEqual([]);
    expect(state.aiCalls).toEqual([]);
    await acknowledgement(page, copy).check();
    await assent(page, copy).click();
    await expectReady(page);
    await expect(context(page, copy)).toHaveValue(draftCanary);
    await expect(page).toHaveURL(new RegExp(`${prefix}/mood-journal$`));
    expect(state.consentPosts).toEqual([{ action: "student_assent", ageBand: "14_17" }]);
    expect(state.aiCalls).toEqual([]);
    await expect(aiChoice(page, copy)).not.toBeChecked();
    await clickIfEnabled(organize(page, copy));
    expect(state.aiCalls).toEqual([]);
    await aiChoice(page, copy).check();
    await organize(page, copy).click();
    await expect(page.getByText(resultCanary, { exact: true })).toBeVisible();
    expect(state.aiCalls).toHaveLength(1);
    expect(state.aiCalls[0]).toMatchObject({ context: draftCanary, aiNoticeAccepted: true });
    await assertDraftIsMemoryOnly(page);
    expect(state.otpSends).toBe(0);
    expect(state.blockedExternal).toEqual([]);
    expect(state.unexpectedApi).toEqual([]);
  });

  test(`${prefix || "zh"} 既有有效确认不重复勾选，AI仍须本次单独选择`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!, { consentState: "active", ageBand: "18_plus" });
    await page.goto(`${prefix}/mood-journal`);
    await expectReady(page);
    await expect(age(page, copy)).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
    await context(page, copy).fill(draftCanary);
    await expect(aiChoice(page, copy)).not.toBeChecked();
    await clickIfEnabled(organize(page, copy));
    expect(state.aiCalls).toEqual([]);
    expect(state.consentPosts).toEqual([]);
    await aiChoice(page, copy).check();
    await organize(page, copy).click();
    await expect(page.getByText(resultCanary, { exact: true })).toBeVisible();
    expect(state.aiCalls).toHaveLength(1);
    expect(state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 已撤回确认需重新明确选择，切换年龄清空旧勾选`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!, { consentState: "withdrawn" });
    await page.goto(`${prefix}/mood-journal`);
    await context(page, copy).fill(draftCanary);
    await age(page, copy).selectOption("14_17");
    await acknowledgement(page, copy).check();
    await age(page, copy).selectOption("18_plus");
    await expect(acknowledgement(page, copy)).not.toBeChecked();
    await expect(assent(page, copy)).toBeDisabled();
    await acknowledgement(page, copy).check();
    await assent(page, copy).click();
    await expectReady(page);
    expect(state.consentPosts).toEqual([{ action: "student_assent", ageBand: "18_plus" }]);
    await expect(context(page, copy)).toHaveValue(draftCanary);
    expect(state.aiCalls).toEqual([]);
    expect(state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 未满14岁保持受限，不能凭本页选择解锁AI`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!);
    await page.goto(`${prefix}/mood-journal`);
    await context(page, copy).fill(draftCanary);
    await confirm(page, copy, "under_14");
    await expect(panel(page).getByText(copy.account.consent.ineligible, { exact: true })).toBeVisible();
    await expect(assent(page, copy)).toHaveCount(0);
    await aiChoice(page, copy).check();
    await clickIfEnabled(organize(page, copy));
    expect(state.aiCalls).toEqual([]);
    expect(state.consentPosts).toEqual([{ action: "student_assent", ageBand: "under_14" }]);
    await expect(context(page, copy)).toHaveValue(draftCanary);
    expect(state.blockedExternal).toEqual([]);
  });

  for (const failure of ["before", "after"] as const) {
    test(`${prefix || "zh"} 确认响应${failure}失败先重新核验，不重复提交且保留草稿`, async ({ page, baseURL }) => {
      const { state } = await syntheticInlineConsent(page, baseURL!);
      state.consentPostFailure = failure;
      await page.goto(`${prefix}/mood-journal`);
      await context(page, copy).fill(draftCanary);
      await confirm(page, copy);
      await expect(panel(page).getByRole("alert")).toBeVisible();
      await expect(page.getByText(privateDiagnostic, { exact: false })).toHaveCount(0);
      await expect(assent(page, copy)).toHaveCount(0);
      expect(state.consentPosts).toHaveLength(1);
      await expect(context(page, copy)).toHaveValue(draftCanary);
      const reads = state.consentGets;
      state.consentPostFailure = null;
      await panel(page).getByRole("button").click();
      await expect.poll(() => state.consentGets).toBeGreaterThan(reads);
      if (failure === "before") {
        await expect(acknowledgement(page, copy)).not.toBeChecked();
        await expect(assent(page, copy)).toBeDisabled();
      } else await expectReady(page);
      expect(state.consentPosts).toHaveLength(1);
      expect(state.aiCalls).toEqual([]);
      expect(state.blockedExternal).toEqual([]);
    });
  }

  test(`${prefix || "zh"} 状态加载失败提供安全重试，未核实前不能调用AI`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!, { consentState: "active" });
    state.consentReadFailure = true;
    await page.goto(`${prefix}/mood-journal`);
    await expect(panel(page).getByRole("alert")).toBeVisible();
    await context(page, copy).fill(draftCanary);
    await aiChoice(page, copy).check();
    await clickIfEnabled(organize(page, copy));
    expect(state.aiCalls).toEqual([]);
    await expect(page.getByText(privateDiagnostic, { exact: false })).toHaveCount(0);
    state.consentReadFailure = false;
    await panel(page).getByRole("button").click();
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
    await expectReady(page);
    await expect(context(page, copy)).toHaveValue(draftCanary);
    expect(state.consentPosts).toEqual([]);
    expect(state.aiCalls).toEqual([]);
    expect(state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 访客在原页完成八位OTP和基础确认，不丢草稿或自动发内容`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!, { signedIn: false });
    await page.goto(`${prefix}/mood-journal`);
    await context(page, copy).fill(draftCanary);
    const email = panel(page).getByRole("textbox", { name: copy.account.visitor.email, exact: true });
    await email.fill(state.user.email);
    expect(state.otpSends).toBe(0);
    await panel(page).getByRole("button", { name: copy.account.visitor.sendOtp, exact: true }).click();
    const otp = panel(page).getByRole("textbox", { name: copy.account.visitor.otp, exact: true });
    await expect(otp).toBeVisible();
    await otp.fill("123");
    await expect(panel(page).getByRole("button", { name: copy.account.visitor.signIn, exact: true })).toBeDisabled();
    expect(state.otpVerifies).toBe(0);
    await otp.fill("12345678");
    await panel(page).getByRole("button", { name: copy.account.visitor.signIn, exact: true }).click();
    await expect(age(page, copy)).toBeVisible();
    await expect(context(page, copy)).toHaveValue(draftCanary);
    await confirm(page, copy);
    await expectReady(page);
    await expect(context(page, copy)).toHaveValue(draftCanary);
    await expect(page).toHaveURL(new RegExp(`${prefix}/mood-journal$`));
    expect(state.otpSends).toBe(1);
    expect(state.otpVerifies).toBe(1);
    expect(state.aiCalls).toEqual([]);
    await assertDraftIsMemoryOnly(page);
    expect(state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 换号和退出清空上一账号的私密草稿与AI结果`, async ({ page, baseURL }) => {
    const { state, changeSession } = await syntheticInlineConsent(page, baseURL!, { consentState: "active" });
    await page.goto(`${prefix}/mood-journal`);
    await expectReady(page);
    await context(page, copy).fill(draftCanary);
    await aiChoice(page, copy).check();
    await organize(page, copy).click();
    await expect(page.getByText(resultCanary, { exact: true })).toBeVisible();
    await changeSession("second_student");
    await expect(context(page, copy)).toHaveValue("");
    await expect(page.getByText(resultCanary, { exact: true })).toHaveCount(0);
    await expect(age(page, copy)).toBeVisible();
    await expect(aiChoice(page, copy)).not.toBeChecked();
    await expect(acknowledgement(page, copy)).not.toBeChecked();
    await context(page, copy).fill("Synthetic second account draft.");
    await changeSession("signed_out");
    await expect(context(page, copy)).toHaveValue("");
    await expect(panel(page).getByRole("textbox", { name: copy.account.visitor.email, exact: true })).toBeVisible();
    expect(state.aiCalls).toHaveLength(1);
    expect(state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 花园受限时原页确认，成功后只读加载且不新增参与`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!);
    await page.goto(`${prefix}/garden`);
    await confirm(page, copy);
    await expect(age(page, copy)).toHaveCount(0);
    await expect.poll(() => state.gardenReads).toBeGreaterThan(0);
    await expect(page.locator(".garden-scene")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${prefix}/garden$`));
    expect(state.gardenWrites).toBe(0);
    expect(state.aiCalls).toEqual([]);
    expect(state.consentPosts).toEqual([{ action: "student_assent", ageBand: "14_17" }]);
    expect(state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 原页补昵称只写普通资料，不提交或改变角色`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!, { displayName: "" });
    await page.goto(`${prefix}/mood-journal`);
    await context(page, copy).fill(draftCanary);
    const nickname = panel(page).getByRole("textbox", { name: copy.account.profile.name, exact: true });
    await expect(nickname).toBeVisible();
    await expect(assent(page, copy)).toHaveCount(0);
    await nickname.fill("Synthetic nickname");
    await panel(page).getByRole("button", { name: copy.account.actions.saveProfile, exact: true }).click();
    await expect(age(page, copy)).toBeVisible();
    expect(state.profileWrites).toHaveLength(1);
    expect(Object.keys(state.profileWrites[0]).sort()).toEqual(["display_name", "updated_at"]);
    expect(state.profileWrites[0].display_name).toBe("Synthetic nickname");
    expect(state.role).toBe("学生");
    expect(state.consentPosts).toEqual([]);
    expect(state.aiCalls).toEqual([]);
    await expect(context(page, copy)).toHaveValue(draftCanary);
    await expect(page).toHaveURL(new RegExp(`${prefix}/mood-journal$`));
    expect(state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 非学生不能通过就地确认成为学生或获得AI资格`, async ({ page, baseURL }) => {
    const { state } = await syntheticInlineConsent(page, baseURL!, { role: "家长" });
    await page.goto(`${prefix}/mood-journal`);
    await expect(panel(page)).toBeVisible();
    await expect(age(page, copy)).toHaveCount(0);
    await expect(assent(page, copy)).toHaveCount(0);
    await context(page, copy).fill(draftCanary);
    await aiChoice(page, copy).check();
    await clickIfEnabled(organize(page, copy));
    expect(state.consentPosts).toEqual([]);
    expect(state.profileWrites).toEqual([]);
    expect(state.aiCalls).toEqual([]);
    expect(state.role).toBe("家长");
    expect(state.blockedExternal).toEqual([]);
  });

  for (const invalid of ["owner", "policy"] as const) {
    test(`${prefix || "zh"} 不接受${invalid}不匹配的已确认响应`, async ({ page, baseURL }) => {
      const { state } = await syntheticInlineConsent(page, baseURL!, { consentState: "active" });
      if (invalid === "owner") state.consentOwner = "00000000-0000-4000-8000-000000000099";
      else state.consentPolicy = "superseded-policy";
      await page.goto(`${prefix}/mood-journal`);
      await expect(panel(page).getByRole("alert")).toBeVisible();
      await context(page, copy).fill(draftCanary);
      await aiChoice(page, copy).check();
      await clickIfEnabled(organize(page, copy));
      expect(state.aiCalls).toEqual([]);
      expect(state.consentPosts).toEqual([]);
      expect(state.blockedExternal).toEqual([]);
    });
  }

  test(`${prefix || "zh"} 换号后忽略上一账号迟到的AI结果`, async ({ page, baseURL }) => {
    const { state, changeSession } = await syntheticInlineConsent(page, baseURL!, { consentState: "active" });
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (...args: Parameters<typeof fetch>) => {
        const input = args[0];
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (new URL(url, location.href).pathname !== "/api/ai/mood-journal") return originalFetch(...args);
        // Let the synthetic late response arrive despite cancellation, so this
        // case verifies account isolation independently of AbortController.
        return originalFetch(input, { ...args[1], signal: undefined });
      };
    });
    let release!: () => void;
    state.aiGate = new Promise<void>((resolve) => { release = resolve; });
    await page.goto(`${prefix}/mood-journal`);
    await expectReady(page);
    await context(page, copy).fill(draftCanary);
    await aiChoice(page, copy).check();
    await organize(page, copy).click();
    await expect.poll(() => state.aiCalls.length).toBe(1);
    await changeSession("second_student");
    await expect(age(page, copy)).toBeVisible();
    const aiResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/ai/mood-journal");
    release();
    await aiResponse;
    await expect(page.getByText(resultCanary, { exact: true })).toHaveCount(0);
    await expect(context(page, copy)).toHaveValue("");
    await expect(aiChoice(page, copy)).not.toBeChecked();
    expect(state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 确认提交中换号不把上一账号结果用于新账号`, async ({ page, baseURL }) => {
    const { state, changeSession } = await syntheticInlineConsent(page, baseURL!);
    let release!: () => void;
    state.consentGate = new Promise<void>((resolve) => { release = resolve; });
    await page.goto(`${prefix}/mood-journal`);
    await context(page, copy).fill(draftCanary);
    await confirm(page, copy);
    await expect.poll(() => state.consentPosts.length).toBe(1);
    await changeSession("second_student");
    const oldPost = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/account/consent" && response.request().method() === "POST");
    release();
    await oldPost;
    await expect(age(page, copy)).toBeVisible();
    await expect(acknowledgement(page, copy)).not.toBeChecked();
    await expect(assent(page, copy)).toBeDisabled();
    await expect(context(page, copy)).toHaveValue("");
    expect(state.aiCalls).toEqual([]);
    expect(state.blockedExternal).toEqual([]);
  });
}
