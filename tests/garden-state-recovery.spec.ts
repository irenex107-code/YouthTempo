import { expect, test, type Page } from "@playwright/test";
import type { TempoGardenData } from "@/lib/cloudRecords";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

const projectRef = new URL(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co",
).hostname.split(".")[0];

type SyntheticGardenOptions = {
  data?: Partial<TempoGardenData>;
  refreshFailures?: number;
  postResult?: "saved" | "rejected" | "lost_response";
  forbidden?: boolean;
  role?: "学生" | "平台管理员";
};

// All authentication and application responses are synthetic. No fixture or database is used.
async function useSyntheticGarden(page: Page, options: SyntheticGardenOptions = {}) {
  const user = {
    id: "00000000-0000-4000-8000-000000000017",
    aud: "authenticated",
    role: "authenticated",
    email: "garden-state@example.invalid",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  };
  let data: TempoGardenData = {
    stage: "seed", sceneLevel: "base", total: 0, thisWeek: 0, thisMonth: 0,
    quickCheckIns: 0, fullSweetRecords: 0, todayParticipated: false,
    unlockedPositions: [], unlockedItems: [], reminderMode: "off",
    canCareToday: false, canAddKeepsakeToday: false, todayCare: null,
    layout: {}, keepsakes: [], ...options.data,
  };
  let posts = 0;
  let reads = 0;
  let refreshFailures = options.refreshFailures || 0;
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: expiresAt, role: "authenticated" })).toString("base64url")}.synthetic-signature`;

  await page.addInitScript(({ key, user, accessToken, expiresAt }) => {
    window.localStorage.setItem(key, JSON.stringify({
      access_token: accessToken,
      refresh_token: "synthetic-garden-state-refresh",
      token_type: "bearer", expires_in: 3600,
      expires_at: expiresAt, user,
    }));
    window.localStorage.setItem(`youthtempo:garden:intro:v2:${user.id}`, "seen");
  }, { key: `sb-${projectRef}-auth-token`, user, accessToken, expiresAt });
  const appOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").origin;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === appOrigin ? route.continue() : route.abort();
  });
  await page.route("**/auth/v1/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/user")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    } else {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Synthetic authentication only" }) });
    }
  });
  await page.route("**/rest/v1/**", (route) => route.abort());
  await page.route("**/storage/v1/**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const respond = (body: unknown, status = 200) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify(body),
    });
    if (pathname === "/api/account/status") {
      return respond({ profile: { id: user.id, display_name: "Garden fixture", role: options.role || "学生" }, displayRole: options.role || "学生", hasSchool: false, adminAccess: null });
    }
    if (pathname === "/api/account/consent") return respond({
      role: options.role === "平台管理员" ? "other" : "student",
      policyVersion: "2026-08-28", children: [],
      consent: options.role === "平台管理员" ? null : {
        studentUserId: user.id, studentName: "Garden fixture", policyVersion: "2026-08-28",
        ageBand: "14_17", consentBasis: "student_self_pilot", status: "active",
        studentAssentedAt: "2026-10-28T04:00:00Z", guardianUserId: null, guardianConsentedAt: null,
        withdrawnAt: null, hasLinkedGuardian: false,
      },
    });
    if (pathname === "/api/pilot-experience") return respond({ eligible: false });
    if (pathname === "/api/garden") {
      if (method === "POST") {
        posts += 1;
        if (options.postResult === "rejected") return respond({ error: "The garden is temporarily unavailable." }, 503);
        data = {
          ...data, stage: "sprout", total: 1, thisWeek: 1, thisMonth: 1,
          quickCheckIns: data.quickCheckIns + 1, todayParticipated: true,
          canCareToday: true, canAddKeepsakeToday: true,
        };
        if (options.postResult === "lost_response") return route.abort("failed");
        return respond({ checkIn: { id: "synthetic-check-in", created_at: "2026-10-26T04:00:00Z" } }, 201);
      }
      if (method === "GET") {
        reads += 1;
        if (options.forbidden) return respond({ error: "Student access required." }, 403);
        if (posts > 0 && refreshFailures > 0) {
          refreshFailures -= 1;
          return respond({ error: "The garden is temporarily unavailable." }, 503);
        }
        return respond(data);
      }
    }
    if (pathname === "/api/garden/keepsakes" && method === "POST") {
      const { type } = route.request().postDataJSON() as { type: "flower" | "stone" | "lantern" };
      const keepsake = { id: "00000000-0000-4000-8000-000000000099", date: "2026-10-26", type };
      data = { ...data, canAddKeepsakeToday: false, keepsakes: [keepsake] };
      return respond({ keepsake, created: true }, 201);
    }
    if (pathname.startsWith("/api/garden/keepsakes/") && method === "DELETE") {
      const id = pathname.split("/").at(-1);
      data = { ...data, canAddKeepsakeToday: true, keepsakes: [] };
      return respond({ id, deleted: true });
    }
    return respond({ error: "No synthetic response for this request." }, 404);
  });
  return { posts: () => posts, reads: () => reads };
}

const locales = [
  {
    locale: "zh-CN", path: "/garden", record: "记录", feeling: "有些沉重", submit: "记录这一刻", close: "关闭",
    careTitle: "今天想怎样照料？", keepsakes: "看看纪念物", flower: "一朵花", remove: "移除",
    unavailable: "今天记录后，可以选择一个纪念物。已有纪念物仍会保留。",
    available: "今天有一条参与记录，可以选择一个纪念物。每天最多保存一个。",
    completed: "今天的纪念物已经保留，可以在下方查看或移除。",
    savedPending: "这一刻已保存，但花园暂时还没更新。请刷新花园，不用再次提交。",
    unconfirmed: "暂时无法确认这次记录是否保存。请先刷新花园查看当前状态，避免重复提交。",
    refreshedUnconfirmed: "花园已刷新，但仍无法确认刚才那次记录是否保存。再次提交可能产生重复记录。",
    saved: "这一刻已记下。", refresh: "刷新花园", account: "查看账户确认状态",
    restricted: "花园只向已完成适用知情确认的学生账号开放。管理员账号不能读取学生的私人花园。",
    nextStep: "如果你是学生，请到“我的账户”查看资料及知情确认状态。其他身份目前不能使用私人花园。",
  },
  {
    locale: "en", path: "/en/garden", record: "Record", feeling: "A little heavy", submit: "Record this moment", close: "Close",
    careTitle: "How would you like to care today?", keepsakes: "View keepsakes", flower: "A flower", remove: "Remove",
    unavailable: "Record a moment today to choose a keepsake. Your existing keepsakes will stay here.",
    available: "You have a participation record today, so you can choose one keepsake. You can save one per day.",
    completed: "You have a keepsake for today. You can view or remove it below.",
    savedPending: "This moment is saved, but your garden has not updated yet. Refresh the garden; you do not need to submit again.",
    unconfirmed: "We could not confirm whether this record was saved. Refresh the garden to check its current state before submitting again.",
    refreshedUnconfirmed: "Your garden has refreshed, but we still cannot confirm whether that record was saved. Submitting again may create a duplicate.",
    saved: "This moment is saved.", refresh: "Refresh garden", account: "Check account consent status",
    restricted: "The garden is available to student accounts with active consent. Administrator accounts cannot read a student's private garden.",
    nextStep: "If you are a student, check your profile and consent status in My account. Other roles cannot use a private garden at this time.",
  },
] as const;

for (const copy of locales) {
  test(`${copy.locale} 保存成功后刷新失败只重读，不重复提交`, async ({ page }) => {
    const requests = await useSyntheticGarden(page, { refreshFailures: 2 });
    await page.goto(copy.path);
    await page.getByRole("button", { name: copy.record, exact: true }).click();
    await page.getByRole("radio", { name: copy.feeling, exact: true }).check();
    await page.getByRole("button", { name: copy.submit, exact: true }).click();
    await expect(page.getByText(copy.savedPending, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.submit, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.record, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: copy.refresh, exact: true }).click();
    await expect(page.getByRole("button", { name: copy.refresh, exact: true })).toBeEnabled();
    await expect(page.getByText(copy.savedPending, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy.refresh, exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("garden-care-invitation")).toHaveText(copy.locale === "en" ? en.garden.care.available : zh.garden.care.available);
    await page.getByRole("button", { name: copy.locale === "en" ? en.garden.actions.care : zh.garden.actions.care, exact: true }).click();
    await expect(page.getByRole("heading", { name: copy.careTitle, exact: true })).toBeVisible();
    await expect(page.getByText(copy.savedPending, { exact: true })).toHaveCount(0);
    expect(requests.posts()).toBe(1);
    expect(requests.reads()).toBe(4);
  });

  for (const postResult of ["rejected", "lost_response"] as const) {
    test(`${copy.locale} ${postResult} 不把结果未确认说成保存成功`, async ({ page }) => {
      const requests = await useSyntheticGarden(page, { postResult });
      await page.goto(copy.path);
      await page.getByRole("button", { name: copy.record, exact: true }).click();
      await page.getByRole("radio", { name: copy.feeling, exact: true }).check();
      await page.getByRole("button", { name: copy.submit, exact: true }).click();
      await expect(page.getByText(copy.unconfirmed, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.saved, { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: copy.refresh, exact: true }).click();
      await expect(page.getByText(copy.refreshedUnconfirmed, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.saved, { exact: true })).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(requests.posts()).toBe(1);
      expect(requests.reads()).toBe(2);
    });
  }

  test(`${copy.locale} 纪念物未记录、可创建、已保存及删除后状态准确`, async ({ page }) => {
    await useSyntheticGarden(page);
    await page.goto(copy.path);
    await page.locator("[data-garden-options] > summary").click();
    await page.getByRole("button", { name: copy.keepsakes, exact: true }).click();
    await expect(page.getByRole("dialog").getByText(copy.unavailable, { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: copy.flower, exact: true })).toBeDisabled();
    await page.getByRole("button", { name: copy.close, exact: true }).click();
    await page.getByRole("button", { name: copy.record, exact: true }).click();
    await page.getByRole("radio", { name: copy.feeling, exact: true }).check();
    await page.getByRole("button", { name: copy.submit, exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("garden-care-invitation")).toHaveText(copy.locale === "en" ? en.garden.care.available : zh.garden.care.available);
    await page.getByRole("button", { name: copy.locale === "en" ? en.garden.actions.care : zh.garden.actions.care, exact: true }).click();
    await expect(page.getByRole("heading", { name: copy.careTitle, exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy.close, exact: true }).click();
    await page.getByRole("button", { name: copy.keepsakes, exact: true }).click();
    await expect(page.getByRole("dialog").getByText(copy.available, { exact: true })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: copy.flower, exact: true }).click();
    await expect(page.getByRole("dialog").getByText(copy.completed, { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByText(copy.unavailable, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog").getByRole("button", { name: copy.flower, exact: true })).toBeDisabled();
    await page.getByRole("dialog").getByRole("button", { name: copy.remove, exact: true }).click();
    await expect(page.getByRole("dialog").getByText(copy.available, { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: copy.flower, exact: true })).toBeEnabled();
  });

  test(`${copy.locale} 读取已有今日纪念物时不提示重新记录`, async ({ page }) => {
    await useSyntheticGarden(page, { data: {
      stage: "sprout", total: 1, thisWeek: 1, thisMonth: 1, todayParticipated: true,
      keepsakes: [{ id: "00000000-0000-4000-8000-000000000099", date: "2026-10-26", type: "flower" }],
    } });
    await page.goto(copy.path);
    await page.locator("[data-garden-options] > summary").click();
    await page.getByRole("button", { name: copy.keepsakes, exact: true }).click();
    await expect(page.getByRole("dialog").getByText(copy.completed, { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByText(copy.unavailable, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog").getByRole("button", { name: copy.flower, exact: true })).toBeDisabled();
  });

  for (const role of ["学生", "平台管理员"] as const) {
    test(`${copy.locale} ${role} 受限时保留适用角色说明并在原页核对状态`, async ({ page }) => {
      const requests = await useSyntheticGarden(page, { forbidden: true, role });
      const dictionary = copy.locale === "en" ? en : zh;
      await page.goto(copy.path);
      if (role === "学生") {
        await expect(page.locator("main [role='alert']")).toHaveText(copy.restricted);
        await expect(page.getByText(dictionary.garden.status.restrictedNextStep, { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: dictionary.inlineConsent.checkStatus, exact: true })).toBeVisible();
        expect(requests.reads()).toBe(1);
      } else {
        await expect(page.getByText(dictionary.inlineConsent.notStudent, { exact: true })).toBeVisible();
        expect(requests.reads()).toBe(0);
      }
      await expect(page.locator('a[href$="/account?next=garden"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: copy.record, exact: true })).toHaveCount(0);
      expect(requests.posts()).toBe(0);
    });
  }
}
