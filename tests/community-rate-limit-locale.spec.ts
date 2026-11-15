import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import { getRequestLocale, getServerTranslator } from "@/lib/i18n/server";
import { moderateCommunityContent } from "@/lib/messageSafety";
import { communityReportCategory, isCommunityReportCategory } from "@/lib/communityReports";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

type Row = Record<string, unknown>;
type Request = {
  method: string;
  headers: Record<string, string>;
  body: Row;
  query: Record<string, string>;
  cookies: Record<string, string>;
};
type Response = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => Response;
  json: (body: unknown) => Response;
};
type Handler = (req: Request, res: Response) => Promise<unknown>;

// This secret is synthetic and lives only in the module sandbox. The tests do
// not read or change the process environment and never contact a database.
const syntheticSecret = "synthetic-community-rate-limit-secret";
const userId = "00000000-0000-4000-8000-000000000081";
const privateDetail = "PRIVATE_RATE_LIMIT_RPC_DETAIL";
const endpoints = [
  { route: "posts", action: "community_post_create", limit: 5, seconds: 600, message: "post", unavailable: "unavailable" },
  { route: "comments", action: "community_comment_create", limit: 20, seconds: 600, message: "comment", unavailable: "unavailable" },
  { route: "reports", action: "community_report_submit", limit: 20, seconds: 3600, message: "report", unavailable: "reportUnavailable" },
] as const;

async function isolatedModule(file: string, dependencies: Record<string, unknown>) {
  const source = await readFile(path.join(process.cwd(), file), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require: (name: string) => {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unmocked import: ${name}`);
      return dependencies[name];
    },
    process: { env: { RATE_LIMIT_SECRET: syntheticSecret } },
    console, Error, URL, Date,
  }, { filename: file });
  return module.exports;
}

async function harness(route: string, outcome: 429 | 503) {
  const rpcCalls: Array<{ name: string; params: Row }> = [];
  const writes: Array<{ table: string; value: unknown }> = [];
  const reports: Array<{ operation: string; statusCode: number }> = [];
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const monitoring = {
    reportOperationalError: async (event: { operation: string; statusCode: number }) => {
      reports.push({ operation: event.operation, statusCode: event.statusCode });
    },
  };
  const supabase = {
    async rpc(name: string, params: Row) {
      rpcCalls.push({ name, params });
      if (outcome === 503) return { data: null, error: { message: privateDetail, code: "SYNTHETIC_INTERNAL_CODE" } };
      return { data: [{ allowed: false, remaining: 0, reset_at: new Date(Date.now() + 45_000).toISOString() }], error: null };
    },
    from(table: string) {
      const query = { table, filters: [] as Array<[string, unknown]> };
      queries.push(query);
      const chain = {
        select() { return chain; },
        eq(key: string, value: unknown) { query.filters.push([key, value]); return chain; },
        async maybeSingle() {
          expect(table, "Only the comment's existing published parent may be read before limiting").toBe("community_posts");
          return { data: { author_user_id: "another-student", viewer_roles: ["student"],
            commenter_roles: ["student"], moderation_status: "published" }, error: null };
        },
        insert(value: unknown) {
          writes.push({ table, value });
          throw new Error("A denied or unavailable limiter must stop before any insert");
        },
      };
      return chain;
    },
  };
  const limiter = await isolatedModule("lib/rateLimit.ts", {
    "node:crypto": crypto,
    "@/lib/operationalMonitoring": monitoring,
  });
  const handler = await isolatedModule(`pages/api/community/${route}.ts`, {
    "@/lib/supabaseServer": { getAuthenticatedUser: async () => ({ id: userId }), getSupabaseAdmin: () => supabase },
    "@/lib/community": {
      getCommunityIdentity: async () => ({ role: "student", canModerate: false }),
      getActiveCommunityMute: async () => null,
      getCommunityBlockedUserIds: async () => new Set<string>(),
      normalizeRoleList: (roles: unknown) => Array.isArray(roles) ? roles.filter((role) => role === "student") : [],
      communityRoleLabels: { student: "学生" },
    },
    "@/lib/messageSafety": { moderateCommunityContent },
    "@/lib/studentConsent": { requireActiveStudentConsent: async () => undefined },
    "@/lib/rateLimit": limiter,
    "@/lib/i18n/server": { getRequestLocale, getServerTranslator },
    "@/lib/operationalMonitoring": monitoring,
    "@/lib/communityReports": { communityReportCategory, isCommunityReportCategory },
  });
  return {
    rpcCalls, writes, reports, queries,
    async call(locale: "zh-CN" | "en") {
      const result = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
      const res: Response = {
        setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
        status(code) { result.status = code; return res; },
        json(body) { result.body = body; return res; },
      };
      const otherLocale = locale === "en" ? "zh-CN" : "en";
      await (handler.default as Handler)({
        method: "POST", headers: { authorization: "Bearer synthetic-token" },
        body: { locale, title: "Synthetic check-in", body: "I feel stressed about exams",
          viewerRoles: ["student"], commenterRoles: ["student"], postId: "published-post", category: "other" },
        // The submitted language must win over stale language preferences.
        query: { locale: otherLocale }, cookies: { NEXT_LOCALE: otherLocale },
      }, res);
      return result;
    },
  };
}

for (const endpoint of endpoints) {
  for (const locale of ["zh-CN", "en"] as const) {
    for (const outcome of [429, 503] as const) {
      test(`community/${endpoint.route} ${locale} 实际限流${outcome}保持双语安全响应且不写入`, async () => {
        const mock = await harness(endpoint.route, outcome);
        const result = await mock.call(locale);
        const copy = (locale === "en" ? en : zh).community.messages.rateLimit;
        expect(result.status).toBe(outcome);
        expect(mock.writes, "Rejected and unavailable requests must not insert a post, comment or report").toEqual([]);
        expect(mock.rpcCalls).toEqual([{ name: "consume_api_rate_limit", params: {
          p_identifier_hash: crypto.createHmac("sha256", syntheticSecret).update(`user:${userId}`).digest("hex"),
          p_action: endpoint.action, p_limit: endpoint.limit, p_window_seconds: endpoint.seconds,
        } }]);
        expect(mock.queries).toEqual(endpoint.route === "comments"
          ? [{ table: "community_posts", filters: [["id", "published-post"]] }] : []);
        const payload = JSON.stringify(result.body);
        expect(payload).not.toContain(privateDetail);
        expect(payload).not.toContain("SYNTHETIC_INTERNAL_CODE");
        expect(payload).not.toContain(syntheticSecret);
        expect(payload).not.toContain(userId);
        if (outcome === 429) {
          const retryAfter = Number(result.headers["retry-after"]);
          expect(Number.isInteger(retryAfter)).toBe(true);
          expect(retryAfter).toBeGreaterThan(0);
          expect(retryAfter).toBeLessThanOrEqual(45);
          expect(result.headers).toMatchObject({
            "ratelimit-limit": String(endpoint.limit), "ratelimit-remaining": "0",
            "ratelimit-policy": `${endpoint.limit};w=${endpoint.seconds}`, "ratelimit-reset": String(retryAfter),
          });
          expect(result.body).toEqual({ error: copy[endpoint.message], rateLimited: true, retryAfterSeconds: retryAfter });
          expect(mock.reports).toEqual([]);
        } else {
          expect(result.body).toEqual({ error: copy[endpoint.unavailable] });
          expect(result.headers["retry-after"]).toBeUndefined();
          expect(mock.reports).toEqual([{ operation: `${endpoint.action}_rate_limit`, statusCode: 503 }]);
        }
      });
    }
  }
}
