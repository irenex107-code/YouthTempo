import { test, expect, type Page, type Route } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

const receiptKey = "youthtempo:account-deletion-receipts:v1";
const a = "00000000-0000-4000-8000-000000000091";
const b = "00000000-0000-4000-8000-000000000092";
const originalReceipt = { subjectUserId: a, operationId: "00000000-0000-4000-8000-000000000093", secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", expiresAt: 0 };
const privateDetail = "PRIVATE_SYNTHETIC_DELETE_PROVIDER_DETAIL";
function user(id: string) {
  return { id, email: `synthetic-${id.slice(-3)}@example.invalid`, aud: "authenticated", role: "authenticated",
    app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
}
function session(id: string) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = [ { alg: "HS256", typ: "JWT" }, { sub: id, session_id: `synthetic-${id}`, exp: expires, role: "authenticated" } ]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".c3ludGhldGlj";
  return { access_token: token, refresh_token: "synthetic-refresh", expires_in: 3600, expires_at: expires, token_type: "bearer", user: user(id) };
}
function actor(headers: Record<string, string>) {
  const token = headers.authorization?.replace(/^Bearer /, "");
  return token?.split(".").length === 3 ? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub as string : "";
}
function barrier() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }

async function fixture(page: Page, baseURL: string, options: { signedOut?: boolean; receipt?: boolean } = {}) {
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co").hostname.split(".")[0];
  const storageKey = `sb-${ref}-auth-token`;
  const state = {
    deleteRequests: [] as Array<{ actor: string; body: Record<string, any> }>,
    statusRequests: [] as Array<{ headers: Record<string, string>; body: Record<string, any> }>,
    logoutActors: [] as string[], external: [] as string[],
    status: "completed", deleteReply: null as ((route: Route) => Promise<void>) | null,
    statusReply: null as ((route: Route) => Promise<void>) | null,
  };
  await page.addInitScript(({ storageKey, initial, receiptKey, receipt }) => {
    if (sessionStorage.getItem("deletion-receipt-fixture-seeded")) return;
    sessionStorage.setItem("deletion-receipt-fixture-seeded", "true");
    if (initial) localStorage.setItem(storageKey, JSON.stringify(initial));
    if (receipt) sessionStorage.setItem(receiptKey, JSON.stringify([{ ...receipt, expiresAt: Date.now() + 86_400_000 }]));
  }, { storageKey, initial: options.signedOut ? null : session(a), receiptKey, receipt: options.receipt ? originalReceipt : null });
  const origin = new URL(baseURL).origin;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    state.external.push(url.origin); return route.abort();
  });
  await page.route("**/auth/v1/**", (route) => {
    const url = new URL(route.request().url());
    const owner = actor(route.request().headers());
    if (url.pathname.endsWith("/user")) return route.fulfill({ json: user(owner) });
    if (url.pathname.endsWith("/logout")) { state.logoutActors.push(owner); return route.fulfill({ status: 204 }); }
    return route.abort();
  });
  await page.route("**/rest/v1/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const owner = actor(route.request().headers());
    if (path === "/api/account/status") return route.fulfill({ json: { displayRole: "家长", hasSchool: false,
      profile: { id: owner, display_name: owner === b ? "SYNTHETIC_B" : "SYNTHETIC_A", role: "家长", school_id: null },
      linkedChildren: [], assignedStudents: [], assignedTeachers: [], linkedGuardians: [] } });
    if (path === "/api/account/consent") return route.fulfill({ json: { role: "guardian", policyVersion: "2026-08-28", consent: null, children: [] } });
    if (path === "/api/account/data" && route.request().method() === "DELETE") {
      state.deleteRequests.push({ actor: owner, body: route.request().postDataJSON() });
      const stored = await page.evaluate((key) => sessionStorage.getItem(key), receiptKey);
      expect(stored).not.toBeNull(); // Capability exists before the destructive request.
      return state.deleteReply ? state.deleteReply(route) : route.fulfill({ json: { deleted: true } });
    }
    if (path === "/api/account/deletion-status") {
      state.statusRequests.push({ headers: route.request().headers(), body: route.request().postDataJSON() });
      return state.statusReply ? state.statusReply(route) : route.fulfill({ json: { state: state.status } });
    }
    if (path === "/api/monitoring/client-error") return route.fulfill({ status: 204 });
    return route.fulfill({ json: { identities: [], records: [], verification: null, available: false } });
  });
  return { state, storageKey };
}
async function switchActor(page: Page, storageKey: string, id: string | null) {
  await page.evaluate(({ storageKey, value }) => {
    if (value) localStorage.setItem(storageKey, JSON.stringify(value)); else localStorage.removeItem(storageKey);
    const channel = new BroadcastChannel(storageKey);
    channel.postMessage({ event: value ? "SIGNED_IN" : "SIGNED_OUT", session: value }); channel.close();
  }, { storageKey, value: id ? session(id) : null });
}
async function dataForm(page: Page, copy: typeof zh | typeof en) {
  const summary = page.locator("summary").filter({ hasText: copy.account.settings.title });
  await expect(summary).toBeVisible();
  if (await summary.locator("..").getAttribute("open") === null) await summary.click();
  await page.getByRole("button", { name: copy.account.settings.data, exact: true }).click();
}
async function confirm(page: Page, copy: typeof zh | typeof en, id: string) {
  await page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true }).fill(user(id).email);
  await page.getByLabel(copy.account.deletion.acknowledgement, { exact: true }).check();
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} 注销响应中断保留回执，退出后显式只读核对，不自动重复删除`, async ({ page, baseURL }) => {
    const f = await fixture(page, baseURL!);
    f.state.deleteReply = (route) => route.abort("failed");
    await page.goto(`${prefix}/account`);
    await dataForm(page, copy);
    await expect(page.getByRole("button", { name: copy.account.deletion.action, exact: true })).toBeDisabled();
    await confirm(page, copy, a);
    await page.getByRole("button", { name: copy.account.deletion.action, exact: true }).click();
    await expect.poll(() => f.state.deleteRequests.length).toBe(1);
    const card = page.locator("[data-deletion-receipt]");
    await expect(card.getByText(copy.account.deletionReceipt.unknown, { exact: true })).toBeVisible();
    expect(f.state.deleteRequests).toHaveLength(1);
    expect(f.state.statusRequests).toHaveLength(0);
    await expect(page.getByRole("button", { name: copy.account.deletion.action, exact: true })).toBeDisabled();
    await switchActor(page, f.storageKey, null);
    await expect(page.getByRole("heading", { name: copy.account.visitor.title })).toBeVisible();
    await card.getByRole("button", { name: copy.account.deletionReceipt.check, exact: true }).click();
    await expect(card.getByText(copy.account.deletionReceipt.completed, { exact: true })).toBeVisible();
    expect(f.state.statusRequests).toHaveLength(1);
    expect(f.state.statusRequests[0].headers.authorization).toBeUndefined();
    expect(f.state.deleteRequests).toHaveLength(1);
    expect(f.state.logoutActors).toEqual([]);
    expect(f.state.external).toEqual([]);
    const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), receiptKey);
    expect(Object.keys(stored[0]).sort()).toEqual(["expiresAt", "operationId", "secret", "subjectUserId"]);
    expect(JSON.stringify(stored)).not.toContain("@example.invalid");
    await page.reload();
    await expect(page.locator("[data-deletion-receipt]")).toBeVisible();
    expect(f.state.statusRequests).toHaveLength(1);
  });

  test(`${prefix || "zh"} 原本人核对not_deleted后须重新确认，手动继续同一operation`, async ({ page, baseURL }) => {
    const f = await fixture(page, baseURL!, { receipt: true });
    f.state.status = "not_deleted";
    await page.goto(`${prefix}/account`);
    await dataForm(page, copy);
    await confirm(page, copy, a);
    await page.locator("[data-deletion-receipt]").getByRole("button", { name: copy.account.deletionReceipt.check, exact: true }).click();
    await expect(page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true })).toHaveValue("");
    await expect(page.getByLabel(copy.account.deletion.acknowledgement, { exact: true })).not.toBeChecked();
    expect(f.state.deleteRequests).toHaveLength(0);
    await page.locator("[data-deletion-receipt]").getByRole("button", { name: copy.account.deletionReceipt.continue, exact: true }).click();
    await confirm(page, copy, a);
    await page.getByRole("button", { name: copy.account.deletion.action, exact: true }).click();
    await expect(page.locator("[data-deletion-receipt]").getByText(copy.account.deletionReceipt.completed, { exact: true })).toBeVisible();
    expect(f.state.deleteRequests).toHaveLength(1);
    expect(f.state.deleteRequests[0].body.receipt).toEqual({ operationId: originalReceipt.operationId, secret: originalReceipt.secret });
    expect(f.state.deleteRequests[0].actor).toBe(a);
    expect(f.state.external).toEqual([]);
  });

  test(`${prefix || "zh"} A注销迟到完成不会清除B会话、邮箱确认或表单，状态明确属于之前申请`, async ({ page, baseURL }) => {
    const f = await fixture(page, baseURL!);
    const hold = barrier();
    f.state.deleteReply = async (route) => { await hold.promise; await route.fulfill({ json: { deleted: true } }); };
    await page.goto(`${prefix}/account`); await dataForm(page, copy); await confirm(page, copy, a);
    await page.getByRole("button", { name: copy.account.deletion.action, exact: true }).click();
    await expect.poll(() => f.state.deleteRequests.length).toBe(1);
    await switchActor(page, f.storageKey, b);
    await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: "SYNTHETIC_B" })).toBeVisible();
    await dataForm(page, copy); await confirm(page, copy, b);
    await page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true }).focus();
    hold.release();
    const card = page.locator("[data-deletion-receipt]");
    await expect(card.getByText(copy.account.deletionReceipt.completed, { exact: true })).toBeVisible();
    await expect(card.getByRole("heading", { name: copy.account.deletionReceipt.title })).toBeVisible();
    await expect(card.getByText(copy.account.deletionReceipt.differentAccount, { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: copy.account.deletionReceipt.continue, exact: true })).toHaveCount(0);
    await expect(page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true })).toHaveValue(user(b).email);
    await expect(page.getByLabel(copy.account.deletion.acknowledgement, { exact: true })).toBeChecked();
    await expect(page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true })).toBeFocused();
    expect(f.state.logoutActors).toEqual([]);
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).user.id, f.storageKey)).toBe(b);
    expect(await card.textContent()).not.toContain(user(a).email);
    expect(f.state.deleteRequests).toHaveLength(1);
  });

  test(`${prefix || "zh"} A状态查询迟到not_deleted不清B表单，也不重删或暴露供应商错误`, async ({ page, baseURL }) => {
    const f = await fixture(page, baseURL!, { receipt: true });
    const hold = barrier();
    f.state.statusReply = async (route) => { await hold.promise; await route.fulfill({ json: { state: "not_deleted", error: privateDetail } }); };
    await page.goto(`${prefix}/account`);
    await page.locator("[data-deletion-receipt]").getByRole("button", { name: copy.account.deletionReceipt.check, exact: true }).click();
    await expect.poll(() => f.state.statusRequests.length).toBe(1);
    await switchActor(page, f.storageKey, b);
    await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: "SYNTHETIC_B" })).toBeVisible();
    await dataForm(page, copy); await confirm(page, copy, b);
    await page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true }).focus();
    hold.release();
    await expect(page.locator("[data-deletion-receipt]").getByText(copy.account.deletionReceipt.notDeleted, { exact: true })).toBeVisible();
    await expect(page.locator("[data-deletion-receipt]").getByRole("button", { name: copy.account.deletionReceipt.continue, exact: true })).toHaveCount(0);
    await expect(page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true })).toHaveValue(user(b).email);
    await expect(page.getByLabel(copy.account.deletion.acknowledgement, { exact: true })).toBeChecked();
    await expect(page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true })).toBeFocused();
    expect(f.state.deleteRequests).toHaveLength(0);
    expect(f.state.logoutActors).toEqual([]);
    expect(await page.locator("body").textContent()).not.toContain(privateDetail);
  });

  test(`${prefix || "zh"} 核对429或503及提交Busy409均撤销一次性继续资格，已完成状态不降级`, async ({ page, baseURL }) => {
    const f = await fixture(page, baseURL!, { receipt: true });
    await page.goto(`${prefix}/account`); await dataForm(page, copy);
    const card = page.locator("[data-deletion-receipt]");
    const check = card.getByRole("button", { name: copy.account.deletionReceipt.check, exact: true });
    const proceed = page.getByRole("button", { name: copy.account.deletion.action, exact: true });
    const continuation = card.getByRole("button", { name: copy.account.deletionReceipt.continue, exact: true });
    for (const status of [429, 503]) {
      f.state.statusReply = (route) => route.fulfill({ json: { state: "not_deleted", retryAfter: 0 } });
      await check.click();
      await expect(card.getByText(copy.account.deletionReceipt.notDeleted, { exact: true })).toBeVisible();
      await continuation.click();
      await confirm(page, copy, a);
      await expect(proceed).toBeEnabled();
      f.state.statusReply = (route) => route.fulfill({ status, json: { state: "unknown", error: privateDetail } });
      await check.click();
      await expect(card.getByText(copy.account.deletionReceipt.unavailable, { exact: true })).toBeVisible();
      await expect(proceed).toBeDisabled();
      await expect(page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true })).toHaveValue(user(a).email);
      await expect(page.getByLabel(copy.account.deletion.acknowledgement, { exact: true })).toBeChecked();
    }
    await continuation.click();
    await expect(page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true })).toHaveValue("");
    await expect(page.getByLabel(copy.account.deletion.acknowledgement, { exact: true })).not.toBeChecked();
    await confirm(page, copy, a);
    f.state.deleteReply = (route) => route.fulfill({ status: 409, json: { error: privateDetail, deletionState: "unknown", retryAfter: 30 } });
    await proceed.click();
    await expect.poll(() => f.state.deleteRequests.length).toBe(1);
    await expect(page.getByRole("alert").filter({ hasText: copy.account.deletionReceipt.unknown })).toBeVisible();
    await expect(proceed).toBeDisabled();
    await expect(page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true })).toHaveValue(user(a).email);
    await expect(page.getByLabel(copy.account.deletion.acknowledgement, { exact: true })).toBeChecked();
    for (const [state, message] of [["deleted_cleanup_pending", copy.account.deletionReceipt.cleanupPending], ["completed", copy.account.deletionReceipt.completed]]) {
      f.state.statusReply = (route) => route.fulfill({ json: { state } });
      await check.click(); await expect(card.getByText(message, { exact: true })).toBeVisible();
      f.state.statusReply = (route) => route.fulfill({ status: 503, json: { state: "unknown" } });
      await check.click(); await expect(card.getByText(copy.account.deletionReceipt.unavailable, { exact: true })).toBeVisible();
      f.state.statusReply = (route) => route.fulfill({ json: { state: "not_deleted" } });
      await check.click(); await expect(card.getByText(message, { exact: true })).toBeVisible();
      await expect(proceed).toBeDisabled();
    }
    expect(f.state.deleteRequests).toHaveLength(1);
    expect(f.state.logoutActors).toEqual([]);
    expect(await page.locator("body").textContent()).not.toContain(privateDetail);
  });

  test(`${prefix || "zh"} 请求到服务器前断开且回执未注册，原本人显式继续并重新确认同op恢复`, async ({ page, baseURL }) => {
    const f = await fixture(page, baseURL!);
    let registered = false;
    f.state.deleteReply = (route) => route.abort("failed");
    f.state.statusReply = (route) => route.fulfill({ json: { state: registered ? "completed" : "unknown" } });
    await page.goto(`${prefix}/account`); await dataForm(page, copy); await confirm(page, copy, a);
    const submit = page.getByRole("button", { name: copy.account.deletion.action, exact: true });
    await submit.click();
    await expect.poll(() => f.state.deleteRequests.length).toBe(1);
    const firstReceipt = f.state.deleteRequests[0].body.receipt;
    const card = page.locator("[data-deletion-receipt]");
    const check = card.getByRole("button", { name: copy.account.deletionReceipt.check, exact: true });
    await expect(card.getByText(copy.account.deletionReceipt.unknown, { exact: true })).toBeVisible();
    await check.click();
    await expect.poll(() => f.state.statusRequests.length).toBe(1);
    await expect(check).toBeEnabled();
    expect(registered).toBe(false);
    expect(f.state.deleteRequests).toHaveLength(1);
    await expect(submit).toBeDisabled();

    await switchActor(page, f.storageKey, b);
    await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: "SYNTHETIC_B" })).toBeVisible();
    await expect(card.getByRole("button", { name: copy.account.deletionReceipt.continue, exact: true })).toHaveCount(0);
    await dataForm(page, copy); await confirm(page, copy, b);
    await expect(page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true })).toHaveValue(user(b).email);
    expect(f.state.deleteRequests).toHaveLength(1);
    expect(f.state.logoutActors).toEqual([]);

    await switchActor(page, f.storageKey, a);
    await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: "SYNTHETIC_A" })).toBeVisible();
    await dataForm(page, copy); await confirm(page, copy, a);
    await expect(submit).toBeDisabled(); // Old email/checkbox alone confer no continuation grant.
    await card.getByRole("button", { name: copy.account.deletionReceipt.continue, exact: true }).click();
    await expect(page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true })).toHaveValue("");
    await expect(page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true })).toBeFocused();
    await expect(page.getByLabel(copy.account.deletion.acknowledgement, { exact: true })).not.toBeChecked();
    await expect(submit).toBeDisabled();
    expect(f.state.deleteRequests).toHaveLength(1); // Continue is only local preparation.
    expect(f.state.statusRequests).toHaveLength(1);
    f.state.deleteReply = async (route) => { registered = true; await route.fulfill({ json: { deleted: true } }); };
    await confirm(page, copy, a);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(card.getByText(copy.account.deletionReceipt.completed, { exact: true })).toBeVisible();
    expect(registered).toBe(true);
    expect(f.state.deleteRequests).toHaveLength(2);
    expect(f.state.deleteRequests[1].body.receipt).toEqual(firstReceipt);
    expect(f.state.deleteRequests.every((request) => request.actor === a)).toBe(true);
    expect(f.state.statusRequests).toHaveLength(1);
    expect(f.state.logoutActors.every((id) => id === a)).toBe(true);
    expect(f.state.external).toEqual([]);
  });
}
