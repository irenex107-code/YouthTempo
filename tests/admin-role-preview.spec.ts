import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co").hostname.split(".")[0];
const storageKey = `sb-${projectRef}-auth-token`;
type Identity = "platform" | "student";
const sessionFor = (kind: Identity) => {
  const user = { id: `00000000-0000-4000-8000-00000000001${kind === "platform" ? "1" : "2"}`, aud: "authenticated", role: "authenticated",
    email: `${kind}@example.invalid`, app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { display_name: `Synthetic ${kind}` }, created_at: "2026-01-01T00:00:00Z" };
  const accessToken = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: user.id, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "synthetic"].join(".");
  return { access_token: accessToken, refresh_token: `synthetic-${kind}-refresh`, token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user };
};
const sessions = { platform: sessionFor("platform"), student: sessionFor("student") };

async function syntheticPreview(page: Page, baseURL: string, initial: Identity | null) {
  const origin = new URL(baseURL).origin;
  expect(new URL(baseURL).hostname).toBe("127.0.0.1");
  const unexpected: string[] = [];
  const external: string[] = [];
  const reads: Identity[] = [];
  const completed: Identity[] = [];
  const failures = new Set<Identity>();
  const holds = new Map<Identity, { promise: Promise<void>; release: () => void }>();
  let selected = initial;
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem("synthetic-preview-initialized")) return;
    sessionStorage.setItem("synthetic-preview-initialized", "yes");
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  }, { key: storageKey, value: initial ? sessions[initial] : null });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const identity = (Object.keys(sessions) as Identity[]).find((kind) => request.headers().authorization === `Bearer ${sessions[kind].access_token}`);
    if (url.pathname.startsWith("/auth/v1/")) {
      if (method === "GET" && url.pathname === "/auth/v1/user" && selected) return route.fulfill({ json: sessions[selected].user });
      unexpected.push(`${method} Auth ${url.pathname}`);
      return route.abort();
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      if (method === "GET" && url.pathname === "/rest/v1/profiles" && identity) return route.fulfill({ json: [{
        id: sessions[identity].user.id, display_name: sessions[identity].user.user_metadata.display_name, role: "学生", school_id: null,
      }] });
      unexpected.push(`${method} Data ${url.pathname}`);
      return route.abort();
    }
    if (url.origin !== origin) { external.push(`${method} ${url.origin}${url.pathname}`); return route.abort(); }
    if (url.pathname.startsWith("/api/")) {
      if (method === "GET" && url.pathname === "/api/account/status" && identity) {
        reads.push(identity);
        const held = holds.get(identity);
        if (held) await held.promise;
        try {
          if (failures.has(identity)) return await route.fulfill({ status: 503, json: { error: "PRIVATE_ERROR_MUST_NOT_RENDER" } });
          return await route.fulfill({ json: {
            profile: { id: sessions[identity].user.id, display_name: sessions[identity].user.user_metadata.display_name, role: "学生" },
            displayRole: identity === "platform" ? "平台管理员" : "学生",
            adminAccess: identity === "platform" ? { role: "平台管理员", scope: "platform" } : null,
            schoolMemberships: [], hasSchool: false, studentAgeBand: identity === "student" ? "14_17" : null,
            linkedChildren: [], assignedStudents: [], assignedTeachers: [], linkedGuardians: [],
          } });
        } catch (error) {
          // Switching accounts cancels the old preview fetch before this held reply.
          if (!request.failure()) throw error;
        } finally { completed.push(identity); }
        return;
      }
      unexpected.push(`${method} API ${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });

  return {
    reads, completed, failures,
    hold(kind: Identity) {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => { release = resolve; });
      holds.set(kind, { promise, release });
    },
    release(kind: Identity) { holds.get(kind)?.release(); holds.delete(kind); },
    async change(kind: Identity | null) {
      selected = kind;
      await page.evaluate(({ key, session }) => {
        if (session) localStorage.setItem(key, JSON.stringify(session));
        else localStorage.removeItem(key);
        const channel = new BroadcastChannel(key);
        channel.postMessage({ event: session ? "SIGNED_IN" : "SIGNED_OUT", session });
        channel.close();
      }, { key: storageKey, session: kind ? sessions[kind] : null });
    },
    assertIsolated() { expect(external).toEqual([]); expect(unexpected).toEqual([]); },
  };
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} 未登录预览入口保留登录返回地址`, async ({ page, baseURL }) => {
    const fixture = await syntheticPreview(page, baseURL!, null);
    await page.goto(`${prefix}/admin/role-preview`);
    await expect(page.getByRole("heading", { name: copy.adminRolePreview.deniedTitle })).toBeVisible();
    const login = page.getByRole("link", { name: copy.adminRolePreview.signIn, exact: true });
    await expect(login).toHaveAttribute("href", `${prefix}/account?next=/admin/role-preview`);
    await login.click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/account\\?next=/admin/role-preview$`));
    fixture.assertIsolated();
  });

  test(`${prefix || "zh"} 普通账号不能查看角色预览`, async ({ page, baseURL }) => {
    const fixture = await syntheticPreview(page, baseURL!, "student");
    await page.goto(`${prefix}/admin/role-preview`);
    await expect(page.getByRole("heading", { name: copy.adminRolePreview.deniedTitle })).toBeVisible();
    await expect(page.getByRole("heading", { name: copy.adminRolePreview.roles.minor.workspace })).toHaveCount(0);
    expect(fixture.reads).toContain("student");
    fixture.assertIsolated();
  });

  test(`${prefix || "zh"} 平台预览可切换示例角色，家长沟通入口正确且没有写入`, async ({ page, baseURL }) => {
    const fixture = await syntheticPreview(page, baseURL!, "platform");
    await page.goto(`${prefix}/admin/role-preview`);
    await expect(page.locator("html")).toHaveAttribute("lang", prefix ? "en" : "zh-CN");
    await expect(page.getByRole("heading", { name: copy.adminRolePreview.roles.minor.workspace })).toBeVisible();
    await page.getByRole("button", { name: copy.adminRolePreview.roles.guardian.title, exact: true }).click();
    await expect(page.getByRole("heading", { name: copy.adminRolePreview.roles.guardian.workspace })).toBeVisible();
    await expect(page.locator("aside").getByRole("link", { name: copy.adminRolePreview.pages.talk })).toHaveAttribute("href", `${prefix}/for-parents#conversation`);
    await expect(page.locator("aside a[href$='/talk']")).toHaveCount(0);
    await page.getByRole("button", { name: copy.adminRolePreview.roles.teacher.title, exact: true }).click();
    await expect(page.getByRole("heading", { name: copy.adminRolePreview.roles.teacher.workspace })).toBeVisible();
    fixture.assertIsolated();
  });

  test(`${prefix || "zh"} 管理员换普通账号立即撤销预览，退出后保持拒绝`, async ({ page, baseURL }) => {
    const fixture = await syntheticPreview(page, baseURL!, "platform");
    await page.goto(`${prefix}/admin/role-preview`);
    await expect(page.getByRole("heading", { name: copy.adminRolePreview.roles.minor.workspace })).toBeVisible();
    await fixture.change("student");
    await expect(page.getByRole("heading", { name: copy.adminRolePreview.deniedTitle })).toBeVisible();
    await expect(page.getByRole("heading", { name: copy.adminRolePreview.roles.minor.workspace })).toHaveCount(0);
    expect(fixture.reads).toContain("student");
    await fixture.change(null);
    await expect(page.getByRole("heading", { name: copy.adminRolePreview.deniedTitle })).toBeVisible();
    fixture.assertIsolated();
  });
}

test("平台账号退出立即清除已显示的预览", async ({ page, baseURL }) => {
  const fixture = await syntheticPreview(page, baseURL!, "platform");
  await page.goto("/admin/role-preview");
  await expect(page.getByRole("heading", { name: zh.adminRolePreview.roles.minor.workspace })).toBeVisible();
  await fixture.change(null);
  await expect(page.getByRole("heading", { name: zh.adminRolePreview.deniedTitle })).toBeVisible();
  await expect(page.getByRole("heading", { name: zh.adminRolePreview.roles.minor.workspace })).toHaveCount(0);
  fixture.assertIsolated();
});

for (const [initial, next] of [["platform", "student"], ["student", "platform"], ["platform", null]] as const) {
  test(`迟到的 ${initial} 身份结果不能改写 ${next} 当前权限`, async ({ page, baseURL }) => {
    const fixture = await syntheticPreview(page, baseURL!, initial);
    fixture.hold(initial);
    try {
      await page.goto("/admin/role-preview");
      await expect.poll(() => fixture.reads.filter((kind) => kind === initial).length).toBeGreaterThanOrEqual(2);
      await fixture.change(next);
      const heading = page.getByRole("heading", { name: next === "platform" ? zh.adminRolePreview.roles.minor.workspace : zh.adminRolePreview.deniedTitle });
      await expect(heading).toBeVisible();
      fixture.release(initial);
      await expect.poll(() => fixture.completed.filter((kind) => kind === initial).length).toBeGreaterThanOrEqual(2);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(heading).toBeVisible();
      await expect(page.getByRole("heading", { name: next === "platform" ? zh.adminRolePreview.deniedTitle : zh.adminRolePreview.roles.minor.workspace })).toHaveCount(0);
      fixture.assertIsolated();
    } finally { fixture.release(initial); }
  });
}

test("可信身份接口失败时拒绝预览且不展示内部详情", async ({ page, baseURL }) => {
  const fixture = await syntheticPreview(page, baseURL!, "platform");
  fixture.failures.add("platform");
  await page.goto("/admin/role-preview");
  await expect(page.getByRole("heading", { name: zh.adminRolePreview.deniedTitle })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("PRIVATE_ERROR_MUST_NOT_RENDER");
  await expect(page.getByRole("heading", { name: zh.adminRolePreview.roles.minor.workspace })).toHaveCount(0);
  fixture.assertIsolated();
});
