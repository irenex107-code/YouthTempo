import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import type { ReportAccess, ReportAuthorizationView } from "../lib/reports/accessTypes";
// Historical v1 model; the current contracts are covered by reports-sharing-* tests.
test.skip(true, "Superseded voluntary period-report model; retained as historical evidence.");


test.skip(process.env.E2E_REPORTS_LOCAL_INTEGRATION !== "true", "Requires an explicitly enabled local-only reports server.");
const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const studentId = id(1); const teacherId = id(11); const grantId = id(201); const createdId = id(203);
function text(locale: string, key: string) {
  return key.split(".").reduce((value: unknown, segment) => (value as Record<string, unknown>)?.[segment], locale === "en" ? en : zh) as string;
}

async function syntheticReports(page: Page, options: { owned?: boolean; received?: boolean; eligibility?: ReportAccess["eligibility"]; failCreates?: number; failRevokes?: number; expiresInMs?: number } = {}) {
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3214").origin;
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:55321").hostname.split(".")[0];
  const storageKey = `sb-${ref}-auth-token`;
  const now = Date.now();
  const grant: ReportAuthorizationView = { id: grantId, recipientType: "teacher", displayName: "Synthetic Teacher", dimensions: ["sleep"],
    effectiveAt: new Date(now - 15 * 86_400_000).toISOString(), expiresAt: new Date(now + (options.expiresInMs ?? 5 * 86_400_000)).toISOString(), status: "active" };
  const report = { summary: { version: "sweet-period-report-v1", status: "ready", period: {
    start: new Date(now - 8 * 86_400_000).toISOString(), end: new Date(now - 86_400_000).toISOString(),
  }, dimensions: [{ id: "sleep", state: "category", category: "sleep_good", comparison: "unavailable" }] } };
  const state = {
    access: { version: "reports-access-v1", eligibility: options.eligibility || "eligible", candidates: [{ id: teacherId, type: "teacher", displayName: "Synthetic Teacher" }],
      owned: options.owned ? [grant] : [], received: options.received ? [{ ...grant, displayName: "Synthetic Student" }] : [] } as ReportAccess,
    userId: options.received ? teacherId : studentId,
    failedCreates: options.failCreates || 0, failedRevokes: options.failRevokes || 0,
    createBodies: [] as Record<string, unknown>[], revokeIds: [] as string[], accessReads: 0, currentReads: 0,
    holdCurrent: false, holdRevoke: false, denyCurrent: false,
    pendingCurrent: [] as Array<() => Promise<void>>, pendingRevoke: [] as Array<() => Promise<void>>,
    unexpected: [] as string[], external: [] as string[], pageErrors: [] as string[], reportAuthHeaders: [] as string[],
  };
  if (state.access.eligibility !== "eligible") state.access.candidates = [];
  const user = (userId: string) => ({ id: userId, aud: "authenticated", role: "authenticated", email: "reports-synthetic@example.invalid", app_metadata: {}, user_metadata: { display_name: "Synthetic reports" }, created_at: "2026-01-01T00:00:00Z" });
  const session = (userId: string) => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const accessToken = [ { alg: "HS256", typ: "JWT" }, { sub: userId, exp: expiresAt, role: "authenticated" } ].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".synthetic-signature";
    return { access_token: accessToken, refresh_token: "synthetic-reports-refresh", token_type: "bearer", expires_in: 3600, expires_at: expiresAt, user: user(userId) };
  };
  await page.addInitScript(({ storageKey, initial }) => { localStorage.setItem(storageKey, JSON.stringify(initial)); }, { storageKey, initial: session(state.userId) });
  page.on("pageerror", (error) => state.pageErrors.push(error.message));
  async function fulfillSafely(route: Route, data: unknown, status = 200) {
    try { await route.fulfill({ status, json: data, headers: { "Cache-Control": "private, no-store" } }); } catch { /* An intentionally aborted stale request cannot be delivered. */ }
  }
  await page.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url()); const pathname = url.pathname;
    if (pathname.startsWith("/auth/v1/")) {
      if (pathname.endsWith("/user")) return fulfillSafely(route, user(state.userId));
      if (pathname.endsWith("/logout")) return fulfillSafely(route, {});
      state.unexpected.push(`auth ${pathname}`); return route.abort();
    }
    if (pathname.startsWith("/rest/v1/")) return fulfillSafely(route, []);
    if (pathname.startsWith("/storage/v1/")) return route.abort();
    if (pathname.startsWith("/api/")) {
      if (pathname.startsWith("/api/reports/")) state.reportAuthHeaders.push(request.headers().authorization || "");
      if (pathname === "/api/reports/access") { state.accessReads += 1; return fulfillSafely(route, state.access); }
      if (pathname === "/api/reports/current") {
        state.currentReads += 1;
        if (state.holdCurrent) return new Promise<void>((resolve) => { state.pendingCurrent.push(async () => { await fulfillSafely(route, report); resolve(); }); });
        return fulfillSafely(route, state.denyCurrent ? { error: "Unavailable" } : report, state.denyCurrent ? 403 : 200);
      }
      if (pathname === "/api/reports/authorizations" && request.method() === "POST") {
        state.createBodies.push(request.postDataJSON() as Record<string, unknown>);
        state.access.owned = [{ ...grant, id: createdId }];
        if (state.failedCreates > 0) { state.failedCreates -= 1; return route.abort("failed"); }
        return fulfillSafely(route, { authorizationId: createdId }, 201);
      }
      if (pathname.startsWith("/api/reports/authorizations/") && request.method() === "DELETE") {
        state.revokeIds.push(pathname.split("/").pop() || "");
        const finish = async () => {
          if (state.failedRevokes > 0) { state.failedRevokes -= 1; await route.abort("failed").catch(() => {}); return; }
          state.access.owned = state.access.owned.map((row) => ({ ...row, status: "revoked" as const }));
          await fulfillSafely(route, { revoked: true });
        };
        if (state.holdRevoke) return new Promise<void>((resolve) => { state.pendingRevoke.push(async () => { await finish(); resolve(); }); });
        return finish();
      }
      if (pathname === "/api/account/status") return fulfillSafely(route, { displayRole: options.received ? "学校支持人员" : "学生", profile: { id: state.userId, display_name: "Synthetic reports", role: options.received ? "学校支持人员" : "学生" }, hasSchool: true,
        studentAgeBand: "14_17", linkedChildren: [], linkedGuardians: [], assignedTeachers: [], assignedStudents: [] });
      if (pathname === "/api/account/consent") return fulfillSafely(route, { role: "student", policyVersion: "2026-08-28", children: [], consent: null });
      if (pathname === "/api/monitoring/client-error") return fulfillSafely(route, {}, 200);
      if (pathname === "/api/pilot-experience") return fulfillSafely(route, { eligible: false });
      state.unexpected.push(`${request.method()} ${pathname}`); return fulfillSafely(route, { error: "No synthetic response" }, 404);
    }
    if (url.origin !== origin) { state.external.push(url.origin); return route.abort(); }
    return route.continue();
  });
  async function changeSession(next: string | null) {
    if (next) state.userId = next;
    state.access = { version: "reports-access-v1", eligibility: "not_available", candidates: [], owned: [], received: [] };
    await page.evaluate(({ storageKey, nextSession }) => {
      const oldValue = localStorage.getItem(storageKey);
      const newValue = nextSession ? JSON.stringify(nextSession) : null;
      if (newValue) localStorage.setItem(storageKey, newValue); else localStorage.removeItem(storageKey);
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey, oldValue, newValue, storageArea: localStorage }));
      // The installed Supabase auth client synchronizes tabs through this
      // channel; a StorageEvent alone does not notify onAuthStateChange.
      const channel = new BroadcastChannel(storageKey);
      channel.postMessage({ event: nextSession ? "SIGNED_IN" : "SIGNED_OUT", session: nextSession });
      channel.close();
    }, { storageKey, nextSession: next ? session(next) : null });
  }
  return { state, grant, changeSession };
}

async function assertNoUnexpected(page: Page, state: Awaited<ReturnType<typeof syntheticReports>>["state"]) {
  expect(state.external).toEqual([]); expect(state.unexpected).toEqual([]); expect(state.pageErrors).toEqual([]);
  expect(state.reportAuthHeaders.every((value) => value.startsWith("Bearer ") && !value.includes("service_role"))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((key) => /report/i.test(key)))).toEqual([]);
}

for (const [prefix, locale] of [["", "zh-CN"], ["/en", "en"]] as const) {
  test(`${locale} 明确选择和确认后启用；不确定结果重试相同requestId，并按获准维度展示`, async ({ page }, testInfo) => {
    const fixture = await syntheticReports(page, { failCreates: 1 });
    await page.goto(`${prefix}/reports`);
    await expect(page.getByRole("heading", { level: 1, name: text(locale, "reports.title") })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const submit = page.getByRole("button", { name: text(locale, "reports.create.submit"), exact: true });
    await expect(submit).toBeDisabled();
    await page.locator("#report-teacher").selectOption(teacherId);
    await page.getByRole("checkbox", { name: text(locale, "reportsPreview.dimensions.sleep"), exact: true }).check();
    await expect(submit).toBeDisabled();
    await page.getByRole("checkbox", { name: text(locale, "reports.create.confirm"), exact: true }).check();
    await submit.click();
    await expect(page.getByText(text(locale, "reports.create.uncertain"), { exact: true })).toBeVisible();
    await expect(page.locator("[data-report-summary]")).toHaveCount(0);
    await page.getByRole("button", { name: text(locale, "reports.create.retry"), exact: true }).click();
    await expect(page.locator(`[data-report-authorization="${createdId}"]`)).toBeVisible();
    expect(fixture.state.createBodies).toHaveLength(2);
    expect(fixture.state.createBodies[1]).toEqual(fixture.state.createBodies[0]);
    expect(fixture.state.createBodies[0]).toMatchObject({ recipientId: teacherId, recipientType: "teacher", dimensions: ["sleep"], confirmed: true });
    expect(fixture.state.createBodies[0].requestId).toMatch(/^[a-f0-9-]{36}$/i);
    await page.locator(`[data-report-select="${createdId}"]`).click();
    await expect(page.locator('[data-report-summary="ready"]')).toBeVisible();
    await expect(page.locator("[data-report-dimension]")).toHaveCount(1);
    await expect(page.locator('[data-report-dimension="sleep"]')).toBeVisible();
    await expect(page.getByText(text(locale, "reports.guardianClosed"), { exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("sleep_good");
    if (process.env.YOUTHTEMPO_CAPTURE_REPORTS_INTEGRATION === "true") {
      const output = path.join(process.cwd(), "deliverables/reports-integration-2026-10-28"); await mkdir(output, { recursive: true });
      await page.screenshot({ path: path.join(output, `${locale}-${testInfo.project.name}.png`), fullPage: true });
    }
    await assertNoUnexpected(page, fixture.state);
  });

  test(`${locale} 撤回立即隐藏；请求未确认不能宣称成功，重试后才显示停止`, async ({ page }) => {
    const fixture = await syntheticReports(page, { owned: true, failRevokes: 1 });
    await page.goto(`${prefix}/reports`);
    await page.locator(`[data-report-select="${grantId}"]`).click();
    await expect(page.locator('[data-report-summary="ready"]')).toBeVisible();
    fixture.state.holdRevoke = true;
    await page.locator(`[data-report-revoke="${grantId}"]`).click();
    await expect(page.locator("[data-report-summary]")).toHaveCount(0);
    await expect(page.getByText(text(locale, "reports.notices.revoked"), { exact: true })).toHaveCount(0);
    await expect.poll(() => fixture.state.pendingRevoke.length).toBe(1);
    fixture.state.holdRevoke = false; await fixture.state.pendingRevoke.shift()!();
    await expect(page.getByText(text(locale, "reports.revoke.uncertain"), { exact: true })).toBeVisible();
    await expect(page.getByText(text(locale, "reports.notices.revoked"), { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: text(locale, "reports.revoke.retry"), exact: true }).click();
    await expect(page.getByText(text(locale, "reports.notices.revoked"), { exact: true })).toBeVisible();
    expect(fixture.state.revokeIds).toEqual([grantId, grantId]);
    await expect(page.locator("[data-report-summary]")).toHaveCount(0);
    await assertNoUnexpected(page, fixture.state);
  });

  test(`${locale} 缺新学校确认和成人不适用状态不出现启用入口`, async ({ page }) => {
    const fixture = await syntheticReports(page, { eligibility: "school_consent_required" });
    await page.goto(`${prefix}/reports`);
    await expect(page.getByText(text(locale, "reports.eligibility.school_consent_required"), { exact: true })).toBeVisible();
    await expect(page.locator("#report-teacher")).toHaveCount(0);
    fixture.state.access.eligibility = "not_available";
    await page.getByRole("button", { name: text(locale, "reports.refresh"), exact: true }).click();
    await expect(page.getByText(text(locale, "reports.eligibility.not_available"), { exact: true })).toBeVisible();
    await expect(page.locator("#report-teacher")).toHaveCount(0);
    expect(fixture.state.createBodies).toEqual([]);
    await assertNoUnexpected(page, fixture.state);
  });
}

test("撤回中迟到的旧读取响应不能恢复已隐藏报告", async ({ page }) => {
  const fixture = await syntheticReports(page, { owned: true });
  fixture.state.holdCurrent = true;
  await page.goto("/reports");
  await page.locator(`[data-report-select="${grantId}"]`).click();
  await expect.poll(() => fixture.state.pendingCurrent.length).toBe(1);
  await page.locator(`[data-report-revoke="${grantId}"]`).click();
  await expect(page.getByText(text("zh-CN", "reports.notices.revoked"), { exact: true })).toBeVisible();
  fixture.state.holdCurrent = false; await fixture.state.pendingCurrent.shift()!();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.locator("[data-report-summary]")).toHaveCount(0);
  await assertNoUnexpected(page, fixture.state);
});

test("切换账号与退出清空身份和报告，旧会话响应不能返回", async ({ page }) => {
  const fixture = await syntheticReports(page, { owned: true });
  await page.goto("/reports"); await page.locator(`[data-report-select="${grantId}"]`).click();
  await expect(page.locator('[data-report-summary="ready"]')).toBeVisible();
  fixture.state.holdCurrent = true;
  await page.locator(`[data-report-select="${grantId}"]`).click();
  await expect.poll(() => fixture.state.pendingCurrent.length).toBe(1);
  await fixture.changeSession(id(99));
  await expect(page.locator("[data-report-summary], [data-report-authorization]")).toHaveCount(0);
  fixture.state.holdCurrent = false; await fixture.state.pendingCurrent.shift()!();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.locator("[data-report-summary], [data-report-authorization]")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Synthetic Teacher");
  await fixture.changeSession(null);
  await expect(page.getByText(text("zh-CN", "reports.signInDescription"), { exact: true })).toBeVisible();
  await expect(page.locator("[data-report-summary], [data-report-authorization]")).toHaveCount(0);
  await assertNoUnexpected(page, fixture.state);
});

test("页面隐藏立即清空；回到前台与focus必须重新核验后才可读取", async ({ page }) => {
  const fixture = await syntheticReports(page, { owned: true });
  await page.goto("/reports"); await page.locator(`[data-report-select="${grantId}"]`).click();
  await expect(page.locator('[data-report-summary="ready"]')).toBeVisible();
  const before = fixture.state.accessReads;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("[data-report-summary], [data-report-authorization]")).toHaveCount(0);
  fixture.state.access.owned = []; fixture.state.access.candidates = [];
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(() => fixture.state.accessReads).toBeGreaterThan(before);
  await expect(page.getByText(text("zh-CN", "reports.lists.emptyOwned"), { exact: true })).toBeVisible();
  await expect(page.locator("[data-report-summary]")).toHaveCount(0);
  await assertNoUnexpected(page, fixture.state);
});

test("授权有效截止和周期性复核不保留旧摘要", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  const fixture = await syntheticReports(page, { owned: true, expiresInMs: 60_000 });
  await page.goto("/reports"); await page.locator(`[data-report-select="${grantId}"]`).click();
  await expect(page.locator('[data-report-summary="ready"]')).toBeVisible();
  fixture.state.access.owned = fixture.state.access.owned.map((row) => ({ ...row, status: "expired" as const })); fixture.state.denyCurrent = true;
  await page.clock.fastForward(61_000);
  await expect(page.locator("[data-report-summary]")).toHaveCount(0);
  await expect(page.locator(`[data-report-select="${grantId}"]`)).toBeDisabled();
  await assertNoUnexpected(page, fixture.state);
});

test("负责老师只看到received范围，能够读取受限报告且没有代学生启用或撤回入口", async ({ page }) => {
  const fixture = await syntheticReports(page, { received: true, eligibility: "not_available" });
  await page.goto("/reports");
  await expect(page.locator(`#received-report-grants [data-report-authorization="${grantId}"]`)).toContainText("Synthetic Student");
  await expect(page.locator("#report-teacher")).toHaveCount(0);
  await expect(page.locator("[data-report-revoke]")).toHaveCount(0);
  await page.locator(`[data-report-select="${grantId}"]`).click();
  await expect(page.locator('[data-report-summary="ready"]')).toBeVisible();
  await expect(page.locator("[data-report-dimension]")).toHaveCount(1);
  expect(fixture.state.createBodies).toEqual([]); expect(fixture.state.revokeIds).toEqual([]);
  await assertNoUnexpected(page, fixture.state);
});

test("current失权响应清空received学生身份和摘要，再核验后不保留旧条目", async ({ page }) => {
  const fixture = await syntheticReports(page, { received: true, eligibility: "not_available" });
  await page.goto("/reports"); await page.locator(`[data-report-select="${grantId}"]`).click();
  await expect(page.locator('[data-report-summary="ready"]')).toBeVisible();
  const reads = fixture.state.accessReads;
  fixture.state.access.received = []; fixture.state.denyCurrent = true;
  await page.locator(`[data-report-select="${grantId}"]`).click();
  await expect.poll(() => fixture.state.accessReads).toBeGreaterThan(reads);
  await expect(page.locator("[data-report-summary], [data-report-authorization]")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Synthetic Student");
  await expect(page.getByText(text("zh-CN", "reports.current.states.invalid"), { exact: true })).toBeVisible();
  await assertNoUnexpected(page, fixture.state);
});
