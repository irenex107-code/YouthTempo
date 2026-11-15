import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { expect, type Page } from "@playwright/test";
import zh from "../../locales/zh-CN.json";
import en from "../../locales/en.json";
import referralHandler from "../../pages/api/ai/referral";

export type PortalOptions = {
  mode: "youth" | "adult";
  locale: "zh-CN" | "en";
  view?: "portal" | "referral" | "privacy" | "home" | "teacher" | "adultInfo" | "teenInfo";
  phase?: string;
  list?: "ready" | "pending" | "503";
  post?: "normal" | "urgent" | "429" | "503" | "reject" | "pending";
  consultationAvailable?: boolean;
  wrongAge?: boolean;
  feedbackCase?: boolean;
  feedbackUrgent?: boolean;
  displayContext?: string;
  actualReferralApi?: boolean;
};

const root = process.cwd();
const sourceFiles = ["views/support/CasePortal.tsx", "components/InlineStudentConsent.tsx", "components/PageHero.tsx",
  "views/referral/page.tsx", "views/privacy-safety/page.tsx", "views/page.tsx", "views/for-teachers/page.tsx",
  "views/for-young-adults/page.tsx", "views/for-teens/page.tsx", "components/Cards.tsx", "components/SectionHeader.tsx", "components/IllustrationPanel.tsx"];
const bundleCache = new Map<string, Promise<string>>();
let cssPromise: Promise<string> | undefined;

// Only these application modules may be loaded into the browser. Supabase's
// SDK/config and every real credential/provider module are excluded entirely.
const actualModules: Record<string, string> = {
  "@/views/support/CasePortal": "views/support/CasePortal.tsx",
  "@/components/InlineStudentConsent": "components/InlineStudentConsent.tsx",
  "@/components/PageHero": "components/PageHero.tsx",
  "@/lib/peerSpaceClient": "lib/peerSpaceClient.ts",
  "@/lib/referralDisplayContext": "lib/referralDisplayContext.ts",
  "@/views/referral/page": "views/referral/page.tsx",
  "@/views/privacy-safety/page": "views/privacy-safety/page.tsx",
  "@/views/page": "views/page.tsx",
  "@/views/for-teachers/page": "views/for-teachers/page.tsx",
  "@/views/for-young-adults/page": "views/for-young-adults/page.tsx",
  "@/views/for-teens/page": "views/for-teens/page.tsx",
  "@/components/Cards": "components/Cards.tsx",
  "@/components/SectionHeader": "components/SectionHeader.tsx",
  "@/components/IllustrationPanel": "components/IllustrationPanel.tsx",
  "@/components/AiUrgentNotice": "components/AiUrgentNotice.tsx",
  "@/lib/safety/aiUrgentResponse": "lib/safety/aiUrgentResponse.ts",
};

async function callReferralHandler(body: Record<string, unknown>) {
  let statusCode = 200;
  let payload: unknown;
  const response = {
    setHeader: () => undefined,
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { payload = value; return this; },
  };
  await referralHandler({ method: "POST", body } as never, response as never);
  return { status: statusCode, body: payload };
}

const runtimeSource = `
import * as React from "react";
export const state = { options: window.__product01Options, calls: [], unexpected: [], pending: [], epoch: 0 };
const listeners = new Set();
const actorA = "00000000-0000-4000-8000-000000000011";
export function t(key, values) {
  let value = key.split(".").reduce((object, part) => object?.[part], window.__product01Dictionary);
  if (typeof value !== "string") throw new Error("Missing translation: " + key);
  return value.replace(/\\{\\{(\\w+)\\}\\}/g, (all, name) => values?.[name] ?? all);
}
const trackRequest = () => { const epoch = state.epoch; return () => epoch === state.epoch; };
let consent;
function setConsent(userId, phase) {
  ++state.epoch;
  consent = { userId, phase, studentReady: phase === "ready", busy: false, errorKind: null,
    summary: { role: "student", consent: { ageBand: state.options.mode === "adult" ? "18_plus" : "14_17" } },
    trackRequest, isSameActor: (id) => id === consent.userId,
    refresh: async () => {}, assent: () => forbidden("consent mutation"), completeProfile: () => forbidden("profile mutation") };
  listeners.forEach((listener) => listener());
}
function forbidden(name) { state.unexpected.push(name); throw new Error("Forbidden boundary: " + name); }
setConsent(state.options.phase === "signed_out" ? "" : actorA, state.options.phase || "ready");
export function useConsent() {
  return React.useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => consent);
}
export const getSupabase = () => ({ auth: { getSession: async () => ({ data: { session: consent.userId
  ? { access_token: "synthetic-token", user: { id: consent.userId } } : null }, error: null }) } });
function response(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
const closedCase = { id: "synthetic-case", case_type: state.options.mode === "adult" ? "adult_consultation" : "youth_request", status: "closed", need_summary: "Synthetic support request", availability: null,
  appointment_at: null, appointment_status: "none", referral_type: null, created_at: "2026-11-01T00:00:00Z",
  assignments: [], events: [], feedbackSubmitted: false };
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), "http://local-mock.invalid");
  const method = init.method || "GET";
  const requestBody = init.body ? JSON.parse(init.body) : null;
  state.calls.push({ path: url.pathname, method, body: requestBody, actor: consent.userId });
  if (url.pathname === "/api/support/cases" && method === "GET") {
    if (state.options.list === "pending") return new Promise(() => {});
    if (state.options.list === "503") return response({ error: t("supportFlow.errors.unavailable") }, 503);
    return response({ canUseNewService: consent.studentReady, historyReason: consent.studentReady ? "inactive" : "withdrawn", consultationAvailable: state.options.consultationAvailable !== false,
      ageBand: state.options.wrongAge ? (state.options.mode === "adult" ? "14_17" : "18_plus")
        : state.options.mode === "adult" ? "18_plus" : "14_17",
      cases: state.options.feedbackCase ? [closedCase] : [] });
  }
  if (url.pathname === "/api/support/cases" && method === "POST") {
    if (state.options.post === "pending") return new Promise((resolve) => state.pending.push(resolve));
    if (state.options.post === "reject") throw new TypeError("Synthetic network rejection");
    if (state.options.post === "429" || state.options.post === "503") return response({
      error: t(state.options.post === "429" ? "supportFlow.errors.tooMany" : "supportFlow.errors.unavailable") }, Number(state.options.post));
    return response({ id: "synthetic-case", status: state.options.post === "urgent" ? "triage" : "requested",
      urgent: state.options.post === "urgent" }, 201);
  }
  if (url.pathname === "/api/support/feedback" && method === "POST") return response({ saved: true, urgent: state.options.feedbackUrgent === true }, 201);
  if (url.pathname === "/api/ai/referral" && method === "POST") {
    if (state.options.actualReferralApi) {
      const result = await window.__product01ReferralApi(requestBody || {});
      return response(result.body, result.status);
    }
    return response({ recommendedSupport: "Synthetic support pathway", reason: "Synthetic reason", nextStep: "Synthetic next step",
      whenToSeekMoreSupport: "Synthetic reminder", supportReminder: "Synthetic support boundary",
      decisionMethod: "deterministic_rules", decisionVersion: "synthetic", supportTier: "school_support" });
  }
  return forbidden(method + " " + url.pathname);
};
window.XMLHttpRequest = class { constructor() { forbidden("XMLHttpRequest"); } };
window.WebSocket = class { constructor() { forbidden("WebSocket"); } };
navigator.sendBeacon = () => forbidden("sendBeacon");
window.__product01 = {
  state,
  setActor: (userId, phase = "ready") => setConsent(userId, phase),
  setPost: (post) => { state.options.post = post; },
  resolvePost: (urgent) => state.pending.splice(0).forEach((resolve) => resolve(response({ id: "synthetic-case", urgent }, 201))),
};
`;

const virtualModules: Record<string, string> = {
  "product01:runtime": runtimeSource,
  "@/lib/i18n/client": `import { state, t } from "product01:runtime"; export const useTranslation = () => ({ locale: state.options.locale, t });`,
  "@/lib/useInlineStudentConsent": `export { useConsent as useInlineStudentConsent } from "product01:runtime";`,
  "@/lib/useSessionActor": `import { useConsent } from "product01:runtime"; export const useSessionActor = () => {
    const c = useConsent(); return { actorId: c.userId, phase: c.phase === "signed_out" ? "signed_out" : "ready", trackRequest: c.trackRequest }; };`,
  "@/lib/supabaseClient": `export { getSupabase } from "product01:runtime";`,
  "@/lib/cloudRecords": `export const sendEmailOtp = () => { throw new Error("OTP forbidden"); }; export const verifyEmailOtp = sendEmailOtp;`,
  "@/lib/emailOtp": `export const emailOtpLength = 8; export const isOtpRateLimitError = () => false;
    export const otpRequestErrorMessage = () => "Synthetic OTP error"; export const otpVerificationErrorMessage = otpRequestErrorMessage;`,
  "@/components/MicroPilotFeedback": `export const MicroPilotFeedback = () => null;`,
  "@/components/garden/GardenWelcome": `export const GardenWelcome = () => null;`,
  "next/link": `import { jsx } from "react/jsx-runtime"; export default function Link({ href, children, ...props }) {
    return jsx("a", { ...props, href: typeof href === "string" ? href : href.pathname, children }); }`,
  "next/router": `import { state } from "product01:runtime"; export const useRouter = () => ({ isReady: true,
    query: typeof state.options.displayContext === "string" ? { displayContext: state.options.displayContext } : {} });`,
  "next/image": `import { jsx } from "react/jsx-runtime"; export default function Image({ alt, className, width, height }) {
    return jsx("div", { role: "img", "aria-label": alt, className, style: { aspectRatio: width + "/" + height } }); }`,
};

async function browserBundle(mode: PortalOptions["mode"], view: PortalOptions["view"]) {
  const modules: Record<string, { source: string; dependencies: Record<string, string> }> = {};
  async function add(id: string, file?: string): Promise<string> {
    if (modules[id]) return id;
    let source = virtualModules[id] ?? await readFile(file!, "utf8");
    if (virtualModules[id] || file?.endsWith(".tsx") || file?.endsWith(".ts")) source = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const entry = { source, dependencies: {} as Record<string, string> };
    modules[id] = entry;
    for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const name = match[1];
      if (virtualModules[name]) entry.dependencies[name] = await add(name);
      else if (actualModules[name]) entry.dependencies[name] = await add(name, path.join(root, actualModules[name]));
      else if (/^(react(?:-dom)?(?:\/.*)?|scheduler(?:\/.*)?)$/.test(name) || (file?.includes("node_modules") && name.startsWith("."))) {
        const resolved = createRequire(file || path.join(root, "package.json")).resolve(name);
        if (!/node_modules\/(?:react|react-dom|scheduler)\//.test(resolved)) throw new Error(`Disallowed vendor import: ${name}`);
        entry.dependencies[name] = await add(resolved, resolved);
      } else throw new Error(`Unmocked browser import: ${name}`);
    }
    return id;
  }
  const route = view === "referral" ? "pages/referral.tsx"
    : view === "privacy" ? "pages/privacy-safety.tsx"
      : view === "home" ? "pages/index.tsx"
        : view === "teacher" ? "pages/for-teachers.tsx"
          : view === "adultInfo" ? "pages/for-young-adults.tsx"
            : view === "teenInfo" ? "pages/for-teens.tsx"
            : mode === "adult" ? "pages/consultation.tsx" : "pages/support-request.tsx";
  await add("product01:runtime");
  await add("product01:route", path.join(root, route));
  await add("react-dom/client", createRequire(path.join(root, "package.json")).resolve("react-dom/client"));
  await add("react/jsx-runtime", createRequire(path.join(root, "package.json")).resolve("react/jsx-runtime"));
  return `(function() { const process = { env: { NODE_ENV: "production" } }; const factories = {${Object.entries(modules).map(([id, entry]) =>
    `${JSON.stringify(id)}: [function(module,exports,require) {\n${entry.source}\n}, ${JSON.stringify(entry.dependencies)}]`).join(",\n")}};
    const cache = {}; function load(id) { if (cache[id]) return cache[id].exports;
      const module = cache[id] = { exports: {} }; const [factory, deps] = factories[id];
      factory(module, module.exports, (name) => { if (!deps[name]) throw new Error("Unmocked require " + name); return load(deps[name]); }); return module.exports; }
    load("product01:runtime"); const Root = load("product01:route").default;
    load("react-dom/client").createRoot(document.getElementById("root")).render(load("react/jsx-runtime").jsx(Root, {})); })();`;
}

async function browserCss() {
  const configSource = await readFile(path.join(root, "tailwind.config.ts"), "utf8");
  const compiled = ts.transpileModule(configSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const configModule = { exports: {} as { default?: Record<string, unknown> } };
  // The inspected config contains only a literal theme and no runtime imports.
  new Function("module", "exports", compiled)(configModule, configModule.exports);
  const raw = (await Promise.all(sourceFiles.map((file) => readFile(path.join(root, file), "utf8")))).join("\n");
  const result = await postcss([tailwindcss({ ...configModule.exports.default, content: [{ raw, extension: "tsx" }] }), autoprefixer])
    .process(await readFile(path.join(root, "views/globals.css"), "utf8"), { from: undefined });
  return result.css;
}

export async function openPortal(page: Page, options: PortalOptions) {
  const network: string[] = [];
  const errors: string[] = [];
  await page.unrouteAll({ behavior: "wait" });
  await page.route("**/*", (route) => { network.push(route.request().url()); return route.abort("blockedbyclient"); });
  page.removeAllListeners("pageerror");
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("about:blank");
  await page.setContent(`<html lang="${options.locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'">
    <title>PRODUCT-01 local mock</title></head><body><div id="root"></div></body></html>`);
  await page.evaluate(({ options, dictionary }) => {
    Object.assign(window, { __product01Options: options, __product01Dictionary: dictionary });
  }, { options, dictionary: options.locale === "en" ? en : zh });
  if (options.actualReferralApi) {
    await page.exposeFunction("__product01ReferralApi", (body: Record<string, unknown>) => callReferralHandler(body));
  }
  const cacheKey = `${options.view || "portal"}:${options.mode}`;
  if (!bundleCache.has(cacheKey)) bundleCache.set(cacheKey, browserBundle(options.mode, options.view));
  cssPromise ??= browserCss();
  await page.addStyleTag({ content: await cssPromise });
  await page.addScriptTag({ content: await bundleCache.get(cacheKey)! });
  if (options.view && options.view !== "portal") {
    const copy = options.locale === "en" ? en : zh;
    const heading = options.view === "referral" ? copy.referral.hero.title
      : options.view === "privacy" ? copy.privacySafety.hero.title
        : options.view === "home" ? copy.home.audiences.teachers.title
          : options.view === "teacher" ? copy.forTeachers.hero.title
            : options.view === "teenInfo" ? copy.forTeens.hero.title
              : copy.forYoungAdults.hero.title;
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  } else await expect(page.getByTestId("inline-student-consent")).toBeVisible();
  return { network, errors };
}

export async function mockState(page: Page) {
  return page.evaluate(() => {
    const state = (window as unknown as { __product01: { state: { calls: unknown[]; unexpected: string[] } } }).__product01.state;
    return { calls: state.calls, unexpected: state.unexpected };
  });
}

export async function control(page: Page, action: "setActor" | "setPost" | "resolvePost", value: string | boolean) {
  await page.evaluate(({ action, value }) => {
    (window as unknown as { __product01: Record<string, (value: string | boolean) => void> }).__product01[action](value);
  }, { action, value });
}
