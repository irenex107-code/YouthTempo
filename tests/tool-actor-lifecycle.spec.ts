import { expect, test, type Page } from "@playwright/test";
import en from "../locales/en.json";
import zh from "../locales/zh-CN.json";
import { syntheticInlineConsent } from "./fixtures/synthetic-inline-consent";

type Tool = "worry-time" | "referral";
type Copy = typeof zh | typeof en;
const draft = "PRIVATE synthetic A tool draft";
const normalResult = "PRIVATE synthetic A tool result";
const urgentResult = "PRIVATE synthetic A urgent response";

function result(tool: Tool) {
  return tool === "worry-time"
    ? { decisionMethod: "deterministic_rules", decisionVersion: "synthetic", controllableParts: normalResult,
      canWaitUntilTomorrow: "Synthetic tomorrow", tomorrowSmallAction: "Synthetic small action", bedtimeSentence: "Synthetic rest", supportReminder: "Synthetic support" }
    : { decisionMethod: "deterministic_rules", decisionVersion: "synthetic", recommendedSupport: normalResult,
      reason: "Synthetic reason", nextStep: "Synthetic small action", whenToSeekMoreSupport: "Synthetic support", supportReminder: "Synthetic reminder", supportTier: "self_guided" };
}

async function toolFixture(page: Page, baseURL: string, tool: Tool, options: { signedIn?: boolean; hold?: boolean; urgent?: boolean } = {}) {
  expect(new URL(baseURL).hostname).toBe("127.0.0.1");
  const fixture = await syntheticInlineConsent(page, baseURL, { consentState: "active", signedIn: options.signedIn });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requests: Array<{ authorization: string; body: Record<string, unknown> }> = [];
  let settled = false;
  await page.route(`**/api/ai/${tool}`, async (route) => {
    requests.push({ authorization: route.request().headers().authorization || "", body: route.request().postDataJSON() as Record<string, unknown> });
    if (options.hold) await gate;
    try {
      await route.fulfill({ json: options.urgent
        ? { urgent: true, reply: urgentResult, suggestHumanSupport: true } : result(tool) });
    } finally { settled = true; }
  });
  return { ...fixture, requests, release, settled: () => settled };
}

async function fillTool(page: Page, tool: Tool, copy: Copy, text = draft) {
  if (tool === "worry-time") {
    await page.locator("textarea").first().fill(text);
    await page.locator("textarea").nth(3).fill(`${text} action`);
    await page.getByRole("button", { name: copy.worryTime.controls.actionable, exact: true }).first().click();
  } else {
    for (const question of Object.values(copy.referral.questions).filter((item) => typeof item === "object" && "title" in item)) {
      const article = page.locator("article").filter({ has: page.getByRole("heading", { name: question.title, exact: true }) });
      await article.getByRole("button").first().click();
    }
    await page.getByRole("textbox", { name: copy.referral.generate.noteLabel, exact: true }).fill(text);
  }
}

function generate(page: Page, tool: Tool, copy: Copy) {
  return page.getByRole("button", { name: tool === "worry-time" ? copy.worryTime.actions.organize : copy.referral.actions.generate, exact: true });
}

async function expectCleared(page: Page, tool: Tool, copy: Copy) {
  for (const field of await page.locator("textarea").all()) await expect(field).toHaveValue("");
  await expect(page.getByText(normalResult, { exact: true })).toHaveCount(0);
  await expect(page.getByText(urgentResult, { exact: true })).toHaveCount(0);
  if (tool === "worry-time") {
    await expect(page.getByText("15:00", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: copy.worryTime.done.title, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.worryTime.controls.actionable, exact: true }).first()).not.toHaveClass(/bg-mist/);
  } else {
    await expect(page.locator("article button").filter({ hasText: "✓" })).toHaveCount(0);
  }
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  for (const tool of ["worry-time", "referral"] as const) {
    test(`${prefix || "zh"} ${tool} A→B清私人草稿、选择和结果，担心计时器停止`, async ({ page, baseURL }) => {
      const fixture = await toolFixture(page, baseURL!, tool);
      await page.clock.install();
      await page.goto(`${prefix}/${tool}`);
      await fillTool(page, tool, copy);
      if (tool === "worry-time") {
        await page.getByRole("button", { name: copy.worryTime.actions.start, exact: true }).click();
        await page.clock.runFor(1200);
        await expect(page.getByText("14:59", { exact: true })).toBeVisible();
      }
      await generate(page, tool, copy).click();
      await expect(page.getByText(normalResult, { exact: true })).toBeVisible();
      if (tool === "worry-time") await page.getByRole("button", { name: copy.worryTime.actions.complete, exact: true }).click();
      await fixture.changeSession("second_student");
      await expectCleared(page, tool, copy);
      if (tool === "worry-time") {
        await page.clock.runFor(2200);
        await expect(page.getByText("15:00", { exact: true })).toBeVisible();
      }
      expect(fixture.requests).toHaveLength(1);
      expect(fixture.requests[0].authorization).toBe("");
      expect(fixture.state.blockedExternal).toEqual([]);
      expect(fixture.state.unexpectedApi).toEqual([]);
    });

    test(`${prefix || "zh"} ${tool} 匿名首次登录及同actor刷新保留本人草稿，不自动请求`, async ({ page, baseURL }) => {
      const fixture = await toolFixture(page, baseURL!, tool, { signedIn: false });
      await page.goto(`${prefix}/${tool}`);
      await fillTool(page, tool, copy, "Anonymous current-page draft");
      await fixture.changeSession("second_student");
      await expect(page.locator("textarea").first()).toHaveValue("Anonymous current-page draft");
      await page.evaluate(({ key }) => {
        const session = JSON.parse(localStorage.getItem(key)!);
        session.access_token = `${session.access_token}-refreshed`;
        localStorage.setItem(key, JSON.stringify(session));
        const channel = new BroadcastChannel(key);
        channel.postMessage({ event: "TOKEN_REFRESHED", session }); channel.close();
      }, { key: fixture.storageKey });
      await expect(page.locator("textarea").first()).toHaveValue("Anonymous current-page draft");
      expect(fixture.requests).toHaveLength(0);
      await generate(page, tool, copy).click();
      await expect(page.getByText(normalResult, { exact: true })).toBeVisible();
      expect(fixture.requests).toHaveLength(1);
      expect(fixture.requests[0].authorization).toBe("");
      expect(fixture.state.otpSends).toBe(0);
      expect(fixture.state.otpVerifies).toBe(0);
      expect(fixture.state.blockedExternal).toEqual([]);
      expect(fixture.state.unexpectedApi).toEqual([]);
    });

    for (const transition of ["second_student", "signed_out"] as const) {
      test(`${prefix || "zh"} ${tool} ${transition}后旧${transition === "signed_out" ? "urgent" : "ordinary"}响应不回填或清新草稿`, async ({ page, baseURL }) => {
        const fixture = await toolFixture(page, baseURL!, tool, { hold: true, urgent: transition === "signed_out" });
        try {
          await page.goto(`${prefix}/${tool}`);
          await fillTool(page, tool, copy);
          await generate(page, tool, copy).click();
          await expect.poll(() => fixture.requests.length).toBe(1);
          await fixture.changeSession(transition);
          await expectCleared(page, tool, copy);
          await page.locator("textarea").first().fill("New independent draft");
          fixture.release();
          await expect.poll(fixture.settled).toBe(true);
          await expect(page.locator("textarea").first()).toHaveValue("New independent draft");
          await expect(page.getByText(normalResult, { exact: true })).toHaveCount(0);
          await expect(page.getByText(urgentResult, { exact: true })).toHaveCount(0);
          await expect(generate(page, tool, copy)).toBeEnabled();
          expect(fixture.requests).toHaveLength(1);
          expect(fixture.state.blockedExternal).toEqual([]);
          expect(fixture.state.unexpectedApi).toEqual([]);
        } finally { fixture.release(); }
      });
    }

    for (const change of tool === "worry-time" ? ["worry", "control", "action", "reset"] : ["note", "answer"]) {
      test(`${prefix || "zh"} ${tool} ${change}使旧请求失效，旧finally不能停止新请求loading`, async ({ page, baseURL }) => {
        const fixture = await toolFixture(page, baseURL!, tool);
        const release: Array<() => void> = [];
        const gates = [0, 1].map((index) => new Promise<void>((resolve) => { release[index] = resolve; }));
        const settled = [false, false];
        let count = 0;
        await page.route(`**/api/ai/${tool}`, async (route) => {
          const index = count++;
          expect(index).toBeLessThan(2);
          await gates[index];
          const text = index === 0 ? "STALE pre-edit tool result" : "CURRENT post-edit tool result";
          try {
            await route.fulfill({ json: { ...result(tool),
              ...(tool === "worry-time" ? { controllableParts: text } : { recommendedSupport: text }) } });
          } finally { settled[index] = true; }
        });
        try {
          await page.goto(`${prefix}/${tool}`);
          await fillTool(page, tool, copy);
          await generate(page, tool, copy).click();
          await expect.poll(() => count).toBe(1);
          if (change === "reset") {
            await page.getByRole("button", { name: copy.worryTime.actions.reset, exact: true }).click();
            await expectCleared(page, tool, copy);
            await fillTool(page, tool, copy, "Post-reset independent draft");
          } else if (change === "control") {
            await page.getByRole("button", { name: copy.worryTime.controls.uncontrollable, exact: true }).first().click();
          } else if (change === "action") {
            await page.locator("textarea").nth(3).fill("New independent action");
          } else if (change === "answer") {
            await page.getByRole("button", { name: copy.referral.questions.duration.options.days, exact: true }).click();
          } else {
            await page.locator("textarea").first().fill("Edited independent draft");
          }
          await expect(generate(page, tool, copy)).toBeEnabled();
          expect(count).toBe(1);
          await generate(page, tool, copy).click();
          await expect.poll(() => count).toBe(2);
          release[0]();
          await expect.poll(() => settled[0]).toBe(true);
          await expect(page.getByText("STALE pre-edit tool result", { exact: true })).toHaveCount(0);
          await expect(page.getByRole("button", { name: tool === "worry-time"
            ? copy.worryTime.actions.organizing : copy.referral.actions.generating, exact: true })).toBeDisabled();
          release[1]();
          await expect(page.getByText("CURRENT post-edit tool result", { exact: true })).toBeVisible();
          await expect(generate(page, tool, copy)).toBeEnabled();
          expect(count).toBe(2);
          expect(fixture.state.blockedExternal).toEqual([]);
          expect(fixture.state.unexpectedApi).toEqual([]);
        } finally { for (const done of release) done(); }
      });
    }
  }
}
