import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { expect, type Page } from "@playwright/test";

export type TerminationOptions = {
  locale: "zh-CN" | "en"; mode?: "youth" | "adult";
  consent?: "active" | "withdrawn" | "error"; adultClosed?: boolean;
  adultAvailabilityReason?: "available" | "ineligible" | "not_open" | "unavailable";
  createFailure?: "offline" | "timeout" | "nonjson503" | 401 | 403 | 429;
  postCreateReadFailure?: number;
};
const root = process.cwd();

let cssPromise: Promise<string> | undefined;

const runtime = String.raw`
export const state = { options: window.__supportOptions, calls: [], authCalls: [], unexpected: [], pending: [], reads: 0, actionQueue: [] };
const A = "00000000-0000-4000-8000-000000000011", B = "00000000-0000-4000-8000-000000000012";
export const CASES = { assigned: "00000000-0000-4000-8000-000000000101", active: "00000000-0000-4000-8000-000000000102", closed: "00000000-0000-4000-8000-000000000103" };
let actor = A, sessionError = false, revisions = 1;
const listeners = new Set(), owners = new Map();
const revision = () => "aaaaaaaa-aaaa-4aaa-8aaa-" + String(++revisions).padStart(12, "0");
const session = () => actor ? { user: { id: actor }, access_token: "synthetic:" + actor } : null;
function hold(kind, value) { return new Promise((resolve) => state.pending.push({ kind, release: () => resolve(value) })); }
export const client = { auth: {
  getSession: async () => {
    state.authCalls.push({ kind: "session", actor });
    const result = { data: { session: session() }, error: sessionError ? new Error("synthetic session unavailable") : null };
    return state.options.holdSession ? hold("session", result) : result;
  },
  getUser: async (token) => {
    state.authCalls.push({ kind: "user", actor });
    const id = String(token).replace("synthetic:", "");
    const result = { data: { user: state.options.userFailure ? null : { id } }, error: state.options.userFailure ? new Error("synthetic identity unavailable") : null };
    return state.options.holdUser ? hold("user", result) : result;
  },
  onAuthStateChange: (fn) => { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
} };
function forbidden(name) { state.unexpected.push(name); throw new Error("Forbidden: " + name); }
function response(body, status = 200, holdBody = false) {
  const result = new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (holdBody) result.json = () => hold("body", body);
  return result;
}
function consentBody(id) { return { role: "student", policyVersion: "2026-08-28", children: [], consent: {
  studentUserId: id, studentName: "Synthetic", ageBand: state.options.mode === "adult" ? "18_plus" : "14_17",
  consentBasis: state.options.mode === "adult" ? "adult_self" : "student_self_pilot", status: state.options.consent || "active",
  policyVersion: "2026-08-28", studentAssentedAt: "2026-10-01T00:00:00Z", guardianUserId: null, guardianConsentedAt: null,
  withdrawnAt: state.options.consent === "withdrawn" ? "2026-10-02T00:00:00Z" : null } }; }
function cases(id) {
  if (!owners.has(id)) {
    const c = (status) => ({ id: CASES[status], case_type: state.options.mode === "adult" ? "adult_consultation" : "youth_request", status,
      need_summary: (id === A ? "A PRIVATE " : "B PRIVATE ") + status, availability: null,
      appointment_at: status === "active" ? "2026-12-01T08:00:00.123456Z" : null,
      appointment_status: status === "active" ? "proposed" : "none", referral_type: null, student_authorization_active: true,
      row_revision: revision(), created_at: "2026-11-01T00:00:00Z",
      assignments: [{ role: "primary", status: "accepted", name: "Synthetic supporter", category: "counselor" }],
      events: [{ action: "requested", status: "requested", createdAt: "2026-11-01T00:00:00Z" }], feedbackSubmitted: false });
    owners.set(id, [c("assigned"), c("active"), c("closed")]);
  }
  return owners.get(id);
}
function adultReason() { return state.options.adultAvailabilityReason
  || (state.options.adultClosed ? "not_open" : "available"); }
function data(id) { return JSON.parse(JSON.stringify({ cases: cases(id).map((item) => ({ ...item, need_summary: item.need_summary + (state.options.marker || "") })),
  ageBand: state.options.mode === "adult" ? "18_plus" : "14_17",
  consultationAvailable: state.options.mode === "adult" ? adultReason() === "available" : !state.options.adultClosed,
  adultAvailabilityReason: state.options.mode === "adult" ? adultReason() : "ineligible",
  canUseNewService: state.options.consent === "active" && !state.options.adultClosed
    && (state.options.mode !== "adult" || adultReason() === "available"),
  historyReason: state.options.consent === "withdrawn" ? "withdrawn" : "consent_unavailable" })); }
function saveAction(item, action) {
  const matchedRevision = item.row_revision;
  if (action === "cancel") { item.status = "cancelled"; item.student_authorization_active = false; }
  else if (action === "withdraw_authorization") { item.status = "paused"; item.student_authorization_active = false; }
  else if (action === "close") { item.status = "closed"; item.student_authorization_active = false; }
  else if (action === "cancel_appointment") item.appointment_status = "cancelled";
  else if (action === "accept_assignment") item.status = "active";
  else if (["reject_assignment", "request_change"].includes(action)) item.status = "transfer_requested";
  else if (action === "accept_appointment") item.appointment_status = "accepted";
  else if (action === "request_reschedule") item.appointment_status = "reschedule_requested";
  item.row_revision = revision();
  item.events.push({ action, status: item.status, createdAt: "2026-11-03T00:00:00Z" });
  return { caseId: item.id, action, status: item.status, appointmentAt: item.appointment_at, appointmentStatus: item.appointment_status,
    referralType: item.referral_type, authorizationActive: item.student_authorization_active, matchedRevision, revision: item.row_revision };
}
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), "https://support-mock.invalid"), method = init.method || "GET";
  if (url.origin !== "https://support-mock.invalid") return forbidden("external fetch " + url.origin);
  const id = (init.headers?.authorization || "").replace("Bearer synthetic:", ""), body = init.body ? JSON.parse(init.body) : null;
  state.calls.push({ path: url.pathname, method, actor: id, body });
  if (!id || id !== actor) return response({ error: "Synthetic sign-in required" }, 401);
  if (url.pathname === "/api/account/status" && method === "GET") return response({ profile: { id, display_name: "Synthetic", role: "学生" }, hasSchool: false, adminAccess: false });
  if (url.pathname === "/api/account/consent") {
    if (method !== "GET") return forbidden("consent mutation");
    return state.options.consent === "error" ? response({ error: "Synthetic consent unavailable" }, 503) : response(consentBody(id));
  }
  if (url.pathname === "/api/support/cases" && method === "GET") {
    ++state.reads;
    const result = state.options.readFailure ? response({ error: "Synthetic history unavailable" }, state.options.readFailure) : response(data(id));
    return state.options.holdRead ? hold("read", result) : result;
  }
  if (url.pathname === "/api/support/case-action" && method === "POST") {
    const queued = state.actionQueue.shift() || {}, terminal = ["cancel", "withdraw_authorization", "close", "cancel_appointment"].includes(body.action);
    const fail = queued.status || state.options.actionFailure;
    if (fail) {
      const refused = response({ error: "Synthetic action refused" }, fail, state.options.holdBody);
      return state.options.holdActionHeaders ? hold("write", refused) : refused;
    }
    if (state.options.actionNetwork) throw new Error("Synthetic network rejection");
    if (!terminal && (state.options.consent !== "active" || state.options.adultClosed)) return forbidden("disabled continuation");
    const item = cases(id).find((value) => value.id === body.caseId);
    if (!item) return response({ error: "Synthetic no access" }, 404);
    if (terminal && (body.expectedStatus !== item.status || (body.action === "cancel_appointment" && body.expectedAppointmentRevision !== item.row_revision))) {
      return response({ error: "Synthetic conflict" }, 409);
    }
    const result = saveAction(item, body.action);
    if (state.options.postReadFailure) state.options.readFailure = state.options.postReadFailure;
    const payload = state.options.malformed ? {} : { ...result, ...(state.options.receiptPatch || {}) };
    const resultResponse = response(payload, 200, state.options.holdBody);
    return state.options.holdWrite ? hold("write", resultResponse) : resultResponse;
  }
  if (url.pathname === "/api/support/cases" && method === "POST") {
    const failure = state.options.createFailure;
    if (failure === 401) return response({ error: state.options.locale === "en" ? "Please sign in." : "请先登录。" }, 401);
    if (failure === 403) return response({ error: state.options.locale === "en" ? "This support pathway is not available to your account." : "当前账号不适用这项支持。" }, 403);
    if (failure === 429) return response({ error: state.options.locale === "en" ? "Too many requests. Please try again later." : "请求有些频繁，请稍后再试。" }, 429);
    if (state.options.serviceFailure) return response({ error: "Synthetic service denied" }, state.options.serviceFailure);
    if (state.options.consent !== "active" || state.options.adultClosed) return forbidden("disabled creation");
    const created = { id: "00000000-0000-4000-8000-000000000201", case_type: state.options.mode === "adult" ? "adult_consultation" : "youth_request",
      status: "requested", need_summary: body.needSummary, availability: body.availability || null,
      appointment_at: null, appointment_status: "none", referral_type: null, student_authorization_active: true,
      row_revision: revision(), created_at: "2026-11-11T00:00:00Z", assignments: [],
      events: [{ action: "requested", status: "requested", createdAt: "2026-11-11T00:00:00Z" }], feedbackSubmitted: false };
    cases(id).unshift(created);
    if (failure === "offline") throw new TypeError("SYNTHETIC PRIVATE response lost after create");
    if (failure === "timeout") return new Promise((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("SYNTHETIC PRIVATE timeout", "AbortError")), { once: true });
    });
    if (failure === "nonjson503") return new Response("SYNTHETIC PRIVATE upstream", { status: 503, headers: { "content-type": "text/html" } });
    if (state.options.postCreateReadFailure) state.options.readFailure = state.options.postCreateReadFailure;
    const result = response({ id: "00000000-0000-4000-8000-000000000201", status: "requested", urgent: state.options.urgent === true }, 201);
    return state.options.holdWrite ? hold("write", result) : result;
  }
  if (url.pathname === "/api/support/feedback" && method === "POST") {
    if (state.options.serviceFailure) return response({ error: "Synthetic feedback denied" }, state.options.serviceFailure);
    if (state.options.consent !== "active" || state.options.adultClosed) return forbidden("disabled feedback");
    const item = cases(id).find((value) => value.id === body.caseId);
    if (item) item.feedbackSubmitted = true;
    return response({ saved: true, urgent: state.options.urgent === true }, 201);
  }
  return forbidden(method + " " + url.pathname);
};
window.XMLHttpRequest = class { constructor() { forbidden("XMLHttpRequest"); } };
window.WebSocket = class { constructor() { forbidden("WebSocket"); } };
navigator.sendBeacon = () => forbidden("sendBeacon");
window.__support = { state,
  set: (key, value) => { state.options[key] = value; },
  actor: (id) => { actor = id; listeners.forEach((fn) => fn(id ? "SIGNED_IN" : "SIGNED_OUT", session())); },
  sessionError: (value) => { sessionError = value; },
  consent: (value) => { state.options.consent = value; window.dispatchEvent(new Event("youthtempo:consent-updated")); },
  release: (kind = "all") => {
    const selected = state.pending.filter((item) => kind === "all" || item.kind === kind);
    state.pending = state.pending.filter((item) => !selected.includes(item)); selected.forEach((item) => item.release());
  },
  queue: (status) => state.actionQueue.push({ status }),
  case: (patch) => { const item = cases(actor).find((value) => value.id === CASES.active); Object.assign(item, patch); },
  propose: () => { const item = cases(actor).find((value) => value.id === CASES.active); item.status = "active"; item.appointment_status = "proposed"; item.appointment_at = "2026-12-02T08:00:00.654321Z"; item.row_revision = revision(); },
};
`;
const virtual: Record<string, string> = {
  "support:runtime": runtime,
  "@/lib/cloudRecords": `export const sendEmailOtp = () => { throw new Error("OTP forbidden"); }; export const verifyEmailOtp = sendEmailOtp; export const saveProfile = sendEmailOtp;`,
  "@/lib/supabaseClient": `export { client } from "support:runtime"; import { client } from "support:runtime"; export const getSupabase = () => client;`,
  "@/lib/emailOtp": `export const emailOtpLength = 8; export const isOtpRateLimitError = () => false; export const otpRequestErrorMessage = () => "Synthetic OTP error"; export const otpVerificationErrorMessage = otpRequestErrorMessage;`,
  "@/components/MicroPilotFeedback": `import { jsx } from "react/jsx-runtime"; export const MicroPilotFeedback = ({ trigger }) => jsx("div", { "data-testid": "micro-feedback", "data-trigger": String(trigger) });`,
  "next/router": `export const useRouter = () => ({ locale: window.__supportOptions.locale });`,
  "next/link": `import { jsx } from "react/jsx-runtime"; export default function Link({ href, children, ...props }) { return jsx("a", { ...props, href: window.__supportOptions.locale === "en" ? "/en" + href : href, children }); }`,
};

async function bundle(mode: string) {
  const modules: Record<string, { source: string; dependencies: Record<string, string> }> = {};
  const allowed = new Set(["views/support/CasePortal.tsx", "pages/support-request.tsx", "pages/consultation.tsx", "components/PageHero.tsx", "components/InlineStudentConsent.tsx", "lib/peerSpaceClient.ts",
    "lib/useInlineStudentConsent.ts", "lib/useSessionActor.ts", "lib/studentConsent.ts",
    "lib/i18n/client.tsx", "lib/i18n/config.ts", "lib/i18n/dictionaries.ts", "locales/zh-CN.json", "locales/en.json"]);
  async function add(id: string, file?: string): Promise<string> {
    if (modules[id]) return id;
    const source = virtual[id] ?? await readFile(file!, "utf8");
    const compiled = file?.endsWith(".json") ? `module.exports = ${source};` : ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const entry = modules[id] = { source: compiled, dependencies: {} as Record<string, string> };
    for (const match of compiled.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const name = match[1];
      if (virtual[name]) entry.dependencies[name] = await add(name);
      else if (name.startsWith("@/")) {
        const base = name.slice(2), local = [base, base + ".ts", base + ".tsx"].find((p) => allowed.has(p));
        if (!local) throw new Error(`Unmocked application module: ${name}`);
        entry.dependencies[name] = await add(name, path.join(root, local));
      } else if (/^(react(?:-dom)?(?:\/.*)?|scheduler(?:\/.*)?)$/.test(name) || (file?.includes("node_modules") && name.startsWith("."))) {
        const resolved = createRequire(file || path.join(root, "package.json")).resolve(name);
        if (!/node_modules\/(?:react|react-dom|scheduler)\//.test(resolved)) throw new Error(`Disallowed vendor: ${name}`);
        entry.dependencies[name] = await add(resolved, resolved);
      } else throw new Error(`Unmocked import: ${name}`);
    }
    return id;
  }
  await add("support:runtime");
  await add("support:route", path.join(root, mode === "adult" ? "pages/consultation.tsx" : "pages/support-request.tsx"));
  await add("@/lib/i18n/client", path.join(root, "lib/i18n/client.tsx"));
  for (const name of ["react-dom/client", "react/jsx-runtime"]) await add(name, createRequire(path.join(root, "package.json")).resolve(name));
  return `(function() { const process = { env: { NODE_ENV: "production" } }; const factories = {${Object.entries(modules).map(([id, e]) =>
    `${JSON.stringify(id)}: [function(module,exports,require) {\n${e.source}\n}, ${JSON.stringify(e.dependencies)}]`).join(",\n")}};
    const cache = {}; function load(id) { if (cache[id]) return cache[id].exports; const module = cache[id] = { exports: {} };
      const [factory,deps] = factories[id]; factory(module,module.exports,(name) => { if (!deps[name]) throw new Error("Unmocked require " + name); return load(deps[name]); }); return module.exports; }
    load("support:runtime"); const jsx = load("react/jsx-runtime").jsx;
    load("react-dom/client").createRoot(document.getElementById("root")).render(jsx(load("@/lib/i18n/client").I18nProvider, { children: jsx(load("support:route").default, {}) })); })();`;
}

async function css() {
  const config = ts.transpileModule(await readFile(path.join(root, "tailwind.config.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const configModule = { exports: {} as { default?: Record<string, unknown> } };
  new Function("module", "exports", config)(configModule, configModule.exports);
  const files = ["views/support/CasePortal.tsx", "components/PageHero.tsx", "components/InlineStudentConsent.tsx"];
  const raw = (await Promise.all(files.map((f) => readFile(path.join(root, f), "utf8")))).join("\n");
  return (await postcss([tailwindcss({ ...configModule.exports.default, content: [{ raw, extension: "tsx" }] }), autoprefixer])
    .process(await readFile(path.join(root, "views/globals.css"), "utf8"), { from: undefined })).css;
}

export async function openTermination(page: Page, options: TerminationOptions) {
  const network: string[] = [], errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const url = `https://support-mock.invalid${options.locale === "en" ? "/en" : ""}/${options.mode === "adult" ? "consultation" : "support-request"}`;
  await page.route("**/*", (route) => {
    if (route.request().url() === url && route.request().isNavigationRequest()) return route.fulfill({ status: 200, contentType: "text/html", body: `<html lang="${options.locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'"></head><body><div id="root"></div></body></html>` });
    network.push(route.request().url()); return route.abort("blockedbyclient");
  });
  await page.goto(url);
  await page.evaluate((options) => Object.assign(window, { __supportOptions: { consent: "active", ...options } }), options);
  cssPromise ??= css();
  await page.addStyleTag({ content: await cssPromise });
  // Bundles differ only by actual route; no SDK/config/env is imported.
  await page.addScriptTag({ content: await bundle(options.mode || "youth") });
  if (await page.locator("#support-immediate-help").count() === 0 && errors.length) {
    throw new Error(`Synthetic support fixture did not render: ${errors.join(" | ")}`);
  }
  await expect(page.locator("#support-immediate-help")).toBeVisible();
  return { network, errors };
}
export function controlTermination(page: Page, action: string, ...args: unknown[]) {
  return page.evaluate(({ action, args }) => {
    (window as unknown as { __support: Record<string, (...args: unknown[]) => unknown> }).__support[action](...args);
  }, { action, args });
}
export function terminationState(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __support: { state: { calls: Array<{ path: string; method: string; actor: string; body: Record<string, unknown> | null }>; authCalls: Array<{ kind: string; actor: string }>; unexpected: string[]; reads: number; pending: Array<{ kind: string }> } } }).__support.state;
    return { calls: s.calls, authCalls: s.authCalls, unexpected: s.unexpected, reads: s.reads, pending: s.pending.map((item) => item.kind) };
  });
}
