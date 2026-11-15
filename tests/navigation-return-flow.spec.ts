import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

async function navigationFixture(page: Page, origin: string, options: {
  role?: string; signedIn?: boolean; consent?: string; approved?: boolean; ageBand?: string; profileComplete?: boolean;
} = {}) {
  const role = options.role || "学生";
  const ageBand = options.ageBand || "14_17";
  const user = {
    id: "00000000-0000-4000-8000-000000000063", aud: "authenticated", role: "authenticated",
    email: "navigation-return@example.invalid", app_metadata: {}, user_metadata: { display_name: "Navigation user" },
    created_at: "2026-01-01T00:00:00Z",
  };
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, role: "authenticated", exp: expiry })).toString("base64url")}.synthetic-signature`;
  const session = { access_token: token, refresh_token: "synthetic-navigation-refresh", token_type: "bearer", expires_at: expiry, expires_in: 3600, user };
  const state = { sends: 0, verifications: 0, unexpectedExternal: [] as string[], writes: [] as string[],
    profileName: options.profileComplete === false ? "" : "Navigation user", profileWrites: [] as Record<string, unknown>[],
  };
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co").hostname.split(".")[0];
  if (options.signedIn !== false) {
    await page.addInitScript(({ session, key }) => localStorage.setItem(key, JSON.stringify(session)), { session, key: `sb-${ref}-auth-token` });
  }
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    state.unexpectedExternal.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  await page.route("**/auth/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/user")) return route.fulfill({ json: user });
    if (pathname.endsWith("/otp")) { state.sends += 1; return route.fulfill({ json: {} }); }
    if (pathname.endsWith("/verify")) { state.verifications += 1; return route.fulfill({ json: session }); }
    return route.abort();
  });
  await page.route("**/rest/v1/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/profiles") && route.request().method() === "PATCH") {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      state.profileWrites.push(payload);
      state.profileName = String(payload.display_name || "");
      return route.fulfill({ json: { id: user.id, display_name: state.profileName, role, school_id: null } });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") state.writes.push(pathname);
    if (pathname === "/api/account/status") return route.fulfill({ json: {
      profile: { id: user.id, display_name: state.profileName, role, school_id: null }, displayRole: role,
      hasSchool: ["支持老师", "学校负责人"].includes(role), studentAgeBand: role === "学生" ? ageBand : null,
      linkedChildren: [], assignedStudents: [], assignedTeachers: [], linkedGuardians: [], schoolMemberships: [],
    } });
    if (pathname === "/api/account/consent") return route.fulfill({ json: {
      role: role === "学生" ? "student" : role === "家长" ? "guardian" : "other", policyVersion: "2026-08-28", children: [],
      consent: role === "学生" ? { studentUserId: user.id, studentName: "Navigation user", ageBand,
        consentBasis: ageBand === "18_plus" ? "adult_self" : "student_self_pilot", status: options.consent || "withdrawn", hasLinkedGuardian: false,
      } : null,
    } });
    if (pathname === "/api/support/staff") return route.fulfill({ json: { application: options.approved ? { status: "approved" } : null } });
    if (pathname === "/api/support/staff-cases") return route.fulfill({ json: { assignments: [] } });
    if (pathname === "/api/garden") return route.fulfill({ status: 503, json: { error: "Synthetic garden unavailable" } });
    return route.fulfill({ json: { records: [], identities: [], available: false, verification: null, posts: [], comments: [], blocks: [] } });
  });
  return state;
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} 学校值班老师登录后保留支持申请与工作台原任务`, async ({ page, baseURL }) => {
    const state = await navigationFixture(page, new URL(baseURL!).origin, { role: "支持老师" });
    for (const target of ["/support/apply", "/support/workbench"]) {
      await page.goto(`${prefix}/account?next=${encodeURIComponent(target)}`);
      await expect(page).toHaveURL(`${baseURL}${prefix}${target}`);
    }
    expect(state.writes).toEqual([]);
    expect(state.unexpectedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 房间审核保留原任务，由原接口拒绝未获当前职责的账号`, async ({ page, baseURL }) => {
    const state = await navigationFixture(page, new URL(baseURL!).origin, { role: "支持老师" });
    await page.route("**/api/admin/peer-space/review?*", (route) => route.fulfill({ status: 403, json: { error: "SYNTHETIC_PRIVATE_DENIAL" } }));
    await page.goto(`${prefix}/account?next=${encodeURIComponent("/admin/peer-space")}`);
    await expect(page).toHaveURL(`${baseURL}${prefix}/admin/peer-space`);
    await expect(page.locator("main").getByRole("alert")).toContainText(copy.roleFollowup.professional.loadFailed);
    await expect(page.locator("main")).not.toContainText("SYNTHETIC_PRIVATE_DENIAL");
    await expect(page.locator("main textarea, main select")).toHaveCount(0);
    expect(state.writes).toEqual([]);
    expect(state.unexpectedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 已登录学生从确认入口回到原任务，未自动发送或调用AI`, async ({ page, baseURL }) => {
    const state = await navigationFixture(page, new URL(baseURL!).origin);
    for (const target of ["/mood-journal", "/community", "/feedback"]) {
      await page.goto(`${prefix}/account?next=${encodeURIComponent(target)}`);
      await expect(page).toHaveURL(`${baseURL}${prefix}${target}`);
    }
    expect(state.sends).toBe(0);
    expect(state.verifications).toBe(0);
    expect(state.writes).toEqual([]);
    expect(state.unexpectedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} OTP登录继续原任务，默认花园不覆盖社区返回目标`, async ({ page, baseURL }) => {
    const state = await navigationFixture(page, new URL(baseURL!).origin, { signedIn: false });
    await page.goto(`${prefix}/account?next=/community`);
    await page.getByPlaceholder("name@example.com").fill("navigation-return@example.invalid");
    await page.getByRole("button", { name: copy.account.visitor.sendOtp, exact: true }).click();
    await page.getByPlaceholder("12345678").fill("12345678");
    await page.getByRole("button", { name: copy.account.visitor.signIn, exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${prefix}/community`);
    expect(state.sends).toBe(1);
    expect(state.verifications).toBe(1);
    expect(state.writes).toEqual([]);
    expect(state.unexpectedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 先补齐昵称再继续原任务，不写权限字段`, async ({ page, baseURL }) => {
    const state = await navigationFixture(page, new URL(baseURL!).origin, { profileComplete: false });
    await page.goto(`${prefix}/account?next=/mood-journal`);
    await expect(page.getByRole("heading", { level: 1, name: copy.account.hero.completeProfile, exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}${prefix}/account?next=/mood-journal`);
    await page.getByLabel(copy.account.profile.name, { exact: true }).fill("My navigation name");
    await page.getByRole("button", { name: copy.account.actions.saveContinue, exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${prefix}/mood-journal`);
    expect(state.profileWrites).toHaveLength(1);
    expect(Object.keys(state.profileWrites[0]).sort()).toEqual(["display_name", "updated_at"]);
    expect(state.writes).toEqual([]);
    expect(state.unexpectedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 拒绝外站和不适用角色的原任务`, async ({ page, baseURL }) => {
    const state = await navigationFixture(page, new URL(baseURL!).origin, { role: "家长" });
    for (const target of ["//example.invalid", "/garden", "/admin/support"]) {
      await page.goto(`${prefix}/account?next=${encodeURIComponent(target)}`);
      await expect(page.getByRole("heading", { level: 1, name: /Navigation user/ })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${prefix}/account\\?next=`));
      await expect(page.locator('header nav a[href$="/garden"]').first()).toBeAttached();
      await expect(page.locator('header a.button-primary[href$="/garden"]')).toHaveCount(0);
    }
    expect(state.unexpectedExternal).toEqual([]);
    expect(state.writes).toEqual([]);
  });

  test(`${prefix || "zh"} 公开学生入口展示三个主要任务，其余工具可展开`, async ({ page, baseURL }) => {
    await navigationFixture(page, new URL(baseURL!).origin, { signedIn: false });
    for (const path of ["/for-teens", "/for-young-adults"]) {
      await page.goto(`${prefix}${path}`);
      const primary = page.locator("[data-primary-tasks]");
      await expect(primary.locator("article")).toHaveCount(3);
      for (const target of ["/garden", "/mood-journal"]) await expect(primary.locator(`a[href$="${target}"]`)).toBeVisible();
      const referralTarget = path === "/for-young-adults" ? "/referral?displayContext=young_adult" : "/referral";
      await expect(primary.locator(`a[href="${prefix}${referralTarget}"]`)).toBeVisible();
      const more = page.locator("[data-public-more-tools]");
      await expect(more).not.toHaveAttribute("open", "");
      await expect(more.locator('a[href$="/check-in"]')).not.toBeVisible();
      await more.locator("summary").click();
      await expect(more.locator('a[href$="/check-in"]')).toBeVisible();
      await expect(more.locator('a[href$="/worry-time"]')).toBeVisible();
      await expect(more.locator('a[href$="/community"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    }
  });

  test(`${prefix || "zh"} 已确认的成年学生获批支持人员后，次级卡片进入工作台，主入口仍是花园`, async ({ page, baseURL }) => {
    const state = await navigationFixture(page, new URL(baseURL!).origin, { role: "学生", ageBand: "18_plus", consent: "active", approved: true });
    await page.goto(`${prefix}/account`);
    await expect(page.getByRole("link", { name: copy.supportStaff.workbench, exact: true })).toHaveAttribute("href", `${prefix}/support/workbench`);
    await expect(page.locator('header a.button-primary[href$="/garden"]:visible').first()).toBeVisible();
    expect(state.writes).toEqual([]);
    expect(state.unexpectedExternal).toEqual([]);
  });

  for (const approved of [false, true]) {
    test(`${prefix || "zh"} 专业支持者按本人真实申请状态分流 approved=${approved}`, async ({ page, baseURL }) => {
      const state = await navigationFixture(page, new URL(baseURL!).origin, { role: "专业支持者", approved });
      await page.goto(`${prefix}/`);
      const target = approved ? "/support/workbench" : "/support/apply";
      const menu = page.getByRole("button", { name: copy.common.navbar.openMenu, exact: true });
      if (await menu.isVisible()) await menu.click();
      await expect(page.locator(`header a.button-primary[href$="${target}"]:visible`).first()).toBeVisible();
      await expect(page.locator('header nav a[href$="/garden"]').first()).toBeAttached();
      await expect(page.locator('header a.button-primary[href$="/garden"]')).toHaveCount(0);
      expect(state.writes).toEqual([]);
      expect(state.unexpectedExternal).toEqual([]);
    });
  }
}
