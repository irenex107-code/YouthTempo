import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import fixture from "./fixtures/permission-boundary.json";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

test("社区发帖按实际用户窗口限流，第六次返回429且不写入", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "API 限流无需按视口重复执行");
  test.skip(!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !password,
    "需要先重置隔离虚拟学校并显式配置地址、密钥和虚拟账号密码");
  test.setTimeout(60_000);
  const trace = testInfo.project.use.trace;
  expect(trace === "off" || (typeof trace === "object" && trace?.mode === "off"),
    "真实会话限流验收必须关闭trace，避免附加JWT").toBe(true);

  const admin = createClient(supabaseUrl, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // The parent runner resets fixture consent and this user's exact rate hash
  // before the suite. Separate fixture users keep the two locale windows apart.
  for (const [userKey, locale] of [["studentOne", "zh-CN"], ["studentThree", "en"]] as const) {
    const marker = `[E2E-RATE-LIMIT] ${randomUUID()}`;
    const createdIds: string[] = [];
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email: fixture.users[userKey].email, password: password! });
    if (error || !data.session || !data.user) throw new Error("隔离虚拟学生密码登录失败。");
    const userId = data.user.id;
    const headers = { Authorization: `Bearer ${data.session.access_token}` };
    const payloadFor = (index: number) => ({ title: `${marker} ${index}`,
      body: "自动化验收内容，将在测试结束后按本次记录编号删除。",
      viewerRoles: ["student"], commenterRoles: ["student"], locale,
    });

    try {
      for (let index = 1; index <= 5; index++) {
        const response = await request.post("/api/community/posts", { headers, data: payloadFor(index) });
        const payload = await response.json();
        if (typeof payload.post?.id === "string") createdIds.push(payload.post.id);
        expect(response.status()).toBe(201);
        expect(payload).toMatchObject({ post: { id: expect.any(String), moderation_status: "published" }, safetyNotice: false });
        expect(response.headers()["ratelimit-limit"]).toBe("5");
        expect(response.headers()["ratelimit-remaining"]).toBe(String(5 - index));
        expect(response.headers()["ratelimit-policy"]).toBe("5;w=600");
      }

      const limited = await request.post("/api/community/posts", { headers, data: payloadFor(6) });
      expect(limited.status()).toBe(429);
      expect(limited.headers()["ratelimit-limit"]).toBe("5");
      expect(limited.headers()["ratelimit-remaining"]).toBe("0");
      expect(limited.headers()["ratelimit-policy"]).toBe("5;w=600");
      const retryAfter = Number(limited.headers()["retry-after"]);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(600);
      expect(limited.headers()["ratelimit-reset"]).toBe(String(retryAfter));
      await expect(limited.json()).resolves.toMatchObject({
        error: (locale === "en" ? en : zh).community.messages.rateLimit.post,
        rateLimited: true,
        retryAfterSeconds: retryAfter,
      });

      const inserted = await admin.from("community_posts").select("id,title,moderation_status")
        .eq("author_user_id", userId).like("title", `${marker}%`);
      expect(inserted.error).toBeNull();
      expect(inserted.data?.map((post) => post.id).sort()).toEqual([...createdIds].sort());
      expect(inserted.data).toHaveLength(5);
      expect(inserted.data?.some((post) => post.title === payloadFor(6).title)).toBe(false);
    } finally {
      const marked = await admin.from("community_posts").select("id")
        .eq("author_user_id", userId).like("title", `${marker}%`);
      expect(marked.error).toBeNull();
      const cleanupIds = [...new Set([...createdIds, ...(marked.data || []).map((post) => post.id)])];
      if (cleanupIds.length) {
        const removed = await admin.from("community_posts").delete().eq("author_user_id", userId).in("id", cleanupIds);
        expect(removed.error).toBeNull();
        const remaining = await admin.from("community_posts").select("id").eq("author_user_id", userId).in("id", cleanupIds);
        expect(remaining.error).toBeNull();
        expect(remaining.data).toEqual([]);
      }
      const remainingMarked = await admin.from("community_posts").select("id")
        .eq("author_user_id", userId).like("title", `${marker}%`);
      expect(remainingMarked.error).toBeNull();
      expect(remainingMarked.data).toEqual([]);
    }
  }
});
