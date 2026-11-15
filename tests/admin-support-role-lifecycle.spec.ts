import { expect, test, type Page, type Route } from "@playwright/test";
import path from "node:path";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { syntheticAdminLifecycle } from "./fixtures/synthetic-admin-lifecycle";

function actorName(route: Route) {
  return route.request().headers().authorization.includes("admin-b") ? "admin-b" : "admin-a";
}

function staffResponse(actor: string, unknown = false) {
  return { applications: [{ user_id: `${actor}-staff`, category: unknown ? "private_unknown_category" : "counselor",
    status: unknown ? "private_unknown_staff_status" : "approved", legal_name: `${actor} legal name`,
    evidence_path: "uploaded", age_scopes: ["14_17", "18_plus"], review_note: null, training_count: 1 }] };
}

function casesResponse(actor: string, unknown = false) {
  return { cases: [{ id: `${actor}-case`, case_type: "youth_request", status: unknown ? "private_unknown_case_status" : "active",
    risk_priority: unknown ? "private_unknown_priority" : "urgent", need_summary: `${actor} PRIVATE_SUPPORT_SUMMARY`,
    appointment_at: null, student_authorization_active: true, created_at: "2026-10-28T01:00:00Z",
    assignments: [{ id: `${actor}-assignment`, staff_user_id: `${actor}-staff`, assignment_role: unknown ? "private_unknown_role" : "primary",
      status: unknown ? "private_unknown_assignment_status" : "offered" }] }] };
}

function feedbackResponse(actor: string) {
  return { count: 1, pendingComplaints: 0, sampleLimited: true,
    ratios: { feltHeard: null, foundHelp: null, boundariesRespected: null, wouldChooseAgain: null },
    feedback: [{ caseId: `${actor}-case`, complaint: false, safetyReview: false, comment: `${actor} PRIVATE_FEEDBACK`,
      reviewStatus: "reviewed", createdAt: "2026-10-28T01:00:00Z" }] };
}

function peerResponse(actor: string, unknown = false) {
  return { cases: [{ id: `${actor}-peer-case`, roomId: "synthetic-room", category: unknown ? "private_unknown_category" : "crisis",
    priority: unknown ? "private_unknown_priority" : "urgent", status: unknown ? "private_unknown_review_status" : "pending",
    createdAt: "2026-10-28T01:00:00Z", followUpRequired: false, escalated: false,
    message: `${actor} PRIVATE_PEER_MESSAGE`, messageStatus: unknown ? "private_unknown_message_status" : "safety_review" }] };
}

async function setup(page: Page, baseURL: string, unknown = false) {
  const fixture = await syntheticAdminLifecycle(page, baseURL);
  fixture.interceptors.set("GET /api/admin/support/staff", (route) =>
    route.fulfill({ json: staffResponse(actorName(route), unknown) }));
  fixture.interceptors.set("GET /api/admin/support/cases", (route) =>
    route.fulfill({ json: casesResponse(actorName(route), unknown) }));
  fixture.interceptors.set("GET /api/admin/support/feedback", (route) =>
    route.fulfill({ json: feedbackResponse(actorName(route)) }));
  fixture.interceptors.set("GET /api/admin/peer-space/review", (route) =>
    route.fulfill({ json: peerResponse(actorName(route), unknown) }));
  return fixture;
}

async function settlePage(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} 管理支持页换号清除实名、小结和草稿，退出后仅保留原任务登录入口`, async ({ page, baseURL }, testInfo) => {
    const fixture = await setup(page, baseURL!);
    await page.goto(`${prefix}/admin/support`);
    await expect(page.locator("main")).toContainText("admin-a PRIVATE_SUPPORT_SUMMARY");
    await page.getByRole("textbox", { name: copy.adminSupport.reviewNote, exact: true }).fill("PRIVATE_OLD_DRAFT");
    await expect(page.locator("main")).toContainText(copy.supportFlow.portal.primary);
    await expect(page.locator("main")).not.toContainText(" · offered");
    await fixture.switchActor("admin-b");
    await expect(page.locator("main")).toContainText("admin-b PRIVATE_SUPPORT_SUMMARY");
    await expect(page.locator("main")).not.toContainText("admin-a");
    await expect(page.getByRole("textbox", { name: copy.adminSupport.reviewNote, exact: true })).toHaveValue("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settlePage(page);
    await page.screenshot({ path: path.join(process.cwd(), "deliverables/resume-2026-10-28",
      `admin-support-${prefix ? "en" : "zh-CN"}-${testInfo.project.name}.png`), fullPage: true });
    await fixture.switchActor(null);
    await expect(page.locator("main input, main textarea, main select")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("PRIVATE_SUPPORT_SUMMARY");
    const login = page.locator('main a[href*="next="]');
    await expect(login).toBeVisible();
    expect(new URL(await login.getAttribute("href") || "", baseURL!).searchParams.get("next")).toBe("/admin/support");
    expect(fixture.requests.filter((request) => request.method !== "GET")).toEqual([]);
    expect(fixture.blocked).toEqual([]);
  });

  test(`${prefix || "zh"} 支持审核失败撤下所有私密内容与草稿，重试只重读不自动操作`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    fixture.interceptors.set("POST /api/admin/support/staff", (route) =>
      route.fulfill({ status: 403, json: { error: "PRIVATE_PROVIDER_ERROR" } }));
    await page.goto(`${prefix}/admin/support`);
    await expect(page.locator("main")).toContainText("admin-a PRIVATE_SUPPORT_SUMMARY");
    await page.getByRole("textbox", { name: copy.adminSupport.reviewNote, exact: true }).fill("PRIVATE_DENIED_DRAFT");
    await page.getByRole("button", { name: copy.adminSupport.review, exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("PRIVATE_SUPPORT_SUMMARY");
    await expect(page.locator("main")).not.toContainText("PRIVATE_PROVIDER_ERROR");
    await expect(page.locator("main input, main textarea, main select")).toHaveCount(0);
    await page.locator("main").getByRole("button").click();
    await expect(page.getByRole("textbox", { name: copy.adminSupport.reviewNote, exact: true })).toHaveValue("");
    expect(fixture.requests.filter((request) => request.method !== "GET")).toHaveLength(1);
    expect(fixture.blocked).toEqual([]);
  });

  test(`${prefix || "zh"} 支持页迟到的旧账号读取不能覆盖新账号`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fixture.interceptors.set("GET /api/admin/support/cases", async (route) => {
      const actor = actorName(route);
      if (actor === "admin-a") await gate;
      await route.fulfill({ json: casesResponse(actor) });
    });
    await page.goto(`${prefix}/admin/support`);
    await expect.poll(() => fixture.requests.some((request) => request.path === "/api/admin/support/cases")).toBe(true);
    await fixture.switchActor("admin-b");
    await expect(page.locator("main")).toContainText("admin-b PRIVATE_SUPPORT_SUMMARY");
    const late = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/support/cases"
      && response.request().headers().authorization.includes("admin-a"));
    release();
    await (await late).finished();
    await settlePage(page);
    await expect(page.locator("main")).not.toContainText("admin-a");
    expect(fixture.blocked).toEqual([]);
  });

  test(`${prefix || "zh"} 支持旧表单不能借用新账号令牌提交`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    await page.goto(`${prefix}/admin/support`);
    await expect(page.locator("main")).toContainText("admin-a PRIVATE_SUPPORT_SUMMARY");
    await fixture.switchActor("admin-b", false);
    await page.getByRole("button", { name: copy.adminSupport.review, exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("PRIVATE_SUPPORT_SUMMARY");
    expect(fixture.requests.filter((request) => request.method !== "GET")).toEqual([]);
    expect(fixture.blocked).toEqual([]);
  });

  test(`${prefix || "zh"} 审核页换号清理消息、备注与勾选，退出后返回原任务登录`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    await page.goto(`${prefix}/admin/peer-space`);
    await expect(page.locator("main")).toContainText("admin-a PRIVATE_PEER_MESSAGE");
    await page.getByRole("textbox", { name: copy.peerSpaceReview.note, exact: true }).fill("PRIVATE_PEER_DRAFT");
    await page.getByLabel(copy.peerSpaceReview.followUp, { exact: true }).check();
    await page.getByLabel(copy.peerSpaceReview.escalated, { exact: true }).check();
    await expect(page.locator("main")).not.toContainText(" · pending");
    await expect(page.locator("main")).not.toContainText(": safety_review");
    await fixture.switchActor("admin-b");
    await expect(page.locator("main")).toContainText("admin-b PRIVATE_PEER_MESSAGE");
    await expect(page.locator("main")).not.toContainText("admin-a");
    await expect(page.getByRole("textbox", { name: copy.peerSpaceReview.note, exact: true })).toHaveValue("");
    await expect(page.getByLabel(copy.peerSpaceReview.followUp, { exact: true })).not.toBeChecked();
    await expect(page.getByLabel(copy.peerSpaceReview.escalated, { exact: true })).not.toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await fixture.switchActor(null);
    await expect(page.locator("main textarea, main select, main input")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("PRIVATE_PEER_MESSAGE");
    const login = page.locator('main a[href*="next="]');
    await expect(login).toBeVisible();
    expect(new URL(await login.getAttribute("href") || "", baseURL!).searchParams.get("next")).toBe("/admin/peer-space");
    expect(fixture.requests.filter((request) => request.method !== "GET")).toEqual([]);
    expect(fixture.blocked).toEqual([]);
  });

  test(`${prefix || "zh"} 审核失败撤下消息并清理草稿，重试不自动公开或提交`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    fixture.interceptors.set("POST /api/admin/peer-space/review", (route) =>
      route.fulfill({ status: 403, json: { error: "PRIVATE_PROVIDER_ERROR" } }));
    await page.goto(`${prefix}/admin/peer-space`);
    await expect(page.locator("main")).toContainText("admin-a PRIVATE_PEER_MESSAGE");
    await page.getByRole("textbox", { name: copy.peerSpaceReview.note, exact: true }).fill("PRIVATE_DENIED_DRAFT");
    await page.getByRole("combobox", { name: copy.peerSpaceReview.messageAction, exact: true }).selectOption("publish");
    await page.getByRole("button", { name: copy.peerSpaceReview.save, exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("PRIVATE_PEER_MESSAGE");
    await expect(page.locator("main")).not.toContainText("PRIVATE_PROVIDER_ERROR");
    await expect(page.locator("main textarea, main select")).toHaveCount(0);
    await page.locator("main").getByRole("button").click();
    await expect(page.getByRole("textbox", { name: copy.peerSpaceReview.note, exact: true })).toHaveValue("");
    await expect(page.getByRole("combobox", { name: copy.peerSpaceReview.messageAction, exact: true })).toHaveValue("none");
    expect(fixture.requests.filter((request) => request.method !== "GET")).toHaveLength(1);
    expect(fixture.blocked).toEqual([]);
  });

  test(`${prefix || "zh"} 审核页旧账号迟到消息不能覆盖新账号`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fixture.interceptors.set("GET /api/admin/peer-space/review", async (route) => {
      const actor = actorName(route);
      if (actor === "admin-a") await gate;
      await route.fulfill({ json: peerResponse(actor) });
    });
    await page.goto(`${prefix}/admin/peer-space`);
    await expect.poll(() => fixture.requests.some((request) => request.path === "/api/admin/peer-space/review")).toBe(true);
    await fixture.switchActor("admin-b");
    await expect(page.locator("main")).toContainText("admin-b PRIVATE_PEER_MESSAGE");
    const late = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/peer-space/review"
      && response.request().headers().authorization.includes("admin-a"));
    release();
    await (await late).finished();
    await settlePage(page);
    await expect(page.locator("main")).not.toContainText("admin-a");
    expect(fixture.blocked).toEqual([]);
  });

  test(`${prefix || "zh"} 审核旧表单不能借用新账号令牌提交`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    await page.goto(`${prefix}/admin/peer-space`);
    await expect(page.locator("main")).toContainText("admin-a PRIVATE_PEER_MESSAGE");
    await fixture.switchActor("admin-b", false);
    await page.getByRole("button", { name: copy.peerSpaceReview.save, exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("PRIVATE_PEER_MESSAGE");
    expect(fixture.requests.filter((request) => request.method !== "GET")).toEqual([]);
    expect(fixture.blocked).toEqual([]);
  });

  test(`${prefix || "zh"} 两张管理页对未知状态使用通用用户标签`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!, true);
    await page.goto(`${prefix}/admin/support`);
    await expect(page.locator("main")).toContainText("PRIVATE_SUPPORT_SUMMARY");
    await expect(page.locator("main")).not.toContainText("private_unknown_");
    await page.goto(`${prefix}/admin/peer-space`);
    await expect(page.locator("main")).toContainText("PRIVATE_PEER_MESSAGE");
    await expect(page.locator("main")).not.toContainText("private_unknown_");
    expect(fixture.requests.filter((request) => request.method !== "GET")).toEqual([]);
    expect(fixture.blocked).toEqual([]);
  });

  test(`${prefix || "zh"} 两张管理页延迟保存期间锁定队列切换和全部编辑控件`, async ({ page, baseURL }) => {
    const fixture = await setup(page, baseURL!);
    for (const config of [
      { path: "/admin/support", endpoint: "/api/admin/support/staff", note: copy.adminSupport.reviewNote,
        save: copy.adminSupport.review, privateText: "PRIVATE_SUPPORT_SUMMARY", saved: copy.adminSupport.saved },
      { path: "/admin/peer-space", endpoint: "/api/admin/peer-space/review", note: copy.peerSpaceReview.note,
        save: copy.peerSpaceReview.save, privateText: "PRIVATE_PEER_MESSAGE", saved: copy.peerSpaceReview.saved },
    ]) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      fixture.interceptors.set(`POST ${config.endpoint}`, async (route) => {
        await gate;
        await route.fulfill({ json: { saved: true } });
      });
      await page.goto(`${prefix}${config.path}`);
      await expect(page.locator("main")).toContainText(config.privateText);
      const note = page.getByRole("textbox", { name: config.note, exact: true });
      await note.fill("SYNTHETIC_PENDING_NOTE");
      const before = fixture.requests.filter((request) => request.method === "POST").length;
      await page.getByRole("button", { name: config.save, exact: true }).click();
      await expect.poll(() => fixture.requests.filter((request) => request.method === "POST").length).toBe(before + 1);
      for (const control of await page.locator("main button, main input, main select, main textarea").all()) {
        await expect(control).toBeDisabled();
      }
      await expect(note).toHaveValue("SYNTHETIC_PENDING_NOTE");
      release();
      await expect(page.locator("main").getByRole("status")).toContainText(config.saved);
      await expect(note).toBeEnabled();
      await expect(note).toHaveValue("");
      expect(fixture.requests.filter((request) => request.method === "POST")).toHaveLength(before + 1);
    }
    expect(fixture.blocked).toEqual([]);
  });
}
