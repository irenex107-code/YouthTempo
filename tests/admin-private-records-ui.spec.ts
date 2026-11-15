import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

type StaffRole = "teacher" | "lead" | "platform";
const schoolId = "00000000-0000-4000-8000-000000000081";
const teacherId = "00000000-0000-4000-8000-000000000082";
const student = { id: "00000000-0000-4000-8000-000000000083", display_name: "Synthetic assigned student", email: "student@example.invalid", school_id: schoolId };
const privateMarker = "PRIVATE_SWEET_BODY_MUST_NOT_RENDER";

async function syntheticStaff(page: Page, baseURL: string, kind: StaffRole, confirmed = true) {
  const origin = new URL(baseURL).origin;
  expect(new URL(baseURL).hostname).toBe("127.0.0.1");
  const role = kind === "platform" ? "平台管理员" : kind === "lead" ? "学校负责人" : "支持老师";
  const user = { id: kind === "teacher" ? teacherId : `00000000-0000-4000-8000-00000000008${kind === "lead" ? "4" : "5"}`,
    email: `${kind}@example.invalid`, role: "authenticated", aud: "authenticated", app_metadata: {},
    user_metadata: { display_name: "Synthetic staff" }, created_at: "2026-01-01T00:00:00Z" };
  const profile = { id: user.id, email: user.email, display_name: "Synthetic staff", role: "学校支持人员", school_id: schoolId };
  const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co").hostname.split(".")[0];
  await page.addInitScript(({ projectRef, user }) => {
    localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify({
      access_token: "synthetic-admin-boundary-token", refresh_token: "synthetic-admin-boundary-refresh",
      token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, { projectRef, user });
  const external: string[] = [];
  const unexpected: string[] = [];
  const apiReads: string[] = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    external.push(url.origin);
    return route.abort();
  });
  await page.route("**/auth/v1/**", (route) => new URL(route.request().url()).pathname.endsWith("/user")
    ? route.fulfill({ json: user }) : route.abort());
  await page.route("**/rest/v1/**", (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") { unexpected.push("Data API mutation"); return route.abort(); }
    return route.fulfill({ json: url.pathname.endsWith("/profiles") ? [profile] : [] });
  });
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (route.request().method() !== "GET") { unexpected.push(`${route.request().method()} ${pathname}`); return route.abort(); }
    apiReads.push(pathname);
    if (pathname === "/api/account/status") return route.fulfill({ json: {
      profile, displayRole: role, adminAccess: { role, scope: kind === "platform" ? "platform" : "school" },
      hasSchool: true, studentAgeBand: null, linkedChildren: [], assignedStudents: kind === "teacher" ? [student] : [],
      assignedTeachers: [], linkedGuardians: [], schoolMemberships: [],
    } });
    if (pathname === "/api/account/consent") return route.fulfill({ json: { role: "other", policyVersion: "2026-08-28", consent: null, children: [] } });
    if (pathname === "/api/admin/overview") return route.fulfill({ json: {
      ...(confirmed ? { privateRecordsRestricted: true } : {}),
      admin: { email: user.email, role, status: "active", scope: kind === "platform" ? "platform" : "school", canManageMembers: kind !== "teacher" },
      counts: { profiles: 2, schoolUsers: 2, sweetRecords: 999, schools: 1, schoolMembers: 1, wechatBindings: 0 },
      schools: [{ id: schoolId, name: "Synthetic school", status: "active", created_at: "2026-01-01T00:00:00Z" }],
      schoolDirectories: kind === "teacher" ? [] : [{ school_id: schoolId, leaders: [], teachers: [{ id: teacherId, display_name: "Synthetic teacher", email: "teacher@example.invalid" }],
        students: [student], guardians: [], professionals: [], assignments: [{ teacher_user_id: teacherId, student_user_id: student.id }], guardianAssignments: [] }],
      // Old fields deliberately contain synthetic sentinels: removing their UI
      // must keep them invisible even if an older response is accidentally mixed in.
      recentRecords: [{ id: "legacy-record", user_id: student.id, records: [], summary: privateMarker, preview: privateMarker, created_at: "2026-01-01T00:00:00Z" }],
      attentionQueue: [{ id: "legacy-attention", user_id: student.id, summary: privateMarker, followup_note: privateMarker }],
      teacherWeeklySummaries: [], schoolMonthlyTrends: [], studentParticipationStats: [],
    } });
    if (pathname === "/api/admin/teacher-student-assignments") return route.fulfill({ json: { schoolId, teachers: [], students: [student], guardians: [], leaders: [], assignments: [], guardianAssignments: [] } });
    if (pathname === "/api/admin/message-duty") return route.fulfill({ json: { enabled: false, emailConfigured: false,
      counts: { total: 0, new: 0, inProgress: 0, safetyReview: 0, alertProblems: 0 }, messages: [] } });
    if (pathname === "/api/admin/community-moderation") return route.fulfill({ json: { counts: { total: 0, safetyReview: 0, reports: 0 }, items: [], history: [] } });
    if (pathname === "/api/admin/community-restrictions") return route.fulfill({ json: { restrictions: [] } });
    if (pathname === "/api/admin/pilot-feedback") return route.fulfill({ json: { counts: { total: 0, student: 0, guardian: 0, teacher: 0 },
      averages: { overallExperience: null, clarity: null, safety: null }, feedback: [] } });
    if (pathname === "/api/admin/pilot-experience") return route.fulfill({ json: { sampleLimited: true, people: 0, submissions: 0,
      byFeature: {}, byAge: {}, ratios: { helpful: null, wouldReturn: null, wantsHumanSupport: null }, pendingSafety: 0, comments: [] } });
    if (pathname === "/api/admin/professional-verifications") return route.fulfill({ json: { verifications: [] } });
    if (pathname === "/api/wechat/check-bind-session") return route.fulfill({ json: { identities: [] } });
    unexpected.push(pathname);
    return route.abort();
  });
  return { external, unexpected, apiReads };
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  for (const kind of ["teacher", "lead", "platform"] as const) {
    test(`${prefix || "zh"}/${kind} 合成角色保留目录与独立安全入口，不渲染私人记录和参与跟进`, async ({ page, baseURL }, testInfo) => {
      const requests = await syntheticStaff(page, baseURL!, kind);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${prefix}/admin`);
      await expect(page.locator("#private-records-boundary")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", prefix ? "en" : "zh-CN");
      await expect(page.locator("#private-records-boundary")).toContainText(copy.adminPrivateRecords.description);
      await expect(page.getByText(copy.adminPrivateRecords.restrictedValue, { exact: true })).toBeVisible();
      await expect(page.locator("main")).not.toContainText(privateMarker);
      for (const id of ["recent-records", "recent-changes", "participation-stats", "weekly-summary", "monthly-trends", "operations-analytics"]) {
        await expect(page.locator(`#${id}`)).toHaveCount(0);
        await expect(page.locator(`main a[href$='#${id}']`)).toHaveCount(0);
      }
      if (kind === "platform") {
        await expect(page.locator("#message-duty")).toBeAttached();
        await expect(page.locator("#community-moderation")).toBeAttached();
        await expect(page.locator(`main a[href='${prefix}/admin/support']`)).toBeVisible();
        await expect(page.locator(`main a[href='${prefix}/admin/peer-space']`)).toBeVisible();
        await expect.poll(() => requests.apiReads.includes("/api/admin/message-duty") && requests.apiReads.includes("/api/admin/community-moderation")).toBe(true);
      }
      if (kind !== "teacher") {
        await expect(page.locator("#schools-overview")).toContainText(copy.adminPrivateRecords.directoryTitle);
        await expect(page.locator("#schools-overview")).toContainText("Synthetic assigned student");
      }
      await expect.poll(() => page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        return { overflow: document.documentElement.scrollWidth > width, width, scrollWidth: document.documentElement.scrollWidth,
          offenders: [...document.querySelectorAll("body *")].filter((element) => element.getBoundingClientRect().right > width + 1)
            .slice(-8).map((element) => ({ tag: element.tagName, id: element.id, className: element.className, right: element.getBoundingClientRect().right, text: element.textContent?.slice(0, 100) })) };
      })).toEqual(expect.objectContaining({ overflow: false }));
      if (kind === "teacher") {
        const directory = path.join(process.cwd(), "deliverables/reports-db-2026-10-27");
        await mkdir(directory, { recursive: true });
        await page.screenshot({ path: path.join(directory, `admin-boundary-${prefix ? "en" : "zh-CN"}-${testInfo.project.name}.png`), fullPage: true });
        await page.goto(`${prefix}/account#students`);
        await expect(page.locator("#students")).toContainText("Synthetic assigned student");
        await expect(page.locator("#students")).toContainText(copy.adminPrivateRecords.directoryPrivateBoundary);
        await expect(page.locator("#students a[href='#records']")).toHaveCount(0);
        await expect(page.locator("#records")).toBeAttached();
      }
      expect(requests.apiReads).not.toContain("/api/admin/followups");
      expect(requests.external).toEqual([]);
      expect(requests.unexpected).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test(`${prefix || "zh"} 缺少私人边界确认的旧overview不能装载工作台`, async ({ page, baseURL }) => {
    const requests = await syntheticStaff(page, baseURL!, "platform", false);
    await page.goto(`${prefix}/admin`);
    await expect(page.getByText(copy.adminPrivateRecords.scopeUnconfirmed, { exact: true })).toBeVisible();
    await expect(page.locator("#private-records-boundary")).toHaveCount(0);
    await expect(page.locator("#message-duty")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(privateMarker);
    expect(requests.apiReads).not.toContain("/api/admin/message-duty");
    expect(requests.external).toEqual([]);
    expect(requests.unexpected).toEqual([]);
  });
}
