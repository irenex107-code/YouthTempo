import type { Page } from "@playwright/test";
import type { TempoGardenData } from "@/lib/cloudRecords";
import { unlockedGardenItems, unlockedGardenPositions, type GardenItemKey, type GardenLayoutSlot } from "@/lib/gardenCatalog";
import { gardenStage } from "@/lib/tempoGarden";

type Scenario = {
  total?: number;
  todayParticipated?: boolean;
  ageBand?: "14_17" | "18_plus";
  consentActive?: boolean;
  peerSpaceAvailable?: boolean;
  failedReadsAfterSave?: number;
  lostSaveResponse?: boolean;
  failedLayouts?: number;
};

// Browser state only: every Auth, Data API and application API response is
// intercepted. Any unexpected external request is aborted, never sent.
export async function syntheticPathsGarden(page: Page, scenario: Scenario = {}) {
  const user = {
    id: "00000000-0000-4000-8000-000000000062", aud: "authenticated", role: "authenticated",
    email: "paths-garden@example.invalid", app_metadata: {}, user_metadata: { display_name: "Path preview" },
    created_at: "2026-01-01T00:00:00Z",
  };
  const ageBand = scenario.ageBand || "14_17";
  const total = scenario.total ?? 13;
  const state = {
    posts: 0, reads: 0, aiCalls: 0, otpCalls: 0, accessReads: 0,
    layoutWrites: [] as Array<{ slot: GardenLayoutSlot; itemKey: GardenItemKey }>,
    blockedExternal: [] as string[],
    failedReads: scenario.failedReadsAfterSave || 0,
    failedLayouts: scenario.failedLayouts || 0,
    garden: {
      total, stage: gardenStage(total), sceneLevel: "base", thisWeek: Math.min(total, 7), thisMonth: total,
      quickCheckIns: total, fullSweetRecords: 0, todayParticipated: scenario.todayParticipated ?? false,
      unlockedPositions: unlockedGardenPositions(total), unlockedItems: unlockedGardenItems(total),
      reminderMode: "off", canCareToday: false, todayCare: null, canAddKeepsakeToday: false,
      layout: total >= 7 ? { flower_border: "low_fern", hill_path: "flat_stones" } : {}, keepsakes: [],
    } as TempoGardenData,
  };
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co").hostname.split(".")[0];
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: expiresAt, role: "authenticated" })).toString("base64url")}.synthetic-signature`;
  await page.addInitScript(({ ref, user, accessToken, expiresAt }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      access_token: accessToken, refresh_token: "synthetic-refresh", token_type: "bearer",
      expires_in: 3600, expires_at: expiresAt, user,
    }));
    localStorage.setItem(`youthtempo:garden:intro:v2:${user.id}`, "seen");
  }, { ref, user, accessToken, expiresAt });
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").origin;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    state.blockedExternal.push(url.origin);
    return route.abort();
  });
  await page.route("**/auth/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/user")) return route.fulfill({ json: user });
    if (pathname.endsWith("/otp")) state.otpCalls += 1;
    return route.abort();
  });
  await page.route("**/rest/v1/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/storage/v1/**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (pathname.startsWith("/api/ai/")) { state.aiCalls += 1; return route.abort(); }
    if (pathname === "/api/account/status") return route.fulfill({ json: {
      displayRole: "学生", profile: { id: user.id, display_name: "Path preview", role: "学生" }, hasSchool: false,
      studentAgeBand: ageBand, linkedChildren: [], linkedGuardians: [], assignedTeachers: [], assignedStudents: [],
    } });
    if (pathname === "/api/account/consent") return route.fulfill({ json: {
      role: "student", policyVersion: "2026-08-28", children: [], consent: {
        studentUserId: user.id, studentName: "Path preview", ageBand, policyVersion: "2026-08-28",
        status: scenario.consentActive === false ? "withdrawn" : "active",
        consentBasis: ageBand === "18_plus" ? "adult_self" : "student_self_pilot", hasLinkedGuardian: false,
        studentAssentedAt: scenario.consentActive === false ? null : "2026-10-28T04:00:00Z",
        guardianUserId: null, guardianConsentedAt: null,
        withdrawnAt: scenario.consentActive === false ? "2026-10-28T03:00:00Z" : null,
      },
    } });
    if (pathname === "/api/peer-space/access") {
      state.accessReads += 1;
      return route.fulfill({ json: { available: scenario.peerSpaceAvailable === true } });
    }
    if (pathname === "/api/pilot-experience") return route.fulfill({ json: { eligible: false } });
    if (pathname === "/api/monitoring/client-error") return route.fulfill({ status: 204 });
    if (pathname === "/api/garden") {
      if (method === "POST") {
        state.posts += 1;
        const nextTotal = state.garden.total + (state.garden.todayParticipated ? 0 : 1);
        state.garden = {
          ...state.garden, total: nextTotal, stage: gardenStage(nextTotal),
          thisWeek: Math.min(nextTotal, 7), thisMonth: nextTotal,
          quickCheckIns: state.garden.quickCheckIns + 1,
          unlockedPositions: unlockedGardenPositions(nextTotal), unlockedItems: unlockedGardenItems(nextTotal),
          todayParticipated: true, canCareToday: true, canAddKeepsakeToday: true,
        };
        if (scenario.lostSaveResponse) return route.abort("failed");
        return route.fulfill({ status: 201, json: { checkIn: { id: "synthetic-record", created_at: "2026-10-26T04:00:00Z" } } });
      }
      state.reads += 1;
      if (state.posts && state.failedReads > 0) {
        state.failedReads -= 1;
        return route.fulfill({ status: 503, json: { error: "Unavailable" } });
      }
      return route.fulfill({ json: state.garden });
    }
    if (pathname === "/api/garden/layout" && method === "PUT") {
      const payload = route.request().postDataJSON() as { slot: GardenLayoutSlot; itemKey: GardenItemKey };
      state.layoutWrites.push({ slot: payload.slot, itemKey: payload.itemKey });
      if (state.failedLayouts > 0) {
        state.failedLayouts -= 1;
        return route.fulfill({ status: 503, json: { error: "Unavailable" } });
      }
      state.garden = { ...state.garden, layout: { ...state.garden.layout, [payload.slot]: payload.itemKey } };
      return route.fulfill({ json: { layoutItem: payload } });
    }
    return route.fulfill({ status: 404, json: { error: "No synthetic response configured" } });
  });
  return state;
}
