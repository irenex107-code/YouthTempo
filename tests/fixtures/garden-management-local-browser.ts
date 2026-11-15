import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { expect, type Page } from "@playwright/test";

export type GardenOptions = { locale: "zh-CN" | "en"; consent?: "active" | "withdrawn" | "error"; empty?: boolean;
  deletion?: "ok" | "reject" | "lost" | "denied" | "malformed"; hold?: "read" | "delete" | "create"; readFailure?: number; identityFailure?: boolean };
const root = process.cwd();
let bundlePromise: Promise<string> | undefined;
let cssPromise: Promise<string> | undefined;

const runtime = String.raw`
export const state = { options: window.__gardenOptions, calls: [], unexpected: [], pending: [], reads: 0, deletes: 0, identityReads: 0 };
const A = "00000000-0000-4000-8000-000000000011", B = "00000000-0000-4000-8000-000000000012";
const ID = "00000000-0000-4000-8000-000000000013";
let actor = A, sessionError = false;
const listeners = new Set();
const session = () => actor ? { user: { id: actor }, access_token: "synthetic:" + actor } : null;
export const client = { auth: {
  getSession: async () => ({ data: { session: session() }, error: sessionError ? new Error("synthetic session unavailable") : null }),
  getUser: async () => { ++state.identityReads; return { data: { user: state.options.identityFailure ? null : session()?.user }, error: null }; },
  onAuthStateChange: (fn) => { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
} };
function forbidden(name) { state.unexpected.push(name); throw new Error("Forbidden: " + name); }
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function consentBody(id) { return { role: "student", policyVersion: "2026-08-28", children: [], consent: {
  studentUserId: id, studentName: "Synthetic", ageBand: "14_17", consentBasis: "student_self_pilot",
  status: state.options.consent || "active", policyVersion: "2026-08-28", studentAssentedAt: "2026-10-01T00:00:00Z",
  guardianUserId: null, guardianConsentedAt: null, withdrawnAt: state.options.consent === "withdrawn" ? "2026-10-02T00:00:00Z" : null,
} }; }
const gardens = {};
function initial(id) { return { total: state.options.empty ? 0 : id === A ? 7 : 2, stage: id === A ? "bloom" : "sprout",
  sceneLevel: "base", thisWeek: 1, thisMonth: 1, quickCheckIns: 7, fullSweetRecords: 0,
  todayParticipated: true, unlockedPositions: ["flower_border"], unlockedItems: ["low_fern"],
  reminderMode: "weekly", canCareToday: true, canAddKeepsakeToday: true, todayCare: null,
  layout: state.options.empty ? {} : { flower_border: "low_fern" },
  keepsakes: state.options.empty ? [] : [{ id: id === A ? ID : B, date: "2026-10-01", type: id === A ? "flower" : "stone" }],
  hasExistingData: !state.options.empty }; }
function garden(id) {
  gardens[id] ||= initial(id);
  return { ...gardens[id], canUseGarden: state.options.consent === "active",
    managementReason: state.options.consent === "withdrawn" ? "withdrawn" : state.options.consent === "error" ? "consent_unavailable" : null };
}
function hold(result) { return new Promise((resolve) => state.pending.push(() => resolve(result))); }
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), "https://garden-mock.invalid"), method = init.method || "GET";
  const id = (init.headers?.authorization || "").replace("Bearer synthetic:", "");
  state.calls.push({ path: url.pathname, method, actor: id, body: init.body ? JSON.parse(init.body) : null });
  if (!id || id !== actor) return response({ error: "Synthetic sign-in required" }, 401);
  if (url.pathname === "/api/account/status") return response({ profile: { id, display_name: "Synthetic", role: "学生" }, hasSchool: false, adminAccess: false });
  if (url.pathname === "/api/account/consent") {
    if (method !== "GET") return forbidden("consent mutation");
    return state.options.consent === "error" ? response({ error: "Synthetic consent unavailable" }, 503) : response(consentBody(id));
  }
  if (url.pathname === "/api/garden" && method === "GET") {
    ++state.reads;
    const result = state.options.readFailure ? response({ error: "Synthetic garden unavailable" }, state.options.readFailure) : response(garden(id));
    return state.options.hold === "read" && id === A ? hold(result) : result;
  }
  if (url.pathname.startsWith("/api/garden/keepsakes/") && method === "DELETE") {
    ++state.deletes;
    if (state.options.deletion === "denied") return response({ error: "Synthetic sign-in required" }, 401);
    if (state.options.deletion === "malformed") return response({ deleted: false });
    if (state.options.deletion === "reject") return response({ error: "Synthetic deletion rejected" }, 429);
    gardens[id] = { ...garden(id), keepsakes: [] };
    if (state.options.deletion === "lost") throw new TypeError("Synthetic response lost after deletion");
    const result = response({ deleted: true, id: ID });
    return state.options.hold === "delete" ? hold(result) : result;
  }
  if (url.pathname.startsWith("/api/garden") && method !== "GET") {
    if (state.options.consent !== "active") return response({ error: "Synthetic consent required" }, 403);
    if (url.pathname === "/api/garden" && method === "POST") {
      const result = response({ checkIn: { id: "synthetic-record" } }, 201);
      return state.options.hold === "create" ? hold(result) : result;
    }
    if (url.pathname.endsWith("/care")) return response({ care: { date: "2026-11-03", action: "water" }, created: true }, 201);
    if (url.pathname.endsWith("/layout")) return response({ layoutItem: JSON.parse(init.body) });
    if (url.pathname.endsWith("/keepsakes")) return response({ keepsake: garden(id).keepsakes[0], created: true });
    return response({ reminderMode: JSON.parse(init.body).reminderMode });
  }
  return forbidden(method + " " + url.pathname);
};
window.XMLHttpRequest = class { constructor() { forbidden("XMLHttpRequest"); } };
window.WebSocket = class { constructor() { forbidden("WebSocket"); } };
navigator.sendBeacon = () => forbidden("sendBeacon");
window.__garden = { state,
  setActor: (next) => { actor = next === "A" ? A : next === "B" ? B : "";
    listeners.forEach((fn) => fn(actor ? "SIGNED_IN" : "SIGNED_OUT", session())); },
  setConsent: (value) => { state.options.consent = value; window.dispatchEvent(new Event("youthtempo:consent-updated")); },
  changeGardenTotal: (total) => { gardens[A] = { ...garden(A), total }; },
  release: () => { state.options.hold = undefined; state.pending.splice(0).forEach((resolve) => resolve()); },
  set: (key, value) => { state.options[key] = value; },
  failIdentity: () => { sessionError = true; window.dispatchEvent(new Event("focus")); },
};
localStorage.setItem("youthtempo:garden:intro:v2:" + A, "seen");
localStorage.setItem("youthtempo:garden:intro:v2:" + B, "seen");
`;

const virtual: Record<string, string> = {
  "garden:runtime": runtime,
  "@/lib/supabaseClient": `export { client } from "garden:runtime"; import { client } from "garden:runtime"; export const getSupabase = () => client; export const signOutSupabaseSession = () => { throw new Error("Unexpected signout transport"); };`,
  "@/lib/emailOtp": `export const emailOtpLength = 8; export const isOtpRateLimitError = () => false; export const otpRequestErrorMessage = () => "Synthetic OTP error"; export const otpVerificationErrorMessage = otpRequestErrorMessage;`,
  "@/components/MicroPilotFeedback": `export const MicroPilotFeedback = () => null;`,
  "next/router": `export const useRouter = () => ({ locale: window.__gardenOptions.locale });`,
  "next/link": `import { jsx } from "react/jsx-runtime"; export default function Link({ href, children, ...props }) { return jsx("a", { ...props, href: window.__gardenOptions.locale === "en" ? "/en" + href : href, children }); }`,
  "next/image": `import { jsx } from "react/jsx-runtime"; export const getImageProps = (props) => ({ props: { src: window.__gardenImages[props.src] } });
    export default function Image({ src, alt, className, width, height }) { return jsx("img", { src: window.__gardenImages[src], alt, className, width, height }); }`,
};

async function bundle() {
  const modules: Record<string, { source: string; dependencies: Record<string, string> }> = {};
  const allowed = new Set(["pages/garden.tsx", "views/garden/page.tsx", "components/InlineStudentConsent.tsx", "lib/cloudRecords.ts",
    "lib/useInlineStudentConsent.ts", "lib/useSessionActor.ts", "lib/studentConsent.ts", "lib/gardenCatalog.ts", "lib/sweetRecordDays.ts", "lib/sweetPersistenceProtocol.ts",
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
  const url = `https://garden-mock.invalid${options.locale === "en" ? "/en" : ""}/garden`;
  await page.route("**/*", (route) => {
    if (route.request().url() === url && route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: `<html lang="${options.locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'"></head><body><div id="root"></div></body></html>` });
    network.push(route.request().url()); return route.abort("blockedbyclient");
  });
  await page.goto(url);
  const images: Record<string, string> = {};
  for (const f of (await readdir(path.join(root, "public/illustrations/garden"))).filter((f) => f.endsWith(".png"))) {
    images["/illustrations/garden/" + f] = "data:image/png;base64," + (await readFile(path.join(root, "public/illustrations/garden", f))).toString("base64");
  }
  await page.evaluate(({ options, images }) => Object.assign(window, { __gardenOptions: { consent: "active", ...options }, __gardenImages: images }), { options, images });
  bundlePromise ??= bundle(); cssPromise ??= css();
  await page.addStyleTag({ content: await cssPromise });
  await page.addScriptTag({ content: await bundlePromise });
  await expect(page.locator("#root main")).toBeVisible();
  return { network, errors };
}

export function controlGarden(page: Page, action: string, ...args: unknown[]) {
  return page.evaluate(({ action, args }) => {
    (window as unknown as { __garden: Record<string, (...args: unknown[]) => unknown> }).__garden[action](...args);
  }, { action, args });
}
export function gardenState(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __garden: { state: { calls: Array<{ path: string; method: string; actor: string }>; unexpected: string[]; reads: number; deletes: number; identityReads: number; pending: unknown[] } } }).__garden.state;
    return { calls: s.calls, unexpected: s.unexpected, reads: s.reads, deletes: s.deletes, identityReads: s.identityReads, pending: s.pending.length };
  });
}
