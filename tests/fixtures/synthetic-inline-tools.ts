import { expect, type Page } from "@playwright/test";
import type { CloudSweetRecord } from "../../lib/cloudRecords";
import { parseSweetCommand, sweetRecordsKey, sweetStoredDay } from "../../lib/sweetPersistenceProtocol";
import { syntheticInlineConsent } from "./synthetic-inline-consent";

export const inlineToolsTraffic = new WeakMap<Page, { blockedExternal: string[]; unexpectedApi: string[] }>();

export async function syntheticInlineTools(page: Page, baseURL: string, scenario?: Parameters<typeof syntheticInlineConsent>[2]) {
  const base = await syntheticInlineConsent(page, baseURL, scenario);
  inlineToolsTraffic.set(page, base.state);
  const tool = {
    messagePosts: [] as Array<Record<string, unknown>>,
    communityPosts: [] as Array<Record<string, unknown>>,
    supportReads: 0,
    supportPosts: [] as Array<Record<string, unknown>>,
    sweetWrites: [] as Array<Record<string, unknown>>,
    sweetReads: 0,
    sweetProtocolRequests: [] as Array<{ method: string; actor: string; body?: unknown }>,
  };
  const sweetHeads = new Map<string, { token: string; record: CloudSweetRecord | null }>();
  let sweetSequence = 100;
  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith("/profiles") && method === "GET") return route.fulfill({ json: {
      id: base.state.user.id, display_name: base.state.user.user_metadata.display_name,
      role: base.state.role, school_id: null,
    } });
    if (url.pathname.endsWith("/sweet_records")) {
      if (method === "GET") {
        tool.sweetReads += 1;
        return route.fulfill({ json: [...sweetHeads.values()].flatMap((head) => head.record?.user_id === base.state.user.id ? [head.record] : []) });
      }
      if (method === "POST" || method === "DELETE" || method === "PATCH") {
        return route.fulfill({ status: 403, json: { error: "Synthetic direct SWEET mutation denied" } });
      }
      await route.abort();
      throw new Error(`Unexpected synthetic SWEET ${method}`);
    }
    return route.fallback();
  });
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (pathname === "/api/sweet-records") {
      // Necessary transport adaptation for the unchanged S03/AI draft tests.
      // It is a model, never evidence that PostgreSQL/RLS was executed.
      const token = route.request().headers().authorization?.replace(/^Bearer\s+/i, "") || "";
      const actor = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub as string;
      expect(actor).toBe(base.state.user.id);
      const acceptedAt = new Date().toISOString();
      const today = sweetStoredDay(acceptedAt)!;
      const raw = method === "POST" ? route.request().postDataJSON() : undefined;
      tool.sweetProtocolRequests.push({ method, actor, body: raw });
      const targetDay = method === "GET" ? new URL(route.request().url()).searchParams.get("targetDay") || today : raw?.targetDay;
      const key = `${actor}:${targetDay}`; const current = sweetHeads.get(key);
      const scope = { operationDay: today, targetDay, headToken: current?.token ?? null, record: current?.record ?? null };
      if (method === "GET") { tool.sweetReads++; return route.fulfill({ json: { ...scope, status: "ready" } }); }
      const command = parseSweetCommand(raw);
      if (method !== "POST" || !command) return route.fulfill({ status: 400, json: { status: "invalid_request", writeOutcome: "not_committed" } });
      if (command.operationDay !== today || (!command.intent.startsWith("delete_") && command.targetDay !== today)) return route.fulfill({ status: 409, json: { ...scope, status: "scope_expired", writeOutcome: "not_committed" } });
      if (command.expectedHead !== scope.headToken) return route.fulfill({ status: 409, json: { ...scope, status: "conflict", writeOutcome: "not_committed" } });
      if (command.intent === "delete_day" || command.intent === "delete_record_cutoff") {
        if (current?.record?.id !== command.recordId) return route.fulfill({ status: 404, json: { status: "not_found", writeOutcome: "not_committed" } });
        const tombstone = `00000000-0000-4000-8000-${String(++sweetSequence).padStart(12, "0")}`;
        sweetHeads.set(key, { token: tombstone, record: null });
        return route.fulfill({ status: 201, json: { ...scope, status: "accepted", headToken: tombstone, record: null } });
      }
      if (!command.record) return route.fulfill({ status: 400, json: { status: "invalid_request", writeOutcome: "not_committed" } });
      if (base.state.role === "学生" && base.state.consentState !== "active") return route.fulfill({ status: 403, json: { status: "denied", writeOutcome: "not_committed" } });
      const input = command.record;
      if (command.intent === "preserve_summary" && current?.record && sweetRecordsKey(current.record.records) !== sweetRecordsKey(input.records)) {
        return route.fulfill({ status: 409, json: { ...scope, status: "conflict", writeOutcome: "not_committed" } });
      }
      const summary = command.intent === "preserve_summary" ? current?.record?.summary ?? null : command.intent === "clear_summary" ? null : input.summary || null;
      const smallStep = command.intent === "preserve_summary" ? current?.record?.small_step ?? null : command.intent === "clear_summary" ? null : input.smallStep || null;
      const nextTool = command.intent === "preserve_summary" ? current?.record?.recommended_next_tool ?? null : command.intent === "clear_summary" ? null : input.recommendedNextTool || null;
      if (current?.record && sweetRecordsKey(current.record.records) === sweetRecordsKey(input.records)
        && current.record.summary === summary && current.record.small_step === smallStep && current.record.recommended_next_tool === nextTool) {
        return route.fulfill({ json: { ...scope, status: "noop" } });
      }
      const payload = { user_id: actor, school_id: null, records: structuredClone(input.records), summary, small_step: smallStep, recommended_next_tool: nextTool };
      tool.sweetWrites.push(payload);
      const id = `00000000-0000-4000-8000-${String(++sweetSequence).padStart(12, "0")}`;
      const record = { ...payload, id, created_at: acceptedAt };
      sweetHeads.set(key, { token: id, record });
      return route.fulfill({ status: 201, json: { ...scope, status: "accepted", headToken: id, record } });
    }
    if (pathname === "/api/messages") {
      if (method === "GET") return route.fulfill({ json: { messages: [], pilotDutyAvailable: false, pilotDutyEmailConfigured: false } });
      if (method === "POST") {
        tool.messagePosts.push(route.request().postDataJSON() as Record<string, unknown>);
        return route.fulfill({ json: { safetyNotice: false } });
      }
    }
    if (pathname === "/api/community/posts") {
      if (method === "GET") return route.fulfill({ json: {
        currentUser: {
          id: base.state.user.id, name: base.state.user.user_metadata.display_name,
          role: base.state.role === "学生" ? "student" : "guardian", canModerate: false,
        },
        roles: { student: "学生", guardian: "家长", teacher: "老师", professional: "专业支持者" }, posts: [],
      } });
      if (method === "POST") {
        tool.communityPosts.push(route.request().postDataJSON() as Record<string, unknown>);
        return route.fulfill({ json: { safetyNotice: false } });
      }
    }
    if (pathname === "/api/community/blocks" && method === "GET") return route.fulfill({ json: { blocks: [] } });
    if (pathname === "/api/community/reports" && method === "GET") return route.fulfill({ json: { reports: [] } });
    if (pathname === "/api/support/cases") {
      if (method === "GET") {
        tool.supportReads += 1;
        return route.fulfill({ json: { consultationAvailable: false, ageBand: base.state.ageBand, cases: [] } });
      }
      if (method === "POST") {
        tool.supportPosts.push(route.request().postDataJSON() as Record<string, unknown>);
        return route.fulfill({ json: { urgent: false } });
      }
    }
    const basePaths = [
      "/api/account/status", "/api/account/consent", "/api/ai/mood-journal", "/api/garden",
      "/api/monitoring/client-error", "/api/pilot-experience", "/api/peer-space/access", "/api/professional-verification",
    ];
    if (basePaths.includes(pathname)) return route.fallback();
    base.state.unexpectedApi.push(`${method} ${pathname}`);
    await route.abort();
    throw new Error(`Unexpected synthetic API ${method} ${pathname}`);
  });
  return { ...base, tool };
}
