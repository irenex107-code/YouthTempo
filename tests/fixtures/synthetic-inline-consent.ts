import { expect, type Page } from "@playwright/test";
import { gardenStage } from "@/lib/tempoGarden";
import { unlockedGardenItems, unlockedGardenPositions } from "@/lib/gardenCatalog";

type AgeBand = "under_14" | "14_17" | "18_plus";
type ConsentState = "not_started" | "pending_guardian" | "active" | "withdrawn" | "ineligible";
type Scenario = {
  signedIn?: boolean;
  ageBand?: AgeBand;
  consentState?: ConsentState;
  displayName?: string;
  role?: string;
};

const firstId = "00000000-0000-4000-8000-000000000071";
const secondId = "00000000-0000-4000-8000-000000000072";
export const privateDiagnostic = "PRIVATE inline consent provider diagnostic";
export const draftCanary = "Synthetic draft kept only on this page, 71.";
export const resultCanary = "Synthetic grounded summary 71.";
export const inlineConsentTraffic = new WeakMap<Page, { blockedExternal: string[]; unexpectedApi: string[] }>();

function syntheticUser(id: string, displayName: string) {
  return {
    id, email: `inline-${id.slice(-3)}@example.invalid`, aud: "authenticated", role: "authenticated",
    app_metadata: {}, user_metadata: { display_name: displayName }, created_at: "2026-01-01T00:00:00Z",
  };
}

function syntheticSession(user: ReturnType<typeof syntheticUser>) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: expiresAt, role: "authenticated" })).toString("base64url");
  return {
    access_token: `${header}.${payload}.synthetic-signature`, refresh_token: "synthetic-inline-refresh",
    token_type: "bearer", expires_at: expiresAt, expires_in: 3600, user,
  };
}

// This fixture never connects to Auth, Data API, AI, email or a database.
// All APIs are handled locally and unexpected external requests are aborted.
export async function syntheticInlineConsent(page: Page, baseURL: string, scenario: Scenario = {}) {
  const state = {
    user: syntheticUser(firstId, scenario.displayName ?? "Inline preview"),
    signedIn: scenario.signedIn !== false,
    role: scenario.role ?? "学生",
    ageBand: scenario.ageBand ?? "14_17" as AgeBand,
    consentState: scenario.consentState ?? "not_started" as ConsentState,
    consentPolicy: "2026-08-28",
    consentOwner: firstId,
    consentReadFailure: false,
    consentPostFailure: null as "before" | "after" | null,
    consentGate: null as Promise<void> | null,
    aiGate: null as Promise<void> | null,
    consentGets: 0,
    consentPosts: [] as Array<Record<string, unknown>>,
    profileWrites: [] as Array<Record<string, unknown>>,
    aiCalls: [] as Array<Record<string, unknown>>,
    otpSends: 0,
    otpVerifies: 0,
    gardenReads: 0,
    gardenWrites: 0,
    unexpectedApi: [] as string[],
    blockedExternal: [] as string[],
  };
  inlineConsentTraffic.set(page, state);
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
  const ref = new URL(configuredUrl).hostname.split(".")[0];
  const storageKey = `sb-${ref}-auth-token`;
  await page.addInitScript(({ storageKey, session, userId }) => {
    if (session && !sessionStorage.getItem("synthetic-session-seeded")) {
      localStorage.setItem(storageKey, JSON.stringify(session));
      sessionStorage.setItem("synthetic-session-seeded", "1");
    }
    localStorage.setItem(`youthtempo:garden:intro:v2:${userId}`, "seen");
  }, { storageKey, session: state.signedIn ? syntheticSession(state.user) : null, userId: state.user.id });

  const origin = new URL(baseURL).origin;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    state.blockedExternal.push(url.origin);
    return route.abort();
  });
  await page.route("**/auth/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/user")) return route.fulfill(state.signedIn ? { json: state.user } : { status: 401, json: {} });
    if (path.endsWith("/otp")) {
      state.otpSends += 1;
      return route.fulfill({ json: {} });
    }
    if (path.endsWith("/verify")) {
      state.otpVerifies += 1;
      expect(route.request().postDataJSON()).toMatchObject({ token: "12345678", type: "email" });
      state.signedIn = true;
      return route.fulfill({ json: syntheticSession(state.user) });
    }
    if (path.endsWith("/logout")) {
      state.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    return route.abort();
  });
  await page.route("**/rest/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (pathname.endsWith("/profiles") && ["PATCH", "POST"].includes(method)) {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      state.profileWrites.push(payload);
      if (typeof payload.display_name === "string") state.user = syntheticUser(state.user.id, payload.display_name);
      return route.fulfill({ json: { id: state.user.id, role: state.role, display_name: state.user.user_metadata.display_name } });
    }
    if (pathname.endsWith("/profiles") && method === "GET") return route.fulfill({ json: [] });
    state.unexpectedApi.push(`REST ${method} ${pathname}`);
    await route.abort();
    throw new Error(`Unexpected synthetic Data API ${method} ${pathname}`);
  });
  await page.route("**/storage/v1/**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/account/status") return route.fulfill({ json: {
      displayRole: state.role,
      profile: { id: state.user.id, display_name: state.user.user_metadata.display_name, role: state.role, school_id: null },
      studentAgeBand: state.ageBand, hasSchool: false, adminAccess: null,
      linkedChildren: [], linkedGuardians: [], assignedTeachers: [], assignedStudents: [],
    } });
    if (pathname === "/api/account/consent") {
      const method = route.request().method();
      if (method === "GET") {
        state.consentGets += 1;
        if (state.consentReadFailure) return route.fulfill({ status: 503, json: { error: privateDiagnostic } });
      }
      if (method === "POST") {
        const payload = route.request().postDataJSON() as Record<string, unknown>;
        const postingActor = state.user.id;
        state.consentPosts.push(payload);
        expect(Object.keys(payload).sort()).toEqual(["action", "ageBand"]);
        expect(payload.action).toBe("student_assent");
        if (state.consentGate) await state.consentGate;
        if (state.consentPostFailure !== "before" && postingActor === state.user.id) {
          state.ageBand = payload.ageBand as AgeBand;
          state.consentState = state.ageBand === "under_14" ? "ineligible" : "active";
        }
        if (state.consentPostFailure) return route.fulfill({ status: 503, json: { error: privateDiagnostic } });
      }
      return route.fulfill({ json: {
        role: state.role === "学生" ? "student" : state.role === "家长" ? "guardian" : "other",
        policyVersion: state.consentPolicy,
        children: [],
        consent: state.role === "学生" ? {
          studentUserId: state.consentOwner, studentName: state.user.user_metadata.display_name,
          ageBand: state.ageBand, policyVersion: state.consentPolicy, status: state.consentState,
          consentBasis: state.ageBand === "18_plus" ? "adult_self" : state.ageBand === "under_14" ? "not_applicable" : state.consentState === "pending_guardian" ? "student_guardian" : "student_self_pilot",
          studentAssentedAt: ["active", "pending_guardian"].includes(state.consentState) ? "2026-11-01T00:00:00Z" : null,
          guardianUserId: null, guardianConsentedAt: null, withdrawnAt: null, hasLinkedGuardian: false,
        } : null,
      } });
    }
    if (pathname === "/api/ai/mood-journal") {
      state.aiCalls.push(route.request().postDataJSON() as Record<string, unknown>);
      if (state.aiGate) await state.aiGate;
      return route.fulfill({ json: {
        emotionReflection: resultCanary, possibleNeed: "Synthetic stated preference.",
        communicationSuggestion: "Synthetic communication template.", smallStep: "Synthetic processing scope.",
        supportReminder: "Synthetic support reminder.",
      } });
    }
    if (pathname === "/api/garden") {
      if (route.request().method() !== "GET") {
        state.gardenWrites += 1;
        return route.fulfill({ status: 500, json: { error: "Unexpected garden mutation" } });
      }
      state.gardenReads += 1;
      if (state.consentState !== "active") return route.fulfill({ status: 403, json: { error: "Consent required" } });
      const total = 3;
      return route.fulfill({ json: {
        total, stage: gardenStage(total), sceneLevel: "base", thisWeek: total, thisMonth: total,
        quickCheckIns: total, fullSweetRecords: 0, todayParticipated: false,
        unlockedPositions: unlockedGardenPositions(total), unlockedItems: unlockedGardenItems(total),
        reminderMode: "off", canCareToday: false, todayCare: null, canAddKeepsakeToday: false,
        layout: {}, keepsakes: [],
      } });
    }
    if (pathname === "/api/monitoring/client-error") return route.fulfill({ status: 204 });
    if (pathname === "/api/pilot-experience") return route.fulfill({ json: { eligible: false } });
    if (pathname === "/api/peer-space/access") return route.fulfill({ json: { available: false } });
    if (pathname === "/api/professional-verification") return route.fulfill({ json: { verification: null } });
    state.unexpectedApi.push(pathname);
    await route.abort();
    throw new Error(`Unexpected synthetic API ${pathname}`);
  });

  async function changeSession(kind: "signed_out" | "second_student") {
    if (kind === "second_student") {
      state.user = syntheticUser(secondId, "Second inline account");
      state.consentOwner = secondId;
      state.consentState = "not_started";
    }
    state.signedIn = kind !== "signed_out";
    await page.evaluate(({ key, session }) => {
      if (session) localStorage.setItem(key, JSON.stringify(session));
      else localStorage.removeItem(key);
      const channel = new BroadcastChannel(key);
      channel.postMessage({ event: session ? "SIGNED_IN" : "SIGNED_OUT", session });
      channel.close();
    }, { key: storageKey, session: state.signedIn ? syntheticSession(state.user) : null });
  }
  return { state, storageKey, changeSession };
}
