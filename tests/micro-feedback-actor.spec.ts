import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { inlineToolsTraffic } from "./fixtures/synthetic-inline-tools";
import { syntheticMicroFeedbackActor } from "./fixtures/synthetic-micro-feedback-actor";

type Copy = typeof zh | typeof en;
const draftA = "Synthetic private micro-feedback draft A";
const draftB = "Synthetic private micro-feedback draft B";

function card(page: Page, copy: Copy) {
  return page.getByRole("region", { name: copy.microFeedback.title, exact: true });
}
function field(page: Page, copy: Copy) {
  return card(page, copy).getByRole("textbox", { name: copy.microFeedback.comment, exact: true });
}
function submit(page: Page, copy: Copy) {
  return card(page, copy).getByRole("button", { name: copy.microFeedback.submit, exact: true });
}
async function fillAnswers(page: Page, copy: Copy) {
  await card(page, copy).getByRole("group", { name: copy.microFeedback.questions.helpful, exact: true }).getByLabel(copy.microFeedback.yes, { exact: true }).check();
  await card(page, copy).getByRole("group", { name: copy.microFeedback.questions.wouldReturn, exact: true }).getByLabel(copy.microFeedback.no, { exact: true }).check();
  await card(page, copy).getByRole("group", { name: copy.microFeedback.questions.wantsHumanSupport, exact: true }).getByLabel(copy.microFeedback.yes, { exact: true }).check();
}
async function triggerSweet(page: Page, copy: Copy) {
  const progress = (step: number) => page.getByText(copy.checkIn.progress.step
    .replace("{{current}}", String(step)).replace("{{total}}", "5"), { exact: true });
  // Header Auth updates can precede the parent form reset. Start only when
  // this actor's first step is rendered, and confirm each navigation commit.
  await expect(progress(1)).toBeVisible();
  for (let step = 0; step < 5; step++) {
    await expect(progress(step + 1)).toBeVisible();
    const option = page.locator("main article button[aria-pressed]").first();
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
    if (step < 4) {
      await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
      await expect(progress(step + 2)).toBeVisible();
    }
  }
  await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).click();
  await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
}
async function ready(page: Page, copy: Copy) {
  await triggerSweet(page, copy);
  await expect(field(page, copy)).toBeVisible();
}
async function headerActor(page: Page, name: string) {
  await expect(page.locator("header")).toContainText(name);
}

test.afterEach(async ({ page }) => {
  const traffic = inlineToolsTraffic.get(page);
  if (traffic) {
    expect(traffic.blockedExternal).toEqual([]);
    expect(traffic.unexpectedApi).toEqual([]);
  }
});

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} micro 正常编辑与同账号token刷新后提交仍绑定A`, async ({ page, baseURL }) => {
    const fixture = await syntheticMicroFeedbackActor(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await ready(page, copy);
    await field(page, copy).fill("First revision");
    await field(page, copy).fill(draftA);
    await fillAnswers(page, copy);
    const initialToken = fixture.requests.find((item) => item.method === "GET")!.token;
    const fresh = await fixture.changeActor("A", true, "TOKEN_REFRESHED");
    await expect(field(page, copy)).toHaveValue(draftA);
    await submit(page, copy).click();
    await expect.poll(() => fixture.requests.filter((item) => item.method === "POST").length).toBe(1);
    const post = fixture.requests.find((item) => item.method === "POST")!;
    expect(post.actor).toBe(fixture.ids.A);
    expect(post.token).toBe(fresh);
    expect(post.token).not.toBe(initialToken);
    expect(post.body).toEqual({ feature: "sweet", outcome: "submitted", helpful: true, wouldReturn: false,
      wantsHumanSupport: true, comment: draftA, locale: prefix ? "en" : "zh-CN" });
    await expect(card(page, copy)).toHaveCount(0);
    await expect(page.getByText(copy.microFeedback.thanks, { exact: false })).toBeVisible();
    await expect(page.getByRole("status").getByRole("link", { name: copy.microFeedback.support, exact: true })).toBeVisible();
    expect(fixture.state.otpSends).toBe(0);
    expect(fixture.state.aiCalls).toEqual([]);
  });

  test(`${prefix || "zh"} micro RED换号撤下A草稿且同挂载A与B恢复各自内容`, async ({ page, baseURL }) => {
    const fixture = await syntheticMicroFeedbackActor(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await ready(page, copy);
    await field(page, copy).fill(draftA);
    await fillAnswers(page, copy);
    await fixture.changeActor("B");
    await headerActor(page, "Second inline account");
    // Regression: the old component leaves A's populated card visible when trigger becomes zero.
    await expect(card(page, copy)).toHaveCount(0);
    await ready(page, copy);
    await expect(field(page, copy)).toHaveValue("");
    await expect(card(page, copy).locator("input:checked")).toHaveCount(0);
    await field(page, copy).fill(draftB);
    await fixture.changeActor("A");
    await headerActor(page, "Inline preview");
    await ready(page, copy);
    await expect(field(page, copy)).toHaveValue(draftA);
    await expect(card(page, copy).locator("input:checked")).toHaveCount(3);
    await fixture.changeActor("B");
    await headerActor(page, "Second inline account");
    await ready(page, copy);
    await expect(field(page, copy)).toHaveValue(draftB);
    await expect(card(page, copy).locator("input:checked")).toHaveCount(0);
    await submit(page, copy).click();
    await expect.poll(() => fixture.requests.filter((item) => item.method === "POST").length).toBe(1);
    const post = fixture.requests.find((item) => item.method === "POST")!;
    expect(post.actor).toBe(fixture.ids.B);
    expect(post.body).toMatchObject({ comment: draftB, helpful: null, wouldReturn: null, wantsHumanSupport: null });
  });

  test(`${prefix || "zh"} micro B登出再登录只恢复B本人稿，登出不提交`, async ({ page, baseURL }) => {
    const fixture = await syntheticMicroFeedbackActor(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await ready(page, copy);
    await field(page, copy).fill(draftA);
    await fixture.changeActor("B");
    await headerActor(page, "Second inline account");
    await ready(page, copy);
    await field(page, copy).fill(draftB);
    await fixture.changeActor("signed_out");
    await expect(card(page, copy)).toHaveCount(0);
    expect(fixture.requests.filter((item) => item.method === "POST")).toHaveLength(0);
    await fixture.changeActor("B");
    await headerActor(page, "Second inline account");
    await ready(page, copy);
    await expect(field(page, copy)).toHaveValue(draftB);
    await expect(field(page, copy)).not.toHaveValue(draftA);
  });

  for (const reply of [{ urgent: false }, { urgent: true }, { status: 503 }] as const) {
    test(`${prefix || "zh"} micro A迟到POST ${JSON.stringify(reply)}不改变B编辑与提示`, async ({ page, baseURL }) => {
      const fixture = await syntheticMicroFeedbackActor(page, baseURL!);
      const held = fixture.hold("POST", "A", reply);
      try {
        await page.goto(`${prefix}/check-in`);
        await ready(page, copy);
        await field(page, copy).fill(draftA);
        await submit(page, copy).click();
        await expect.poll(() => held.held).toBe(true);
        await fixture.changeActor("B");
        await headerActor(page, "Second inline account");
        await ready(page, copy);
        await field(page, copy).fill(draftB);
        await fillAnswers(page, copy);
        const pendingB = "urgent" in reply && reply.urgent === false ? fixture.hold("POST", "B") : null;
        if (pendingB) {
          await submit(page, copy).click();
          await expect.poll(() => pendingB.held).toBe(true);
          await expect(submit(page, copy)).toBeDisabled();
        }
        await field(page, copy).focus();
        await fixture.releaseAndSettle(held);
        await expect(field(page, copy)).toHaveValue(draftB);
        await expect(field(page, copy)).toBeFocused();
        await expect(card(page, copy).locator("input:checked")).toHaveCount(3);
        if (pendingB) await expect(submit(page, copy)).toBeDisabled();
        else await expect(submit(page, copy)).toBeEnabled();
        await expect(page.getByText(copy.microFeedback.thanks, { exact: false })).toHaveCount(0);
        await expect(page.getByText(copy.microFeedback.urgent, { exact: false })).toHaveCount(0);
        await expect(page.getByText(copy.microFeedback.errors.unavailable, { exact: false })).toHaveCount(0);
        const posts = fixture.requests.filter((item) => item.method === "POST");
        expect(posts).toHaveLength(pendingB ? 2 : 1);
        expect(posts[0]).toMatchObject({ actor: fixture.ids.A, body: { comment: draftA } });
        if (pendingB) {
          expect(posts[1]).toMatchObject({ actor: fixture.ids.B, body: { comment: draftB } });
          await fixture.releaseAndSettle(pendingB);
          await expect(card(page, copy)).toHaveCount(0);
          await expect(page.getByText(copy.microFeedback.thanks, { exact: false })).toBeVisible();
        }
      } finally { fixture.releaseAll(); }
    });
  }

  test(`${prefix || "zh"} micro 未广播换号时不得以B身份提交A稿`, async ({ page, baseURL }) => {
    const fixture = await syntheticMicroFeedbackActor(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await ready(page, copy);
    await field(page, copy).fill(draftA);
    await fixture.changeActor("B", false);
    // No focus/visibility/Auth notification before click: submission must read the fresh session itself.
    await submit(page, copy).click();
    await expect.poll(() => fixture.requests.filter((item) => item.method === "POST").length).toBe(0);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("button", { name: copy.checkIn.actions.next, exact: true })).toBeVisible();
    await expect(card(page, copy)).toHaveCount(0);
    await ready(page, copy);
    await expect(field(page, copy)).toHaveValue("");
    expect(fixture.requests.some((item) => item.method === "GET" && item.actor === fixture.ids.B)).toBe(true);
    expect(fixture.requests.filter((item) => item.method === "POST")).toHaveLength(0);
    await field(page, copy).fill(draftB);
    await submit(page, copy).click();
    await expect.poll(() => fixture.requests.filter((item) => item.method === "POST").length).toBe(1);
    expect(fixture.requests.find((item) => item.method === "POST")).toMatchObject({ actor: fixture.ids.B, body: { comment: draftB } });
  });

  test(`${prefix || "zh"} micro 迟到资格GET在退出后不得重新显示A卡片`, async ({ page, baseURL }) => {
    const fixture = await syntheticMicroFeedbackActor(page, baseURL!);
    const held = fixture.hold("GET", "A");
    try {
      await page.goto(`${prefix}/check-in`);
      await triggerSweet(page, copy);
      await expect.poll(() => held.held).toBe(true);
      await fixture.changeActor("signed_out");
      await expect(card(page, copy)).toHaveCount(0);
      await fixture.releaseAndSettle(held);
      await expect(card(page, copy)).toHaveCount(0);
      expect(fixture.requests.filter((item) => item.method === "POST")).toHaveLength(0);
    } finally { fixture.releaseAll(); }
  });

  test(`${prefix || "zh"} micro 未广播换号后迟到POST也必须复核当前actor`, async ({ page, baseURL }) => {
    const fixture = await syntheticMicroFeedbackActor(page, baseURL!);
    const held = fixture.hold("POST", "A", { urgent: true });
    try {
      await page.goto(`${prefix}/check-in`);
      await ready(page, copy);
      await field(page, copy).fill(draftA);
      await submit(page, copy).click();
      await expect.poll(() => held.held).toBe(true);
      await fixture.changeActor("B", false);
      await fixture.releaseAndSettle(held);
      await expect(page.getByText(copy.microFeedback.urgent, { exact: false })).toHaveCount(0);
      await expect(page.getByText(copy.microFeedback.thanks, { exact: false })).toHaveCount(0);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByRole("button", { name: copy.checkIn.actions.next, exact: true })).toBeVisible();
      await expect(card(page, copy)).toHaveCount(0);
      await ready(page, copy);
      await expect(field(page, copy)).toHaveValue("");
      expect(fixture.requests.some((item) => item.method === "GET" && item.actor === fixture.ids.B)).toBe(true);
      expect(fixture.requests.filter((item) => item.method === "POST")).toMatchObject([
        { actor: fixture.ids.A, body: { comment: draftA } },
      ]);
      await field(page, copy).fill(draftB);
      await submit(page, copy).click();
      await expect.poll(() => fixture.requests.filter((item) => item.method === "POST").length).toBe(2);
      expect(fixture.requests.filter((item) => item.method === "POST")[1]).toMatchObject({ actor: fixture.ids.B, body: { comment: draftB } });
    } finally { fixture.releaseAll(); }
  });

  test(`${prefix || "zh"} micro A到B再A的旧POST代际不得清除A新编辑`, async ({ page, baseURL }) => {
    const fixture = await syntheticMicroFeedbackActor(page, baseURL!);
    const held = fixture.hold("POST", "A", { urgent: true });
    try {
      await page.goto(`${prefix}/check-in`);
      await ready(page, copy);
      await field(page, copy).fill(draftA);
      await submit(page, copy).click();
      await expect.poll(() => held.held).toBe(true);
      await fixture.changeActor("B");
      await headerActor(page, "Second inline account");
      await fixture.changeActor("A");
      await headerActor(page, "Inline preview");
      await ready(page, copy);
      await field(page, copy).fill("A new current revision");
      await fixture.releaseAndSettle(held);
      await expect(field(page, copy)).toHaveValue("A new current revision");
      await expect(submit(page, copy)).toBeEnabled();
      await expect(page.getByText(copy.microFeedback.urgent, { exact: false })).toHaveCount(0);
    } finally { fixture.releaseAll(); }
  });

  test(`${prefix || "zh"} micro 跳过不带正文且正常失败允许本人稿重试`, async ({ page, baseURL }) => {
    const fixture = await syntheticMicroFeedbackActor(page, baseURL!);
    const held = fixture.hold("POST", "A", { status: 503 });
    try {
      await page.goto(`${prefix}/check-in`);
      await ready(page, copy);
      await field(page, copy).fill(draftA);
      await submit(page, copy).click();
      await expect.poll(() => held.held).toBe(true);
      await fixture.releaseAndSettle(held);
      await expect(field(page, copy)).toHaveValue(draftA);
      await expect(submit(page, copy)).toBeEnabled();
      await expect(page.getByText(copy.microFeedback.errors.unavailable, { exact: false })).toBeVisible();
      await card(page, copy).getByRole("button", { name: copy.microFeedback.skip, exact: true }).click();
      await expect.poll(() => fixture.requests.filter((item) => item.method === "POST").length).toBe(2);
      const post = fixture.requests.filter((item) => item.method === "POST")[1];
      expect(post.actor).toBe(fixture.ids.A);
      expect(post.body).toEqual({ feature: "sweet", outcome: "dismissed", locale: prefix ? "en" : "zh-CN" });
      await expect(card(page, copy)).toHaveCount(0);
    } finally { fixture.releaseAll(); }
  });

  test(`${prefix || "zh"} micro 同actor保存期间新稿保留但urgent结果仍提供人工支持`, async ({ page, baseURL }) => {
    const fixture = await syntheticMicroFeedbackActor(page, baseURL!);
    const held = fixture.hold("POST", "A", { urgent: true });
    try {
      await page.goto(`${prefix}/check-in`);
      await ready(page, copy);
      await field(page, copy).fill(draftA);
      await submit(page, copy).click();
      await expect.poll(() => held.held).toBe(true);
      await field(page, copy).fill("A edits while its own save is pending");
      await fixture.releaseAndSettle(held);
      await expect(field(page, copy)).toHaveValue("A edits while its own save is pending");
      await expect(submit(page, copy)).toBeEnabled();
      await expect(page.getByText(copy.microFeedback.urgent, { exact: false })).toBeVisible();
      await expect(page.getByRole("status").getByRole("link", { name: copy.microFeedback.support, exact: true })).toBeVisible();
      const posts = fixture.requests.filter((item) => item.method === "POST");
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ actor: fixture.ids.A, body: { comment: draftA } });
    } finally { fixture.releaseAll(); }
  });

  test(`${prefix || "zh"} micro 一次session读取失败后同A重核恢复本人草稿`, async ({ page, baseURL }) => {
    const fixture = await syntheticMicroFeedbackActor(page, baseURL!);
    await page.goto(`${prefix}/check-in`);
    await ready(page, copy);
    await field(page, copy).fill(draftA);
    await page.evaluate((key) => {
      const runtime = window as typeof window & { microStorageFailureHits: number };
      runtime.microStorageFailureHits = 0;
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (name: string) {
        if (name === key) {
          Storage.prototype.getItem = original;
          runtime.microStorageFailureHits++;
          throw new Error("Synthetic single session read failure");
        }
        return original.call(this, name);
      };
    }, fixture.storageKey);
    await submit(page, copy).click();
    await expect.poll(() => page.evaluate(() => (window as typeof window & { microStorageFailureHits: number }).microStorageFailureHits)).toBe(1);
    expect(fixture.requests.filter((item) => item.method === "POST")).toHaveLength(0);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(field(page, copy)).toHaveValue(draftA);
    await expect(submit(page, copy)).toBeEnabled();
    await submit(page, copy).click();
    await expect.poll(() => fixture.requests.filter((item) => item.method === "POST").length).toBe(1);
    expect(fixture.requests.find((item) => item.method === "POST")).toMatchObject({ actor: fixture.ids.A, body: { comment: draftA } });
  });

  test(`${prefix || "zh"} micro 合并登出及同uid重登仍隔离旧保存代际`, async ({ page, baseURL }) => {
    const fixture = await syntheticMicroFeedbackActor(page, baseURL!);
    const held = fixture.hold("POST", "A", { urgent: true });
    try {
      await page.goto(`${prefix}/check-in`);
      await ready(page, copy);
      await field(page, copy).fill(draftA);
      await submit(page, copy).click();
      await expect.poll(() => held.held).toBe(true);
      const beforeReads = fixture.requests.filter((item) => item.method === "GET").length;
      await page.evaluate((key) => {
        const session = JSON.parse(localStorage.getItem(key)!);
        const channel = new BroadcastChannel(key);
        localStorage.removeItem(key);
        channel.postMessage({ event: "SIGNED_OUT", session: null });
        session.access_token += "-same-actor-relogin";
        localStorage.setItem(key, JSON.stringify(session));
        channel.postMessage({ event: "SIGNED_IN", session });
        channel.close();
      }, fixture.storageKey);
      await page.evaluate(() => new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 0), 0)));
      // Auth callbacks may be batched into the same render, or the parent may
      // observe signed_out and legitimately clear its business trigger.
      if (await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).isVisible()) {
        await ready(page, copy);
      } else {
        await expect.poll(() => fixture.requests.filter((item) => item.method === "GET").length).toBeGreaterThan(beforeReads);
      }
      await expect(field(page, copy)).toHaveValue(draftA);
      await field(page, copy).fill("Current A draft after batched login");
      await fixture.releaseAndSettle(held);
      await expect(field(page, copy)).toHaveValue("Current A draft after batched login");
      await expect(submit(page, copy)).toBeEnabled();
      await expect(page.getByText(copy.microFeedback.urgent, { exact: false })).toHaveCount(0);
      expect(fixture.requests.filter((item) => item.method === "POST")).toHaveLength(1);
    } finally { fixture.releaseAll(); }
  });

  for (const entry of ["garden", "peer-space", "support-request"] as const) {
    test(`${prefix || "zh"} micro ${entry}实际挂载入口换号仅提交B本人反馈`, async ({ page, baseURL }) => {
      const fixture = await syntheticMicroFeedbackActor(page, baseURL!);
      let expectedFeature: string;
      let trigger: () => Promise<void>;
      if (entry === "garden") {
        expectedFeature = "quick_check_in";
        await page.addInitScript((id) => localStorage.setItem(`youthtempo:garden:intro:v2:${id}`, "seen"), fixture.ids.B);
        await page.route("**/api/garden?*", async (route) => {
          if (route.request().method() !== "POST") return route.fallback();
          expect(route.request().postDataJSON()).toMatchObject({ feeling: "steady" });
          return route.fulfill({ json: { checkIn: { id: "synthetic-quick-check-in", created_at: "2026-10-31T00:00:00Z" } } });
        });
        trigger = async () => {
          await page.getByRole("navigation", { name: copy.garden.actions.ariaLabel, exact: true })
            .getByRole("button", { name: copy.garden.actions.record, exact: true }).click();
          const dialog = page.getByRole("dialog", { name: copy.garden.quick.title, exact: true });
          await dialog.getByLabel(copy.garden.quick.steady, { exact: true }).check();
          await dialog.getByRole("button", { name: copy.garden.quick.submit, exact: true }).click();
          await expect(field(page, copy)).toBeVisible();
          await page.getByRole("dialog").getByRole("button", { name: copy.garden.actions.close, exact: true }).click();
        };
      } else if (entry === "peer-space") {
        expectedFeature = "peer_space";
        fixture.state.ageBand = "18_plus";
        const left = new Set<string>();
        await page.route("**/api/peer-space/**", async (route) => {
          const path = new URL(route.request().url()).pathname;
          const method = route.request().method();
          if (path === "/api/peer-space/access") return route.fulfill({ json: { available: true, rulesAccepted: true, rulesVersion: "synthetic-v1" } });
          if (path === "/api/peer-space/rooms") {
            if (method === "DELETE") {
              left.add(fixture.state.user.id);
              return route.fulfill({ json: { saved: true } });
            }
            if (method === "GET") return route.fulfill({ json: { rulesAccepted: true, rooms: [{
              id: "synthetic-room", code: "synthetic-room", title: "Synthetic room", description: "Synthetic room description",
              guidelines: "Synthetic room rules", status: "staffed_open", joined: !left.has(fixture.state.user.id),
            }] } });
          }
          if (path === "/api/peer-space/messages" && method === "GET") return route.fulfill({ json: { messages: [], roomStatus: "staffed_open" } });
          if (path === "/api/peer-space/controls" && method === "GET") return route.fulfill({ json: { controls: [] } });
          fixture.state.unexpectedApi.push(`${method} ${path}`);
          return route.abort();
        });
        trigger = async () => {
          await page.getByRole("button", { name: copy.peerSpaceLive.leave, exact: true }).click();
          await expect(field(page, copy)).toBeVisible();
        };
      } else {
        expectedFeature = "support";
        const closed = new Set<string>();
        await page.route("**/api/support/**", async (route) => {
          const path = new URL(route.request().url()).pathname;
          const method = route.request().method();
          if (path === "/api/support/cases" && method === "GET") return route.fulfill({ json: {
            consultationAvailable: false, ageBand: "14_17", cases: [{
              id: "synthetic-support-case", status: closed.has(fixture.state.user.id) ? "closed" : "active",
              need_summary: "Synthetic school support request", availability: null, appointment_at: null,
              appointment_status: "none", referral_type: null, created_at: "2026-10-31T00:00:00Z",
              assignments: [], events: [], feedbackSubmitted: false,
            }],
          } });
          if (path === "/api/support/case-action" && method === "POST") {
            expect(route.request().postDataJSON()).toMatchObject({ caseId: "synthetic-support-case", action: "close" });
            closed.add(fixture.state.user.id);
            return route.fulfill({ json: { saved: true } });
          }
          fixture.state.unexpectedApi.push(`${method} ${path}`);
          return route.abort();
        });
        trigger = async () => {
          await page.getByRole("button", { name: copy.supportFlow.portal.actions.close, exact: true }).click();
          await expect(field(page, copy)).toBeVisible();
        };
      }
      await page.goto(`${prefix}/${entry}`);
      await trigger();
      await field(page, copy).fill(draftA);
      await fixture.changeActor("B");
      await headerActor(page, "Second inline account");
      await expect(card(page, copy)).toHaveCount(0);
      await trigger();
      await expect(field(page, copy)).toHaveValue("");
      await field(page, copy).fill(draftB);
      await submit(page, copy).click();
      await expect.poll(() => fixture.requests.filter((item) => item.method === "POST").length).toBe(1);
      expect(fixture.requests.find((item) => item.method === "POST")).toMatchObject({
        actor: fixture.ids.B, body: { feature: expectedFeature, comment: draftB, outcome: "submitted" },
      });
    });
  }
}
