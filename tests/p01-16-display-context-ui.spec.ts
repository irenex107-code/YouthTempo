import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { mockState, openPortal } from "./fixtures/product01-local-browser";

const phase = process.env.P01_16_PHASE || "run";
const evidence = path.join(process.cwd(), "audit-records/2026-11-12/product01_p01_16_display_context", phase);

const expected = {
  "zh-CN": {
    legacy: {
      hero: "当自己整理还不够时，用几道题整理一个起点：可以继续使用自助工具、告诉家长或老师，或连接更多支持。这里不会判断你的心理状态。",
      contact: "你现在愿意和家长、老师或其他可信任的大人说吗？",
      school: "学校支持",
      path: "尝试和家长、老师或其他可信任的大人说",
      result: "可以先找家长、老师或其他你愿意开口的可信任成年人，让对方听你说，再一起决定下一步。",
    },
    adult: {
      hero: "当自己整理还不够时，用几道题整理一个起点：继续使用自助工具，联系你信任的人，或选择学校、校园、社区和专业支持。由你决定先找谁；这里不会判断你的心理状态。",
      contact: "你现在愿意联系一位信任的人，或一个可用的支持服务吗？",
      school: "学校或校园支持",
      path: "尝试联系一位信任的人或支持服务",
      result: "可以先找一位由你选择且信任的人——例如家人、朋友、老师或同事——或你愿意使用的支持服务，再一起决定下一步。",
    },
  },
  en: {
    legacy: {
      hero: "When reflecting on your own is not enough, use a few questions to organize a starting point: continue with self-guided tools, tell a parent or teacher, or connect with more support. This does not judge your mental state.",
      contact: "Would you be willing to tell a parent or guardian, teacher, or another trusted adult?",
      school: "Support at school",
      path: "Try telling a parent, teacher, or another trusted adult",
      result: "Begin with a parent or guardian, teacher, or another trusted adult you feel comfortable talking to, and decide the next step together.",
    },
    adult: {
      hero: "When reflecting on your own is not enough, use a few questions to organize a starting point: continue with self-guided tools, contact someone you trust, or choose school, campus, community, or professional support. You decide whom to contact first. This does not judge your mental state.",
      contact: "Would you be willing to contact someone you trust or an available support service?",
      school: "School or campus support",
      path: "Try contacting a trusted person or support service",
      result: "Begin with someone you choose and trust—such as a family member, friend, teacher, or colleague—or a support service you prefer, then decide the next step together.",
    },
  },
} as const;

async function expectViewportContained(page: Page) {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
}

async function capture(page: Page, locale: "zh-CN" | "en", context: string, testInfo: TestInfo) {
  if (context !== "adult" && context !== "teen") return;
  const directory = path.join(evidence, "screenshots");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: path.join(directory, `${locale}-${context}-${testInfo.project.name}.png`),
    fullPage: true,
  });
}

for (const [locale, copy] of [["zh-CN", zh], ["en", en]] as const) {
  test(`${locale} explicit age-entry links select copy context without claiming verification`, async ({ page }) => {
    const adultGuard = await openPortal(page, { locale, mode: "adult", view: "adultInfo", phase: "signed_out" });
    const adultLinks = await page.locator('a[href^="/referral"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(adultLinks).toEqual(["/referral?displayContext=young_adult", "/referral?displayContext=young_adult"]);
    expect(adultGuard.network).toEqual([]);
    expect(adultGuard.errors).toEqual([]);

    const teenGuard = await openPortal(page, { locale, mode: "youth", view: "teenInfo", phase: "signed_out" });
    const teenLinks = await page.locator('a[href^="/referral"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(teenLinks).toEqual(["/referral", "/referral"]);
    expect(teenGuard.network).toEqual([]);
    expect(teenGuard.errors).toEqual([]);

    const adultPortalGuard = await openPortal(page, { locale, mode: "adult", phase: "signed_out" });
    await expect(page.locator('a[href="/referral?displayContext=young_adult"]')).toHaveCount(2);
    expect(adultPortalGuard.network).toEqual([]);
    expect(adultPortalGuard.errors).toEqual([]);

    const youthPortalGuard = await openPortal(page, { locale, mode: "youth", phase: "signed_out" });
    await expect(page.locator('a[href="/referral"]')).toHaveCount(1);
    expect(youthPortalGuard.network).toEqual([]);
    expect(youthPortalGuard.errors).toEqual([]);
  });

  for (const scenario of [
    { name: "adult", mode: "adult" as const, displayContext: "young_adult", copy: "adult" as const, sent: "young_adult" },
    { name: "teen", mode: "youth" as const, displayContext: undefined, copy: "legacy" as const, sent: undefined },
    { name: "unknown-direct", mode: "adult" as const, displayContext: undefined, copy: "legacy" as const, sent: undefined },
    { name: "invalid", mode: "adult" as const, displayContext: "18_plus", copy: "legacy" as const, sent: undefined },
  ]) {
    test(`${locale} ${scenario.name} page -> API -> rules uses the bounded copy branch`, async ({ page }, testInfo) => {
      const wanted = expected[locale][scenario.copy];
      const guard = await openPortal(page, {
        locale,
        mode: scenario.mode,
        view: "referral",
        phase: "signed_out",
        displayContext: scenario.displayContext,
        actualReferralApi: true,
      });

      await expect(page.getByText(wanted.hero, { exact: true })).toBeVisible();
      const contact = page.locator("article").filter({ has: page.getByRole("heading", { name: wanted.contact, exact: true }) });
      await expect(contact).toBeVisible();
      const support = page.locator("article").filter({ has: page.getByRole("heading", { name: copy.referral.questions.supportType.title, exact: true }) });
      await expect(support.getByRole("button", { name: wanted.school, exact: true })).toBeVisible();

      const choices = [
        ["currentState", "emotionalPressure"], ["duration", "today"], ["impact", "none"],
        ["affectedAreas", "expression"], ["trustedAdult", "willing"], ["supportType", "listener"], ["currentNeed", "understood"],
      ] as const;
      for (const [question, option] of choices) {
        const title = question === "trustedAdult" ? wanted.contact : copy.referral.questions[question].title;
        const card = page.locator("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
        await card.getByRole("button", { name: copy.referral.questions[question].options[option], exact: true }).click();
      }

      await page.getByRole("button", { name: copy.referral.actions.generate, exact: true }).click();
      await expect(page.getByText(wanted.result, { exact: true })).toBeVisible();
      await expect(page.getByText(wanted.path, { exact: true })).toBeVisible();

      const state = await mockState(page);
      const posts = state.calls.filter((call) => (call as { path?: string; method?: string }).path === "/api/ai/referral"
        && (call as { method?: string }).method === "POST") as Array<{ body: Record<string, unknown> }>;
      expect(posts).toHaveLength(1);
      if (scenario.sent) expect(posts[0].body.displayContext).toBe(scenario.sent);
      else expect(posts[0].body).not.toHaveProperty("displayContext");
      expect(state.unexpected).toEqual([]);
      expect(guard.network).toEqual([]);
      expect(guard.errors).toEqual([]);
      await expectViewportContained(page);
      await capture(page, locale, scenario.name, testInfo);
    });
  }
}
