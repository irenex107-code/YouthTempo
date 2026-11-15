import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";
import { getRequestLocale, getServerTranslator } from "@/lib/i18n/server";
import { moderateCommunityContent } from "@/lib/messageSafety";

type Row = Record<string, any>;
async function load(file: string, deps: Row) {
  const source = await readFile(path.join(process.cwd(), file), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as Row };
  vm.runInNewContext(output, { module, exports: module.exports, URL, Date, Error, console,
    process: { env: { RATE_LIMIT_SECRET: "synthetic-audit-rate-secret" } },
    require(name: string) { if (!Object.hasOwn(deps, name)) throw new Error(`Unexpected dependency: ${name}`); return deps[name]; },
  }, { filename: file });
  return module.exports;
}
function response() {
  const result = { status: 200, body: null as any, headers: {} as Record<string, unknown> };
  const res: any = {
    setHeader(k: string, v: unknown) { result.headers[k.toLowerCase()] = v; },
    getHeader(k: string) { return result.headers[k.toLowerCase()]; },
    status(n: number) { result.status = n; return res; }, json(body: unknown) { result.body = body; return res; },
  };
  return { result, res };
}
for (const locale of ["zh-CN", "en"] as const) {
  test(`社区 ${locale} 空昵称不泄露帖子或评论作者邮箱`, async () => {
    const selections: Array<[string, string]> = [];
    const tables: Row = {
      community_posts: [{ id: "post", author_user_id: "author", author_role: "student", title: "Synthetic", body: "Synthetic", viewer_roles: ["student"], commenter_roles: ["student"], moderation_status: "published", created_at: "2026-10-29T00:00:00Z" }],
      community_comments: [{ id: "comment", post_id: "post", author_user_id: "reply", author_role: "teacher", body: "Synthetic", moderation_status: "published" }],
      profiles: [{ id: "author", display_name: "", email: "private-minor@example.invalid" }, { id: "reply", display_name: null, email: "private-teacher@example.invalid" }],
      professional_verifications: [],
    };
    const supabase = { from(table: string) {
      if (!Object.hasOwn(tables, table)) throw new Error(`Unexpected table: ${table}`);
      const filters: Array<(row: Row) => boolean> = [];
      const chain: any = {
        select(fields: string) { selections.push([table, fields]); return chain; },
        eq(key: string, value: unknown) { filters.push((r) => r[key] === value); return chain; },
        contains(key: string, values: unknown[]) { filters.push((r) => values.every((v) => r[key]?.includes(v))); return chain; },
        in(key: string, values: unknown[]) { filters.push((r) => values.includes(r[key])); return chain; },
        order() { return chain; }, limit() { return chain; }, or() { return chain; },
        then(done: (v: unknown) => unknown) { return Promise.resolve({ data: tables[table].filter((row: Row) => filters.every((f) => f(row))), error: null }).then(done); },
      };
      return chain;
    } };
    const api = await load("pages/api/community/posts.ts", {
      "@/lib/supabaseServer": { getAuthenticatedUser: async () => ({ id: "viewer" }), getSupabaseAdmin: () => supabase },
      "@/lib/community": { getCommunityIdentity: async () => ({ role: "student", canModerate: false }), getCommunityBlockedUserIds: async () => new Set(), communityRoleLabels: { student: "学生", teacher: "老师" } },
      "@/lib/messageSafety": { moderateCommunityContent }, "@/lib/studentConsent": {}, "@/lib/rateLimit": {},
      "@/lib/operationalMonitoring": { reportOperationalError: async () => undefined },
      "@/lib/i18n/server": { getRequestLocale, getServerTranslator },
    });
    const { result, res } = response();
    await api.default({ method: "GET", body: {}, query: { locale }, cookies: {} }, res);
    expect(result.status).toBe(200);
    expect(result.body.posts).toHaveLength(1);
    expect(result.body.posts[0].author_name).toBe(getServerTranslator(locale)("community.roles.student.label"));
    expect(result.body.posts[0].comments[0].author_name).toBe(getServerTranslator(locale)("community.roles.teacher.label"));
    expect(JSON.stringify(result.body)).not.toContain("@example.invalid");
    expect(selections.filter(([table]) => table === "profiles").every(([, fields]) => !fields.split(",").includes("email"))).toBe(true);
  });
  for (const outcome of ["client", "ip", "unavailable"] as const) {
    test(`AI ${locale} ${outcome} 限流保持语言和安全响应契约`, async () => {
      let calls = 0;
      const supabase = { rpc: async () => {
        calls++;
        if (outcome === "unavailable") return { data: null, error: { message: "PRIVATE_RPC_DETAIL" } };
        return { data: [{ allowed: outcome === "ip" && calls === 1, remaining: outcome === "ip" && calls === 1 ? 19 : 0, reset_at: new Date(Date.now() + 30_000).toISOString() }], error: null };
      } };
      const monitor = { reportOperationalError: async () => undefined };
      const rate = await load("lib/rateLimit.ts", { "node:crypto": crypto, "@/lib/operationalMonitoring": monitor });
      const shared = await load("pages/api/ai/_shared.ts", {
        "@/lib/rateLimit": rate, "@/lib/supabaseServer": { getSupabaseAdmin: () => supabase },
        "@/lib/studentConsent": {}, "@/lib/operationalMonitoring": monitor,
        "@/lib/safety/crisisDetection": {}, "@/lib/aiNotice": {},
      });
      const { result, res } = response();
      const ok = await shared.requireAiRateLimit({ cookies: { yt_ai_client: "00000000-0000-4000-8000-000000000081" }, headers: { "x-real-ip": "127.0.0.1" }, socket: {}, body: { locale } }, res, locale);
      expect(ok).toBe(false);
      expect(result.status).toBe(outcome === "unavailable" ? 503 : 429);
      expect(JSON.stringify(result.body)).not.toContain("PRIVATE_RPC_DETAIL");
      if (locale === "en") expect(result.body.error).not.toMatch(/[\u3400-\u9fff]/);
      else expect(result.body.error).toMatch(/[\u3400-\u9fff]/);
      if (outcome !== "unavailable") {
        expect(result.body).toMatchObject({ rateLimited: true, retryAfterSeconds: expect.any(Number) });
        expect(result.headers["ratelimit-limit"]).toBe(outcome === "ip" ? "120" : "20");
        expect(result.headers["retry-after"]).toBe(String(result.body.retryAfterSeconds));
      }
      expect(calls).toBe(outcome === "ip" ? 2 : 1);
    });
  }
}
