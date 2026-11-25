import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type Session } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";
import fixture from "./fixtures/permission-boundary.json";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

test("Account 为历史 SWEET 记录提供稳定的渲染 key fallback", async () => {
  const source = await readFile(path.join(process.cwd(), "views/account/page.tsx"), "utf8");

  expect(source).toContain('step.id || `${record.id}-step-${stepIndex}`');
  expect(source).toContain('field.id || `${stepKey}-field-${fieldIndex}`');
});

const accountRoles = ["学生", "家长", "支持老师", "学校负责人", "平台管理员", "专业支持者"] as const;
type AccountRole = typeof accountRoles[number];
const accountOwner = "00000000-0000-4000-8000-000000000068";
const otherStudent = "00000000-0000-4000-8000-000000000069";
const ownerFilter = `eq.${accountOwner}`;
const recordsFixture = [
  { id: "00000000-0000-4000-8000-000000000071", user_id: accountOwner, created_at: "2026-01-03T03:00:00Z", summary: "Own record to delete", records: [] },
  { id: "00000000-0000-4000-8000-000000000072", user_id: accountOwner, created_at: "2026-01-02T03:00:00Z", summary: "Own record to keep", records: [] },
  { id: "00000000-0000-4000-8000-000000000073", user_id: otherStudent, created_at: "2026-01-01T03:00:00Z", summary: "Other student's private record", records: [] },
];

async function mockAccountHistory(page: Page, baseURL: string, role: AccountRole, deleteTargetOwner = accountOwner) {
  const appOrigin = new URL(baseURL).origin;
  const dataOrigin = new URL(supabaseUrl || "https://saqkzfsmabsgbwdvuras.supabase.co").origin;
  const projectRef = new URL(dataOrigin).hostname.split(".")[0];
  const user = { id: accountOwner, email: "history-owner@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const guardian = role === "家长";
  const schoolStaff = role === "支持老师" || role === "学校负责人";
  const profile = { id: user.id, display_name: "History owner", role: schoolStaff ? "学校支持人员" : role };
  const relatedStudent = { id: otherStudent, display_name: "Related student" };
  const deleteFilters: (string | null)[] = [];
  let rows = recordsFixture;
  await page.addInitScript(({ projectRef, user }) => {
    localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify({
      access_token: "synthetic-history-token", refresh_token: "synthetic-history-refresh",
      token_type: "bearer", expires_at: Math.floor(Date.now() / 1_000) + 3_600, user,
    }));
  }, { projectRef, user });
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const cors = { "access-control-allow-origin": appOrigin };
    const reply = (json: unknown) => route.fulfill({ headers: cors, json });
    if (url.origin === dataOrigin && /^\/(?:auth|rest)\/v1\//.test(url.pathname)) {
      if (method === "OPTIONS") {
        return route.fulfill({ status: 204, headers: {
          ...cors, "access-control-allow-methods": "GET, DELETE, OPTIONS",
          "access-control-allow-headers": request.headers()["access-control-request-headers"] || "*",
        } });
      }
      if (method === "GET" && url.pathname === "/auth/v1/user") return reply(user);
      if (method === "GET" && url.pathname === "/rest/v1/wechat_identities") return reply([]);
      if (method === "GET" && url.pathname === "/rest/v1/profiles") return reply(profile);
      if (url.pathname === "/rest/v1/sweet_records") {
        if (method === "GET" && url.searchParams.has("id")) {
          return reply([{ ...recordsFixture[0], user_id: deleteTargetOwner }]);
        }
        // Deliberately include another student's row even on a scoped read.
        if (method === "GET") return reply(rows);
        if (method === "DELETE") {
          const filter = url.searchParams.get("user_id");
          deleteFilters.push(filter);
          if (filter === ownerFilter) rows = rows.filter(({ id }) => id !== recordsFixture[0].id);
          return route.fulfill({ status: 204, headers: cors });
        }
      }
      return route.abort();
    }
    if (url.origin !== appOrigin || method !== "GET") return route.abort();
    if (url.pathname === "/api/account/status") return reply({
      profile, displayRole: role, hasSchool: guardian || schoolStaff,
      linkedChildren: guardian ? [relatedStudent] : [], assignedStudents: schoolStaff ? [relatedStudent] : [],
    });
    if (url.pathname === "/api/account/consent") return reply({ role: guardian ? "guardian" : "student", consent: null, children: [] });
    return url.pathname.startsWith("/api/") ? route.abort() : route.continue();
  });
  return deleteFilters;
}

function nextHistoryRead(page: Page) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === "/rest/v1/sweet_records" && !url.searchParams.has("id");
  });
}

test.describe("Account 本人 SWEET 历史", () => {
  test.use({ serviceWorkers: "block" });

  for (const role of accountRoles) {
    test(`${role} 的首次读取和可用的删除后刷新仅查询本人`, async ({ page, baseURL }) => {
      const deleteFilters = await mockAccountHistory(page, baseURL!, role);
      const initialRead = nextHistoryRead(page);
      await page.goto("/en/account");
      expect.soft(new URL((await initialRead).url()).searchParams.get("user_id"), "首次历史请求").toBe(ownerFilter);
      const history = page.locator("#records");
      const deleteButtons = history.getByRole("button", { name: en.account.records.delete, exact: true });
      if (role === "家长") {
        await expect(history.getByText(en.account.records.empty.guardian, { exact: true })).toBeVisible();
        await expect(history.getByRole("article")).toHaveCount(0);
        await expect(deleteButtons).toHaveCount(0);
        expect(deleteFilters).toEqual([]);
        return;
      }
      const ownCard = history.getByRole("article").filter({ hasText: recordsFixture[0].summary });
      const foreignSummary = page.getByText(recordsFixture[2].summary, { exact: true });
      await expect(ownCard).toBeVisible();
      await expect.soft(foreignSummary).toHaveCount(0, { timeout: 1_500 });
      await expect.soft(deleteButtons).toHaveCount(2, { timeout: 1_500 });
      const refreshed = nextHistoryRead(page);
      await ownCard.getByRole("button", { name: en.account.records.delete, exact: true }).click();
      expect.soft(new URL((await refreshed).url()).searchParams.get("user_id"), "删除后历史请求").toBe(ownerFilter);
      await expect(page.getByText(en.account.notices.recordDeleted, { exact: true })).toBeVisible();
      await expect(ownCard).toHaveCount(0);
      await expect(history.getByText(recordsFixture[1].summary, { exact: true })).toBeVisible();
      await expect(foreignSummary).toHaveCount(0, { timeout: 1_500 });
      expect(deleteFilters).toEqual([ownerFilter]);
    });
  }

  test("平台管理员删除前重新核对目标记录归属", async ({ page, baseURL }) => {
    const deleteFilters = await mockAccountHistory(page, baseURL!, "平台管理员", otherStudent);
    await page.goto("/en/account");
    const ownCard = page.locator("#records").getByRole("article").filter({ hasText: recordsFixture[0].summary });
    await ownCard.getByRole("button", { name: en.account.records.delete, exact: true }).click();
    await expect(page.getByText(en.account.errors.recordDeleteFailed, { exact: true })).toBeVisible();
    await expect(ownCard).toBeVisible();
    expect(deleteFilters).toEqual([]);
  });
});

test("Account 英文数量文案区分单复数且中文显示保持不变", () => {
  expect(en.account.summary.recordCountOne).toBe("{{count}} record");
  expect(en.account.summary.recordCount).toBe("{{count}} records");
  expect(en.account.summary.daysRecordedOne).toBe("Records on {{count}} day");
  expect(en.account.summary.daysRecorded).toBe("Records on {{count}} days");
  expect(zhCN.account.summary.recordCountOne).toBe(zhCN.account.summary.recordCount);
  expect(zhCN.account.summary.daysRecordedOne).toBe(zhCN.account.summary.daysRecorded);
});

test("Account 英文隐私链接保留可访问文本间距", async () => {
  const source = await readFile(path.join(process.cwd(), "views/account/page.tsx"), "utf8");
  expect(source.match(/locale === "en" \? " " : null/g)).toHaveLength(2);
});

test("SWEET 卡片保留固定术语并避免英文辅助文本重复", () => {
  for (const item of Object.values(en.common.hero.rhythm).filter(
    (value): value is { title: string; label: string } => typeof value === "object",
  )) {
    expect(item.label).not.toBe(item.title);
  }

  expect(en.common.hero.rhythm.sleep.title).toBe("Sleep");
  expect(en.common.hero.rhythm.wake.title).toBe("Wake");
  expect(en.common.hero.rhythm.eat.title).toBe("Eat");
  expect(en.common.hero.rhythm.exercise.title).toBe("Exercise");
  expect(en.common.hero.rhythm.task.title).toBe("Task engagement");
  expect(zhCN.common.hero.rhythm.sleep).toEqual({ title: "睡眠", label: "Sleep" });
});

test("Account 加载缺少 step/field id 的历史记录时不再产生 key warning", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "登录态控制台回归无需重复视口执行");
  test.skip(!supabaseUrl || !supabaseAnonKey || !password, "需要隔离测试账号配置");
  test.setTimeout(60_000);

  const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: fixture.users.studentOne.email,
    password: password!,
  });
  expect(error).toBeNull();
  expect(data.session).not.toBeNull();

  const projectRef = new URL(supabaseUrl!).hostname.split(".")[0];
  await page.addInitScript(
    ({ key, value }: { key: string; value: Session }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: `sb-${projectRef}-auth-token`, value: data.session! },
  );

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/en/account", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("1 record", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main")).toContainText("under Privacy & Safety");
  expect(consoleErrors).not.toEqual(expect.arrayContaining([
    expect.stringContaining('unique "key" prop'),
  ]));
});
