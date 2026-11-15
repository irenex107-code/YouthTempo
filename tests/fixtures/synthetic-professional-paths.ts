import { expect, type Page, type Route } from "@playwright/test";

type Actor = "provider-a" | "provider-b";
type Intercept = (route: Route) => Promise<void> | void;

export function syntheticApplication(actor = "provider-a", category = "counselor", status = "pending") {
  return { category, status, legal_name: `${actor} legal name`, credential_type: "Synthetic qualification",
    credential_number: `${actor}-credential`, evidence_path: null, service_languages: ["zh-CN", "en"],
    age_scopes: ["18_plus"], service_scope: "Synthetic listening support", availability: "Synthetic availability",
    institution_name: `${actor} institution`, boundaries_confirmed: true, crisis_rules_confirmed: true,
    privacy_rules_confirmed: true, review_note: null };
}

export function syntheticVerification(actor = "provider-a", status = "pending") {
  return { status, institutionName: `${actor} institution`, positionTitle: `${actor} position`, credentialType: "Synthetic qualification",
    credentialNumber: `${actor}-credential`, credentialIssuer: "Synthetic issuer", credentialExpiresOn: null,
    evidenceReference: "Synthetic evidence reference", applicantStatement: "Synthetic statement", submittedAt: "2026-10-28T01:00:00Z",
    reviewedAt: null, reviewNote: null, legacyConfirmed: false };
}

export function syntheticAssignment(actor = "provider-a", status = "accepted", caseStatus = "active") {
  return { id: `${actor}-assignment`, caseId: `${actor}-case`, role: "primary", status,
    caseType: "adult_consultation", caseStatus, createdAt: "2026-10-28T01:00:00Z", needSummary: `${actor} private summary`,
    availability: `${actor} private availability`, appointmentAt: "2026-11-01T01:00:00Z", appointmentStatus: "proposed" };
}

/** Browser responses only. Every Auth, Data API and app request is intercepted. */
export async function syntheticProfessionalPaths(page: Page, baseURL: string, options: {
  signedIn?: boolean; student?: boolean; consentActive?: boolean; ageBand?: "14_17" | "18_plus";
} = {}) {
  expect(new URL(baseURL).hostname).toBe("127.0.0.1");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  expect(supabaseUrl && new URL(supabaseUrl).hostname).toBe("youthtempo-synthetic.invalid.supabase.co");
  const key = `sb-${new URL(supabaseUrl!).hostname.split(".")[0]}-auth-token`;
  const origin = new URL(baseURL).origin;
  let actor: Actor | null = options.signedIn === false ? null : "provider-a";
  let consentActive = options.consentActive !== false;
  const ageBand = options.ageBand || "18_plus";
  const user = (id: Actor) => ({ id, email: `${id}@example.invalid`, role: "authenticated", aud: "authenticated",
    app_metadata: {}, user_metadata: { display_name: id }, created_at: "2026-01-01T00:00:00Z" });
  const session = (id: Actor) => ({ access_token: `synthetic-${id}-token`, refresh_token: `synthetic-${id}-refresh`,
    token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, user: user(id) });
  const requests: Array<{ path: string; method: string; authorization: string; body: Record<string, unknown> | null }> = [];
  const blocked: string[] = [];
  const interceptors = new Map<string, Intercept>();
  if (actor) await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key, session: session(actor) });
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    blocked.push(`external ${new URL(route.request().url()).origin}`);
    return route.abort();
  });
  await page.route("**/auth/v1/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/user") && actor) return route.fulfill({ json: user(actor) });
    blocked.push(`Auth ${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.abort();
  });
  await page.route("**/rest/v1/**", (route) => {
    if (route.request().method() !== "GET") { blocked.push("Data API mutation"); return route.abort(); }
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body = request.headers()["content-type"]?.includes("application/json") && request.postData()
      ? request.postDataJSON() as Record<string, unknown> : null;
    requests.push({ path, method, authorization: request.headers().authorization || "", body });
    const intercept = interceptors.get(`${method} ${path}`);
    if (intercept) return intercept(route);
    if (path === "/api/account/consent" && method === "POST" && options.student && body?.action === "student_assent") {
      consentActive = true;
      return route.fulfill({ json: {} });
    }
    if (method !== "GET") { blocked.push(`${method} ${path}`); return route.abort(); }
    if (path === "/api/account/status") return route.fulfill({ json: {
      profile: actor ? { ...user(actor), display_name: actor, role: options.student ? "学生" : "专业支持者", school_id: null } : null,
      displayRole: options.student ? "学生" : "专业支持者", hasSchool: false, studentAgeBand: options.student ? ageBand : null,
      linkedChildren: [], linkedGuardians: [], assignedTeachers: [], assignedStudents: [], schoolMemberships: [],
    } });
    if (path === "/api/account/consent") return route.fulfill({ json: { role: options.student ? "student" : "other",
      policyVersion: "2026-08-28", children: [], consent: options.student ? {
        studentUserId: actor, studentName: actor, ageBand, policyVersion: "2026-08-28", status: consentActive ? "active" : "withdrawn",
        consentBasis: ageBand === "18_plus" ? "adult_self" : "student_self_pilot", hasLinkedGuardian: false,
        studentAssentedAt: consentActive ? "2026-10-28T01:00:00Z" : null, guardianUserId: null, guardianConsentedAt: null,
        withdrawnAt: consentActive ? null : "2026-10-27T01:00:00Z",
      } : null } });
    if (path === "/api/support/staff") return route.fulfill({ json: { application: syntheticApplication(actor || "provider-a") } });
    if (path === "/api/support/staff-cases") return route.fulfill({ json: { assignments: [syntheticAssignment(actor || "provider-a")] } });
    if (path === "/api/professional-verification") return route.fulfill({ json: { verification: syntheticVerification(actor || "provider-a") } });
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
