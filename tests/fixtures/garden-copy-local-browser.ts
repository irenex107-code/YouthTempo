import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { expect, type Page } from "@playwright/test";

export type GardenOptions = { locale: "zh-CN" | "en"; total?: number; todayParticipated?: boolean; intro?: boolean; visitor?: boolean; consent?: "active" | "withdrawn" | "error"; recordFailure?: "lost"; readFailures?: number; holdRecord?: boolean; holdRefresh?: boolean; auxFailure?: "lost"; auxHold?: boolean; identityFailure?: boolean };
const root = process.cwd();
let bundlePromise: Promise<string> | undefined;
let cssPromise: Promise<string> | undefined;

const runtime = String.raw`
import { gardenStage, gardenSceneLevel } from "@/lib/tempoGarden";
import { unlockedGardenItems, unlockedGardenPositions } from "@/lib/gardenCatalog";
const options = window.__gardenOptions;
const A = "00000000-0000-4000-8000-000000000011", B = "00000000-0000-4000-8000-000000000012";
const pending = [], listeners = new Set();
let actor = options.visitor ? "" : A, identityFailure = Boolean(options.identityFailure);
const store = "youthtempo:synthetic-garden-copy";
const previous = JSON.parse(sessionStorage.getItem(store) || "null");
const total = options.total ?? 28;
export const state = previous || { calls: [], unexpected: [], garden: {
  total, stage: gardenStage(total), sceneLevel: gardenSceneLevel(total), thisWeek: Math.min(total, 7), thisMonth: total,
  quickCheckIns: total, fullSweetRecords: 0, todayParticipated: options.todayParticipated ?? total > 0,
  unlockedPositions: unlockedGardenPositions(total), unlockedItems: unlockedGardenItems(total),
  reminderMode: "off", canCareToday: (options.todayParticipated ?? total > 0), todayCare: null,
  canAddKeepsakeToday: (options.todayParticipated ?? total > 0), layout: {}, keepsakes: [], hasExistingData: total > 0,
  canUseGarden: true, managementReason: null,
} };
const persist = () => sessionStorage.setItem(store, JSON.stringify(state));
const user = () => actor ? { id: actor } : null;
const session = () => actor ? { user: user(), access_token: "synthetic:" + actor } : null;
export const client = { auth: {
  getSession: async () => ({ data: { session: session() }, error: null }),
  getUser: async () => ({ data: { user: identityFailure ? null : user() }, error: null }),
  onAuthStateChange: (fn) => { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
} };
function hold(value) { return new Promise((resolve) => pending.push(() => resolve(value))); }
function currentGarden(id) {
  const g = id === A ? state.garden : { ...state.garden, total: 0, stage: "seed", thisWeek: 0, thisMonth: 0,
    todayParticipated: false, canCareToday: false, todayCare: null, unlockedPositions: [], unlockedItems: [], layout: {}, hasExistingData: false };
  return { ...g, canUseGarden: !options.consent || options.consent === "active",
    managementReason: options.consent === "withdrawn" ? "withdrawn" : options.consent === "error" ? "consent_unavailable" : null };
}
function forbidden(name) { state.unexpected.push(name); persist(); throw new Error("Forbidden: " + name); }
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), "https://garden-copy.invalid"), method = init.method || "GET";
  if (url.origin !== "https://garden-copy.invalid") return forbidden("external fetch " + url.origin);
  const body = init.body ? JSON.parse(init.body) : null;
  const id = (init.headers?.authorization || "").replace("Bearer synthetic:", "");
  state.calls.push({ path: url.pathname, method, body, actor: id }); persist();
  if (!actor || id !== actor) return response({ error: "Synthetic sign-in required" }, 401);
  if (url.pathname === "/api/account/status" && method === "GET") return response({ profile: { id, display_name: "Synthetic", role: "学生" }, hasSchool: false, adminAccess: false });
  if (url.pathname === "/api/account/consent" && method === "GET") {
    if (options.consent === "error") return response({ error: "Synthetic consent unavailable" }, 503);
    return response({ role: "student", policyVersion: "2026-08-28", children: [], consent: {
    studentUserId: id, studentName: "Synthetic", ageBand: "14_17", consentBasis: "student_self_pilot", status: options.consent || "active",
    policyVersion: "2026-08-28", studentAssentedAt: "2026-10-01T00:00:00Z", guardianUserId: null, guardianConsentedAt: null, withdrawnAt: options.consent === "withdrawn" ? "2026-11-04T00:00:00Z" : null,
  } }); }
  if (url.pathname === "/api/garden" && method === "GET") {
    const saved = state.calls.some((c) => c.path === "/api/garden" && c.method === "POST" && c.actor === id);
    if (saved && options.readFailures > 0) { --options.readFailures; return response({ error: "Synthetic read failure" }, 503); }
    const result = response(currentGarden(id));
    return saved && id === A && options.holdRefresh ? hold(result) : result;
  }
  if (options.consent && options.consent !== "active") return response({ error: "Synthetic active consent required" }, 403);
  if (url.pathname === "/api/garden" && method === "POST") {
    const g = state.garden, next = g.total + (g.todayParticipated ? 0 : 1);
    state.garden = { ...g, total: next, stage: gardenStage(next), sceneLevel: gardenSceneLevel(next),
      thisWeek: Math.min(next, 7), thisMonth: next, quickCheckIns: g.quickCheckIns + 1, todayParticipated: true,
      unlockedPositions: unlockedGardenPositions(next), unlockedItems: unlockedGardenItems(next),
      canCareToday: !g.todayCare, canAddKeepsakeToday: true, hasExistingData: true };
    persist();
    if (options.recordFailure === "lost") throw new TypeError("Synthetic record response lost");
    const result = response({ checkIn: { id: "synthetic-record", created_at: "2026-11-04T04:00:00Z" } }, 201);
    return options.holdRecord ? hold(result) : result;
  }
  if (url.pathname === "/api/garden/care" && method === "POST") {
    if (!state.garden.todayParticipated) return response({ error: "Synthetic record required" }, 409);
    const created = !state.garden.todayCare;
    state.garden.todayCare ||= { date: "2026-11-04", action: body.action };
    state.garden.canCareToday = false; persist();
    if (options.auxFailure === "lost") throw new TypeError("Synthetic care response lost");
    const result = response({ care: state.garden.todayCare, created }, created ? 201 : 200);
    return options.auxHold ? hold(result) : result;
  }
  if (url.pathname === "/api/garden/layout" && method === "PUT") {
    state.garden.layout[body.slot] = body.itemKey; persist(); return response({ layoutItem: body });
  }
  return forbidden(method + " " + url.pathname);
};
window.XMLHttpRequest = class { constructor() { forbidden("XMLHttpRequest"); } };
window.WebSocket = class { constructor() { forbidden("WebSocket"); } };
navigator.sendBeacon = () => forbidden("sendBeacon");
window.__gardenCopy = { state, pending: () => pending.length,
  release: () => { options.holdRecord = false; options.holdRefresh = false; options.auxHold = false; pending.splice(0).forEach((resolve) => resolve()); },
  setActor: (value) => { actor = value === "A" ? A : value === "B" ? B : ""; listeners.forEach((fn) => fn(actor ? "SIGNED_IN" : "SIGNED_OUT", session())); },
  setConsent: (value) => { options.consent = value; window.dispatchEvent(new Event("youthtempo:consent-updated")); },
};
if (!options.intro) { localStorage.setItem("youthtempo:garden:intro:v2:" + A, "seen"); localStorage.setItem("youthtempo:garden:intro:v2:" + B, "seen"); }
`;

const virtual: Record<string, string> = {
  "garden:runtime": runtime,
  "@/lib/supabaseClient": `export { client } from "garden:runtime"; import { client } from "garden:runtime"; export const getSupabase = () => client; export const signOutSupabaseSession = () => { throw new Error("Unexpected signout transport"); };`,
  "@/lib/emailOtp": `export const emailOtpLength = 8; export const isOtpRateLimitError = () => false; export const otpRequestErrorMessage = () => "Synthetic OTP error"; export const otpVerificationErrorMessage = otpRequestErrorMessage;`,
  "@/components/MicroPilotFeedback": `export const MicroPilotFeedback = () => null;`,
  "next/router": `export const useRouter = () => ({ locale: window.__gardenOptions.locale });`,
  "next/link": `import { jsx } from "react/jsx-runtime"; export default function Link({ href, children, ...props }) { return jsx("a", { ...props, href: window.__gardenOptions.locale === "en" ? "/en" + href : href, children }); }`,
  "next/image": `import { jsx } from "react/jsx-runtime"; export const getImageProps = (props) => ({ props: { src: window.__gardenImages[props.src], srcSet: window.__gardenImages[props.src] + " 1x", sizes: props.sizes } });
    export default function Image({ src, alt, className, width, height }) { return jsx("img", { src: window.__gardenImages[src], alt, className, width, height }); }`,
};

async function bundle() {
  const modules: Record<string, { source: string; dependencies: Record<string, string> }> = {};
  const allowed = new Set(["pages/garden.tsx", "views/garden/page.tsx", "components/InlineStudentConsent.tsx", "lib/cloudRecords.ts",
    "lib/tempoGarden.ts", "lib/useInlineStudentConsent.ts", "lib/useSessionActor.ts", "lib/studentConsent.ts", "lib/gardenCatalog.ts", "lib/sweetRecordDays.ts", "lib/sweetPersistenceProtocol.ts",
    "lib/i18n/client.tsx", "lib/i18n/config.ts", "lib/i18n/dictionaries.ts", "locales/zh-CN.json", "locales/en.json",
    ...(await readdir(path.join(root, "components/garden"))).filter((f) => f.endsWith(".tsx")).map((f) => `components/garden/${f}`)]);
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
  await add("garden:runtime");
  await add("garden:route", path.join(root, "pages/garden.tsx"));
  await add("@/lib/i18n/client", path.join(root, "lib/i18n/client.tsx"));
  for (const name of ["react-dom/client", "react/jsx-runtime"]) await add(name, createRequire(path.join(root, "package.json")).resolve(name));
  return `(function() { const process = { env: { NODE_ENV: "production" } }; const factories = {${Object.entries(modules).map(([id, e]) =>
    `${JSON.stringify(id)}: [function(module,exports,require) {\n${e.source}\n}, ${JSON.stringify(e.dependencies)}]`).join(",\n")}};
    const cache = {}; function load(id) { if (cache[id]) return cache[id].exports; const module = cache[id] = { exports: {} };
      const [factory,deps] = factories[id]; factory(module,module.exports,(name) => { if (!deps[name]) throw new Error("Unmocked require " + name); return load(deps[name]); }); return module.exports; }
    load("garden:runtime"); const jsx = load("react/jsx-runtime").jsx;
    load("react-dom/client").createRoot(document.getElementById("root")).render(jsx(load("@/lib/i18n/client").I18nProvider, { children: jsx(load("garden:route").default, {}) })); })();`;
}

async function css() {
  const config = ts.transpileModule(await readFile(path.join(root, "tailwind.config.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const configModule = { exports: {} as { default?: Record<string, unknown> } };
  new Function("module", "exports", config)(configModule, configModule.exports);
  const files = ["views/garden/page.tsx", "components/InlineStudentConsent.tsx", ...(await readdir(path.join(root, "components/garden"))).filter((f) => f.endsWith(".tsx")).map((f) => `components/garden/${f}`)];
  const raw = (await Promise.all(files.map((f) => readFile(path.join(root, f), "utf8")))).join("\n");
  return (await postcss([tailwindcss({ ...configModule.exports.default, content: [{ raw, extension: "tsx" }] }), autoprefixer])
    .process(await readFile(path.join(root, "views/globals.css"), "utf8"), { from: undefined })).css;
}

export async function openGarden(page: Page, options: GardenOptions) {
  const network: string[] = [], errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const url = `https://garden-copy.invalid${options.locale === "en" ? "/en" : ""}/garden`;
  const images: Record<string, string> = {};
  for (const f of (await readdir(path.join(root, "public/illustrations/garden"))).filter((f) => f.endsWith(".png"))) {
    images["/illustrations/garden/" + f] = "data:image/png;base64," + (await readFile(path.join(root, "public/illustrations/garden", f))).toString("base64");
  }
  bundlePromise ??= bundle(); cssPromise ??= css();
  const html = `<html lang="${options.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'"><style>${await cssPromise}</style></head><body><div id="root"></div><script>window.__gardenOptions=${JSON.stringify(options)};window.__gardenImages=${JSON.stringify(images)};${await bundlePromise}</script></body></html>`;
  await page.route("**/*", (route) => {
    if (route.request().url() === url && route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    network.push(route.request().url()); return route.abort("blockedbyclient");
  });
  await page.goto(url);
  if (options.identityFailure) await expect(page.getByTestId("garden-read-identity")).toBeVisible();
  else await expect(page.locator(".garden-scene")).toBeVisible();
  return { network, errors };
}

export function gardenState(page: Page) {
  return page.evaluate(() => (window as unknown as { __gardenCopy: { state: {
    calls: Array<{ path: string; method: string; body: unknown }>; unexpected: string[];
    garden: { total: number; stage: string; layout: Record<string, string>; todayCare: { action: string } | null; unlockedPositions: string[] };
  } } }).__gardenCopy.state);
}

export function controlGarden(page: Page, action: string, ...args: unknown[]) {
  return page.evaluate(({ action, args }) => {
    const control = (window as unknown as { __gardenCopy: Record<string, (...args: unknown[]) => unknown> }).__gardenCopy;
    return control[action](...args);
  }, { action, args });
}
