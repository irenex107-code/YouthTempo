import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import * as protocol from "../lib/sweetPersistenceProtocol";
import type { CloudSweetRecord } from "../lib/cloudRecords";
import type { SweetRecordInput, SweetScope } from "../lib/sweetPersistenceProtocol";

// Exercise the actual component's returned public event props independently
// of DOM disabled-button filtering. This controlled hook host does not inspect
// React internals. Browser specs separately cover routing and Account reads.
type Element = { type: unknown; props: Record<string, unknown> };
type Click = () => void | Promise<void>;
type Summary = { summary: string; smallStep: string; recommendedNextTool: string };
const S1: Summary = { summary: "HANDLER_S1", smallStep: "HANDLER_STEP_1", recommendedNextTool: "HANDLER_TOOL_1" };
const S2: Summary = { summary: "HANDLER_S2", smallStep: "HANDLER_STEP_2", recommendedNextTool: "HANDLER_TOOL_2" };
const S3: Summary = { summary: "HANDLER_S3", smallStep: "HANDLER_STEP_3", recommendedNextTool: "HANDLER_TOOL_3" };
const actor = "11111111-1111-4111-8111-111111111111";

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
  let row: CloudSweetRecord | null = null;
  let version = 0;
  let nextAck: ReturnType<typeof gate> | null = null;
  let summary = S1;
  let failNextAI = false;
  const calls: Array<Record<string, unknown>> = [];
  const day = protocol.sweetStoredDay(new Date().toISOString())!;
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
  const scope = (): SweetScope => ({ operationDay: day, targetDay: day,
    headToken: row?.id ?? null, record: structuredClone(row) });
  const cloud = {
    getCurrentUser: async () => ({ id: actor }),
    readCloudSweetScope: async (requestedActor: string, _target: unknown, current: () => boolean) => {
      if (!current()) throw new protocol.SweetPersistenceError("interrupted");
      expect(requestedActor).toBe(actor);
      calls.push({ method: "GET", head: row?.id ?? null });
      return scope();
    },
    saveCloudSweetRecord: async (record: SweetRecordInput, requestedActor: string,
      options: { scope: SweetScope; intent: string; current: () => boolean }) => {
      if (!options.current()) throw new protocol.SweetPersistenceError("interrupted");
      expect(requestedActor).toBe(actor);
      calls.push({ method: "POST", expectedHead: options.scope.headToken, intent: options.intent, record: structuredClone(record) });
      if (options.scope.headToken !== (row?.id ?? null)) throw new protocol.SweetPersistenceError("conflict");
      row = { id: `00000000-0000-4000-8000-${String(++version).padStart(12, "0")}`, user_id: actor, school_id: null,
        created_at: new Date().toISOString(), records: structuredClone(record.records), summary: record.summary ?? null,
        small_step: record.smallStep ?? null, recommended_next_tool: record.recommendedNextTool ?? null };
      const committed = structuredClone(row);
      const ack = nextAck; nextAck = null;
      if (ack) { ack.held = true; await ack.promise; }
      return committed;
    },
  };
  const consent = { userId: actor, canProceed: true, studentReady: true,
    trackRequest: () => () => true, isSameActor: (id: string) => id === actor, refresh: async () => undefined };
  const translate = (key: string) => {
    const value = key.split(".").reduce<unknown>((v, part) => (v as Record<string, unknown> | undefined)?.[part], copy);
    return typeof value === "string" ? value : key;
  };
  const exported: { default?: () => Element } = {};
  const source = ts.transpileModule(readFileSync("views/check-in/page.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { exports: exported, Date, Intl, Set, Map, WeakMap, Error, JSON, Object, Array,
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
      if (name === "@/lib/supabaseClient") return { getSupabase: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
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
  function external(value: Summary) {
    expect(row).not.toBeNull();
    row = { ...row!, id: `eeeeeeee-eeee-4eee-8eee-${String(++version).padStart(12, "0")}`,
      summary: value.summary, small_step: value.smallStep, recommended_next_tool: value.recommendedNextTool };
    return structuredClone(row);
  }
  function setChoice(checked: boolean) {
    const notice = children(tree).find((n) => n.props.id === "check-in-ai-notice")!;
    (notice.props.onChange as (value: boolean) => void)(checked); render();
  }
  return { copy, calls, render, button, click, complete, external, setChoice,
    snapshot: () => structuredClone(row), setSummary: (value: Summary) => { summary = value; },
    failNextAI: () => { failNextAI = true; },
    holdAck: () => { nextAck = gate(); return nextAck; }, dispose: () => { for (const cleanup of cleanups) cleanup(); } };
}

for (const locale of ["zh-CN", "en"] as const) {
  test(`${locale} completed S1 public callbacks cannot rebind, duplicate, or revive after explicit new generation`, async ({}, info) => {
    const h = harness(locale); let ack: ReturnType<typeof gate> | undefined;
    try {
      h.complete();
      // A failed first AI request leaves the public retry action available;
      // retry generates a summary without automatically saving it. This gives
      // us the real manual-save callback with saving=false before its POST.
      h.failNextAI();
      await h.click(h.button(h.copy.checkIn.actions.generateAndSave))(); h.render();
      expect(h.snapshot()).toMatchObject({ summary: null, small_step: null, recommended_next_tool: null });
      const initialPosts = h.calls.filter((c) => c.method === "POST").length;
      const initialAI = h.calls.filter((c) => c.method === "AI").length;
      const oldGenerate = h.click(h.button(h.copy.checkIn.actions.regenerate));
      const generating = Promise.resolve(oldGenerate());
      await oldGenerate(); await generating; h.render();
      expect(h.calls.filter((c) => c.method === "AI")).toHaveLength(initialAI + 1);
      expect(h.button(h.copy.checkIn.actions.saveToAccount).props.disabled).toBe(false);
      const beforeSaveGenerate = h.click(h.button(h.copy.checkIn.actions.generateAndSave));
      const oldSave = h.click(h.button(h.copy.checkIn.actions.saveToAccount));
      ack = h.holdAck();
      const saving = Promise.resolve(oldSave());
      await oldSave(); await turn(); h.render();
      expect(ack.held).toBe(true);
      expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(initialPosts + 1);
      const latest = h.external(S2);
      ack.release(); await saving; h.render();
      expect(h.snapshot()).toEqual(latest);
      const settled = structuredClone(h.calls);
      await oldSave(); await oldSave(); await oldGenerate(); await beforeSaveGenerate(); await turn(); h.render();
      expect(h.calls).toEqual(settled); expect(h.snapshot()).toEqual(latest);
      expect(h.button(h.copy.checkIn.actions.savedToAccount).props.disabled).toBe(true);

      h.setSummary(S3);
      await h.click(h.button(h.copy.checkIn.actions.generateAndSave))(); h.render();
      const current = h.snapshot();
      expect(current).toMatchObject({ summary: S3.summary, small_step: S3.smallStep, recommended_next_tool: S3.recommendedNextTool });
      expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(initialPosts + 2);
      expect(h.calls.filter((c) => c.method === "POST").at(-1)).toMatchObject({ expectedHead: latest.id });
      const freshCalls = structuredClone(h.calls);
      await oldSave(); await oldGenerate(); await turn(); h.render();
      expect(h.calls).toEqual(freshCalls); expect(h.snapshot()).toEqual(current);
      await info.attach("actual-component-handler-storage", { contentType: "application/json", body: JSON.stringify({ calls: h.calls, final: h.snapshot() }, null, 2) });
    } finally { ack?.release(); h.dispose(); }
  });

  test(`${locale} completed null callback stays terminal across late ACK, duplicate dispatch and fresh generation`, async ({}, info) => {
    const h = harness(locale); const ack = h.holdAck();
    try {
      h.complete();
      const beforeRawGenerate = h.click(h.button(h.copy.checkIn.actions.generateAndSave));
      const oldRaw = h.click(h.button(h.copy.checkIn.actions.saveFirst));
      oldRaw(); oldRaw(); await turn(); h.render();
      expect(ack.held).toBe(true);
      expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(1);
      expect(h.snapshot()).toMatchObject({ summary: null, small_step: null, recommended_next_tool: null });
      const latest = h.external(S2);
      ack.release(); await turn(); h.render();
      const settled = structuredClone(h.calls);
      oldRaw(); oldRaw(); await beforeRawGenerate(); await turn(); h.render();
      expect(h.calls).toEqual(settled); expect(h.snapshot()).toEqual(latest);
      expect(h.button(h.copy.checkIn.actions.saveFirst).props.disabled).toBe(true);
      h.setSummary(S3);
      await h.click(h.button(h.copy.checkIn.actions.generateAndSave))(); h.render();
      expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(2);
      expect(h.calls.filter((c) => c.method === "POST").at(-1)).toMatchObject({ expectedHead: latest.id });
      const current = h.snapshot(); const freshCalls = structuredClone(h.calls);
      oldRaw(); oldRaw(); await turn(); h.render();
      expect(h.calls).toEqual(freshCalls); expect(h.snapshot()).toEqual(current);
      await info.attach("actual-component-null-handler-storage", { contentType: "application/json", body: JSON.stringify({ calls: h.calls, final: h.snapshot() }, null, 2) });
    } finally { ack.release(); h.dispose(); }
  });

  test(`${locale} late success after AI cancellation terminates pre-save idle callbacks without reviving stale consent`, async ({}, info) => {
    const h = harness(locale); let ack: ReturnType<typeof gate> | undefined;
    try {
      h.complete(); h.failNextAI();
      await h.click(h.button(h.copy.checkIn.actions.generateAndSave))(); h.render();
      await h.click(h.button(h.copy.checkIn.actions.regenerate))(); h.render();
      const beforeSaveGenerate = h.click(h.button(h.copy.checkIn.actions.generateAndSave));
      const beforeSave = h.click(h.button(h.copy.checkIn.actions.saveToAccount));
      const initialPosts = h.calls.filter((c) => c.method === "POST").length;
      ack = h.holdAck(); const saving = Promise.resolve(beforeSave());
      await turn(); h.render(); expect(ack.held).toBe(true);
      // A public AI-choice change invalidates UI response eligibility while
      // preserving the storage facts of this already-dispatched S1 save.
      h.setChoice(false);
      const latest = h.external(S2);
      ack.release(); await saving; h.render();
      expect(h.snapshot()).toEqual(latest);
      const settled = structuredClone(h.calls);
      await beforeSave(); await beforeSaveGenerate(); await beforeSaveGenerate(); await turn(); h.render();
      expect(h.calls).toEqual(settled); expect(h.snapshot()).toEqual(latest);
      // An actual current-screen user action can still start a fresh intent.
      h.setChoice(true); h.setSummary(S3);
      await h.click(h.button(h.copy.checkIn.actions.generateAndSave))(); h.render();
      expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(initialPosts + 2);
      expect(h.calls.filter((c) => c.method === "POST").at(-1)).toMatchObject({ expectedHead: latest.id });
      expect(h.snapshot()).toMatchObject({ summary: S3.summary, small_step: S3.smallStep,
        recommended_next_tool: S3.recommendedNextTool });
      await info.attach("cancelled-ui-success-handler-storage", { contentType: "application/json",
        body: JSON.stringify({ calls: h.calls, final: h.snapshot() }, null, 2) });
    } finally { ack?.release(); h.dispose(); }
  });

}
