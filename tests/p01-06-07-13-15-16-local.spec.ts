import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { mockState, openPortal } from "./fixtures/product01-local-browser";
import { controlLocal, localState, openLocal } from "./fixtures/feedback-otp-local-browser";

const phase = process.env.P01_COPY_PHASE || "run";
const evidence = path.join(process.cwd(), "audit-records/2026-11-11/product01_p01_06_07_13_15_16_local", phase);
const actor = "00000000-0000-4000-8000-000000000011";

const expected = {
  "zh-CN": {
    profile: "填写姓名等账号资料即可继续。学校学生、老师或负责人身份由学校邀请与成员关系确认；平台管理员职责、专业身份和提供支持资格由平台按各自流程核验，不能在这里自行选择。",
    identity: "登录邮箱和显示名称由本人提供，用于登录和账号展示。学校学生、老师或负责人身份由学校邀请与成员关系确认；平台管理员职责、专业身份和提供支持资格由平台按各自流程核验。账号类型或身份标签本身不授予具体信息访问权。",
    records: "你可以回看本人已有记录，并下载当前账户提供的导出。SWEET 按日删除，花园纪念物可删除，社区和同伴内容可从展示中移除；“想说的话”和支持事项没有逐条删除入口。你也可以申请注销账号。",
    hero: "当自己整理还不够时，用几道题整理一个起点：继续使用自助工具，联系你信任的人，或选择学校、校园、社区和专业支持。由你决定先找谁；这里不会判断你的心理状态。",
    contact: "你现在愿意联系一位信任的人，或一个可用的支持服务吗？",
    school: "学校或校园支持",
  },
  en: {
    profile: "Complete your name and other account details to continue. Student, teacher, and school-lead identities are confirmed through school invitations and memberships. Platform-administrator responsibilities, professional identity, and eligibility to provide support are verified through separate platform processes and cannot be self-selected here.",
    identity: "You provide your sign-in email and display name for sign-in and account display. Student, teacher, and school-lead identities are confirmed through school invitations and memberships. Platform-administrator responsibilities, professional identity, and eligibility to provide support are verified through separate platform processes. An account type or role label alone does not grant access to specific information.",
    records: "You can review your existing records and download the export currently provided for your account. SWEET records can be deleted by day, garden keepsakes can be deleted, and community or peer content can be removed from display. Private messages and support cases have no individual deletion option. You can also request account closure.",
    hero: "When reflecting on your own is not enough, use a few questions to organize a starting point: continue with self-guided tools, contact someone you trust, or choose school, campus, community, or professional support. You decide whom to contact first. This does not judge your mental state.",
    contact: "Would you be willing to contact someone you trust or an available support service?",
    school: "School or campus support",
  },
} as const;

async function expectViewportContained(page: Page) {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className,
          text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((element) => element.left < -1 || element.right > document.documentElement.clientWidth + 1)
      .slice(-12),
  }));
  expect(dimensions.client).toBe(page.viewportSize()!.width);
  expect(dimensions.scroll, JSON.stringify(dimensions.offenders, null, 2)).toBeLessThanOrEqual(dimensions.client + 1);
}

async function captureNarrow(page: Page, locale: "zh-CN" | "en", name: string, testInfo: TestInfo) {
  if (testInfo.project.name !== "local-narrow") return;
  const directory = path.join(evidence, "screenshots");
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${locale}-${name}-320.png`), fullPage: true });
}

for (const [locale, copy] of [["zh-CN", zh], ["en", en]] as const) {
  const wanted = expected[locale];

  test(`${locale} P01-06／16 Referral当前收件路径与自主支持选择`, async ({ page }, testInfo) => {
    const guard = await openPortal(page, { locale, mode: "adult", view: "referral", phase: "signed_out", displayContext: "young_adult" });
    await expect(page.getByText(wanted.hero, { exact: true })).toBeVisible();
    const contact = page.locator("article").filter({ has: page.getByRole("heading", { name: wanted.contact, exact: true }) });
    await expect(contact).toBeVisible();
    const support = page.locator("article").filter({ has: page.getByRole("heading", { name: copy.referral.questions.supportType.title, exact: true }) });
    await expect(support.getByRole("button", { name: wanted.school, exact: true })).toBeVisible();

    const direct = page.locator("section").filter({ has: page.getByRole("heading", { name: copy.referral.direct.title, exact: true }) });
    await expect(direct.getByText(copy.referral.direct.description, { exact: true })).toBeVisible();
    await expect(direct.getByRole("link", { name: copy.referral.direct.action, exact: true })).toHaveAttribute("href", "/messages");

    const choices = [
      ["currentState", "emotionalPressure"], ["duration", "weeks"], ["impact", "none"],
      ["affectedAreas", "expression"], ["trustedAdult", "willing"], ["supportType", "listener"], ["currentNeed", "understood"],
    ] as const;
    for (const [question, option] of choices) {
      const title = question === "trustedAdult" ? wanted.contact : copy.referral.questions[question].title;
      const card = page.locator("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
      await card.getByRole("button", { name: copy.referral.questions[question].options[option], exact: true }).click();
    }
    await page.getByRole("button", { name: copy.referral.actions.generate, exact: true }).click();
    await expect(page.getByRole("link", { name: copy.referral.links.tellAdult, exact: true })).toHaveAttribute("href", "/messages");
    expect((await mockState(page)).calls.filter((call) => (call as { method?: string }).method === "POST")).toHaveLength(1);
    expect((await mockState(page)).unexpected).toEqual([]);
    expect(guard.network).toEqual([]);
    expect(guard.errors).toEqual([]);
    await expectViewportContained(page);
    await captureNarrow(page, locale, "referral", testInfo);
  });

  test(`${locale} P01-07／13／15 隐私页身份、数据类别与教师边界`, async ({ page }, testInfo) => {
    const guard = await openPortal(page, { locale, mode: "youth", view: "privacy", phase: "signed_out" });
    await expect(page.getByText(wanted.identity, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.privacySafety.account.delete.text, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.privacySafety.account.export.text, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.privacySafety.consent.afterWithdrawal.text, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.privacySafety.account.school.text, { exact: true })).toBeVisible();
    expect((await mockState(page)).calls).toEqual([]);
    expect((await mockState(page)).unexpected).toEqual([]);
    expect(guard.network).toEqual([]);
    expect(guard.errors).toEqual([]);
    await expectViewportContained(page);
    await captureNarrow(page, locale, "privacy", testInfo);
  });

  test(`${locale} P01-07 首次账号资料状态不把职责写成自选`, async ({ page }, testInfo) => {
    const guard = await openLocal(page, { locale, route: "account", profileName: null });
    await controlLocal(page, "actor", actor);
    await expect(page.getByRole("heading", { name: copy.account.hero.completeProfile, exact: true })).toBeVisible();
    await expect(page.getByText(wanted.profile, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.account.profile.accountType, { exact: true }).first()).toBeVisible();
    await expect(page.locator("select")).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    const state = await localState(page);
    expect(state.unexpected).toEqual([]);
    expect(state.calls.every((call) => call.method === "GET")).toBe(true);
    expect(guard.network).toEqual([]);
    expect(guard.errors).toEqual([]);
    await expectViewportContained(page);
    await captureNarrow(page, locale, "account-profile", testInfo);
  });

  test(`${locale} P01-13 成年人页面按类别说明管理能力`, async ({ page }, testInfo) => {
    const guard = await openPortal(page, { locale, mode: "adult", view: "adultInfo", phase: "signed_out" });
    await expect(page.getByText(wanted.records, { exact: true })).toBeVisible();
    const supportCard = page.locator("article").filter({ has: page.getByRole("heading", { name: copy.ageWorkspace.primary.help.title, exact: true }) });
    await expect(supportCard.getByRole("link", { name: copy.ageWorkspace.primary.help.action, exact: true })).toHaveAttribute("href", "/referral?displayContext=young_adult");
    expect((await mockState(page)).calls).toEqual([]);
    expect((await mockState(page)).unexpected).toEqual([]);
    expect(guard.network).toEqual([]);
    expect(guard.errors).toEqual([]);
    await expectViewportContained(page);
    await captureNarrow(page, locale, "young-adults", testInfo);
  });

  test(`${locale} P01-15 首页教师卡只说明当前名单、留言和报告边界`, async ({ page }, testInfo) => {
    const guard = await openPortal(page, { locale, mode: "youth", view: "home", phase: "signed_out" });
    const card = page.locator('a[href="/for-teachers"]').filter({ hasText: copy.home.audiences.teachers.title });
    await expect(card.getByText(copy.home.audiences.teachers.text, { exact: true })).toBeVisible();
    await expect(card).toHaveAttribute("href", "/for-teachers");
    expect((await mockState(page)).calls).toEqual([]);
    expect((await mockState(page)).unexpected).toEqual([]);
    expect(guard.network).toEqual([]);
    expect(guard.errors).toEqual([]);
    await expectViewportContained(page);
    await captureNarrow(page, locale, "home-teacher", testInfo);
  });

  test(`${locale} P01-15 教师页CTA和未开放报告边界`, async ({ page }, testInfo) => {
    const guard = await openPortal(page, { locale, mode: "youth", view: "teacher", phase: "signed_out" });
    await expect(page.getByText(copy.forTeachers.hero.description, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: copy.forTeachers.hero.primaryAction, exact: true })).toHaveAttribute("href", "/account");
    await expect(page.getByText(copy.forTeachers.capabilities.items.details.description, { exact: true })).toBeVisible();
    expect((await mockState(page)).calls).toEqual([]);
    expect((await mockState(page)).unexpected).toEqual([]);
    expect(guard.network).toEqual([]);
    expect(guard.errors).toEqual([]);
    await expectViewportContained(page);
    await captureNarrow(page, locale, "teacher", testInfo);
  });
}
