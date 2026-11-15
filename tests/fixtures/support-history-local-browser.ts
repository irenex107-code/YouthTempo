import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { expect, type Page } from "@playwright/test";

export type SupportOptions = { locale: "zh-CN" | "en"; consent?: "active" | "withdrawn" | "error" | "not_started"; mode?: "youth" | "adult"; empty?: boolean; readFailure?: number; identityFailure?: boolean; hold?: "read" | "write"; adultClosed?: boolean };
const root = process.cwd();

let cssPromise: Promise<string> | undefined;

const runtime = String.raw`
export const state = { options: window.__supportOptions, calls: [], unexpected: [], pending: [], reads: 0 };
const A = "00000000-0000-4000-8000-000000000011", B = "00000000-0000-4000-8000-000000000012";
let actor = A, sessionError = false;
const listeners = new Set();
const session = () => actor ? { user: { id: actor }, access_token: "synthetic:" + actor } : null;
export const client = { auth: {
  getSession: async () => ({ data: { session: session() }, error: sessionError || state.options.identityFailure ? new Error("synthetic session unavailable") : null }),
  onAuthStateChange: (fn) => { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
} };
function forbidden(name) { state.unexpected.push(name); throw new Error("Forbidden: " + name); }
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function consentBody(id) { return { role: "student", policyVersion: "2026-08-28", children: [], consent: {
  studentUserId: id, studentName: "Synthetic", ageBand: state.options.mode === "adult" ? "18_plus" : "14_17",
  consentBasis: state.options.mode === "adult" ? "adult_self" : "student_self_pilot", status: state.options.consent || "active",
  policyVersion: "2026-08-28", studentAssentedAt: "2026-10-01T00:00:00Z", guardianUserId: null, guardianConsentedAt: null,
  withdrawnAt: state.options.consent === "withdrawn" ? "2026-10-02T00:00:00Z" : null } }; }
function data(id) {
  const c = (status, i) => ({ id: id + i, case_type: state.options.crossType ? (state.options.mode === "adult" ? "youth_request" : "adult_consultation") : state.options.mode === "adult" ? "adult_consultation" : "youth_request", status, need_summary: (id === A ? "A PRIVATE " : "B PRIVATE ") + (state.options.marker || "") + status,
    availability: null, appointment_at: status === "active" ? "2026-11-04T10:00:00Z" : null, appointment_status: "proposed", referral_type: null,
    created_at: "2026-11-01T00:00:00Z", assignments: [{ role: "primary", status: "accepted", name: "Synthetic supporter", category: "counselor" }],
    events: [{ action: "requested", status: "requested", createdAt: "2026-11-01T00:00:00Z" }], feedbackSubmitted: false });
  return { cases: state.options.empty ? [] : [c("assigned", 1), c("active", 2), c("closed", 3)],
    ageBand: state.options.mode === "adult" ? "18_plus" : "14_17", consultationAvailable: !state.options.adultClosed,
    canUseNewService: state.options.consent === "active" && !state.options.adultClosed,
    historyReason: state.options.consent === "withdrawn" ? "withdrawn" : "consent_unavailable" };
}
function hold(result) { return new Promise((resolve) => state.pending.push(() => resolve(result))); }
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), "https://support-mock.invalid"), method = init.method || "GET";
  const id = (init.headers?.authorization || "").replace("Bearer synthetic:", "");
  state.calls.push({ path: url.pathname, method, actor: id, body: init.body ? JSON.parse(init.body) : null });
  if (!id || id !== actor) return response({ error: "Synthetic sign-in required" }, 401);
  if (url.pathname === "/api/account/status") return response({ profile: { id, display_name: "Synthetic", role: "学生" }, hasSchool: false, adminAccess: false });
  if (url.pathname === "/api/account/consent") {
    if (method !== "GET") return forbidden("consent mutation");
    return state.options.consent === "error" ? response({ error: "Synthetic consent unavailable" }, 503) : response(consentBody(id));
  }
  if (url.pathname === "/api/support/cases" && method === "GET") {
    ++state.reads;
    const result = state.options.readFailure ? response({ error: "Synthetic history unavailable" }, state.options.readFailure) : response(data(id));
    return state.options.hold === "read" && id === A ? hold(result) : result;
  }
  if (["/api/support/cases", "/api/support/case-action", "/api/support/feedback"].includes(url.pathname) && method === "POST") {
    if (state.options.consent !== "active" || state.options.adultClosed) return forbidden("disabled write");
    const result = response({ id: "synthetic", status: "requested", saved: true, urgent: state.options.urgent === true }, 201);
    return state.options.hold === "write" ? hold(result) : result;
  }
  return forbidden(method + " " + url.pathname);
};
window.XMLHttpRequest = class { constructor() { forbidden("XMLHttpRequest"); } };
window.WebSocket = class { constructor() { forbidden("WebSocket"); } };
navigator.sendBeacon = () => forbidden("sendBeacon");
window.__support = { state,
  set: (key, value) => { state.options[key] = value; },
  actor: (id) => { actor = id; listeners.forEach((fn) => fn(id ? "SIGNED_IN" : "SIGNED_OUT", session())); },
  sessionError: (value) => { sessionError = value; window.dispatchEvent(new Event("focus")); },
  consent: (value) => { state.options.consent = value; window.dispatchEvent(new Event("youthtempo:consent-updated")); },
  release: () => state.pending.splice(0).forEach((fn) => fn()),
};
`;
const virtual: Record<string, string> = {
  "support:runtime": runtime,
  "@/lib/cloudRecords": `export const sendEmailOtp = () => { throw new Error("OTP forbidden"); }; export const verifyEmailOtp = sendEmailOtp; export const saveProfile = sendEmailOtp;`,
  "@/lib/supabaseClient": `export { client } from "support:runtime"; import { client } from "support:runtime"; export const getSupabase = () => client;`,
  "@/lib/emailOtp": `export const emailOtpLength = 8; export const isOtpRateLimitError = () => false; export const otpRequestErrorMessage = () => "Synthetic OTP error"; export const otpVerificationErrorMessage = otpRequestErrorMessage;`,
  "@/components/MicroPilotFeedback": `import { jsx } from "react/jsx-runtime"; export const MicroPilotFeedback = () => jsx("div", { "data-testid": "micro-feedback" });`,
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

export async function openSupport(page: Page, options: SupportOptions) {
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
  await expect(page.locator("#root main")).toBeVisible();
  return { network, errors };
}
export function controlSupport(page: Page, action: string, ...args: unknown[]) {
  return page.evaluate(({ action, args }) => {
    (window as unknown as { __support: Record<string, (...args: unknown[]) => unknown> }).__support[action](...args);
  }, { action, args });
}
export function supportState(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __support: { state: { calls: Array<{ path: string; method: string; actor: string }>; unexpected: string[]; reads: number; pending: unknown[] } } }).__support.state;
    return { calls: s.calls, unexpected: s.unexpected, reads: s.reads, pending: s.pending.length };
  });
}
