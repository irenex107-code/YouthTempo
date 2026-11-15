import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { expect, type Page } from "@playwright/test";
import zh from "@/locales/zh-CN.json";
import en from "@/locales/en.json";

export type A11yLocalOptions = {
  route: "community" | "mood-journal" | "worry-time" | "for-teachers";
  locale: "zh-CN" | "en";
  signedOut?: boolean;
  serviceFailure?: boolean;
};

const root = process.cwd();
const bundleCache = new Map<A11yLocalOptions["route"], Promise<string>>();
let cssPromise: Promise<string> | undefined;

const runtimeSource = String.raw`
import * as React from "react";
export const options = window.__a11yOptions;
export const state = { calls: [], unexpected: [] };
export const actorId = "00000000-0000-4000-8000-000000000011";
const otherId = "00000000-0000-4000-8000-000000000022";
export function t(key, values) {
  let value = key.split(".").reduce((object, part) => object?.[part], window.__a11yDictionary);
  if (typeof value !== "string") throw new Error("Missing translation: " + key);
  return value.replace(/\{\{(\w+)\}\}/g, (all, name) => values?.[name] ?? all);
}
export function forbidden(name) {
  state.unexpected.push(name);
  throw new Error("Forbidden local-fixture boundary: " + name);
}
const current = () => true;
export const consent = {
  userId: options.signedOut ? "" : actorId,
  phase: options.signedOut ? "signed_out" : "ready",
  studentReady: !options.signedOut,
  canProceed: !options.signedOut,
  busy: false,
  errorKind: null,
  summary: { role: "student", consent: { status: "active", ageBand: "14_17" } },
  trackRequest: () => current,
  isSameActor: (id) => id === actorId,
  refresh: async () => {},
};
export const actor = {
  actorId: options.signedOut ? "" : actorId,
  phase: options.signedOut ? "signed_out" : "ready",
  trackRequest: () => current,
  isSameActor: (id) => id === actorId,
  refreshIdentity: async () => {},
};
const post = {
  id: "synthetic-post",
  author_user_id: otherId,
  author_role: "student",
  author_name: "Synthetic member",
  author_role_label: options.locale === "en" ? "Young person" : "青年用户",
  verified_professional: false,
  can_delete: true,
  title: options.locale === "en" ? "A synthetic community topic" : "一条公开合成社区主题",
  body: options.locale === "en" ? "Public synthetic content for keyboard checks." : "仅供键盘验证的公开合成内容。",
  viewer_roles: ["student", "guardian", "teacher", "professional"],
  commenter_roles: ["student", "guardian", "teacher", "professional"],
  can_comment: true,
  created_at: "2026-11-11T00:00:00Z",
  comments: [{
    id: "synthetic-comment",
    post_id: "synthetic-post",
    author_user_id: otherId,
    author_role: "student",
    author_name: "Synthetic commenter",
    author_role_label: options.locale === "en" ? "Young person" : "青年用户",
    verified_professional: false,
    can_delete: true,
    body: options.locale === "en" ? "A synthetic reply." : "一条公开合成回复。",
    created_at: "2026-11-11T00:01:00Z",
  }],
};
export async function getCurrentUser() { return options.signedOut ? null : { id: actorId }; }
export async function listCommunityPosts() {
  return { posts: [post], currentUser: { id: actorId, role: "student" } };
}
export async function listCommunityBlocks() { return { blocks: [] }; }
export async function listCommunityReports() { return { reports: [] }; }
export async function createCommunityPost() { return { safetyNotice: false }; }
export async function createCommunityComment() { return { safetyNotice: false }; }
export async function deleteCommunityPost(id) { state.calls.push({ kind: "delete-post", id }); }
export async function deleteCommunityComment(id) { state.calls.push({ kind: "delete-comment", id }); }
export async function reportCommunityContent(input) {
  state.calls.push({ kind: "report", input });
  return { notice: options.locale === "en" ? "The synthetic report was received." : "合成举报已收到。", report: {
    id: "synthetic-report", post_id: input.postId || null, comment_id: input.commentId || null,
    reason: input.details || "", category: input.category, priority: "standard", status: "new",
    created_at: "2026-11-11T00:02:00Z", target_review_at: "2026-11-12T00:02:00Z", resolved_at: null,
  } };
}
export async function blockCommunityMember(id) { state.calls.push({ kind: "block", id }); }
export async function unblockCommunityMember(id) { state.calls.push({ kind: "unblock", id }); }
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), "https://a11y-local.invalid");
  const method = init.method || "GET";
  state.calls.push({ kind: "fetch", path: url.pathname, method });
  if (url.origin !== "https://a11y-local.invalid") return forbidden("external fetch " + url.origin);
  if (url.pathname === "/api/ai/mood-journal" && method === "POST") {
    if (options.serviceFailure) return response({ error: options.locale === "en" ? "Please try the reflection again later." : "请稍后再试一次整理。" }, 503);
    return response({ emotionReflection: "Synthetic", possibleNeed: "Synthetic", communicationSuggestion: "Synthetic", smallStep: "Synthetic", supportReminder: "Synthetic" });
  }
  if (url.pathname === "/api/ai/worry-time" && method === "POST") {
    if (options.serviceFailure) return response({ error: options.locale === "en" ? "Please try sorting the worries again later." : "请稍后再试一次整理担心。" }, 503);
    return response({ decisionMethod: "deterministic_rules", decisionVersion: "synthetic", controllableParts: "Synthetic", canWaitUntilTomorrow: "Synthetic", tomorrowSmallAction: "Synthetic", bedtimeSentence: "Synthetic", supportReminder: "Synthetic" });
  }
  return forbidden(method + " " + url.pathname);
};
window.XMLHttpRequest = class { constructor() { forbidden("XMLHttpRequest"); } };
window.WebSocket = class { constructor() { forbidden("WebSocket"); } };
navigator.sendBeacon = () => forbidden("sendBeacon");
window.__a11yLocal = { state };
`;

const virtualModules: Record<string, string> = {
  "a11y:runtime": runtimeSource,
  "@/lib/i18n/client": `import { options, t } from "a11y:runtime"; export const useTranslation = () => ({ locale: options.locale, t });`,
  "@/lib/useInlineStudentConsent": `export { consent } from "a11y:runtime"; import { consent } from "a11y:runtime"; export const useInlineStudentConsent = () => consent;`,
  "@/lib/useSessionActor": `export { actor } from "a11y:runtime"; import { actor } from "a11y:runtime"; export const useSessionActor = () => actor;`,
  "@/lib/aiClient": `export const aiRequestHeaders = async () => ({ "content-type": "application/json", authorization: "Bearer synthetic" });`,
  "@/lib/cloudRecords": `export { getCurrentUser, listCommunityPosts, listCommunityBlocks, listCommunityReports, createCommunityPost, createCommunityComment, deleteCommunityPost, deleteCommunityComment, reportCommunityContent, blockCommunityMember, unblockCommunityMember } from "a11y:runtime";`,
  "@/components/InlineStudentConsent": `import { jsx } from "react/jsx-runtime"; export const InlineStudentConsent = () => jsx("div", { "data-testid": "inline-student-consent" });`,
  "@/components/MicroPilotFeedback": `export const MicroPilotFeedback = () => null;`,
  "@/components/VoiceInputButton": `export const VoiceInputButton = () => null;`,
  "next/link": `import { jsx } from "react/jsx-runtime"; import { options } from "a11y:runtime"; export default function Link({ href, children, ...props }) { const value = typeof href === "string" ? href : href.pathname; return jsx("a", { ...props, href: options.locale === "en" ? "/en" + value : value, children }); }`,
  "next/image": `import { jsx } from "react/jsx-runtime"; export const getImageProps = (props) => ({ props }); export default function Image({ alt, className, width, height }) { return jsx("div", { role: "img", "aria-label": alt, className, style: { aspectRatio: width && height ? width + "/" + height : "1/1" } }); }`,
  "next/router": `import { options } from "a11y:runtime"; export const useRouter = () => ({ locale: options.locale, pathname: "/" + options.route });`,
};

const routeFiles: Record<A11yLocalOptions["route"], string> = {
  community: "views/community/page.tsx",
  "mood-journal": "views/mood-journal/page.tsx",
  "worry-time": "views/worry-time/page.tsx",
  "for-teachers": "views/for-teachers/page.tsx",
};

function resolveLocal(name: string) {
  const base = path.join(root, name.slice(2));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found || !found.startsWith(root + path.sep)) throw new Error(`Unresolved local module: ${name}`);
  return found;
}

async function browserBundle(route: A11yLocalOptions["route"]) {
  const modules: Record<string, { source: string; dependencies: Record<string, string> }> = {};
  async function add(id: string, file?: string): Promise<string> {
    if (modules[id]) return id;
    const original = virtualModules[id] ?? await readFile(file!, "utf8");
    const source = file?.endsWith(".json")
      ? `module.exports = ${original};`
      : virtualModules[id] || file?.endsWith(".ts") || file?.endsWith(".tsx")
        ? ts.transpileModule(original, { compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        } }).outputText
        : original;
    const entry = modules[id] = { source, dependencies: {} };
    for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const name = match[1];
      if (virtualModules[name]) entry.dependencies[name] = await add(name);
      else if (name.startsWith("@/")) {
        const resolved = resolveLocal(name);
        entry.dependencies[name] = await add(name, resolved);
      } else if (/^(react(?:-dom)?(?:\/.*)?|scheduler(?:\/.*)?)$/.test(name) || (file?.includes("node_modules") && name.startsWith("."))) {
        const resolved = createRequire(file || path.join(root, "package.json")).resolve(name);
        if (!/node_modules\/(?:react|react-dom|scheduler)\//.test(resolved)) throw new Error(`Disallowed vendor import: ${name}`);
        entry.dependencies[name] = await add(resolved, resolved);
      } else throw new Error(`Unmocked browser import: ${name}`);
    }
    return id;
  }
  await add("a11y:runtime");
  await add("a11y:route", path.join(root, routeFiles[route]));
  for (const name of ["react-dom/client", "react/jsx-runtime"]) {
    await add(name, createRequire(path.join(root, "package.json")).resolve(name));
  }
  return `(function() { const process = { env: { NODE_ENV: "production" } }; const factories = {${Object.entries(modules).map(([id, entry]) =>
    `${JSON.stringify(id)}: [function(module,exports,require) {\n${entry.source}\n}, ${JSON.stringify(entry.dependencies)}]`).join(",\n")}};
    const cache = {}; function load(id) { if (cache[id]) return cache[id].exports; const module = cache[id] = { exports: {} };
      const [factory,deps] = factories[id]; factory(module,module.exports,(name) => { if (!deps[name]) throw new Error("Unmocked require " + name); return load(deps[name]); }); return module.exports; }
    load("a11y:runtime"); const Root = load("a11y:route").default; const jsx = load("react/jsx-runtime").jsx;
    load("react-dom/client").createRoot(document.getElementById("app-main")).render(jsx(Root, {})); })();`;
}

async function browserCss() {
  const configSource = await readFile(path.join(root, "tailwind.config.ts"), "utf8");
  const compiled = ts.transpileModule(configSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const configModule = { exports: {} as { default?: Record<string, unknown> } };
  new Function("module", "exports", compiled)(configModule, configModule.exports);
  const componentFiles = (await readdir(path.join(root, "components")))
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => `components/${file}`);
  const contentFiles = [...Object.values(routeFiles), ...componentFiles];
  const raw = (await Promise.all(contentFiles.map((file) => readFile(path.join(root, file), "utf8")))).join("\n");
  return (await postcss([
    tailwindcss({ ...configModule.exports.default, content: [{ raw, extension: "tsx" }] }),
    autoprefixer,
  ]).process(await readFile(path.join(root, "views/globals.css"), "utf8"), { from: undefined })).css;
}

export async function openA11yLocalPage(page: Page, options: A11yLocalOptions) {
  const network: string[] = [];
  const errors: string[] = [];
  page.removeAllListeners("pageerror");
  page.on("pageerror", (error) => errors.push(error.message));
  await page.unrouteAll({ behavior: "wait" });
  const url = `https://a11y-local.invalid${options.locale === "en" ? "/en" : ""}/${options.route}`;
  if (!bundleCache.has(options.route)) bundleCache.set(options.route, browserBundle(options.route));
  cssPromise ??= browserCss();
  const html = `<html lang="${options.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'"><style>${await cssPromise}</style></head><body><div class="page-shell"><header><button type="button" data-testid="outside-header-control">Header control</button></header><main id="app-main"></main><footer><a href="#footer" data-testid="outside-footer-control">Footer control</a></footer></div><script>window.__a11yOptions=${JSON.stringify(options)};window.__a11yDictionary=${JSON.stringify(options.locale === "en" ? en : zh)};${await bundleCache.get(options.route)!}</script></body></html>`;
  await page.route("**/*", (route) => {
    if (route.request().url() === url && route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    network.push(route.request().url());
    return route.abort("blockedbyclient");
  });
  await page.goto(url);
  const copy = options.locale === "en" ? en : zh;
  const title = options.route === "community" ? copy.community.hero.title
    : options.route === "mood-journal" ? copy.moodJournal.hero.title
      : options.route === "for-teachers" ? copy.forTeachers.hero.title : copy.worryTime.hero.title;
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  return { network, errors };
}

export function a11yLocalState(page: Page) {
  return page.evaluate(() => (window as unknown as { __a11yLocal: { state: { calls: unknown[]; unexpected: string[] } } }).__a11yLocal.state);
}
