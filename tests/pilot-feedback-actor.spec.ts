import { expect, test } from "@playwright/test";
import en from "../locales/en.json";
import zh from "../locales/zh-CN.json";
import { feedbackA, feedbackB, syntheticFeedbackActor } from "./fixtures/synthetic-feedback-actor";

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} feedback 换号读取本人反馈、提交新token，退出撤下旧表单`, async ({ page, baseURL }) => {
    const fixture = await syntheticFeedbackActor(page, baseURL!);
    await page.goto(`${prefix}/feedback`);
    const field = page.getByRole("textbox", { name: copy.feedback.member.textQuestions.mostHelpful.label, exact: true });
    await expect(field).toHaveValue(feedbackA);
    await fixture.changeSession("second_student");
    await expect(field).toHaveValue(feedbackB);
    await expect(field).not.toHaveValue(feedbackA);
    await field.fill("New B feedback draft");
    await page.getByRole("button", { name: copy.feedback.member.saveChanges, exact: true }).click();
    await expect.poll(() => fixture.requests.filter((item) => item.method === "POST").length).toBe(1);
    const post = fixture.requests.find((item) => item.method === "POST")!;
    expect(post.actor).toBe(fixture.state.user.id);
    expect(post.actor).not.toBe(fixture.firstId);
    expect(post.body).toMatchObject({ mostHelpful: "New B feedback draft", mayContact: false });
    expect(Object.keys(post.body!).sort()).toEqual(["clarity", "hardToUse", "mayContact", "mostHelpful", "overallExperience", "safety", "suggestion"]);
    await expect(page.getByRole("status").first()).toContainText(copy.feedback.member.notices.received);
    await fixture.changeSession("signed_out");
    await expect(page.locator("form")).toHaveCount(0);
    await expect(page.getByRole("link", { name: copy.feedback.visitor.action, exact: true })).toBeVisible();
    expect(fixture.state.blockedExternal).toEqual([]);
    expect(fixture.state.unexpectedApi).toEqual([]);
  });

  test(`${prefix || "zh"} feedback A的迟到读取不进入B表单`, async ({ page, baseURL }) => {
    const fixture = await syntheticFeedbackActor(page, baseURL!, "GET");
    try {
      await page.goto(`${prefix}/feedback`);
      await expect.poll(fixture.held).toBe(true);
      await fixture.changeSession("second_student");
      const field = page.getByRole("textbox", { name: copy.feedback.member.textQuestions.mostHelpful.label, exact: true });
      await expect(field).toHaveValue(feedbackB);
      await field.fill("B keeps this draft");
      fixture.release();
      await expect.poll(fixture.settled).toBe(true);
      await expect(field).toHaveValue("B keeps this draft");
      expect(fixture.requests.filter((item) => item.method === "POST")).toHaveLength(0);
      expect(fixture.state.blockedExternal).toEqual([]);
      expect(fixture.state.unexpectedApi).toEqual([]);
    } finally { fixture.release(); }
  });

  test(`${prefix || "zh"} feedback A的迟到保存不清除B草稿、勾选或焦点`, async ({ page, baseURL }) => {
    const fixture = await syntheticFeedbackActor(page, baseURL!, "POST");
    try {
      await page.goto(`${prefix}/feedback`);
      const field = page.getByRole("textbox", { name: copy.feedback.member.textQuestions.mostHelpful.label, exact: true });
      await expect(field).toHaveValue(feedbackA);
      await field.fill("A pending save");
      await page.getByRole("button", { name: copy.feedback.member.saveChanges, exact: true }).click();
      await expect.poll(fixture.held).toBe(true);
      await fixture.changeSession("second_student");
      await expect(field).toHaveValue(feedbackB);
      await field.fill("B independent draft");
      const contact = page.locator("form input[type=checkbox]");
      await contact.check();
      await field.focus();
      fixture.release();
      await expect.poll(fixture.settled).toBe(true);
      await expect(field).toHaveValue("B independent draft");
      await expect(field).toBeFocused();
      await expect(contact).toBeChecked();
      await expect(page.getByRole("status")).toHaveCount(0);
      expect(fixture.requests.filter((item) => item.method === "POST")).toHaveLength(1);
      expect(fixture.state.blockedExternal).toEqual([]);
      expect(fixture.state.unexpectedApi).toEqual([]);
    } finally { fixture.release(); }
  });

  test(`${prefix || "zh"} feedback 同账号刷新token后提交取当前会话，不使用加载时token`, async ({ page, baseURL }) => {
    const fixture = await syntheticFeedbackActor(page, baseURL!);
    await page.goto(`${prefix}/feedback`);
    await expect(page.getByRole("textbox", { name: copy.feedback.member.textQuestions.mostHelpful.label, exact: true })).toHaveValue(feedbackA);
    const initial = fixture.requests.find((item) => item.method === "GET")!.token;
    const fresh = await page.evaluate(({ key }) => {
      const session = JSON.parse(localStorage.getItem(key)!);
      session.access_token = `${session.access_token}-refreshed`;
      localStorage.setItem(key, JSON.stringify(session));
      const channel = new BroadcastChannel(key);
      channel.postMessage({ event: "TOKEN_REFRESHED", session }); channel.close();
      return session.access_token as string;
    }, { key: fixture.storageKey });
    await page.getByRole("button", { name: copy.feedback.member.saveChanges, exact: true }).click();
    await expect.poll(() => fixture.requests.filter((item) => item.method === "POST").length).toBe(1);
    const post = fixture.requests.find((item) => item.method === "POST")!;
    expect(post.token).toBe(fresh);
    expect(post.token).not.toBe(initial);
    expect(fixture.state.blockedExternal).toEqual([]);
    expect(fixture.state.unexpectedApi).toEqual([]);
  });
}
