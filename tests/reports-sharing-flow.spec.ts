import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import type { SchoolReportAccess, SchoolReportDetailCommand } from "../lib/reports/accessTypes";
import { buildComprehensiveDetails, buildComprehensiveTrend } from "../lib/reports/comprehensive";
import type { ComprehensiveSourceRow, HistoryDetailPosition } from "../lib/reports/comprehensiveTypes";

test.skip(process.env.E2E_REPORTS_LOCAL_INTEGRATION !== "true", "Requires the explicitly enabled, loopback-only local reports app.");
const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const student = uuid(1); const teacher = uuid(11); const enrollment = uuid(201);
const copy = (locale: string, key: string) => key.split(".").reduce((value: unknown, segment) => (value as Record<string, unknown>)?.[segment], locale === "en" ? en : zh) as string;
const opaque = () => `synthetic-opaque-${randomUUID().replaceAll("-", "")}`;

async function syntheticSharing(page: Page, options: { teacher?: boolean; guardian?: boolean; enabled?: boolean; recipientPages?: boolean; receivedCount?: number; lostOn?: number; lostOff?: number; holdOn?: boolean; expiresMs?: number } = {}) {
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3214").origin;
  const key = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:55321").hostname.split(".")[0]}-auth-token`;
  const now = Date.now(); const asOf = new Date(now - 1000).toISOString();
  const rows: ComprehensiveSourceRow[] = Array.from({ length: 1205 }, (_, index) => ({ id: uuid(10_000 + index), created_at: new Date(now - (index + 1) * 86_400_000).toISOString(),
    school_id: index > 100 ? null : uuid(101), records: [
      { id: "sleep", title: "EXCLUDED_TITLE", fields: [{ id: "quality", value: "比较好" }, { id: "note", value: "比较好" }] },
      { id: "wake", fields: [{ id: "state", value: "比较有精神" }, { id: "note", value: "原样补充 <img src=x onerror=window.__reportUnsafe=true>" }] },
      { id: "eat", fields: [{ id: "rhythm", value: "比较规律" }] },
      { id: "exercise", fields: [{ id: "duration", value: "10–19 分钟" }] },
      { id: "task", fields: [{ id: "engagement", value: "比较顺利" }, { id: "completedSmallTask", value: "完成了一个小任务" }] },
    ], summary: "单次小结保持原文。", small_step: "EXCLUDED_AI_STEP", recommended_next_tool: "EXCLUDED_TOOL" }));
  const entry = { enrollmentId: enrollment, displayName: "Synthetic Student", effectiveAt: new Date(now - 2 * 86_400_000).toISOString(), expiresAt: new Date(now + (options.expiresMs || 5 * 86_400_000)).toISOString() };
  const owner = { ...entry, status: "active" as const, detailsEnabled: options.enabled || false, detailRevision: 0, recipientEpoch: 1,
    recipients: [{ id: teacher, displayName: "Synthetic Teacher A", type: "teacher" as const }], recipientNextCursor: options.recipientPages ? opaque() : null };
  const state = { actor: options.teacher ? teacher : options.guardian ? uuid(21) : student, enabled: owner.detailsEnabled, revision: 0, epoch: 1, source: 1,
    access: { version: "school-report-access-v2", viewerRole: options.guardian ? "unavailable" : options.teacher ? "teacher" : "student", eligibility: options.guardian ? "not_available" : "enrolled", owner: options.teacher || options.guardian ? null : owner,
      received: options.teacher ? Array.from({ length: options.receivedCount ?? 1 }, (_, index) => ({ ...entry, enrollmentId: uuid(201 + index), displayName: `Synthetic Student ${index + 1}` })) : [], nextCursor: null } as SchoolReportAccess,
    accessReads: 0, currentReads: 0, detailReads: 0, historyReads: 0, validationReads: 0,
    commands: [] as SchoolReportDetailCommand[], exits: [] as Record<string, unknown>[],
    lostOn: options.lostOn || 0, lostOff: options.lostOff || 0, holdOn: options.holdOn || false, holdDetails: false, holdAccess: false,
    heldOn: [] as Array<() => Promise<void>>, heldDetails: [] as Array<() => Promise<void>>, heldAccess: [] as Array<() => Promise<void>>,
    denied: false, reportPaths: [] as string[], external: [] as string[], unexpected: [] as string[], errors: [] as string[] };
  type Bound = { revision: number; epoch: number; source: number; kind: "view" | "history" | "detail"; bin?: string | null; position?: HistoryDetailPosition | null };
  const tokens = new Map<string, Bound>(); const receipts = new Map<string, string>();
  function token(kind: Bound["kind"], extra: Partial<Bound> = {}) { const value = opaque(); tokens.set(value, { revision: state.revision, epoch: state.epoch, source: state.source, kind, ...extra }); return value; }
  function fresh(value: unknown, kind: Bound["kind"]) { const bound = typeof value === "string" ? tokens.get(value) : null; return bound?.kind === kind && bound.revision === state.revision && bound.epoch === state.epoch && bound.source === state.source ? bound : null; }
  function access() { if (state.access.owner) Object.assign(state.access.owner, { detailsEnabled: state.enabled, detailRevision: state.revision, recipientEpoch: state.epoch }); return state.access; }
  function report(before?: string | null) {
    const core = buildComprehensiveTrend({ rows, asOf, detailsState: state.enabled ? "available" : "off", beforeBinStart: before, limit: 2 });
    return { ...core, viewToken: token("view"), longTerm: { unit: core.longTerm.unit, bins: core.longTerm.bins, nextCursor: core.longTerm.hasMore ? token("history", { bin: core.longTerm.nextBinStart }) : null } };
  }
  function details(position?: HistoryDetailPosition | null) {
    const core = buildComprehensiveDetails({ rows, asOf, position, limit: 2 });
    return { version: core.version, asOf: core.asOf, viewToken: token("view"), items: core.items.map((item) => ({ ...item, key: `opaque-record-${item.date || item.key.replaceAll("-", "")}` })),
      nextCursor: core.hasMore ? token("detail", { position: core.nextPosition }) : null };
  }
  function user(actor: string) { return { id: actor, aud: "authenticated", role: "authenticated", email: "sharing-synthetic@example.invalid", app_metadata: {}, user_metadata: { display_name: "Synthetic reports" }, created_at: "2026-01-01T00:00:00Z" }; }
  function session(actor: string) { const expires = Math.floor(Date.now() / 1000) + 3600; const accessToken = [{ alg: "HS256", typ: "JWT" }, { sub: actor, exp: expires, role: "authenticated" }].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".synthetic-signature";
    return { access_token: accessToken, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: expires, user: user(actor) }; }
  await page.addInitScript(({ key, initial }) => localStorage.setItem(key, JSON.stringify(initial)), { key, initial: session(state.actor) });
  page.on("pageerror", (error) => state.errors.push(error.message));
  async function send(route: Route, body: unknown, status = 200) { try { await route.fulfill({ status, json: body, headers: { "Cache-Control": "private, no-store" } }); } catch { /* Deliberately canceled stale responses cannot be delivered. */ } }
  const failure = (route: Route, code = "refresh_required", status = 409) => send(route, { error: "Unavailable", code }, status);
  await page.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url()); const name = url.pathname;
    if (name.startsWith("/auth/v1/")) { if (name.endsWith("/user")) return send(route, user(state.actor)); state.unexpected.push(name); return route.abort(); }
    if (name.startsWith("/rest/v1/")) return send(route, []);
    if (name.startsWith("/storage/v1/")) return route.abort();
    if (name.startsWith("/api/")) {
      const body = request.method() === "GET" ? {} : request.postDataJSON() as Record<string, unknown>;
      if (name.startsWith("/api/reports/")) state.reportPaths.push(name);
      if (name.startsWith("/api/reports/") && state.denied) return failure(route, "access_denied", 403);
      if (name === "/api/reports/access") {
        state.accessReads += 1;
        if (request.method() === "POST" && state.access.owner?.recipientNextCursor && body.cursor === state.access.owner.recipientNextCursor) {
          state.access.owner.recipients.push({ id: uuid(12), displayName: "Synthetic Teacher B", type: "teacher" }); state.access.owner.recipientNextCursor = null;
        }
        const payload = structuredClone(access());
        if (state.holdAccess) return new Promise<void>((resolve) => state.heldAccess.push(async () => { await send(route, payload); resolve(); }));
        return send(route, payload);
      }
      if (name === "/api/reports/current") { state.currentReads += 1; return send(route, report()); }
      if (name === "/api/reports/validate") { state.validationReads += 1; if (!fresh(body.viewToken, "view")) return failure(route); return send(route, { valid: true, detailsEnabled: state.enabled }); }
      if (name === "/api/reports/history") { state.historyReads += 1; const bound = fresh(body.cursor, "history"); return bound ? send(route, report(bound.bin)) : failure(route); }
      if (name === "/api/reports/details") {
        state.detailReads += 1;
        if (!fresh(body.viewToken, "view") || (state.actor !== student && !state.enabled)) return failure(route);
        const bound = body.cursor ? fresh(body.cursor, "detail") : null; if (body.cursor && !bound) return failure(route);
        if (state.holdDetails) return new Promise<void>((resolve) => state.heldDetails.push(async () => { await send(route, details(bound?.position)); resolve(); }));
        return send(route, details(bound?.position));
      }
      if (name === "/api/reports/details-setting") {
        const { locale: _locale, ...semanticCommand } = body;
        const command = semanticCommand as unknown as SchoolReportDetailCommand; state.commands.push(command);
        const finish = async () => {
          const existing = receipts.get(command.requestId); const signature = JSON.stringify(command);
          if (existing && existing !== signature) return failure(route, "invalid_request", 400);
          if (!existing) {
            if (command.enabled && (command.expectedDetailRevision !== state.revision || command.expectedRecipientEpoch !== state.epoch)) return failure(route, "stale_setting");
            state.enabled = command.enabled; state.revision += 1; receipts.set(command.requestId, signature);
          }
          if (command.enabled && state.lostOn > 0) { state.lostOn -= 1; return route.abort("failed"); }
          if (!command.enabled && state.lostOff > 0) { state.lostOff -= 1; return route.abort("failed"); }
          return send(route, { enabled: state.enabled, detailRevision: state.revision, recipientEpoch: state.epoch, replayed: Boolean(existing) });
        };
        if (command.enabled && state.holdOn) return new Promise<void>((resolve) => state.heldOn.push(async () => { await finish().catch(() => {}); resolve(); }));
        return finish();
      }
      if (name === "/api/reports/enrollment-exit") { state.exits.push(body); state.enabled = false; state.revision += 1; state.access.owner = null; state.access.eligibility = "not_enrolled"; return send(route, { ended: true }); }
      if (name === "/api/account/status") return send(route, { profile: { id: state.actor, display_name: "Synthetic reports", role: options.teacher ? "学校支持人员" : "学生" }, displayRole: "学生", hasSchool: true, studentAgeBand: "14_17", linkedChildren: [], linkedGuardians: [], assignedTeachers: [], assignedStudents: [] });
      if (name === "/api/monitoring/client-error") return send(route, {});
      if (name === "/api/pilot-experience") return send(route, { eligible: false });
      state.unexpected.push(`${request.method()} ${name}`); return failure(route, "unavailable", 404);
    }
    if (url.origin !== origin) { state.external.push(url.origin); return route.abort(); }
    return route.continue();
  });
  async function changeSession(actor: string | null) {
    if (actor) state.actor = actor;
    state.access = { version: "school-report-access-v2", viewerRole: "unavailable", eligibility: "not_available", owner: null, received: [], nextCursor: null };
    await page.evaluate(({ key, next }) => { if (next) localStorage.setItem(key, JSON.stringify(next)); else localStorage.removeItem(key);
      const channel = new BroadcastChannel(key); channel.postMessage({ event: next ? "SIGNED_IN" : "SIGNED_OUT", session: next }); channel.close(); }, { key, next: actor ? session(actor) : null });
  }
  return { state, changeSession };
}

async function clean(page: Page, state: Awaited<ReturnType<typeof syntheticSharing>>["state"]) {
  expect(state.external).toEqual([]); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((key) => /report/i.test(key)))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator("main")).not.toContainText(/EXCLUDED_AI_STEP|EXCLUDED_TOOL|EXCLUDED_TITLE/);
}

for (const [prefix, locale] of [["", "zh-CN"], ["/en", "en"]] as const) {
  test(`${locale} 自动全历史趋势、一个详细开关、本人OFF预览及双类分页`, async ({ page }, info) => {
    const fixture = await syntheticSharing(page);
    await page.goto(`${prefix}/reports`); await expect(page.locator('[data-report-comprehensive="ready"]')).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1, name: copy(locale, "reportsV2.title") })).toBeVisible();
    expect(fixture.state.commands).toEqual([]); expect(fixture.state.currentReads).toBeGreaterThan(0);
    const toggle = page.getByRole("switch", { name: copy(locale, "reportsV2.details.switch") }); await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("#report-teacher, input[type=checkbox]")).toHaveCount(0);
    await expect(page.locator("[data-report-time-bin]")).toHaveCount(2);
    await page.getByRole("button", { name: copy(locale, "reportsV2.trend.more"), exact: true }).click(); await expect(page.locator("[data-report-time-bin]")).toHaveCount(4);
    await page.locator("[data-report-details-open]").click(); await expect(page.locator("[data-report-detail-item]")).toHaveCount(2);
    await page.locator("[data-report-detail-item]").first().locator("summary").click();
    const sleep = page.locator("[data-report-detail-item]").first().locator("section").filter({ has: page.getByRole("heading", { name: copy(locale, "reportsPreview.dimensions.sleep"), exact: true }) });
    await expect(sleep.locator("dd").last()).toHaveText("比较好");
    await expect(page.locator("[data-report-details]").getByText("单次小结保持原文。", { exact: true }).first()).toBeVisible();
    await expect(page.locator("[data-report-details] img, [data-report-details] script")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __reportUnsafe?: boolean }).__reportUnsafe)).toBeUndefined();
    await page.getByRole("button", { name: copy(locale, "reportsV2.details.more"), exact: true }).click(); await expect(page.locator("[data-report-detail-item]")).toHaveCount(4);
    expect(fixture.state.commands).toEqual([]);
    await toggle.focus(); await page.keyboard.press("Space"); await expect(toggle).toHaveAttribute("aria-checked", "true"); await expect(page.locator('[data-report-comprehensive="ready"]')).toBeVisible();
    expect(fixture.state.commands[0]).toMatchObject({ enabled: true, expectedDetailRevision: 0, expectedRecipientEpoch: 1, policyVersion: "sweet-details-2026-10-28", confirmed: true });
    if (process.env.YOUTHTEMPO_CAPTURE_REPORTS_SHARING === "true") {
      const directory = path.join(process.cwd(), "deliverables/reports-sharing-2026-10-28"); await mkdir(directory, { recursive: true });
      await page.evaluate(async () => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); await document.fonts.ready; });
      await expect.poll(() => page.evaluate(async () => {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return window.scrollY;
      })).toBe(0);
      await page.screenshot({ path: path.join(directory, `${locale}-${info.project.name}.png`), fullPage: true, scale: "css" });
    }
    await clean(page, fixture.state);
  });

  test(`${locale} 结果未知使用同请求UUID重试；关闭立即隐藏并保留趋势`, async ({ page }) => {
    const fixture = await syntheticSharing(page, { lostOn: 1, lostOff: 1 }); await page.goto(`${prefix}/reports`);
    const toggle = page.getByRole("switch", { name: copy(locale, "reportsV2.details.switch") }); await expect(toggle).toBeEnabled(); await toggle.click();
    await expect(page.getByText(copy(locale, "reportsV2.details.unknownOn"), { exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy(locale, "reportsV2.details.retry"), exact: true }).click(); await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(fixture.state.commands[1]).toEqual(fixture.state.commands[0]);
    await expect(page.locator('[data-report-comprehensive="ready"]')).toBeVisible(); await page.locator("[data-report-details-open]").click(); await expect(page.locator("[data-report-details]")).toBeVisible();
    await toggle.click(); await expect(page.locator("[data-report-details]")).toHaveCount(0);
    await expect(page.getByText(copy(locale, "reportsV2.details.unknownOff"), { exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy(locale, "reportsV2.details.retry"), exact: true }).click(); await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(fixture.state.commands[3]).toEqual(fixture.state.commands[2]); await expect(page.locator('[data-report-comprehensive="ready"]')).toBeVisible(); await clean(page, fixture.state);
  });
}

test("ON仍在等待时OFF可取消，迟到ON不能恢复旧详情", async ({ page }) => {
  const fixture = await syntheticSharing(page, { holdOn: true }); await page.goto("/reports");
  const toggle = page.locator("[data-report-detail-switch]"); await expect(toggle).toBeEnabled(); await toggle.click(); await expect.poll(() => fixture.state.heldOn.length).toBe(1);
  await page.locator("[data-report-setting-pending] [data-report-detail-off]").click();
  await expect.poll(() => fixture.state.commands.length).toBe(2);
  await expect(page.getByText(copy("zh-CN", "reportsV2.details.confirmedOff"), { exact: true })).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  fixture.state.holdOn = false; await fixture.state.heldOn.shift()!(); await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(fixture.state.enabled).toBe(false); expect(fixture.state.commands.map((command) => command.enabled)).toEqual([true, false]);
  await expect(toggle).toHaveAttribute("aria-checked", "false"); await expect(page.locator("[data-report-details]")).toHaveCount(0); await clean(page, fixture.state);
});

test("完整接收名单加载前不启用；接收集合变化清空旧页，重新读取后详细版关闭", async ({ page }) => {
  const fixture = await syntheticSharing(page, { recipientPages: true }); await page.goto("/reports");
  const toggle = page.locator("[data-report-detail-switch]"); await expect(toggle).toBeDisabled();
  await page.getByRole("button", { name: copy("zh-CN", "reportsV2.access.recipientMore"), exact: true }).click(); await expect(page.locator("[data-report-recipients]")).toContainText("Synthetic Teacher B"); await expect(toggle).toBeEnabled();
  await toggle.click(); await expect(toggle).toHaveAttribute("aria-checked", "true"); await expect(page.locator('[data-report-comprehensive="ready"]')).toBeVisible();
  await page.locator("[data-report-details-open]").click(); await expect(page.locator("[data-report-details]")).toBeVisible();
  fixture.state.epoch += 1; fixture.state.enabled = false; fixture.state.revision += 1;
  await page.getByRole("button", { name: copy("zh-CN", "reportsV2.details.more"), exact: true }).click(); await expect(page.locator("[data-report-details], [data-report-comprehensive], [data-report-owner]")).toHaveCount(0);
  await page.getByRole("button", { name: copy("zh-CN", "reportsV2.actions.refresh"), exact: true }).click(); await expect(toggle).toHaveAttribute("aria-checked", "false"); await clean(page, fixture.state);
});

test("后台、恢复、focus及30秒轮询只validate，不自动拉取正文", async ({ page }) => {
  await page.clock.install({ time: new Date() }); const fixture = await syntheticSharing(page, { enabled: true }); await page.goto("/reports");
  await expect(page.locator('[data-report-comprehensive="ready"]')).toBeVisible(); await page.locator("[data-report-details-open]").click(); await expect(page.locator("[data-report-details]")).toBeVisible();
  const reads = [fixture.state.currentReads, fixture.state.detailReads, fixture.state.accessReads]; const checks = fixture.state.validationReads;
  await page.clock.fastForward(31_000); await expect.poll(() => fixture.state.validationReads).toBeGreaterThan(checks);
  expect([fixture.state.currentReads, fixture.state.detailReads, fixture.state.accessReads]).toEqual(reads);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.locator("[data-report-details], [data-report-comprehensive], [data-report-owner]")).toHaveCount(0);
  const before = fixture.state.validationReads;
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
  await expect.poll(() => fixture.state.validationReads).toBeGreaterThan(before); expect([fixture.state.currentReads, fixture.state.detailReads, fixture.state.accessReads]).toEqual(reads); await clean(page, fixture.state);
});

test("老师多学生未选报告时复核最少名单，撤销后剩一人也不自动拉正文", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  const fixture = await syntheticSharing(page, { teacher: true, receivedCount: 2 });
  await page.goto("/reports"); await expect(page.locator("[data-report-received]")).toHaveCount(2);
  expect([fixture.state.currentReads, fixture.state.detailReads, fixture.state.validationReads]).toEqual([0, 0, 0]);
  const reads = fixture.state.accessReads;
  fixture.state.access.received = fixture.state.access.received.slice(1);
  await page.clock.fastForward(31_000);
  await expect(page.locator("[data-report-received]")).toHaveCount(1);
  await expect(page.locator(`[data-report-received="${uuid(201)}"]`)).toHaveCount(0);
  expect(fixture.state.accessReads).toBeGreaterThan(reads);
  expect([fixture.state.currentReads, fixture.state.detailReads, fixture.state.historyReads, fixture.state.validationReads]).toEqual([0, 0, 0, 0]);
  await expect(page.locator("[data-report-comprehensive], [data-report-details]")).toHaveCount(0);
  await clean(page, fixture.state);
});

test("老师未选中的入组到期即移除名单，不自动打开剩余报告", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  const fixture = await syntheticSharing(page, { teacher: true, receivedCount: 2, expiresMs: 60_000 });
  const later = { ...fixture.state.access.received[1], expiresAt: new Date(Date.now() + 120_000).toISOString() };
  fixture.state.access.received[1] = later;
  await page.goto("/reports"); await expect(page.locator("[data-report-received]")).toHaveCount(2);
  // A response authorized just before the boundary may still contain the first entry.
  // The display must filter that expired metadata without opening another report.
  await page.clock.fastForward(61_000);
  await expect(page.locator("[data-report-received]")).toHaveCount(1);
  await expect(page.locator(`[data-report-received="${later.enrollmentId}"]`)).toHaveCount(1);
  expect([fixture.state.currentReads, fixture.state.detailReads, fixture.state.historyReads, fixture.state.validationReads]).toEqual([0, 0, 0, 0]);
  await clean(page, fixture.state);
});

test("名单复核不重叠，退出后迟到的旧名单不能回填", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  const fixture = await syntheticSharing(page, { teacher: true, receivedCount: 2 });
  await page.goto("/reports"); await expect(page.locator("[data-report-received]")).toHaveCount(2);
  const reads = fixture.state.accessReads;
  fixture.state.holdAccess = true;
  await page.clock.fastForward(31_000);
  await expect.poll(() => fixture.state.heldAccess.length).toBe(1);
  await page.clock.fastForward(31_000);
  expect(fixture.state.accessReads).toBe(reads + 1);
  await fixture.changeSession(null);
  await expect(page.getByText(copy("zh-CN", "reportsV2.session.description"), { exact: true })).toBeVisible();
  fixture.state.holdAccess = false;
  for (const finish of fixture.state.heldAccess.splice(0)) await finish();
  await expect(page.locator("[data-report-received], [data-report-comprehensive], [data-report-details]")).toHaveCount(0);
  expect([fixture.state.currentReads, fixture.state.detailReads, fixture.state.historyReads, fixture.state.validationReads]).toEqual([0, 0, 0, 0]);
  await clean(page, fixture.state);
});

test("切号和退出清空详情，旧会话迟到响应不复活；语言Cookie仍正常", async ({ page, context }) => {
  const fixture = await syntheticSharing(page); await page.goto("/reports"); await expect(page.locator('[data-report-comprehensive="ready"]')).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click(); await expect(page.locator("html")).toHaveAttribute("lang", "en"); expect((await context.cookies()).find((cookie) => cookie.name === "NEXT_LOCALE")?.value).toBe("en");
  await expect(page.locator('[data-report-comprehensive="ready"]')).toBeVisible(); fixture.state.holdDetails = true; await page.locator("[data-report-details-open]").click(); await expect.poll(() => fixture.state.heldDetails.length).toBe(1);
  await fixture.changeSession(uuid(99)); await expect(page.locator("[data-report-details], [data-report-comprehensive], [data-report-owner]")).toHaveCount(0);
  fixture.state.holdDetails = false; await fixture.state.heldDetails.shift()!(); await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.locator("[data-report-details]")).toHaveCount(0); await fixture.changeSession(null); await expect(page.getByText(copy("en", "reportsV2.session.description"), { exact: true })).toBeVisible(); await clean(page, fixture.state);
});

test("老师默认只看趋势，无代开按钮；家长工作流保持关闭", async ({ page }) => {
  const fixture = await syntheticSharing(page, { teacher: true }); await page.goto("/reports"); await expect(page.locator('[data-report-comprehensive="ready"]')).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0); await expect(page.locator("[data-report-details-open]")).toHaveCount(0);
  await expect(page.getByText(copy("zh-CN", "reportsV2.guardianClosed"), { exact: true })).toBeVisible();
  fixture.state.enabled = true; fixture.state.revision += 1; await page.getByRole("button", { name: copy("zh-CN", "reportsV2.actions.refresh"), exact: true }).click();
  await expect(page.locator("[data-report-details-open]")).toBeVisible(); await page.locator("[data-report-details-open]").click(); await expect(page.locator("[data-report-details]")).toBeVisible(); expect(fixture.state.commands).toEqual([]); await clean(page, fixture.state);
});

test("退出学校报告单独确认，趋势不被误当作详细开关关闭", async ({ page }) => {
  const fixture = await syntheticSharing(page, { enabled: true }); await page.goto("/reports"); await expect(page.locator('[data-report-comprehensive="ready"]')).toBeVisible();
  await page.getByRole("button", { name: copy("zh-CN", "reportsV2.actions.exit"), exact: true }).click(); expect(fixture.state.exits).toEqual([]);
  await page.getByRole("button", { name: copy("zh-CN", "reportsV2.actions.exitConfirm"), exact: true }).click(); await expect(page.getByText(copy("zh-CN", "reportsV2.actions.exited"), { exact: true })).toBeVisible();
  await expect(page.locator("[data-report-details], [data-report-comprehensive]")).toHaveCount(0); expect(fixture.state.commands).toEqual([]); expect(fixture.state.exits[0]).toMatchObject({ enrollmentId: enrollment, confirmed: true }); await clean(page, fixture.state);
});

test("家长账号只见未开放状态，不出现学生入口、开关或详细内容", async ({ page }) => {
  const fixture = await syntheticSharing(page, { guardian: true }); await page.goto("/reports");
  await expect(page.getByText(copy("zh-CN", "reportsV2.access.not_available"), { exact: true })).toBeVisible();
  await expect(page.locator("[data-report-owner], [data-report-received], [data-report-comprehensive], [data-report-details], [data-report-detail-switch]")).toHaveCount(0);
  expect(fixture.state.currentReads).toBe(0); expect(fixture.state.detailReads).toBe(0); expect(fixture.state.commands).toEqual([]); await clean(page, fixture.state);
});

test("到期只做最少validate并清空，不自动重新请求趋势或详情", async ({ page }) => {
  await page.clock.install({ time: new Date() }); const fixture = await syntheticSharing(page, { enabled: true, expiresMs: 60_000 }); await page.goto("/reports");
  await expect(page.locator('[data-report-comprehensive="ready"]')).toBeVisible(); await page.locator("[data-report-details-open]").click(); await expect(page.locator("[data-report-details]")).toBeVisible();
  const reads = [fixture.state.currentReads, fixture.state.detailReads, fixture.state.accessReads]; const checks = fixture.state.reportPaths.filter((name) => name.endsWith("/validate")).length;
  fixture.state.denied = true; await page.clock.fastForward(61_000);
  await expect(page.locator("[data-report-owner], [data-report-received], [data-report-comprehensive], [data-report-details]")).toHaveCount(0);
  await expect.poll(() => fixture.state.reportPaths.filter((name) => name.endsWith("/validate")).length).toBeGreaterThan(checks);
  expect([fixture.state.currentReads, fixture.state.detailReads, fixture.state.accessReads]).toEqual(reads); await clean(page, fixture.state);
});
