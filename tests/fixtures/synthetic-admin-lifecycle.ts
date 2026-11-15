import { expect, type Page, type Route } from "@playwright/test";

export const adminSchools = ["school-a", "school-b"] as const;
type Actor = "admin-a" | "admin-b" | "student";
type Intercept = (route: Route) => Promise<void> | void;

function user(actor: Actor) {
  return { id: actor, email: `${actor}@example.invalid`, role: "authenticated", aud: "authenticated", app_metadata: {},
    user_metadata: { display_name: actor }, created_at: "2026-01-01T00:00:00Z" };
}

export function adminRoster(schoolId: string) {
  return { teachers: [{ id: `${schoolId}-teacher`, display_name: `${schoolId} teacher`, email: `${schoolId}-teacher@example.invalid` }],
    students: [{ id: `${schoolId}-student`, display_name: `${schoolId} student`, email: `${schoolId}-student@example.invalid` }],
    guardians: [], professionals: [], assignments: [], guardianAssignments: [] };
}

export function adminOverview(actor: Actor) {
  return { privateRecordsRestricted: true,
    admin: { email: `${actor}@example.invalid`, role: "平台管理员", status: "active", scope: "platform", canManageMembers: true },
    counts: { profiles: 4, schoolUsers: 4, sweetRecords: null, schools: 2, schoolMembers: 2, wechatBindings: 0 },
    schools: adminSchools.map((id) => ({ id, name: `${actor} ${id}`, status: "active", created_at: "2026-01-01T00:00:00Z" })),
    schoolDirectories: adminSchools.map((id) => ({ school_id: id, leaders: [], ...adminRoster(id) })),
    recentRecords: [], attentionQueue: [], teacherWeeklySummaries: [], schoolMonthlyTrends: [], studentParticipationStats: [] };
}

/** All identities and API data are synthetic. No fixture reset, email or database access. */
export async function syntheticAdminLifecycle(page: Page, baseURL: string) {
  expect(new URL(baseURL).hostname).toBe("127.0.0.1");
  const origin = new URL(baseURL).origin;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://youthtempo-synthetic.invalid.supabase.co";
  expect(new URL(supabaseUrl).hostname).toBe("youthtempo-synthetic.invalid.supabase.co");
  const key = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  let actor: Actor | null = "admin-a";
  const requests: Array<{ path: string; method: string; authorization: string; body: Record<string, unknown> | null }> = [];
  const blocked: string[] = [];
  const interceptors = new Map<string, Intercept>();
  const session = (id: Actor) => ({ access_token: `synthetic-${id}-token`, refresh_token: `synthetic-${id}-refresh`,
    token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, user: user(id) });
  await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key, session: session("admin-a") });
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    blocked.push(`external ${new URL(route.request().url()).origin}`);
    return route.abort();
  });
  await page.route("**/auth/v1/**", (route) => {
    if (new URL(route.request().url()).origin !== new URL(supabaseUrl).origin) {
      blocked.push("Unexpected Auth origin");
      return route.abort();
    }
    if (new URL(route.request().url()).pathname.endsWith("/user") && actor) return route.fulfill({ json: user(actor) });
    blocked.push(`Auth ${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.abort();
  });
  await page.route("**/rest/v1/**", (route) => {
    if (new URL(route.request().url()).origin !== new URL(supabaseUrl).origin) {
      blocked.push("Unexpected Data API origin");
      return route.abort();
    }
    if (route.request().method() !== "GET") { blocked.push("Data API mutation"); return route.abort(); }
    return route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/profiles") && actor
      ? [{ ...user(actor), role: actor === "student" ? "学生" : "学校支持人员", display_name: actor }] : [] });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    requests.push({ path, method, authorization: request.headers().authorization || "", body: request.postDataJSON() });
    const intercept = interceptors.get(`${method} ${path}`);
    if (intercept) return intercept(route);
    if (method !== "GET") { blocked.push(`${method} ${path}`); return route.abort(); }
    if (path === "/api/account/status") return route.fulfill({ json: {
      profile: actor ? { ...user(actor), display_name: actor, role: actor === "student" ? "学生" : "学校支持人员" } : null,
      displayRole: actor === "student" ? "学生" : "平台管理员", adminAccess: actor && actor !== "student" ? { role: "平台管理员", scope: "platform" } : null,
      hasSchool: true, studentAgeBand: null, linkedChildren: [], assignedStudents: [], assignedTeachers: [], linkedGuardians: [], schoolMemberships: [],
    } });
    if (path === "/api/account/consent") return route.fulfill({ json: { role: "other", policyVersion: "2026-08-28", consent: null, children: [] } });
    if (path === "/api/admin/overview") return actor && actor !== "student" ? route.fulfill({ json: adminOverview(actor) })
      : route.fulfill({ status: 403, json: { error: "需要管理权限" } });
    if (path === "/api/admin/teacher-student-assignments") return route.fulfill({ json: adminRoster(url.searchParams.get("schoolId")!) });
    if (path === "/api/admin/message-duty") return route.fulfill({ json: { enabled: false, emailConfigured: false,
      counts: { total: 0, new: 0, inProgress: 0, safetyReview: 0, alertProblems: 0 }, messages: [] } });
    if (path === "/api/admin/community-moderation") return route.fulfill({ json: { counts: { total: 0, safetyReview: 0, reports: 0 }, items: [], history: [] } });
    if (path === "/api/admin/community-restrictions") return route.fulfill({ json: { restrictions: [] } });
    if (path === "/api/admin/pilot-feedback") return route.fulfill({ json: { counts: { total: 0, student: 0, guardian: 0, teacher: 0 },
      averages: { overallExperience: null, clarity: null, safety: null }, feedback: [] } });
    if (path === "/api/admin/pilot-experience") return route.fulfill({ json: { sampleLimited: true, people: 0, submissions: 0,
      byFeature: {}, byAge: {}, ratios: { helpful: null, wouldReturn: null, wantsHumanSupport: null }, pendingSafety: 0, comments: [] } });
    if (path === "/api/admin/professional-verifications") return route.fulfill({ json: { verifications: [] } });
    if (path === "/api/wechat/check-bind-session") return route.fulfill({ json: { identities: [] } });
    blocked.push(`${method} ${path}`);
    return route.abort();
  });
  return { requests, blocked, interceptors,
    async switchActor(next: Actor | null, broadcast = true) {
      actor = next;
      await page.evaluate(({ key, session, broadcast }) => {
        if (session) localStorage.setItem(key, JSON.stringify(session)); else localStorage.removeItem(key);
        if (broadcast) {
          const channel = new BroadcastChannel(key);
          channel.postMessage({ event: session ? "SIGNED_IN" : "SIGNED_OUT", session });
          channel.close();
        }
      }, { key, session: next ? session(next) : null, broadcast });
    },
  };
}
