import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { latestSweetRecordsPerUserDay } from "../lib/sweetRecordDays";
import vm from "node:vm";
import ts from "typescript";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import * as protocol from "../lib/sweetPersistenceProtocol";
import type { CloudSweetRecord } from "../lib/cloudRecords";
import type { SweetScope } from "../lib/sweetPersistenceProtocol";

// P2-B-01 regression: actual component/public callbacks + actual
// cloudRecords transport/parser/account-list helper. Hook scheduling, Auth and
// CAS storage are synthetic; no browser/SQL/Supabase connection is possible.
// Original red results/source are preserved in the 2026-11-01 repro evidence.
type Element = { type: unknown; props: Record<string, unknown> };
type Click = () => void | Promise<void>;
type Summary = { summary: string; smallStep: string; recommendedNextTool: string };
const S1: Summary = { summary: "HANDLER_S1", smallStep: "HANDLER_STEP_1", recommendedNextTool: "HANDLER_TOOL_1" };
const S2: Summary = { summary: "HANDLER_S2", smallStep: "HANDLER_STEP_2", recommendedNextTool: "HANDLER_TOOL_2" };
const S3: Summary = { summary: "HANDLER_S3", smallStep: "HANDLER_STEP_3", recommendedNextTool: "HANDLER_TOOL_3" };
const actorA = "11111111-1111-4111-8111-111111111111";
const actorB = "22222222-2222-4222-8222-222222222222";
const businessTime = "2026-11-01T04:00:00.000Z";
class ProbeDate extends Date {
  constructor(value: string | number = businessTime) { super(value); }
  static now() { return Date.parse(businessTime); }
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release, held: false };
}
function element(type: unknown, props: Record<string, unknown>): Element { return { type, props }; }
function children(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(children);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Element;
  return [node, ...children(node.props.children)];
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(locale: "zh-CN" | "en") {
  const copy = locale === "en" ? en : zh;
  const slots = new Map<number, unknown>();
  let cursor = 0;
  let tree: Element;
  const effects: Array<() => void> = [];
  const cleanups: Array<() => void> = [];
  let actor = actorA, epoch = 0;
  const rows = new Map<string, CloudSweetRecord>();
  let authListener: ((event: string, session: { user: { id: string } }) => void) | undefined;
  let dropAck = false, rejectNext = false;
  let failRead: "network" | "missing_source" | null = null;
  const timeline: Array<Record<string, unknown>> = [];
  const mark = (event: string, extra: Record<string, unknown> = {}) => timeline.push({
    sequence: timeline.length + 1, observedAt: new Date().toISOString(), businessTime,
    event, actor, ...extra, rows: structuredClone([...rows.values()]),
    singleDayActorRowCount: rows.size,
  });
  let version = 0;
  let nextAck: ReturnType<typeof gate> | null = null;
  let summary = S1;
  let failNextAI = false;
  const calls: Array<Record<string, unknown>> = [];
  const day = protocol.sweetStoredDay(businessTime)!;
  const sameDeps = (a: unknown[] | undefined, b: unknown[] | undefined) => Boolean(a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!slots.has(index)) slots.set(index, typeof initial === "function" ? (initial as () => unknown)() : initial);
      return [slots.get(index), (next: unknown) => slots.set(index,
        typeof next === "function" ? (next as (previous: unknown) => unknown)(slots.get(index)) : next)];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!slots.has(index)) slots.set(index, { current: initial });
      return slots.get(index);
    },
    useCallback(callback: unknown, deps?: unknown[]) {
      const index = cursor++;
      const previous = slots.get(index) as { callback: unknown; deps?: unknown[] } | undefined;
      if (!previous || !sameDeps(previous.deps, deps)) slots.set(index, { callback, deps });
      return (slots.get(index) as { callback: unknown }).callback;
    },
    useEffect(callback: () => void | (() => void), deps?: unknown[]) {
      const index = cursor++;
      const previous = slots.get(index) as { deps?: unknown[]; cleanup?: () => void } | undefined;
      if (!previous || !sameDeps(previous.deps, deps)) effects.push(() => {
        previous?.cleanup?.();
        const cleanup = callback() || undefined;
        slots.set(index, { deps, cleanup });
        if (cleanup) cleanups.push(cleanup);
      });
    },
  };
  const scope = (owner = actor): SweetScope => ({ operationDay: day, targetDay: day,
    headToken: rows.get(owner)?.id ?? null, record: structuredClone(rows.get(owner) ?? null) });
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
    headers: { "content-type": "application/json" } });
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: actor } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: actor }, access_token: "SYNTHETIC_ONLY" } }, error: null }),
      onAuthStateChange(listener: typeof authListener) {
        authListener = listener; listener?.("INITIAL_SESSION", { user: { id: actor } });
        return { data: { subscription: { unsubscribe() { authListener = undefined; } } } };
      },
    },
    from(table: string) {
      expect(table).toBe("sweet_records");
      const filters: Array<{ key: string; value: unknown }> = [];
      const query = {
        select(columns: string) { expect(columns).toBe("*"); return query; },
        eq(key: string, value: unknown) { filters.push({ key, value }); return query; },
        order(key: string) { expect(key).toBe("created_at"); return query; },
        async limit(count: number) {
          expect(count).toBe(50);
          expect(filters).toEqual([{ key: "user_id", value: actor }]);
          const data = [...rows.values()].filter((row) => filters.every(({ key, value }) => row[key as keyof CloudSweetRecord] === value));
          mark("ACCOUNT_LIST_READ", { filters, returned: data });
          return { data: structuredClone(data), error: null };
        },
      };
      return query;
    },
  };
  const helperSource = readFileSync("lib/cloudRecords.ts", "utf8");
  const cloud = {} as typeof import("../lib/cloudRecords");
  vm.runInNewContext(ts.transpileModule(helperSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    exports: cloud, URLSearchParams, Response,
    document: { documentElement: { lang: locale } },
    require(name: string) {
      if (name === "@/lib/supabaseClient") return { getSupabase: () => client };
      if (name === "@/lib/sweetRecordDays") return { latestSweetRecordsPerUserDay };
      if (name === "@/lib/sweetPersistenceProtocol") return protocol;
      throw new Error(`Unexpected offline helper dependency: ${name}`);
    },
    async fetch(url: string, init: RequestInit) {
      expect(url.startsWith("/api/sweet-records?")).toBe(true);
      const method = init.method ?? "GET";
      const owner = actor;
      const command = init.body ? protocol.parseSweetCommand(JSON.parse(String(init.body))) : null;
      if (method === "POST") expect(command).not.toBeNull();
      const call = { method, actor: owner, head: scope(owner).headToken,
        ...(command ? { expectedHead: command.expectedHead, intent: command.intent, record: structuredClone(command.record), command } : {}) };
      calls.push(call); mark(`PROTOCOL_${method}`, call);
      if (method === "GET") {
        const mode = failRead; failRead = null;
        if (mode === "network") { mark("READ_NETWORK_FAILURE"); throw new TypeError("SYNTHETIC_READ_OFFLINE"); }
        const read = scope(owner);
        if (mode === "missing_source") read.record = null;
        mark("READ_RETURN", { read }); return reply({ status: "ready", ...read });
      }
      if (rejectNext) { rejectNext = false; mark("DEFINITE_WRITE_REJECTED_NO_COMMIT");
        return reply({ status: "write_rejected", writeOutcome: "not_committed" }, 503); }
      if (command!.expectedHead !== scope(owner).headToken) {
        mark("CAS_CONFLICT_NO_WRITE", { expectedHead: command!.expectedHead });
        return reply({ status: "conflict", writeOutcome: "not_committed" }, 409);
      }
      expect(command!.operationDay).toBe(day); expect(command!.targetDay).toBe(day);
      const input = command!.record!;
      const previous = rows.get(owner);
      const row: CloudSweetRecord = { id: `00000000-0000-4000-8000-${String(++version).padStart(12, "0")}`,
        user_id: owner, school_id: null, created_at: businessTime,
        records: structuredClone(input.records),
        summary: command!.intent === "preserve_summary" ? previous?.summary ?? null : input.summary ?? null,
        small_step: command!.intent === "preserve_summary" ? previous?.small_step ?? null : input.smallStep ?? null,
        recommended_next_tool: command!.intent === "preserve_summary" ? previous?.recommended_next_tool ?? null : input.recommendedNextTool ?? null };
      rows.set(owner, row); mark("MODEL_COMMIT", { committed: row });
      const committed = { ...scope(owner), record: structuredClone(row) };
      const ack = nextAck; nextAck = null;
      if (ack) { ack.held = true; mark("ACK_HELD_AFTER_COMMIT"); await ack.promise; }
      if (dropAck) { dropAck = false; mark("ACK_LOST_AFTER_COMMIT"); throw new TypeError("SYNTHETIC_ACK_LOST"); }
      mark("ACK_ACCEPTED", { committed }); return reply({ status: "accepted", ...committed }, 201);
    },
  }, { filename: "actual-cloudRecords-offline.js" });
  const consent = { get userId() { return actor; }, canProceed: true, studentReady: true,
    trackRequest: () => { const captured = epoch; return () => epoch === captured; },
    isSameActor: (id: string) => id === actor, refresh: async () => undefined };
  const translate = (key: string) => {
    const value = key.split(".").reduce<unknown>((v, part) => (v as Record<string, unknown> | undefined)?.[part], copy);
    return typeof value === "string" ? value : key;
  };
  const exported: { default?: () => Element } = {};
  const source = ts.transpileModule(readFileSync("views/check-in/page.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { exports: exported, Date: ProbeDate, Intl, Set, Map, WeakMap, Error, JSON, Object, Array,
    structuredClone, AbortController, console,
    fetch: async (url: string) => {
      expect(url).toBe("/api/ai/check-in");
      calls.push({ method: "AI", summary: summary.summary });
      if (failNextAI) { failNextAI = false; return { ok: false, status: 503, json: async () => ({ error: "Synthetic summary unavailable" }) }; }
      return { ok: true, status: 200, json: async () => ({ ...summary, mainAffectedAreas: [], rhythmClue: "Synthetic clue", supportReminder: "Synthetic reminder" }) };
    },
    require(name: string) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "Fragment" };
      if (name === "next/link") return { __esModule: true, default: "Link" };
      if (name === "@/lib/cloudRecords") return cloud;
      if (name === "@/lib/sweetPersistenceProtocol") return protocol;
      if (name === "@/lib/useInlineStudentConsent") return { useInlineStudentConsent: () => consent };
      if (name === "@/lib/supabaseClient") return { getSupabase: () => client };
      if (name === "@/lib/i18n/client") return { useTranslation: () => ({ locale, t: translate }) };
      if (name === "@/lib/safety/crisisDetection") return { detectCrisisInValues: () => ({ isUrgent: false }), getCrisisResponse: () => "Synthetic urgent" };
      if (name === "@/lib/safety/aiUrgentResponse") return { isAiUrgentResponse: () => false };
      if (name === "@/lib/aiClient") return { aiRequestHeaders: async () => ({}) };
      if (name === "@/lib/aiNotice") return { AI_NOTICE_VERSION: "synthetic" };
      if (name === "@/lib/clientMonitoring") return { reportClientOperationFailure() {} };
      if (name.startsWith("@/components/")) return new Proxy({}, { get: (_target, key) => String(key) });
      throw new Error(`Unexpected component dependency: ${name}`);
    },
  }, { filename: "actual-check-in-component.js" });
  function render() {
    cursor = 0;
    tree = exported.default!();
    while (effects.length) effects.shift()!();
    return tree;
  }
  function button(label: string) {
    const matches = children(tree).filter((n) => n.type === "button" && n.props.children === label);
    expect(matches.length, `public button ${label}`).toBe(1);
    return matches[0];
  }
  function click(node: Element): Click { return node.props.onClick as Click; }
  function complete() {
    render();
    for (let step = 0; step < 5; step++) {
      const choice = children(tree).find((n) => n.type === "button" && "aria-pressed" in n.props)!;
      click(choice)(); render();
      if (step < 4) { click(button(copy.checkIn.actions.next))(); render(); }
    }
    const notice = children(tree).find((n) => n.props.id === "check-in-ai-notice")!;
    (notice.props.onChange as (checked: boolean) => void)(true); render();
  }
  async function external(value: Summary) {
    const current = scope(); expect(current.record).not.toBeNull();
    const stored = await cloud.saveCloudSweetRecord({ records: current.record!.records, ...value }, actor,
      { scope: current, intent: "replace_summary", current: () => true });
    mark("EXPLICIT_EXTERNAL_OPERATION_COMMITTED", { stored }); return stored;
  }
  function setChoice(checked: boolean) {
    const notice = children(tree).find((n) => n.props.id === "check-in-ai-notice")!;
    (notice.props.onChange as (value: boolean) => void)(checked); render();
  }
  function texts() { return children(tree).flatMap((node) => typeof node.props.children === "string" ? [node.props.children] : []); }
  async function settle() { await turn(); await turn(); render(); }
  return { copy, calls, timeline, mark, render, button, click, complete, external, setChoice, texts, settle,
    snapshot: (owner = actor) => structuredClone(rows.get(owner) ?? null),
    account: async (owner = actor) => cloud.listCloudSweetRecords(owner),
    setSummary: (value: Summary) => { summary = value; },
    dropNextAck: () => { dropAck = true; },
    rejectNextWrite: () => { rejectNext = true; },
    async externalNull() {
      const current = scope();
      return cloud.saveCloudSweetRecord({ records: current.record!.records }, actor,
        { scope: current, intent: "clear_summary", current: () => true });
    },
    failNextRead: (mode: NonNullable<typeof failRead>) => { failRead = mode; },
    revalidate() { ++epoch; authListener?.("TOKEN_REFRESHED", { user: { id: actor } }); render(); },
    switchActor(next: string, rerender = true) { actor = next; ++epoch;
      authListener?.("SIGNED_IN", { user: { id: actor } }); mark("AUTH_IDENTITY_EVENT"); if (rerender) render(); },
    failNextAI: () => { failNextAI = true; },
    holdAck: () => { nextAck = gate(); return nextAck; },
    async attach(label: string) {
      await test.info().attach(label, { contentType: "application/json", body: JSON.stringify({
        scope: "Actual public component callbacks and real cloudRecords/helper/parser/account-list; synthetic hooks/Auth/transport/CAS; no SQL, browser event scheduler or real DB proof.",
        sources: Object.fromEntries(["views/check-in/page.tsx", "lib/cloudRecords.ts", "lib/sweetPersistenceProtocol.ts"].map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
        timeline, calls, finalRows: [...rows.values()], singleDayActorRowCount: rows.size,
      }, null, 2) });
    },
    dispose: () => { for (const cleanup of cleanups) cleanup(); } };
}

type Harness = ReturnType<typeof harness>;
const posts = (h: Harness) => h.calls.filter((call) => call.method === "POST");
async function unknownS1(h: Harness) {
  h.complete(); h.dropNextAck();
  const ack = h.holdAck();
  const pending = Promise.resolve(h.click(h.button(h.copy.checkIn.actions.generateAndSave))());
  await turn(); h.render(); expect(ack.held).toBe(true);
  expect(h.snapshot()).toMatchObject({ summary: S1.summary, small_step: S1.smallStep, recommended_next_tool: S1.recommendedNextTool });
  h.mark("S1_COMMITTED_CLIENT_AWAITING_ACK"); ack.release(); await pending; h.render();
  expect(h.texts()).toContain(h.copy.checkIn.messages.persistenceUnknown);
  expect(h.button(h.copy.checkIn.actions.saveToAccount).props.disabled).toBe(false);
  expect(posts(h)).toHaveLength(1); expect(posts(h)[0].expectedHead).toBeNull();
  h.mark("CLIENT_UNKNOWN_ORIGINAL_COMMAND_H0_FROZEN");
  return {
    manual: h.click(h.button(h.copy.checkIn.actions.saveToAccount)),
    generate: h.click(h.button(h.copy.checkIn.actions.generateAndSave)),
    raw: h.click(h.button(h.copy.checkIn.actions.saveFirst)),
  };
}
async function cancelAndReadS2(h: Harness) {
  h.setChoice(false); h.mark("USER_CANCELLED_AI_DISPLAY");
  expect(h.texts()).not.toContain(S1.summary);
  const s2 = await h.external(S2); const count = posts(h).length;
  h.click(h.button(h.copy.checkIn.actions.saveFirst))(); await h.settle();
  expect(posts(h)).toHaveLength(count); expect(h.snapshot()).toEqual(s2);
  expect(h.texts()).toContain(h.copy.checkIn.messages.saved);
  h.mark("READ_ONLY_RECONCILIATION_S2_SUCCEEDED_NO_POST"); return s2;
}
async function accountThreeReads(h: Harness) {
  const reads = [];
  for (const mode of ["first_fresh_helper_read", "second_fresh_helper_read", "third_fresh_helper_read"]) {
    const actual = await h.account(); expect(actual).toEqual([h.snapshot()]);
    reads.push(actual); h.mark(mode, { actual });
  }
  // These are three actual Account list-helper reads, not browser navigation,
  // reload/reentry or UI-rendering evidence.
  return reads;
}

for (const locale of ["zh-CN", "en"] as const) {
  for (const callback of ["manual", "generate"] as const) {
    test(`${locale} P2-B-01 ${callback} late public callback after UNKNOWN cancel and successful S2 read must stay retired`, async () => {
      const h = harness(locale);
      try {
        const old = await unknownS1(h); const s2 = await cancelAndReadS2(h);
        const before = structuredClone(h.calls); h.mark("RELEASE_OLD_PUBLIC_CALLBACK", { callback });
        // Two publicly held events dispatched in the same host task. Busy
        // must block overlap; it does not excuse the first stale write.
        const first = Promise.resolve(old[callback]());
        await old[callback](); await first; await h.settle();
        const afterFirst = structuredClone(h.calls);
        {
          await old[callback](); await old[callback](); await h.settle();
          expect(h.calls).toEqual(afterFirst); // completed A guard still prevents another replay
        }
        h.mark("OLD_CALLBACK_SETTLED", { newCalls: h.calls.slice(before.length) });
        const reads = await accountThreeReads(h);
        // Preserve the observed final storage and timeline even when the
        // prevention invariant fails. A red result is not an invented failure.
        await h.attach(`P2-B-01-${callback}-timeline-final-account`);
        expect.soft(h.calls, "cancelled lifecycle must not fetch new scope or call AI/POST").toEqual(before);
        expect.soft(h.snapshot(), "S2 must survive without an explicit new user operation").toEqual(s2);
        expect.soft(reads, "all fresh account reads must retain S2").toEqual([[s2], [s2], [s2]]);
        expect(h.snapshot()?.records).toEqual(s2.records);
      } finally { h.dispose(); }
    });
  }

  for (const mode of ["network", "missing_source"] as const) {
    test(`${locale} failed ${mode} reconciliation retains UNKNOWN while cancelled old callbacks stay retired`, async () => {
      const h = harness(locale);
      try {
        const old = await unknownS1(h); h.setChoice(false); const s2 = await h.external(S2);
        h.failNextRead(mode); h.click(h.button(h.copy.checkIn.actions.saveFirst))(); await h.settle();
        expect(h.texts()).toContain(h.copy.checkIn.messages.persistenceUnavailable);
        expect(h.texts()).not.toContain(h.copy.checkIn.messages.saveFailed);
        expect(h.texts()).not.toContain(h.copy.checkIn.messages.saved);
        h.mark("FAILED_READ_DID_NOT_SETTLE_UNKNOWN");
        const frozenCalls = structuredClone(h.calls);
        await old.manual(); await old.generate(); old.raw(); await old.manual(); await h.settle();
        expect(h.calls).toEqual(frozenCalls);
        // Failure did not discard UNKNOWN's command: another current raw action
        // still reconciles read-only, rather than clearing the committed S2.
        h.click(h.button(h.copy.checkIn.actions.saveFirst))(); await h.settle();
        expect(posts(h)).toHaveLength(2);
        expect(h.texts()).toContain(h.copy.checkIn.messages.saved);
        expect(h.snapshot()).toEqual(s2); expect(await accountThreeReads(h)).toEqual([[s2], [s2], [s2]]);
      } finally { await h.attach(`failed-${mode}-unknown-cancelled-retired`); h.dispose(); }
    });
  }

  test(`${locale} cancellation retires all captured callbacks before reconciliation and same-account revalidation`, async () => {
    const h = harness(locale);
    try {
      const old = await unknownS1(h); h.setChoice(false); const s2 = await h.external(S2);
      const before = structuredClone(h.calls);
      const first = Promise.resolve(old.manual()); await old.generate(); old.raw(); await first; await h.settle();
      expect(h.calls).toEqual(before); expect(h.snapshot()).toEqual(s2);
      h.revalidate(); await old.manual(); await old.generate(); old.raw(); await h.settle();
      expect(h.calls).toEqual(before);
      h.click(h.button(h.copy.checkIn.actions.saveFirst))(); await h.settle();
      expect(h.calls.slice(before.length).map(call => call.method)).toEqual(["GET"]);
      expect(h.snapshot()).toEqual(s2); expect(await accountThreeReads(h)).toEqual([[s2], [s2], [s2]]);
    } finally { await h.attach("retired-before-read-and-same-account-revalidation"); h.dispose(); }
  });

  for (const mode of ["network", "missing_source"] as const) {
    test(`${locale} uncancelled UNKNOWN failed ${mode} read retains full original command for valid H0 retry`, async () => {
      const h = harness(locale);
      try {
        const old = await unknownS1(h); const original = structuredClone(posts(h)[0].command);
        const s2 = await h.external(S2); h.failNextRead(mode);
        old.raw(); await h.settle();
        expect(h.texts()).toContain(h.copy.checkIn.messages.persistenceUnavailable);
        expect(h.texts()).not.toContain(h.copy.checkIn.messages.saveFailed);
        const before = h.calls.length;
        await old.manual(); await h.settle();
        expect(h.calls.slice(before).map(call => call.method)).toEqual(["POST"]);
        expect(posts(h).at(-1)?.command).toEqual(original);
        expect(h.texts()).toContain(h.copy.checkIn.messages.persistenceConflict);
        const frozen = structuredClone(h.calls); await old.manual(); old.raw(); await h.settle();
        expect(h.calls).toEqual(frozen); expect(h.snapshot()).toEqual(s2);
        expect(await accountThreeReads(h)).toEqual([[s2], [s2], [s2]]);
      } finally { await h.attach(`uncancelled-failed-${mode}-full-command-H0`); h.dispose(); }
    });
  }

  test(`${locale} cancellation and batched A to B to A retire an already dispatched late ACK`, async () => {
    const h = harness(locale);
    try {
      h.complete(); const ack = h.holdAck();
      const pending = Promise.resolve(h.click(h.button(h.copy.checkIn.actions.generateAndSave))());
      await turn(); h.render(); expect(ack.held).toBe(true);
      h.setChoice(false); const s2 = await h.external(S2); const before = structuredClone(h.calls);
      h.switchActor(actorB, false); h.switchActor(actorA, false);
      ack.release(); await pending; await h.settle();
      expect(h.calls).toEqual(before); expect(h.snapshot()).toEqual(s2);
      expect(h.texts()).not.toContain(h.copy.checkIn.messages.saved);
      expect(h.snapshot(actorB)).toBeNull();
      h.switchActor(actorB); expect(await h.account(actorB)).toEqual([]); h.switchActor(actorA);
      expect(await accountThreeReads(h)).toEqual([[s2], [s2], [s2]]);
    } finally { await h.attach("cancelled-late-ACK-batched-ABA"); h.dispose(); }
  });

  test(`${locale} successful preserve repeated raw callbacks stay read only and explicit new generation can continue`, async () => {
    const h = harness(locale);
    try {
      const old = await unknownS1(h); const s2 = await cancelAndReadS2(h); const count = posts(h).length;
      old.raw(); old.raw(); await h.settle(); expect(posts(h)).toHaveLength(count); expect(h.snapshot()).toEqual(s2);
      h.setChoice(true); h.setSummary(S3); h.mark("USER_EXPLICIT_NEW_GENERATION");
      await h.click(h.button(h.copy.checkIn.actions.generateAndSave))(); await h.settle();
      expect(posts(h)).toHaveLength(count + 1); expect(posts(h).at(-1)?.expectedHead).toBe(s2.id);
      expect(h.snapshot()).toMatchObject({ summary: S3.summary, small_step: S3.smallStep, recommended_next_tool: S3.recommendedNextTool });
      const settled = structuredClone(h.calls); const final = h.snapshot();
      await old.manual(); await old.generate(); old.raw(); await h.settle();
      expect(h.calls).toEqual(settled); expect(h.snapshot()).toEqual(final); await accountThreeReads(h);
    } finally { await h.attach("explicit-new-operation-and-old-callback-isolation"); h.dispose(); }
  });

  for (const intent of ["summary", "null"] as const) {
    test(`${locale} UNKNOWN retry cannot bypass A and reviewed explicit ${intent} preserves frozen-head and legal-null rules`, async () => {
      const h = harness(locale);
      try {
        const old = await unknownS1(h); const s2 = await h.external(S2);
        await old.manual(); await h.settle();
        expect(posts(h).at(-1)?.expectedHead).toBeNull(); expect(h.snapshot()).toEqual(s2);
        expect(h.texts()).toContain(h.copy.checkIn.messages.persistenceConflict);
        const count = h.calls.length; await old.manual(); await h.settle(); expect(h.calls).toHaveLength(count);
        await h.click(h.button(h.copy.checkIn.conflict.view))(); await h.settle();
        expect(h.texts()).toContain(S2.summary); const postsBeforeConfirm = posts(h).length;
        h.mark("USER_EXPLICIT_REVIEWED_NEW_OPERATION", { intent });
        h.click(h.button(intent === "summary" ? h.copy.checkIn.conflict.confirmSummary : h.copy.checkIn.conflict.confirmRaw))();
        await h.settle(); expect(posts(h)).toHaveLength(postsBeforeConfirm + 1);
        expect(posts(h).at(-1)).toMatchObject({ expectedHead: s2.id, intent: intent === "summary" ? "replace_summary" : "clear_summary" });
        expect(h.snapshot()).toMatchObject({ records: s2.records,
          summary: intent === "summary" ? S1.summary : null,
          small_step: intent === "summary" ? S1.smallStep : null,
          recommended_next_tool: intent === "summary" ? S1.recommendedNextTool : null });
        const final = h.snapshot(); const settled = structuredClone(h.calls);
        await old.manual(); old.raw(); await h.settle(); expect(h.calls).toEqual(settled); expect(h.snapshot()).toEqual(final);
        await accountThreeReads(h);
      } finally { await h.attach(`A-frozen-command-explicit-${intent}`); h.dispose(); }
    });
  }

  test(`${locale} UNKNOWN cancelled reconciled A callbacks remain isolated across batched A to B to A`, async () => {
    const h = harness(locale);
    try {
      const old = await unknownS1(h); const s2 = await cancelAndReadS2(h);
      const count = h.calls.length;
      h.switchActor(actorB, false); await old.manual(); await old.generate(); old.raw(); await turn();
      expect(h.calls).toHaveLength(count); expect(h.snapshot(actorB)).toBeNull();
      expect(await h.account(actorB)).toEqual([]);
      h.switchActor(actorA, false); await old.manual(); await old.generate(); old.raw(); await h.settle();
      expect(h.calls).toHaveLength(count); expect(h.snapshot(actorA)).toEqual(s2); expect(h.snapshot(actorB)).toBeNull();
      await accountThreeReads(h);
    } finally { await h.attach("A-B-A-old-callback-account-isolation"); h.dispose(); }
  });
}

for (const locale of ["zh-CN", "en"] as const) {
  test(`${locale} uncancelled rejected S3 preserve external null retains original expected for retry`, async () => {
    const h = harness(locale);
    try {
      h.complete(); await h.click(h.button(h.copy.checkIn.actions.generateAndSave))(); await h.settle();
      const original = h.snapshot()!;
      h.setSummary(S3); h.rejectNextWrite();
      await h.click(h.button(h.copy.checkIn.actions.generateAndSave))(); await h.settle();
      expect(h.texts()).toContain(h.copy.checkIn.messages.saveFailed);
      expect(posts(h).at(-1)?.expectedHead).toBe(original.id);
      const latest = await h.externalNull(); h.mark("EXTERNAL_EXPLICIT_LEGAL_NULL", { latest });
      const count = posts(h).length;
      h.click(h.button(h.copy.checkIn.actions.saveFirst))(); await h.settle();
      expect(posts(h)).toHaveLength(count); expect(h.snapshot()).toEqual(latest);
      // AI has NOT been cancelled: preserve is not proof that S3/null was saved.
      await h.click(h.button(h.copy.checkIn.actions.saveToAccount))(); await h.settle();
      expect(posts(h)).toHaveLength(count + 1);
      expect(posts(h).at(-1)).toMatchObject({ expectedHead: original.id, intent: "replace_summary" });
      expect(h.texts()).toContain(h.copy.checkIn.messages.persistenceConflict);
      expect(h.snapshot()).toEqual(latest); await accountThreeReads(h);
    } finally { await h.attach("A-uncancelled-rejected-S3-preserve-null-original-expected"); h.dispose(); }
  });

  test(`${locale} cancelled old retry AI callback from UNKNOWN raw fallback must not restart AI`, async () => {
    const h = harness(locale);
    try {
      h.complete(); h.failNextAI(); h.dropNextAck();
      await h.click(h.button(h.copy.checkIn.actions.generateAndSave))(); await h.settle();
      expect(h.snapshot()).toMatchObject({ summary: null, small_step: null, recommended_next_tool: null });
      expect(h.texts()).toContain(h.copy.checkIn.messages.persistenceUnknown);
      const oldRetry = h.click(h.button(h.copy.checkIn.actions.regenerate));
      h.mark("CAPTURE_RETRY_FROM_ACTUAL_ERROR_UI_UNKNOWN_RAW_FALLBACK");
      h.setChoice(false); const s2 = await h.external(S2);
      const before = structuredClone(h.calls); const count = posts(h).length;
      await oldRetry(); await h.settle();
      expect(posts(h)).toHaveLength(count); expect(h.snapshot()).toEqual(s2);
      expect(await accountThreeReads(h)).toEqual([[s2], [s2], [s2]]);
      await h.attach("old-error-retry-cancelled-AI-only-S2-account-retained");
      expect(h.calls, "cancelled old retry must not GET/AI with old consent closure").toEqual(before);
    } finally { h.dispose(); }
  });
}
