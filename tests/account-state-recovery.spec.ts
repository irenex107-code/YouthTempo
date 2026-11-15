import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

type AgeBand = "under_14" | "14_17" | "18_plus";
type ConsentState = "not_started" | "withdrawn" | "active" | "ineligible";
const privateProviderDetail = "PRIVATE provider sign-out diagnostic";

function syntheticUser(id = "00000000-0000-4000-8000-000000000091", name = "Account recovery") {
  return {
    id, email: `account-${id.slice(-3)}@example.invalid`, aud: "authenticated", role: "authenticated",
    app_metadata: {}, user_metadata: { display_name: name }, created_at: "2026-01-01T00:00:00Z",
  };
}

function syntheticSession(user: ReturnType<typeof syntheticUser>) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: expiresAt, role: "authenticated" })).toString("base64url")}.synthetic-signature`;
  return {
    access_token: token, refresh_token: "synthetic-refresh-token", token_type: "bearer",
    expires_in: 3600, expires_at: expiresAt, user,
  };
}

async function mockAccount(page: Page, baseURL: string, role: "学生" | "家长" = "学生") {
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co").hostname.split(".")[0];
  const storageKey = `sb-${ref}-auth-token`;
  const initialUser = syntheticUser();
  const state = {
    user: initialUser,
    role,
    ageBand: "14_17" as AgeBand,
    consentState: "withdrawn" as ConsentState,
    consentFailures: false,
    consentGets: 0,
    consentPosts: [] as AgeBand[],
    otpSends: 0,
    logoutCalls: 0,
    logoutFailure: null as "server" | "network" | null,
    logoutGate: null as Promise<void> | null,
    requests: [] as Array<{ path: string; method: string; actor: string }>,
    records: [] as Array<{ id: string; user_id: string; created_at: string; records: unknown[]; summary: string; small_step: null; recommended_next_tool: null }>,
    externalRequests: [] as string[],
  };
  function requestActor(headers: Record<string, string>) {
    const token = headers.authorization?.split(" ")[1];
    if (!token) return "";
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub as string;
  }
  await page.addInitScript(({ storageKey, session }) => {
    // Do not recreate a session after a successful sign-out and reload.
    if (sessionStorage.getItem("account-recovery-seeded")) return;
    sessionStorage.setItem("account-recovery-seeded", "true");
    localStorage.setItem(storageKey, JSON.stringify(session));
  }, { storageKey, session: syntheticSession(initialUser) });

  // Abort every unexpected external request. Auth and Data API calls below are
  // fulfilled locally; no real identity, OTP, database, or provider is used.
  const appOrigin = new URL(baseURL).origin;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin) return route.continue();
    state.externalRequests.push(url.origin);
    return route.abort();
  });
  await page.route("**/auth/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/user")) return route.fulfill({ json: state.user });
    if (pathname.endsWith("/logout")) {
      state.logoutCalls += 1;
      if (state.logoutGate) await state.logoutGate;
      if (state.logoutFailure === "network") return route.abort("failed");
      if (state.logoutFailure === "server") {
        return route.fulfill({ status: 500, json: { code: "unexpected_failure", msg: privateProviderDetail } });
      }
      return route.fulfill({ status: 204 });
    }
    if (pathname.endsWith("/otp")) state.otpSends += 1;
    if (pathname.endsWith("/verify")) return route.fulfill({ json: syntheticSession(state.user) });
    return route.abort();
  });
  await page.route("**/rest/v1/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const actor = requestActor(request.headers());
    state.requests.push({ path: url.pathname, method: request.method(), actor });
    if (url.pathname.endsWith("/sweet_records")) {
      if (request.method() === "DELETE") {
        const owner = url.searchParams.get("user_id")?.replace(/^eq\./, "");
        expect(owner).toBe(actor);
        state.records = state.records.filter((record) => record.user_id !== actor);
        return route.fulfill({ status: 204 });
      }
      const recordId = url.searchParams.get("id")?.replace(/^eq\./, "");
      const records = state.records.filter((record) => record.user_id === actor && (!recordId || record.id === recordId));
      return route.fulfill({ json: request.headers().accept?.includes("vnd.pgrst.object") ? records[0] || null : records });
    }
    if (url.pathname.endsWith("/profiles") && request.method() === "PATCH") {
      expect(url.searchParams.get("id")).toBe(`eq.${actor}`);
      const payload = request.postDataJSON();
      expect(Object.keys(payload).sort()).toEqual(["display_name", "updated_at"]);
      state.user.user_metadata.display_name = payload.display_name;
      return route.fulfill({ json: { id: actor, display_name: payload.display_name, role: state.role } });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    state.requests.push({ path: pathname, method: route.request().method(), actor: requestActor(route.request().headers()) });
    if (pathname === "/api/account/status") {
      return route.fulfill({ json: {
        displayRole: state.role,
        profile: { id: state.user.id, display_name: state.user.user_metadata.display_name, role: state.role },
        hasSchool: false,
        // Deliberately retain the initial account response. Consent mutations
        // must use the server-returned age without requiring a page refresh.
        studentAgeBand: "14_17",
        linkedChildren: [], assignedStudents: [], assignedTeachers: [], linkedGuardians: [],
      } });
    }
    if (pathname === "/api/account/consent") {
      const method = route.request().method();
      if (method === "GET") {
        state.consentGets += 1;
        if (state.consentFailures) return route.fulfill({ status: 503, json: { error: privateProviderDetail } });
      } else if (method === "POST") {
        const payload = route.request().postDataJSON();
        expect(payload.action).toBe("student_assent");
        state.ageBand = payload.ageBand;
        state.consentPosts.push(state.ageBand);
        state.consentState = state.ageBand === "under_14" ? "ineligible" : "active";
      } else if (method === "DELETE") {
        state.consentState = "withdrawn";
      }
      return route.fulfill({ json: {
        role: state.role === "学生" ? "student" : "guardian",
        policyVersion: "2026-08-28",
        consent: state.role === "学生" ? {
          studentUserId: state.user.id, studentName: state.user.user_metadata.display_name,
          policyVersion: "2026-08-28",
          status: state.consentState, ageBand: state.ageBand,
          consentBasis: state.ageBand === "18_plus" ? "adult_self" : state.ageBand === "under_14" ? "not_applicable" : "student_self_pilot",
          studentAssentedAt: state.consentState === "active" ? "2026-10-28T04:00:00Z" : null,
          guardianUserId: null, guardianConsentedAt: null,
          withdrawnAt: state.consentState === "withdrawn" ? "2026-10-28T03:00:00Z" : null,
          hasLinkedGuardian: false,
        } : null,
        children: [],
      } });
    }
    if (pathname === "/api/monitoring/client-error") return route.fulfill({ status: 204 });
    if (pathname === "/api/account/data") {
      return route.request().method() === "DELETE"
        ? route.fulfill({ json: { deleted: true, cleanupPending: false } })
        : route.fulfill({ contentType: "application/json", headers: { "content-disposition": 'attachment; filename="synthetic-account-export.json"' }, body: JSON.stringify({ owner: state.user.id }) });
    }
    if (pathname === "/api/professional-verification") return route.fulfill({ json: { verification: null } });
    if (pathname === "/api/garden") return route.fulfill({ status: 503, json: { error: "Garden unavailable in account test" } });
    return route.fulfill({ json: { identities: [], records: [], available: false } });
  });
  return { state, storageKey };
}

type AccountFixture = Awaited<ReturnType<typeof mockAccount>>;

async function switchAccount(page: Page, fixture: AccountFixture, user: ReturnType<typeof syntheticUser> | null, notify = true) {
  if (user) fixture.state.user = user;
  await page.evaluate(({ key, session, notify }) => {
    if (session) localStorage.setItem(key, JSON.stringify(session));
    else localStorage.removeItem(key);
    if (notify) {
      const channel = new BroadcastChannel(key);
      channel.postMessage({ event: session ? "SIGNED_IN" : "SIGNED_OUT", session });
      channel.close();
    }
  }, { key: fixture.storageKey, session: user ? syntheticSession(user) : null, notify });
}

function syntheticRecord(userId: string, marker: string) {
  return { id: "00000000-0000-4000-8000-000000000099", user_id: userId, created_at: "2026-10-28T04:00:00Z",
    records: [{ id: "sleep", label: "S", title: "睡眠", fields: [{ id: "note", title: "补充", value: marker }] }],
    summary: marker, small_step: null, recommended_next_tool: null };
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  for (const failure of ["server", "network"] as const) {
    test(`${prefix || "zh"} 退出${failure}失败保留会话，隐藏内部错误并允许重试`, async ({ page, baseURL }) => {
      const { state, storageKey } = await mockAccount(page, baseURL!);
      let releaseLogout!: () => void;
      state.logoutGate = new Promise<void>((resolve) => { releaseLogout = resolve; });
      state.logoutFailure = failure;
      await page.goto(`${prefix}/account`);
      const signOut = page.locator("main").getByRole("button", { name: copy.account.actions.signOut, exact: true }).first();
      await expect(signOut).toBeEnabled();
      await signOut.click();
      await expect(page.locator("main").getByRole("button", { name: copy.account.actions.signingOut, exact: true }).first()).toBeDisabled();
      await expect.poll(() => state.logoutCalls).toBe(1);
      releaseLogout();
      await expect(page.locator("main [role='alert']")).toHaveText(copy.account.errors.signOutFailed);
      await expect(page.getByText(copy.account.notices.signedOut, { exact: true })).toHaveCount(0);
      await expect(page.getByText(privateProviderDetail, { exact: false })).toHaveCount(0);
      await expect.poll(() => page.evaluate((key) => Boolean(localStorage.getItem(key)), storageKey)).toBe(true);
      await expect(signOut).toBeEnabled();
      expect(state.logoutCalls).toBe(1);
      expect(state.otpSends).toBe(0);
      expect(state.externalRequests).toEqual([]);
    });
  }

  test(`${prefix || "zh"} 顶部退出成功后清空会话和账号视图，刷新仍为访客`, async ({ page, baseURL }) => {
    const { state, storageKey } = await mockAccount(page, baseURL!);
    await page.goto(`${prefix}/account`);
    const signOut = page.locator("main").getByRole("button", { name: copy.account.actions.signOut, exact: true }).first();
    await expect(signOut).toBeEnabled();
    await signOut.click();
    await expect(page.getByRole("heading", { level: 1, name: copy.account.visitor.title })).toBeVisible();
    await expect(page.getByText(copy.account.notices.signedOut, { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
    await expect(page.getByRole("heading", { name: /Account recovery/ })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: copy.account.visitor.title })).toBeVisible();
    expect(state.logoutCalls).toBe(1);
    expect(state.otpSends).toBe(0);
    expect(state.externalRequests).toEqual([]);
  });

  test(`${prefix || "zh"} 账户同意503显示安全重试入口，恢复前不自动离开账户`, async ({ page, baseURL }) => {
    const { state } = await mockAccount(page, baseURL!);
    state.consentFailures = true;
    await page.goto(`${prefix}/account`);
    await expect(page.locator("main [role='alert']")).toHaveText(copy.account.consent.loadFailed);
    await expect(page).toHaveURL(new RegExp(`${prefix}/account$`));
    await expect(page.getByRole("button", { name: copy.account.consent.completeStudent, exact: true })).toHaveCount(0);
    await expect(page.getByText(copy.account.consent.activeTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByText(privateProviderDetail, { exact: false })).toHaveCount(0);
    state.consentFailures = false;
    await page.getByRole("button", { name: copy.account.consent.retry, exact: true }).click();
    await expect(page.getByLabel(copy.account.consent.acknowledgement, { exact: true })).not.toBeChecked();
    await expect(page.locator("main [role='alert']")).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.account.consent.completeStudent, exact: true })).toBeDisabled();
    expect(state.consentGets).toBe(2);
    expect(state.consentPosts).toEqual([]);
    expect(state.otpSends).toBe(0);
    expect(state.externalRequests).toEqual([]);
  });

  test(`${prefix || "zh"} 年龄确认采用服务端返回结果，撤回与更换年龄清空旧勾选`, async ({ page, baseURL }) => {
    const { state } = await mockAccount(page, baseURL!);
    await page.goto(`${prefix}/account`);
    const age = page.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true });
    const acknowledgement = page.getByLabel(copy.account.consent.acknowledgement, { exact: true });
    const submit = page.getByRole("button", { name: copy.account.consent.completeStudent, exact: true });
    await expect(age).toBeVisible();
    await acknowledgement.check();
    await age.selectOption("18_plus");
    await expect(acknowledgement).not.toBeChecked();
    await expect(submit).toBeDisabled();
    await acknowledgement.check();
    await submit.click();
    await expect(page.getByRole("heading", { name: copy.ageWorkspace.adult.title, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: copy.ageWorkspace.minor.title, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: copy.account.consent.withdraw, exact: true }).click();
    await expect(acknowledgement).not.toBeChecked();
    await expect(age).toHaveValue("18_plus");
    await expect(submit).toBeDisabled();
    await age.selectOption("under_14");
    await acknowledgement.check();
    await submit.click();
    await expect(page.getByText(copy.account.consent.ineligible, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: copy.ageWorkspace.adult.title, exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: copy.ageWorkspace.minor.title, exact: true })).toHaveCount(0);
    await expect(acknowledgement).not.toBeChecked();
    await age.selectOption("14_17");
    await acknowledgement.check();
    await submit.click();
    await expect(page.getByRole("heading", { name: copy.ageWorkspace.minor.title, exact: true })).toBeVisible();
    expect(state.consentPosts).toEqual(["18_plus", "under_14", "14_17"]);
    expect(state.otpSends).toBe(0);
    expect(state.externalRequests).toEqual([]);
  });

  test(`${prefix || "zh"} 退出后登录另一合成账号，返回账户时不沿用年龄选择或勾选`, async ({ page, baseURL }) => {
    const { state } = await mockAccount(page, baseURL!);
    await page.goto(`${prefix}/account`);
    const consentArea = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: copy.account.consent.title, exact: true }) });
    const age = consentArea.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true });
    await age.selectOption("18_plus");
    await consentArea.getByLabel(copy.account.consent.acknowledgement, { exact: true }).check();
    await page.locator("main").getByRole("button", { name: copy.account.actions.signOut, exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: copy.account.visitor.title })).toBeVisible();
    state.user = syntheticUser("00000000-0000-4000-8000-000000000092", "Second account");
    await page.getByPlaceholder("name@example.com").fill(state.user.email);
    await page.getByRole("button", { name: copy.account.visitor.alreadyReceivedOtp, exact: true }).click();
    await page.getByPlaceholder("12345678").fill("12345678");
    await page.getByRole("button", { name: copy.account.visitor.signIn, exact: true }).click();
    // Login retains its default garden destination. Inspect the account form
    // after returning there, rather than racing its intentional redirect.
    await expect(page).toHaveURL(`${new URL(baseURL!).origin}${prefix}/garden`);
    await page.goto(`${prefix}/account`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Second account");
    await expect(age).toHaveValue("14_17");
    await expect(consentArea.getByLabel(copy.account.consent.acknowledgement, { exact: true })).not.toBeChecked();
    await expect(consentArea.getByRole("button", { name: copy.account.consent.completeStudent, exact: true })).toBeDisabled();
    expect(state.consentPosts).toEqual([]);
    expect(state.otpSends).toBe(0);
    expect(state.externalRequests).toEqual([]);
  });

  test(`${prefix || "zh"} 当前家长账户保留教育和数据控制入口，不承诺孩子记录或关系开通`, async ({ page, baseURL }) => {
    const { state } = await mockAccount(page, baseURL!, "家长");
    await page.goto(`${prefix}/account`);
    await expect(page.getByRole("link", { name: copy.account.actions.parentResources, exact: true }).first())
      .toHaveAttribute("href", `${prefix}/for-parents`);
    await expect(page.locator("#family-overview")).toHaveCount(0);
    await expect(page.locator("#records")).toHaveCount(0);
    await expect(page.getByText(copy.account.relationships.confirmRelationship, { exact: true })).toHaveCount(0);
    await expect(page.getByText(copy.account.hero.noLinkedChildren, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: copy.account.consent.title, exact: true })).toHaveCount(0);
    await page.locator("summary").filter({ hasText: copy.account.settings.title }).click();
    await page.getByRole("button", { name: copy.account.settings.data, exact: true }).click();
    await expect(page.getByRole("button", { name: copy.account.dataExport.action, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.account.deletion.action, exact: true })).toBeDisabled();
    expect(state.externalRequests).toEqual([]);
  });
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} 账户收到跨标签换号和退出后清除旧记录、昵称与确认勾选`, async ({ page, baseURL }) => {
    const fixture = await mockAccount(page, baseURL!);
    const first = fixture.state.user;
    fixture.state.records = [syntheticRecord(first.id, "OLD_ACCOUNT_PRIVATE_RECORD")];
    await page.goto(`${prefix}/account`);
    await expect(page.locator("#records")).toContainText("OLD_ACCOUNT_PRIVATE_RECORD");
    await page.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true }).selectOption("18_plus");
    await page.getByLabel(copy.account.consent.acknowledgement, { exact: true }).check();
    const second = syntheticUser("00000000-0000-4000-8000-000000000092", "Second account");
    await switchAccount(page, fixture, second);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Second account");
    await expect(page.locator("main")).not.toContainText("OLD_ACCOUNT_PRIVATE_RECORD");
    await expect(page.locator("main")).not.toContainText(first.user_metadata.display_name);
    await expect(page.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true })).toHaveValue("14_17");
    await expect(page.getByLabel(copy.account.consent.acknowledgement, { exact: true })).not.toBeChecked();
    await switchAccount(page, fixture, null);
    await expect(page.getByRole("heading", { level: 1, name: copy.account.visitor.title })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Second account");
    expect(fixture.state.externalRequests).toEqual([]);
  });

  test(`${prefix || "zh"} 迟到的A账户身份读取不能覆盖已切换的B账户`, async ({ page, baseURL }) => {
    const fixture = await mockAccount(page, baseURL!);
    const first = fixture.state.user;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held = 0;
    await page.route("**/api/account/status", async (route) => {
      const token = route.request().headers().authorization.split(" ")[1];
      const owner = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
      if (owner !== first.id) return route.fallback();
      held++;
      await gate;
      return route.fulfill({ json: { displayRole: "学生", profile: { id: first.id, role: "学生", display_name: "LATE_PRIVATE_ACCOUNT_A" },
        hasSchool: false, studentAgeBand: "18_plus", linkedChildren: [], assignedStudents: [], assignedTeachers: [], linkedGuardians: [] } });
    });
    await page.goto(`${prefix}/account`);
    try {
      await expect.poll(() => held).toBeGreaterThanOrEqual(2);
      await switchAccount(page, fixture, syntheticUser("00000000-0000-4000-8000-000000000092", "Second account"));
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Second account");
      const late = page.waitForResponse((response) => {
        if (new URL(response.url()).pathname !== "/api/account/status") return false;
        const token = response.request().headers().authorization.split(" ")[1];
        return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub === first.id;
      });
      release();
      await (await late).finished();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Second account");
      await expect(page.locator("main")).not.toContainText("LATE_PRIVATE_ACCOUNT_A");
      expect(fixture.state.externalRequests).toEqual([]);
    } finally { release(); }
  });

  for (const operation of ["assent", "withdraw", "export", "delete-record", "delete-account"] as const) {
    test(`${prefix || "zh"} 未广播换号时旧账户${operation}操作不能借用B会话`, async ({ page, baseURL }) => {
      const fixture = await mockAccount(page, baseURL!);
      const first = fixture.state.user;
      fixture.state.records = [syntheticRecord(first.id, "OLD_ACCOUNT_RECORD")];
      if (operation === "withdraw") fixture.state.consentState = "active";
      const downloads: string[] = [];
      page.on("download", (download) => downloads.push(download.suggestedFilename()));
      await page.goto(`${prefix}/account`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Account recovery");
      let button;
      if (operation === "assent") {
        await page.getByLabel(copy.account.consent.acknowledgement, { exact: true }).check();
        button = page.getByRole("button", { name: copy.account.consent.completeStudent, exact: true });
      } else if (operation === "withdraw") {
        button = page.getByRole("button", { name: copy.account.consent.withdraw, exact: true });
      } else if (operation === "delete-record") {
        button = page.locator("#records article").filter({ hasText: "OLD_ACCOUNT_RECORD" })
          .getByRole("button", { name: copy.account.records.delete, exact: true });
      } else {
        await page.locator("summary").filter({ hasText: copy.account.settings.title }).click();
        await page.getByRole("button", { name: copy.account.settings.data, exact: true }).click();
        if (operation === "delete-account") {
          await page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true }).fill(first.email);
          await page.getByLabel(copy.account.deletion.acknowledgement, { exact: true }).check();
        }
        button = page.getByRole("button", { name: operation === "export" ? copy.account.dataExport.action : copy.account.deletion.action, exact: true });
      }
      await expect(button).toBeEnabled();
      const before = fixture.state.requests.length;
      await switchAccount(page, fixture, syntheticUser("00000000-0000-4000-8000-000000000092", "Second account"), false);
      await button.click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Second account");
      const sideEffects = fixture.state.requests.slice(before).filter((request) => request.method !== "GET"
        || request.path === "/api/account/data");
      expect(sideEffects.filter((request) => !request.path.startsWith("/api/monitoring/"))).toEqual([]);
      expect(downloads).toEqual([]);
      expect(fixture.state.records.some((record) => record.user_id === first.id)).toBe(true);
      expect(fixture.state.externalRequests).toEqual([]);
    });
  }

  test(`${prefix || "zh"} 本人账户确认、撤回、删除记录和导出仍正常完成`, async ({ page, baseURL }) => {
    const fixture = await mockAccount(page, baseURL!);
    const owner = fixture.state.user.id;
    fixture.state.records = [syntheticRecord(owner, "OWN_RECORD_FOR_DELETE")];
    await page.goto(`${prefix}/account`);
    const acknowledgement = page.getByLabel(copy.account.consent.acknowledgement, { exact: true });
    await acknowledgement.check();
    await page.getByRole("button", { name: copy.account.consent.completeStudent, exact: true }).click();
    await expect(page.getByText(copy.account.notices.studentAssentRecorded, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy.account.consent.withdraw, exact: true }).click();
    await expect(page.getByText(copy.account.notices.consentWithdrawn, { exact: true })).toBeVisible();
    await expect(acknowledgement).not.toBeChecked();
    const card = page.locator("#records article").filter({ hasText: "OWN_RECORD_FOR_DELETE" });
    await card.getByRole("button", { name: copy.account.records.delete, exact: true }).click();
    await expect(page.getByText(copy.account.notices.recordDeleted, { exact: true })).toBeVisible();
    await expect(card).toHaveCount(0);
    expect(fixture.state.records).toEqual([]);
    await page.locator("summary").filter({ hasText: copy.account.settings.title }).click();
    await page.getByRole("button", { name: copy.account.settings.data, exact: true }).click();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: copy.account.dataExport.action, exact: true }).click();
    expect((await downloaded).suggestedFilename()).toBe("synthetic-account-export.json");
    await expect(page.getByText(copy.account.notices.exportStarted, { exact: true })).toBeVisible();
    const actions = fixture.state.requests.filter((request) => request.method !== "GET" || request.path === "/api/account/data")
      .filter((request) => !request.path.startsWith("/api/monitoring/"));
    expect(actions).toEqual(expect.arrayContaining([
      { path: "/api/account/consent", method: "POST", actor: owner },
      { path: "/api/account/consent", method: "DELETE", actor: owner },
      { path: "/rest/v1/sweet_records", method: "DELETE", actor: owner },
      { path: "/api/account/data", method: "GET", actor: owner },
    ]));
    expect(actions.every((request) => request.actor === owner)).toBe(true);
    expect(fixture.state.externalRequests).toEqual([]);
  });

  test(`${prefix || "zh"} 本人账户昵称保存和注销保留正常路径`, async ({ page, baseURL }) => {
    const fixture = await mockAccount(page, baseURL!);
    await page.goto(`${prefix}/account`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Account recovery");
    await page.locator("summary").filter({ hasText: copy.account.settings.title }).click();
    await page.getByLabel(copy.account.profile.name, { exact: true }).fill("Updated own name");
    await page.getByRole("button", { name: copy.account.actions.saveProfile, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Updated own name");
    await expect(page.getByText(copy.account.notices.profileSaved, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy.account.settings.data, exact: true }).click();
    await page.getByLabel(copy.account.deletion.emailConfirmation, { exact: true }).fill(fixture.state.user.email);
    await page.getByLabel(copy.account.deletion.acknowledgement, { exact: true }).check();
    await page.getByRole("button", { name: copy.account.deletion.action, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: copy.account.visitor.title })).toBeVisible();
    await expect(page.getByText(copy.account.notices.accountDeleted, { exact: true })).toBeVisible();
    expect(fixture.state.requests).toEqual(expect.arrayContaining([
      { path: "/rest/v1/profiles", method: "PATCH", actor: fixture.state.user.id },
      { path: "/api/account/data", method: "DELETE", actor: fixture.state.user.id },
    ]));
    expect(fixture.state.externalRequests).toEqual([]);
  });
}
