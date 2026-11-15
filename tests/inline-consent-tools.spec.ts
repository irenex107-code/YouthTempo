import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { draftCanary } from "./fixtures/synthetic-inline-consent";
import { inlineToolsTraffic, syntheticInlineTools } from "./fixtures/synthetic-inline-tools";

type Copy = typeof zh | typeof en;
function panel(page: Page) { return page.getByTestId("inline-student-consent"); }
async function confirm(page: Page, copy: Copy) {
  await panel(page).getByRole("combobox", { name: copy.account.consent.ageRange, exact: true }).selectOption("14_17");
  await panel(page).getByRole("checkbox", { name: copy.account.consent.acknowledgement, exact: true }).check();
  await panel(page).getByRole("button", { name: copy.account.consent.completeStudent, exact: true }).click();
  await expect(panel(page).getByRole("heading")).toHaveCount(0);
  await expect(panel(page).getByRole("status")).toBeVisible();
}

test.afterEach(async ({ page }) => {
  const traffic = inlineToolsTraffic.get(page);
  if (traffic) {
    expect(traffic.blockedExternal, "No request may escape to an external origin").toEqual([]);
    expect(traffic.unexpectedApi, "Every application API must be explicitly synthetic").toEqual([]);
  }
});

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} 完整SWEET不勾AI可直接保存，确认和AI处理互不捆绑`, async ({ page, baseURL }) => {
    const { state, tool } = await syntheticInlineTools(page, baseURL!, { consentState: "active" });
    await page.goto(`${prefix}/check-in`);
    for (let step = 0; step < 5; step += 1) {
      await page.locator("main article button[aria-pressed]").first().click();
      if (step < 4) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
    }
    await expect(panel(page).getByRole("heading")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true })).not.toBeChecked();
    await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).click();
    await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
    expect(tool.sweetWrites).toHaveLength(1);
    expect(tool.sweetWrites[0]).toMatchObject({ summary: null, small_step: null, recommended_next_tool: null });
    expect(tool.sweetWrites[0].records).toHaveLength(5);
    expect(state.consentPosts).toEqual([]);
    expect(state.aiCalls).toEqual([]);
    expect(state.otpSends).toBe(0);
  });

  test(`${prefix || "zh"} 留言就地确认后保留草稿，不自动发送`, async ({ page, baseURL }) => {
    const { state, tool } = await syntheticInlineTools(page, baseURL!);
    await page.goto(`${prefix}/messages`);
    const draft = page.getByRole("textbox", { name: copy.messages.compose.message });
    await draft.fill(draftCanary);
    await page.getByRole("button", { name: copy.messages.compose.saveForSelf, exact: true }).click();
    expect(tool.messagePosts).toEqual([]);
    await confirm(page, copy);
    await expect(draft).toHaveValue(draftCanary);
    expect(tool.messagePosts).toEqual([]);
    await page.getByRole("button", { name: copy.messages.compose.saveForSelf, exact: true }).click();
    await expect.poll(() => tool.messagePosts.length).toBe(1);
    expect(tool.messagePosts[0]).toMatchObject({ body: draftCanary, recipientType: "self", recipientUserId: state.user.id });
    await expect(draft).toHaveValue("");
    expect(state.aiCalls).toEqual([]);
    expect(state.consentPosts).toHaveLength(1);
  });

  test(`${prefix || "zh"} 社区就地确认后保留标题正文，不自动发布`, async ({ page, baseURL }) => {
    const { state, tool } = await syntheticInlineTools(page, baseURL!);
    await page.goto(`${prefix}/community`);
    const title = page.getByRole("textbox", { name: copy.community.newPost.titleLabel, exact: true });
    const body = page.getByRole("textbox", { name: copy.community.newPost.bodyLabel, exact: true });
    await title.fill("Synthetic reflection");
    await body.fill(draftCanary);
    await page.getByRole("button", { name: copy.community.actions.publish, exact: true }).click();
    expect(tool.communityPosts).toEqual([]);
    await confirm(page, copy);
    await expect(title).toHaveValue("Synthetic reflection");
    await expect(body).toHaveValue(draftCanary);
    expect(tool.communityPosts).toEqual([]);
    await page.getByRole("button", { name: copy.community.actions.publish, exact: true }).click();
    await expect.poll(() => tool.communityPosts.length).toBe(1);
    expect(tool.communityPosts[0]).toMatchObject({ title: "Synthetic reflection", body: draftCanary });
    await expect(title).toHaveValue("");
    await expect(body).toHaveValue("");
    expect(state.aiCalls).toEqual([]);
    expect(state.consentPosts).toHaveLength(1);
  });

  test(`${prefix || "zh"} 家长社区保留原有合法路径，不要求学生参与确认`, async ({ page, baseURL }) => {
    const { state, tool } = await syntheticInlineTools(page, baseURL!, { role: "家长" });
    await page.goto(`${prefix}/community`);
    const title = page.getByRole("textbox", { name: copy.community.newPost.titleLabel, exact: true });
    await expect(title).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await title.fill("Synthetic parent reflection");
    await page.getByRole("textbox", { name: copy.community.newPost.bodyLabel, exact: true }).fill(draftCanary);
    await page.getByRole("button", { name: copy.community.actions.publish, exact: true }).click();
    await expect.poll(() => tool.communityPosts.length).toBe(1);
    expect(state.consentPosts).toEqual([]);
    expect(state.profileWrites).toEqual([]);
    expect(state.role).toBe("家长");
  });

  test(`${prefix || "zh"} 支持请求就地确认后只读取服务，不自动提出申请`, async ({ page, baseURL }) => {
    const { state, tool } = await syntheticInlineTools(page, baseURL!);
    await page.goto(`${prefix}/support-request`);
    await expect(panel(page)).toBeVisible();
    expect(tool.supportReads).toBe(0);
    expect(tool.supportPosts).toEqual([]);
    await confirm(page, copy);
    await expect(page.getByRole("textbox", { name: copy.supportFlow.portal.need, exact: true })).toBeVisible();
    await expect.poll(() => tool.supportReads).toBeGreaterThan(0);
    expect(tool.supportPosts).toEqual([]);
    expect(state.consentPosts).toHaveLength(1);
    expect(state.aiCalls).toEqual([]);
    await expect(page).toHaveURL(new RegExp(`${prefix}/support-request$`));
  });
}
