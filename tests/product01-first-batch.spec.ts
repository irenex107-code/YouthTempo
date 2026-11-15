import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { control, mockState, openPortal, type PortalOptions } from "./fixtures/product01-local-browser";

const evidence = path.join(process.cwd(), "audit-records/2026-11-02/product01_first_batch_20261102");

async function checkHelp(page: Page, copy: typeof zh, urgent = false) {
  const help = page.getByRole("region", { name: copy.supportFlow.portal.immediateHelpTitle, exact: true });
  await expect(help).toBeVisible();
  await expect(page.getByText(copy.supportFlow.portal.urgent, { exact: true })).toHaveCount(1);
  await expect(help.getByText(copy.supportFlow.portal.urgent, { exact: true })).toBeVisible();
  await expect(help.locator('[role="alert"]')).toHaveCount(urgent ? 1 : 0);
  await expect(help.getByText("!", { exact: true })).toHaveCount(urgent ? 1 : 0);
  expect(await help.evaluate((element) => Boolean(element.compareDocumentPosition(
    document.querySelector('[data-testid="inline-student-consent"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('a[href="/referral"]').first()).toBeVisible();
  const layout = await help.evaluate((element) => ({
    left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    width: document.documentElement.clientWidth,
    overflowing: [...element.querySelectorAll("h2,p")].some((child) => child.scrollWidth > child.clientWidth + 1),
  }));
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.width).toBe(page.viewportSize()!.width);
  expect(layout.right).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.overflowing).toBe(false);
}

async function submit(page: Page, copy: typeof zh) {
  const previousPosts = (await mockState(page)).calls.filter((call: any) => call.method === "POST").length;
  await page.getByRole("textbox", { name: copy.supportFlow.portal.need, exact: true }).fill("Synthetic request: I want to die");
  // Typing a crisis phrase must not introduce a new client-side detector.
  await expect(page.locator('#support-immediate-help [role="alert"]')).toHaveCount(0);
  expect((await mockState(page)).calls.filter((call: any) => call.method === "POST")).toHaveLength(previousPosts);
  await page.getByRole("button", { name: copy.supportFlow.portal.submit, exact: true }).click();
}

for (const [locale, copy] of [["zh-CN", zh], ["en", en]] as const) {
  test(`${locale} P01-06 Referral真实页面文案及留言入口布局`, async ({ page }, testInfo) => {
    const guard = await openPortal(page, { locale, mode: "youth", view: "referral", phase: "signed_out" });
    const direct = page.locator("section").filter({ has: page.getByRole("heading", { name: copy.referral.direct.title, exact: true }) });
    await expect(direct.getByText(copy.referral.direct.description, { exact: true })).toBeVisible();
    await expect(direct.getByRole("link", { name: copy.referral.direct.action, exact: true })).toHaveAttribute("href", "/messages");
    expect((await mockState(page)).calls).toEqual([]);
    await direct.scrollIntoViewIfNeeded();
    const layout = await direct.evaluate((element) => ({ width: document.documentElement.clientWidth,
      overflowing: [...element.querySelectorAll("h2,p,a")].some((child) => child.scrollWidth > child.clientWidth + 1) }));
    expect(layout.width).toBe(page.viewportSize()!.width); expect(layout.overflowing).toBe(false);
    await mkdir(path.join(evidence, "screenshots"), { recursive: true });
    await direct.screenshot({ path: path.join(evidence, "screenshots", `${locale}-referral-${testInfo.project.name}.png`) });
    for (const id of ["currentState", "duration", "impact", "affectedAreas", "trustedAdult", "supportType", "currentNeed"] as const) {
      const question = page.locator("article").filter({ has: page.getByRole("heading", { name: copy.referral.questions[id].title, exact: true }) });
      await question.getByRole("button").nth(id === "duration" ? 2 : 0).click();
    }
    await page.getByRole("button", { name: copy.referral.actions.generate, exact: true }).click();
    await expect(page.getByRole("link", { name: copy.referral.links.tellAdult, exact: true })).toHaveAttribute("href", "/messages");
    expect((await mockState(page)).calls).toHaveLength(1);
    expect((await mockState(page)).unexpected).toEqual([]);
    expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
  });

  test(`${locale} P01-07 隐私真实页面身份说明布局`, async ({ page }, testInfo) => {
    const guard = await openPortal(page, { locale, mode: "youth", view: "privacy", phase: "signed_out" });
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: copy.privacySafety.dataTypes.account.title, exact: true }) });
    await expect(card.getByText(copy.privacySafety.dataTypes.account.text, { exact: true })).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    const layout = await card.evaluate((element) => ({ width: document.documentElement.clientWidth,
      overflowing: [...element.querySelectorAll("h3,div")].some((child) => child.scrollWidth > child.clientWidth + 1) }));
    expect(layout.width).toBe(page.viewportSize()!.width); expect(layout.overflowing).toBe(false);
    await mkdir(path.join(evidence, "screenshots"), { recursive: true });
    await card.screenshot({ path: path.join(evidence, "screenshots", `${locale}-privacy-${testInfo.project.name}.png`) });
    expect((await mockState(page)).calls).toEqual([]);
    expect((await mockState(page)).unexpected).toEqual([]);
    expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
  });

  for (const mode of ["youth", "adult"] as const) {
    const options: PortalOptions = { locale, mode };
    test(`${locale} ${mode} 帮助独立于登录、资料、同意及资格`, async ({ page }) => {
      for (const phase of ["signed_out", "needs_profile", "needs_consent", "ineligible", "pending_guardian", "other", "error", "unknown", "loading"]) {
        await test.step(phase, async () => {
          const guard = await openPortal(page, { ...options, phase });
          await checkHelp(page, copy);
          await expect(page.getByRole("button", { name: copy.supportFlow.portal.submit, exact: true })).toHaveCount(0);
          expect((await mockState(page)).calls).toEqual([]);
          expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
        });
      }
      for (const eligibility of [{ wrongAge: true }, ...(mode === "adult" ? [{ consultationAvailable: false }] : [])]) {
        const guard = await openPortal(page, { ...options, ...eligibility });
        await checkHelp(page, copy);
        await expect(page.getByRole("button", { name: copy.supportFlow.portal.submit, exact: true })).toHaveCount(0);
        expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
      }
    });

    test(`${locale} ${mode} 列表加载及失败不遮住帮助`, async ({ page }) => {
      for (const list of ["pending", "503"] as const) {
        const guard = await openPortal(page, { ...options, list });
        await checkHelp(page, copy);
        if (list === "503" && mode === "youth") await expect(page.getByText(copy.supportFlow.errors.unavailable, { exact: true })).toBeVisible();
        expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
        expect((await mockState(page)).unexpected).toEqual([]);
      }
    });

    test(`${locale} ${mode} 429、503、网络拒绝及持续pending仍有帮助`, async ({ page }) => {
      for (const post of ["429", "503", "reject", "pending"] as const) {
        await test.step(post, async () => {
          const guard = await openPortal(page, { ...options, post });
          await checkHelp(page, copy);
          await submit(page, copy);
          await expect.poll(async () => (await mockState(page)).calls.filter((call: any) => call.method === "POST").length).toBe(1);
          if (post === "pending") {
            await page.clock.install();
            await page.clock.runFor(60_000);
            await expect(page.getByRole("button", { name: copy.supportFlow.portal.saving, exact: true })).toBeDisabled();
            await expect(page.getByText(copy.supportFlow.errors.unavailable, { exact: true })).toHaveCount(0);
            await expect(page.getByText(copy.supportFlow.portal.submitted, { exact: true })).toHaveCount(0);
          } else await expect(page.getByText(post === "429" ? copy.supportFlow.errors.tooMany : post === "503"
            ? copy.supportFlow.errors.unavailable : "Synthetic network rejection", { exact: true })).toBeVisible();
          await checkHelp(page, copy);
          expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
          expect((await mockState(page)).unexpected).toEqual([]);
        });
      }
    });

    test(`${locale} ${mode} 成功回包才强调urgent且换号不继承`, async ({ page }, testInfo) => {
      const guard = await openPortal(page, { ...options, post: "normal" });
      await checkHelp(page, copy);
      await submit(page, copy);
      await expect(page.getByText(copy.supportFlow.portal.submitted, { exact: true })).toBeVisible();
      await checkHelp(page, copy);
      await mkdir(path.join(evidence, "screenshots"), { recursive: true });
      const base = path.join(evidence, "screenshots", `${locale}-${mode}-${testInfo.project.name}`);
      await page.locator("#support-immediate-help").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${base}-default.png` });
      await control(page, "setPost", "urgent");
      // A new submission clears urgent at the existing point, not while typing.
      await submit(page, copy);
      await checkHelp(page, copy, true);
      await expect(page.getByText(copy.supportFlow.portal.submitted, { exact: true })).toBeVisible();
      await page.locator("#support-immediate-help").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${base}-urgent.png` });
      await page.getByRole("textbox", { name: copy.supportFlow.portal.need, exact: true }).fill("Synthetic ordinary draft");
      await checkHelp(page, copy, true);
      await control(page, "setPost", "pending");
      await page.getByRole("button", { name: copy.supportFlow.portal.submit, exact: true }).click();
      await checkHelp(page, copy);
      await expect.poll(async () => (await mockState(page)).calls.filter((call: any) => call.method === "POST").length).toBe(3);
      await control(page, "resolvePost", true);
      await checkHelp(page, copy, true);
      await control(page, "setActor", "00000000-0000-4000-8000-000000000022");
      await checkHelp(page, copy);
      await expect(page.getByText(copy.supportFlow.portal.submitted, { exact: true })).toHaveCount(0);
      await control(page, "setPost", "pending");
      await submit(page, copy);
      await expect.poll(async () => (await mockState(page)).calls.filter((call: any) => call.method === "POST").length).toBe(4);
      await control(page, "setActor", "00000000-0000-4000-8000-000000000033");
      await control(page, "resolvePost", true);
      await checkHelp(page, copy);
      await expect(page.getByText(copy.supportFlow.portal.submitted, { exact: true })).toHaveCount(0);
      expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
      expect((await mockState(page)).unexpected).toEqual([]);
    });

    test(`${locale} ${mode} 既有反馈urgent不重复整段正文`, async ({ page }) => {
      const guard = await openPortal(page, { ...options, feedbackCase: true, feedbackUrgent: true });
      await page.getByRole("button", { name: copy.supportFlow.portal.feedbackSubmit, exact: true }).click();
      await expect(page.getByRole("alert")).toContainText(copy.supportFlow.portal.feedbackSaved);
      await expect(page.getByRole("alert").getByRole("link", { name: copy.supportFlow.portal.immediateHelpTitle, exact: true })).toHaveAttribute("href", "#support-immediate-help");
      await checkHelp(page, copy);
      expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
      expect((await mockState(page)).unexpected).toEqual([]);
    });
  }
}

test("P01文案与已确认逐字一致，双语键结构相同", async () => {
  expect(zh.referral.links.tellAdult).toBe("查看留言选项");
  expect(en.referral.links.tellAdult).toBe("View message options");
  expect(zh.referral.direct.title).toBe("先写下一句话");
  expect(en.referral.direct.title).toBe("Start with one sentence");
  expect(zh.referral.direct.description).toBe("不必先完成所有问题。你可以先写给自己；如果留言页面提供已分配老师或值班支持选项，也可以选择相应收件人。留言不是即时回复服务。");
  expect(en.referral.direct.description).toBe("You do not need to answer every question first. You can write to yourself, or choose an assigned teacher or the support team if those options appear on the message page. This is not an immediate response service.");
  expect(zh.privacySafety.dataTypes.account.text).toBe("登录邮箱、显示名称、账号类型及相关身份信息，用于登录和核对功能资格。学校身份、平台职责、专业身份核验与提供支持的服务资格按各自流程确认；身份标签本身不代表已获查看具体信息的权限。");
  expect(en.privacySafety.dataTypes.account.text).toBe("Your sign-in email, display name, account type and related role information are used for sign-in and eligibility checks. School affiliation, platform responsibilities, professional verification and eligibility to provide support follow their respective processes. A role label alone does not grant access to specific information.");
  expect(zh.supportFlow.portal.immediateHelpTitle).toBe("需要立即帮助？");
  expect(en.supportFlow.portal.immediateHelpTitle).toBe("Need immediate help?");
  const keys = (value: object, prefix = ""): string[] => Object.entries(value).flatMap(([key, item]) => typeof item === "string"
    ? [prefix + key] : keys(item, prefix + key + "."));
  expect(keys(zh).sort()).toEqual(keys(en).sort());
  // Existing neutral actions, school explanations and offline parent advice stay.
  for (const [name, copy] of [["zh-CN", zh], ["en", en]] as const) {
    const before = JSON.parse(await readFile(path.join(evidence, "before/locales", `${name}.json`), "utf8"));
    expect(copy.referral.direct.action).toBe(before.referral.direct.action);
    expect(copy.referral.links.messages).toBe(before.referral.links.messages);
    expect(copy.referral.questions.trustedAdult).toEqual(before.referral.questions.trustedAdult);
    expect(copy.privacySafety.account.school).toEqual(before.privacySafety.account.school);
    expect(copy.supportFlow.portal.urgent).toBe(before.supportFlow.portal.urgent);
  }
});
