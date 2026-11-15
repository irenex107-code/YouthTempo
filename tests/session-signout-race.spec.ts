import { expect, test, type BrowserContext } from "@playwright/test";
import zh from "../locales/zh-CN.json";

const userA = "00000000-0000-4000-8000-000000000071";
const userB = "00000000-0000-4000-8000-000000000072";
function session(id: string) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = { sub: id, session_id: `synthetic-session-${id}`, exp: expires, role: "authenticated" };
  return { access_token: [ { alg: "HS256", typ: "JWT" }, payload ].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".c3ludGhldGlj",
    refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: expires,
    user: { id, email: "synthetic-signout@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
}
const name = (id: string) => id === userB ? "Synthetic account B" : "Synthetic account A";

async function fixture(context: BrowserContext, baseURL: string, noSharedLock = false) {
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co").hostname.split(".")[0];
  const storageKey = `sb-${ref}-auth-token`;
  const logoutTargets: string[] = []; const external: string[] = []; let verifications = 0;
  let holdLogout = false; let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  await context.addInitScript(({ storageKey, initial, noSharedLock }) => {
    if (!sessionStorage.getItem("signout-race-seeded")) {
      sessionStorage.setItem("signout-race-seeded", "true");
      localStorage.setItem(storageKey, JSON.stringify(initial));
    }
    if (noSharedLock) Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  }, { storageKey, initial: session(userA), noSharedLock });
  const appOrigin = new URL(baseURL).origin;
  await context.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    const token = request.headers().authorization?.replace(/^Bearer\s+/i, "");
    let owner = userA;
    if (token?.split(".").length === 3) owner = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub as string;
    if (url.pathname.startsWith("/auth/v1/")) {
      if (url.pathname.endsWith("/user")) return route.fulfill({ json: session(owner).user });
      if (url.pathname.endsWith("/verify")) { verifications += 1; return route.fulfill({ json: session(userB) }); }
      if (url.pathname.endsWith("/logout")) {
        logoutTargets.push(owner);
        if (holdLogout) await barrier;
        return route.fulfill({ status: 204 });
      }
      return route.abort();
    }
    if (url.pathname.startsWith("/rest/v1/")) return route.fulfill({ json: [] });
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/account/status") return route.fulfill({ json: {
        displayRole: "学生", profile: { id: owner, display_name: name(owner), role: "学生", school_id: null }, hasSchool: false,
        studentAgeBand: "18_plus", linkedChildren: [], linkedGuardians: [], assignedStudents: [], assignedTeachers: [],
      } });
      if (url.pathname === "/api/account/consent") return route.fulfill({ json: {
        role: "student", policyVersion: "2026-08-28", children: [], consent: { studentUserId: owner, studentName: name(owner),
          policyVersion: "2026-08-28", status: "active", ageBand: "18_plus", consentBasis: "adult_self",
          studentAssentedAt: "2026-10-28T04:00:00Z", guardianUserId: null, guardianConsentedAt: null, withdrawnAt: null, hasLinkedGuardian: false },
      } });
      if (url.pathname === "/api/monitoring/client-error") return route.fulfill({ status: 204 });
      return route.fulfill({ json: { available: false, identities: [], records: [], verification: null, eligible: false } });
    }
    if (url.origin !== appOrigin) { external.push(url.origin); return route.abort(); }
    return route.continue();
  });
  return { storageKey, logoutTargets, external, verifications: () => verifications, hold: () => { holdLogout = true; }, release };
}

test("实际浏览器支持并可取得跨标签Auth锁", async ({ page }, testInfo) => {
  await page.goto("/");
  const supported = await page.evaluate(async () => Boolean(navigator.locks?.request)
    && await navigator.locks.request("youthtempo-signout-capability-probe", async () => true));
  await testInfo.attach("native-auth-lock-support", { body: JSON.stringify({ project: testInfo.project.name, supported }), contentType: "application/json" });
  expect(supported).toBe(true);
});

test("实际SDK退出A网络迟到时保留另一标签的新B会话", async ({ page, context, baseURL }) => {
  const f = await fixture(context, baseURL!);
  await page.goto("/account"); await expect(page.getByRole("heading", { level: 1 })).toContainText(name(userA));
  const other = await context.newPage();
  await other.goto("/account"); await expect(other.getByRole("heading", { level: 1 })).toContainText(name(userA));
  f.hold(); await page.bringToFront();
  await page.locator("main").getByRole("button", { name: zh.account.actions.signOut, exact: true }).first().click();
  await expect.poll(() => f.logoutTargets).toEqual([userA]);
  await other.evaluate(({ key, next }) => {
    localStorage.setItem(key, JSON.stringify(next));
    const channel = new BroadcastChannel(key); channel.postMessage({ event: "SIGNED_IN", session: next }); channel.close();
  }, { key: f.storageKey, next: session(userB) });
  expect(await other.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null")?.user.id, f.storageKey)).toBe(userB);
  f.release();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name(userB));
  await expect(other.getByRole("heading", { level: 1 })).toContainText(name(userB));
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null")?.user.id, f.storageKey)).toBe(userB);
  expect(f.logoutTargets).toEqual([userA]); expect(f.external).toEqual([]);
  await other.close();
});

test("普通本人退出仍清理原会话并保留重新登录入口", async ({ page, context, baseURL }) => {
  const f = await fixture(context, baseURL!);
  await page.goto("/account"); await expect(page.getByRole("heading", { level: 1 })).toContainText(name(userA));
  await page.locator("main").getByRole("button", { name: zh.account.actions.signOut, exact: true }).first().click();
  await expect(page.locator("main").getByText(zh.account.notices.signedOut, { exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), f.storageKey)).toBeNull();
  expect(f.logoutTargets).toEqual([userA]); expect(f.external).toEqual([]);
});

test("另一标签的实际token-hash OTP写入与A退出使用同一原生锁", async ({ page, context, baseURL }) => {
  const f = await fixture(context, baseURL!);
  await page.goto("/account"); await expect(page.getByRole("heading", { level: 1 })).toContainText(name(userA));
  const other = await context.newPage();
  await other.goto("/for-young-adults");
  await expect(other.getByLabel(zh.common.navbar.loadingAccount)).toHaveCount(0);
  f.hold(); await page.bringToFront();
  await page.locator("main").getByRole("button", { name: zh.account.actions.signOut, exact: true }).first().click();
  await expect.poll(() => f.logoutTargets).toEqual([userA]);
  // Keep this tab's initialized SDK instance: a full navigation would instead
  // test the SDK initialization lock, not the previously unlocked verifyOtp.
  await other.evaluate(() => {
    const app = window as unknown as { next: { router: { push: (url: string) => Promise<boolean> } } };
    void app.next.router.push("/account?token_hash=synthetic-token-hash&type=email");
  });
  await expect(other).toHaveURL(/token_hash=synthetic-token-hash/);
  await expect.poll(() => other.evaluate(async (key) => {
    const state = await navigator.locks.query();
    return state.pending?.filter((lock) => lock.name === `lock:${key}`).length ?? 0;
  }, f.storageKey)).toBeGreaterThanOrEqual(2);
  expect(f.verifications()).toBe(0);
  expect(await other.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null")?.user.id, f.storageKey)).toBe(userA);
  f.release();
  await expect.poll(f.verifications).toBe(1);
  await expect(other.getByRole("heading", { level: 1 })).toContainText(name(userB));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name(userB));
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null")?.user.id, f.storageKey)).toBe(userB);
  expect(f.logoutTargets).toEqual([userA]); expect(f.external).toEqual([]);
  await other.close();
});

test("不支持跨标签锁时安全拒绝退出，不清会话或发送logout", async ({ page, context, baseURL }) => {
  const f = await fixture(context, baseURL!, true);
  await page.goto("/account"); await expect(page.getByRole("heading", { level: 1 })).toContainText(name(userA));
  await page.locator("main").getByRole("button", { name: zh.account.actions.signOut, exact: true }).first().click();
  await expect(page.locator("main [role=alert]")).toHaveText(zh.account.errors.signOutFailed);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null")?.user.id, f.storageKey)).toBe(userA);
  expect(f.logoutTargets).toEqual([]); expect(f.external).toEqual([]);
});
