import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { syntheticInlineConsent } from "./fixtures/synthetic-inline-consent";

type Copy = typeof zh | typeof en;
type Scenario = NonNullable<Parameters<typeof syntheticInlineConsent>[2]>;
type Fixture = Awaited<ReturnType<typeof syntheticInlineConsent>>;
type Gate = "signed_out" | "needs_consent" | "ready" | "ineligible" | "other";

function secondaryCard(page: Page, copy: Copy) {
  return page.locator("main article").filter({
    has: page.getByRole("heading", { level: 2, name: copy.forYoungPeople.paths.secondary.title, exact: true }),
  });
}

async function setup(page: Page, baseURL: string, scenario: Scenario = {}) {
  const fixture = await syntheticInlineConsent(page, baseURL, scenario);
  await page.route("**/api/support/staff*", (route) => route.fulfill({ json: { application: null } }));
  return fixture;
}

function expectNoMutations(fixture: Fixture) {
  expect(fixture.state.consentPosts).toEqual([]);
  expect(fixture.state.profileWrites).toEqual([]);
  expect(fixture.state.gardenWrites).toBe(0);
  expect(fixture.state.aiCalls).toEqual([]);
  expect(fixture.state.otpSends).toBe(0);
  expect(fixture.state.otpVerifies).toBe(0);
  expect(fixture.state.unexpectedApi).toEqual([]);
  expect(fixture.state.blockedExternal).toEqual([]);
}

const scenarios: Array<{ name: string; scenario: Scenario; gate: Gate }> = [
  { name: "访客", scenario: { signedIn: false }, gate: "signed_out" },
  { name: "尚未确认的学生", scenario: { consentState: "not_started" }, gate: "needs_consent" },
  { name: "已确认14至17岁学生", scenario: { consentState: "active", ageBand: "14_17" }, gate: "ready" },
  { name: "已确认成年学生", scenario: { consentState: "active", ageBand: "18_plus" }, gate: "ready" },
  { name: "未满14岁账号", scenario: { consentState: "ineligible", ageBand: "under_14" }, gate: "ineligible" },
  ...["家长", "支持老师", "学校负责人", "平台管理员", "专业支持者"].map((role) => ({
    name: role, scenario: { role, consentState: "active" as const }, gate: "other" as const,
  })),
];

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  for (const { name, scenario, gate } of scenarios) {
    test(`${prefix || "zh"} 年龄分流的中学生主按钮直接进入花园，${name}仍按原资格处理`, async ({ page, baseURL }) => {
      const fixture = await setup(page, baseURL!, scenario);
      const initial = { role: fixture.state.role, ageBand: fixture.state.ageBand, consentState: fixture.state.consentState };
      const visited: string[] = [];
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
      });
      await page.goto(`${prefix}/for-young-people`);
      const card = secondaryCard(page, copy);
      const start = card.getByRole("link", { name: copy.forYoungPeople.paths.secondary.action, exact: true });
      await expect(start).toHaveAttribute("href", `${prefix}/garden`);
      await expect(card.getByRole("link", { name: copy.forYoungPeople.paths.secondary.learnMore, exact: true }))
        .toHaveAttribute("href", `${prefix}/for-teens`);
      await expect(page.getByText(copy.forYoungPeople.accountNote, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await start.click();
      await expect(page).toHaveURL(`${baseURL}${prefix}/garden`);
      const panel = page.getByTestId("inline-student-consent");
      const scene = page.getByRole("heading", { name: copy.garden.scene.title, exact: true });
      const privateActions = page.getByRole("navigation", { name: copy.garden.actions.ariaLabel, exact: true });
      if (gate === "ready") {
        await expect(panel).toHaveCount(0);
        await expect(scene).toBeVisible();
        await expect(privateActions).toBeVisible();
        await expect.poll(() => fixture.state.gardenReads).toBeGreaterThan(0);
      } else {
        await expect(panel).toBeVisible();
        if (gate === "signed_out") {
          await expect(panel.getByRole("textbox", { name: copy.account.visitor.email, exact: true })).toBeVisible();
          await expect(scene).toBeVisible();
          await expect(page.getByText(copy.gardenWelcome.preview, { exact: true })).toBeVisible();
        }
        if (gate === "needs_consent") {
          await expect(panel.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true })).toHaveValue("");
          await expect(panel.getByRole("checkbox", { name: copy.account.consent.acknowledgement, exact: true })).not.toBeChecked();
          await expect(panel.getByRole("button", { name: copy.account.consent.completeStudent, exact: true })).toBeDisabled();
        }
        if (gate === "ineligible") await expect(panel.getByText(copy.account.consent.ineligible, { exact: true })).toBeVisible();
        if (gate === "other") {
          await expect(panel.getByText(copy.inlineConsent.notStudent, { exact: true })).toBeVisible();
          await expect(panel.getByRole("combobox")).toHaveCount(0);
        }
        if (gate !== "signed_out") await expect(scene).toHaveCount(0);
        await expect(privateActions).toHaveCount(0);
        await expect(page.locator(".garden-facts")).toHaveCount(0);
        expect(fixture.state.gardenReads).toBe(0);
      }
      expect({ role: fixture.state.role, ageBand: fixture.state.ageBand, consentState: fixture.state.consentState }).toEqual(initial);
      expect(visited.some((pathname) => /\/(?:for-teens|account)$/.test(pathname))).toBe(false);
      expectNoMutations(fixture);
    });
  }

  test(`${prefix || "zh"} 年龄分流访客在花园原页登录并主动确认，未跳到介绍或账户`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, { signedIn: false });
    await page.goto(`${prefix}/for-young-people`);
    await secondaryCard(page, copy).getByRole("link", { name: copy.forYoungPeople.paths.secondary.action, exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${prefix}/garden`);
    const panel = page.getByTestId("inline-student-consent");
    await panel.getByRole("textbox", { name: copy.account.visitor.email, exact: true }).fill(fixture.state.user.email);
    await panel.getByRole("button", { name: copy.account.visitor.sendOtp, exact: true }).click();
    await panel.getByRole("textbox", { name: copy.account.visitor.otp, exact: true }).fill("12345678");
    await panel.getByRole("button", { name: copy.account.visitor.signIn, exact: true }).click();
    const age = panel.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true });
    await expect(age).toHaveValue("");
    expect(fixture.state.consentPosts).toEqual([]);
    expect(fixture.state.gardenReads).toBe(0);
    await age.selectOption("14_17");
    await panel.getByRole("checkbox", { name: copy.account.consent.acknowledgement, exact: true }).check();
    await panel.getByRole("button", { name: copy.account.consent.completeStudent, exact: true }).click();
    await expect(page.getByRole("heading", { name: copy.garden.scene.title, exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}${prefix}/garden`);
    expect(fixture.state.otpSends).toBe(1);
    expect(fixture.state.otpVerifies).toBe(1);
    expect(fixture.state.consentPosts).toEqual([{ action: "student_assent", ageBand: "14_17" }]);
    expect(fixture.state.profileWrites).toEqual([]);
    expect(fixture.state.gardenWrites).toBe(0);
    expect(fixture.state.aiCalls).toEqual([]);
    expect(fixture.state.unexpectedApi).toEqual([]);
    expect(fixture.state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 年龄分流不能绕过花园接口的真实403拒绝`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, { consentState: "active" });
    let refused = 0;
    await page.route("**/api/garden*", (route) => {
      expect(route.request().method()).toBe("GET");
      const token = route.request().headers().authorization?.split(" ")[1] || "";
      expect(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub).toBe(fixture.state.user.id);
      refused++;
      return route.fulfill({ status: 403, json: { error: "SYNTHETIC_PRIVATE_GARDEN_DENIAL" } });
    });
    await page.goto(`${prefix}/for-young-people`);
    await secondaryCard(page, copy).getByRole("link", { name: copy.forYoungPeople.paths.secondary.action, exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${prefix}/garden`);
    await expect(page.locator('main [role="alert"]')).toHaveText(copy.garden.status.restricted);
    await expect(page.getByRole("heading", { name: copy.garden.scene.title, exact: true })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("SYNTHETIC_PRIVATE_GARDEN_DENIAL");
    expect(refused).toBeGreaterThan(0);
    expectNoMutations(fixture);
  });

  test(`${prefix || "zh"} 中学生介绍保留为轻量链接，大学生路径保持原入口`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, { signedIn: false });
    await page.goto(`${prefix}/for-young-people`);
    await secondaryCard(page, copy).getByRole("link", { name: copy.forYoungPeople.paths.secondary.learnMore, exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${prefix}/for-teens`);
    await expect(page.getByRole("heading", { level: 1, name: copy.forTeens.hero.title, exact: true })).toBeVisible();
    await page.goto(`${prefix}/for-young-people`);
    const adult = page.locator("main article").filter({
      has: page.getByRole("heading", { level: 2, name: copy.forYoungPeople.paths.youngAdults.title, exact: true }),
    });
    const link = adult.getByRole("link", { name: copy.forYoungPeople.paths.youngAdults.action, exact: true });
    await expect(link).toHaveAttribute("href", `${prefix}/for-young-adults`);
    await link.click();
    await expect(page).toHaveURL(`${baseURL}${prefix}/for-young-adults`);
    expectNoMutations(fixture);
  });
}
