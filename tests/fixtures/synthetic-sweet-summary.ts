import { expect, type Page } from "@playwright/test";
import type { CloudSweetRecord } from "../../lib/cloudRecords";
import { gardenSummary, shanghaiDateKey } from "../../lib/tempoGarden";
import { syntheticInlineConsent } from "./synthetic-inline-consent";

type AiPlan = { summary?: string; smallStep?: string; tool?: string; status?: number; hold?: boolean };
type HeldReply = { release: () => void; held: boolean; settled: boolean; wait: Promise<void> };
type RequestLog = { method: string; query: Array<[string, string]>; body?: Record<string, unknown>; returnedIds?: string[];
  transport: "rest" | "protocol" | "transaction-model"; kind: "read" | "write-attempt" | "transaction-cleanup" };
type Head = { userId: string; targetDay: string; headToken: string; recordId: string | null };
type ProtocolRequest = { method: string; actor: string; body?: Record<string, unknown>; result?: Record<string, unknown> };

export function sweetSummaryRow(value: unknown): CloudSweetRecord {
  const body = value as { record?: CloudSweetRecord };
  return body.record ?? value as CloudSweetRecord;
}

function heldReply(): HeldReply {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { release, wait, held: false, settled: false };
}

export const sweetSummaryTraffic = new WeakMap<Page, {
  blockedExternal: string[]; unexpectedApi: string[]; records: () => CloudSweetRecord[];
  requests: RequestLog[]; aiRequests: Array<Record<string, unknown>>;
}>();

/** Stateful synthetic Auth/Data/AI transport. The browser executes the actual
 * save/list helpers; these rows are not PostgreSQL and do not prove RLS or SQL
 * trigger behavior. A reload re-reads this transport rather than page state.
 */
export async function syntheticSweetSummary(page: Page, baseURL: string, options: { minimalFailureReplies?: boolean; afterCommitReply?: (result: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }> } = {}) {
  expect(new URL(baseURL).hostname).toBe("127.0.0.1");
  const base = await syntheticInlineConsent(page, baseURL, { consentState: "active" });
  const state = Object.assign(base.state, {
    now: "2026-10-30T02:00:00.000Z",
    rows: [] as CloudSweetRecord[],
    requests: [] as RequestLog[],
    protocolRequests: [] as ProtocolRequest[],
    heads: [] as Head[],
    deletedActorIds: [] as string[],
    protocolEnabled: true,
    readFailures: 0,
    afterCommitFailures: 0,
    aiRequests: [] as Array<Record<string, unknown>>,
    insertFailures: 0,
    cleanupFailures: 0,
    gardenSnapshots: [] as ReturnType<typeof gardenSummary>[],
  });
  const plans: Array<AiPlan & { gate: HeldReply }> = [];
  const aiGates: HeldReply[] = [];
  const insertGates: HeldReply[] = [];
  let sequence = 0;
  await page.clock.setFixedTime(new Date(state.now));
  await page.addInitScript(() => {
    const runtime = window as typeof window & { sweetSummaryParsed: number };
    runtime.sweetSummaryParsed = 0;
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname !== "/api/ai/check-in") return original(...args);
      // Also exercise the revision guard when an already dispatched transport
      // ignores abort, rather than relying on browser cancellation alone.
      const response = await original(input, { ...args[1], signal: undefined });
      const json = response.json.bind(response);
      response.json = async () => {
        try { return await json(); }
        finally { runtime.sweetSummaryParsed++; }
      };
      return response;
    };
  });

  function ownedRows() { return state.rows.filter((row) => row.user_id === base.state.user.id); }
  function garden() { return gardenSummary([], ownedRows(), new Date(state.now)); }
  function matches(row: CloudSweetRecord, query: URLSearchParams) {
    return [...query.entries()].every(([key, expression]) => {
      if (["select", "order", "limit", "offset"].includes(key)) return true;
      const value = row[key as keyof CloudSweetRecord];
      if (expression.startsWith("eq.")) return String(value) === expression.slice(3);
      if (expression.startsWith("gte.")) return Date.parse(String(value)) >= Date.parse(expression.slice(4));
      if (expression.startsWith("lt.")) return Date.parse(String(value)) < Date.parse(expression.slice(3));
      if (expression.startsWith("in.(") && expression.endsWith(")")) {
        return expression.slice(4, -1).split(",").map((item) => item.replace(/^"|"$/g, "")).includes(String(value));
      }
      throw new Error(`Unexpected synthetic SWEET filter ${key}`);
    });
  }

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname.endsWith("/profiles") && method === "GET") return route.fulfill({ json: {
      id: base.state.user.id, display_name: base.state.user.user_metadata.display_name,
      role: base.state.role, school_id: null,
    } });
    if (url.pathname.endsWith("/wechat_identities") && method === "GET") return route.fulfill({ json: [] });
    if (!url.pathname.endsWith("/sweet_records")) return route.fallback();
    const log: RequestLog = { method, query: [...url.searchParams.entries()], transport: "rest", kind: method === "GET" ? "read" : "write-attempt" };
    state.requests.push(log);
    const token = request.headers().authorization?.replace(/^Bearer\s+/i, "") || "";
    const actor = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub as string;
    expect(actor).toBe(base.state.user.id);
    if (method === "GET") {
      expect(url.searchParams.get("user_id")).toBe(`eq.${actor}`);
      let selected = state.rows.filter((row) => matches(row, url.searchParams));
      if (url.searchParams.get("order")?.startsWith("created_at.desc")) {
        selected = [...selected].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      }
      selected = selected.slice(0, Number(url.searchParams.get("limit") || Infinity));
      log.returnedIds = selected.map((row) => row.id);
      return route.fulfill({ json: structuredClone(selected) });
    }
    // New clients must never fall back to direct table mutations. This is a
    // transport model of the ACL/guard contract, not evidence of deployed RLS.
    if (method === "POST" || method === "DELETE" || method === "PATCH") {
      return route.fulfill({ status: 403, json: { error: "Synthetic direct SWEET mutation denied" } });
    }
    base.state.unexpectedApi.push(`REST ${method} ${url.pathname}`);
    await route.abort();
    throw new Error(`Unexpected synthetic SWEET method ${method}`);
  });

  function headKey(actor: string, day: string) { return `${actor}:${day}`; }
  function head(actor: string, day: string) { return state.heads.find((item) => headKey(item.userId, item.targetDay) === headKey(actor, day)); }
  function scope(actor = state.user.id, targetDay = shanghaiDateKey(state.now)) {
    const current = head(actor, targetDay);
    const record = current?.recordId ? state.rows.find((row) => row.id === current.recordId && row.user_id === actor) : null;
    const source = state.rows.filter((row) => row.user_id === actor && shanghaiDateKey(row.created_at) === targetDay);
    const inconsistent = (!current && source.length > 0) || (current?.recordId && !record)
      || (current && !current.recordId && source.length > 0);
    return { status: inconsistent ? "protocol_unavailable" : "ready", operationDay: shanghaiDateKey(state.now),
      targetDay, headToken: current?.headToken ?? null, record: structuredClone(record ?? null) };
  }
  function token() { return `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`; }
  function same(value: unknown, other: unknown): boolean {
    if (Array.isArray(value) || Array.isArray(other)) return Array.isArray(value) && Array.isArray(other)
      && value.length === other.length && value.every((item, index) => same(item, other[index]));
    if (value !== null && other !== null && typeof value === "object" && typeof other === "object") {
      const left = value as Record<string, unknown>; const right = other as Record<string, unknown>;
      return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => key in right && same(left[key], right[key]));
    }
    return value === other;
  }
  function replacePersistedRows(rows: CloudSweetRecord[]) {
    // Explicit test-side completed external write: synchronize both independent
    // stores. Normal reads never fabricate missing heads or repair corruption.
    state.rows = structuredClone(rows);
    for (const row of rows) {
      const day = shanghaiDateKey(row.created_at);
      const latest = rows.filter((item) => item.user_id === row.user_id && shanghaiDateKey(item.created_at) === day)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      const current = head(row.user_id, day);
      if (current) { current.headToken = latest.id; current.recordId = latest.id; }
      else state.heads.push({ userId: row.user_id, targetDay: day, headToken: latest.id, recordId: latest.id });
    }
  }
  await page.route("**/api/sweet-records**", async (route) => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method();
    const bearer = request.headers().authorization?.replace(/^Bearer\s+/i, "") || "";
    const actor = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString()).sub as string;
    const packet: ProtocolRequest = { method, actor };
    state.protocolRequests.push(packet);
    const reply = async (status: number, body: Record<string, unknown>) => {
      const failure = options.minimalFailureReplies ? { status: body.status } : body;
      const result = method === "POST" && status >= 400 ? { ...failure, writeOutcome: "not_committed" } : body;
      packet.result = structuredClone(result); return route.fulfill({ status, json: result });
    };
    if (!state.protocolEnabled) return reply(503, { status: "protocol_unavailable" });
    if (state.deletedActorIds.includes(actor)) return reply(403, { status: "denied" });
    if (method === "GET") {
      const targetDay = url.searchParams.get("targetDay") || shanghaiDateKey(state.now);
      const result = scope(actor, targetDay);
      state.requests.push({ method: "GET", transport: "protocol", kind: "read", query: [["user_id", `eq.${actor}`], ["targetDay", targetDay]],
        returnedIds: result.record ? [result.record.id] : [] });
      if (state.readFailures > 0) { state.readFailures--; return reply(503, { status: "protocol_unavailable" }); }
      return reply(result.status === "ready" ? 200 : 503, result);
    }
    if (method !== "POST") return reply(405, { status: "protocol_unavailable" });
    const body = request.postDataJSON() as Record<string, unknown>; packet.body = structuredClone(body);
    const record = body.record as Record<string, unknown> | undefined;
    const normalized = { user_id: actor, school_id: null, records: record?.records,
      summary: record?.summary ?? null, small_step: record?.smallStep ?? null,
      recommended_next_tool: record?.recommendedNextTool ?? null };
    const log: RequestLog = { method: "POST", query: [], body: structuredClone(normalized), transport: "protocol", kind: "write-attempt" };
    state.requests.push(log);
    const held = insertGates.find((item) => !item.held);
    if (held) { held.held = true; await held.wait; }
    try {
      if (!state.protocolEnabled) return await reply(503, { status: "protocol_unavailable" });
      if (state.deletedActorIds.includes(actor)) return await reply(403, { status: "denied" });
      if (state.insertFailures > 0) { state.insertFailures--; return await reply(503, { status: "write_rejected", error: "Synthetic precommit failure" }); }
      const targetDay = String(body.targetDay); const current = scope(actor, targetDay);
      if (body.operationDay !== shanghaiDateKey(state.now)) return await reply(409, { ...current, status: "scope_expired" });
      if (current.status !== "ready") return await reply(503, current);
      if (!("expectedHead" in body)) return await reply(428, { status: "protocol_required" });
      if (body.expectedHead !== current.headToken) return await reply(409, { ...current, status: "conflict" });
      const intent = String(body.intent);
      if (!["delete_day", "delete_record_cutoff"].includes(intent) && state.role === "学生" && state.consentState !== "active") {
        return await reply(403, { status: "denied" });
      }
      const source = state.rows.filter((row) => row.user_id === actor && shanghaiDateKey(row.created_at) === targetDay);
      let result: Record<string, unknown>;
      let removed: CloudSweetRecord[] = [];
      if (intent === "delete_day" || intent === "delete_record_cutoff") {
        const target = source.find((row) => row.id === body.recordId);
        if (!target) return await reply(404, { ...current, status: "not_found" });
        removed = intent === "delete_day" ? source : source.filter((row) => Date.parse(row.created_at) <= Date.parse(target.created_at));
        const removesHead = removed.some((row) => row.id === current.record?.id);
        state.rows = state.rows.filter((row) => !removed.some((item) => item.id === row.id));
        if (removesHead) {
          const tombstone = token(); const h = head(actor, targetDay)!; h.headToken = tombstone; h.recordId = null;
        }
        result = { ...scope(actor, targetDay), status: "accepted" };
      } else {
        if (targetDay !== shanghaiDateKey(state.now)) return await reply(409, { ...current, status: "scope_expired" });
        if (!record || !Array.isArray(record.records)) return await reply(400, { status: "invalid" });
        if (intent === "preserve_summary" && current.record) {
          if (!same(current.record.records, normalized.records)) return await reply(409, { ...current, status: "conflict" });
          Object.assign(normalized, { summary: current.record.summary, small_step: current.record.small_step,
            recommended_next_tool: current.record.recommended_next_tool });
        } else if (intent === "clear_summary") Object.assign(normalized, { summary: null, small_step: null, recommended_next_tool: null });
        const existing = current.record;
        if (existing && same(existing.records, normalized.records) && existing.summary === normalized.summary
          && existing.small_step === normalized.small_step && existing.recommended_next_tool === normalized.recommended_next_tool) {
          return await reply(200, { ...current, status: "noop" });
        }
        if (state.cleanupFailures > 0 && source.length) { state.cleanupFailures--; return await reply(503, { status: "write_rejected", error: "Synthetic rollback" }); }
        // Staged model commit: source cleanup and head replacement become
        // observable together; actual SQL atomicity is a separate DB blocker.
        const id = token(); const inserted = { ...normalized, id, created_at: state.now } as CloudSweetRecord;
        removed = source;
        state.rows = [...state.rows.filter((row) => !source.some((item) => item.id === row.id)), structuredClone(inserted)];
        const h = head(actor, targetDay);
        if (h) { h.headToken = id; h.recordId = id; }
        else state.heads.push({ userId: actor, targetDay, headToken: id, recordId: id });
        result = { ...scope(actor, targetDay), status: "accepted" };
      }
      if (removed.length) state.requests.push({ method: "DELETE", query: [], transport: "transaction-model", kind: "transaction-cleanup",
        returnedIds: removed.map((row) => row.id) });
      if (state.afterCommitFailures > 0) { state.afterCommitFailures--; packet.result = structuredClone(result); await route.abort("failed"); return; }
      if (options.afterCommitReply) {
        // Explicit raw delivery: preserve the real bridge outcome without the
        // legacy failure helper's automatic not_committed annotation.
        const delivered = await options.afterCommitReply(result);
        packet.result = structuredClone(delivered.body);
        return await route.fulfill({ status: delivered.status, json: delivered.body });
      }
      return await reply(201, result);
    } finally { if (held) held.settled = true; }
  });

  await page.route("**/api/ai/check-in", async (route) => {
    state.aiRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    const plan = plans.shift() || { gate: heldReply() };
    plan.gate.held = true;
    if (plan.hold) await plan.gate.wait;
    try {
      if (plan.status && plan.status >= 400) return await route.fulfill({ status: plan.status, json: { error: "Synthetic summary unavailable" } });
      const marker = plan.summary || `SYNTHETIC_SWEET_SUMMARY_${state.aiRequests.length}`;
      return await route.fulfill({ json: {
        summary: marker, mainAffectedAreas: [], rhythmClue: "Synthetic rhythm",
        smallStep: plan.smallStep || `${marker}_STEP`, recommendedNextTool: plan.tool || `${marker}_TOOL`,
        supportReminder: "Synthetic support reminder",
      } });
    } finally { plan.gate.settled = true; }
  });
  await page.route("**/api/garden*", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/garden") return route.fallback();
    expect(route.request().method()).toBe("GET");
    const summary = garden();
    state.gardenSnapshots.push(summary);
    return route.fulfill({ json: { ...summary, reminderMode: "off", canCareToday: false, todayCare: null,
      canAddKeepsakeToday: false, layout: {}, keepsakes: [] } });
  });

  const snapshot = () => ({ rows: structuredClone(state.rows), heads: structuredClone(state.heads), protocolRequests: structuredClone(state.protocolRequests),
    requests: structuredClone(state.requests), requestLogMeaning: "Normalized source attempts; transaction-model DELETE is internal cleanup, not an HTTP request. protocolRequests contains actual protocol envelopes.",
    aiRequests: structuredClone(state.aiRequests), garden: garden(),
    blockedExternal: [...base.state.blockedExternal], unexpectedApi: [...base.state.unexpectedApi] });
  sweetSummaryTraffic.set(page, { ...base.state, records: () => structuredClone(state.rows),
    requests: state.requests, aiRequests: state.aiRequests });
  function queueAi(plan: AiPlan = {}) {
    const gate = heldReply();
    aiGates.push(gate);
    plans.push({ ...plan, gate });
    return gate;
  }
  function holdInsert() { const gate = heldReply(); insertGates.push(gate); return gate; }
  function modelDeleteActor(actor: string) {
    // Model only: real Auth/FK double-cascade is an isolated-DB blocker.
    state.deletedActorIds.push(actor);
    state.rows = state.rows.filter((row) => row.user_id !== actor);
    state.heads = state.heads.filter((item) => item.userId !== actor);
  }
  return { ...base, state, queueAi, holdInsert, snapshot, garden, scope, replacePersistedRows, modelDeleteActor,
    ownedRows: () => structuredClone(ownedRows()),
    participationDays: () => new Set(ownedRows().map((row) => shanghaiDateKey(row.created_at))).size,
    async setNow(now: string) { state.now = now; await page.clock.setFixedTime(new Date(now)); },
    releaseAll() { aiGates.forEach((gate) => gate.release()); insertGates.forEach((gate) => gate.release()); } };
}
