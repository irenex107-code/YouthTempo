import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_NiIGAQ6Wf--HakVNwFnSmA_zqzSGHRv";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

test("社区发帖达到窗口上限后返回 429", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "API 限流无需按视口重复执行");
  test.skip(!serviceRoleKey, "需要服务端密钥创建和清理临时 E2E 账号");

  const marker = `[E2E-RATE-LIMIT] ${Date.now()}`;
  const suffix = randomUUID();
  const email = `e2e-rate-limit-${suffix}@youthtempo.test`;
  const password = `${randomUUID()}Aa1!`;
  const admin = createClient(supabaseUrl, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const browserClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let userId = "";

  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createError).toBeNull();
    userId = created.user?.id || "";
    expect(userId).not.toBe("");

    const { error: profileError } = await admin.from("profiles").upsert({
      id: userId,
      email,
      display_name: "E2E 限流账号",
      role: "学生",
      school_id: null,
      updated_at: new Date().toISOString(),
    });
    expect(profileError).toBeNull();

    const { data: sessionData, error: signInError } = await browserClient.auth.signInWithPassword({
      email,
      password,
    });
    expect(signInError).toBeNull();
    expect(sessionData.session?.access_token).toBeTruthy();
    const headers = { Authorization: `Bearer ${sessionData.session!.access_token}` };

    for (let index = 1; index <= 5; index += 1) {
      const response = await request.post("/api/community/posts", {
        headers,
        data: {
          title: `${marker} ${index}`,
          body: "自动化验收内容，将在测试结束后立即删除。",
          viewerRoles: ["student"],
          commenterRoles: ["student"],
        },
      });
      expect(response.status()).toBe(201);
    }

    const limited = await request.post("/api/community/posts", {
      headers,
      data: {
        title: `${marker} 6`,
        body: "这条请求应被频率限制，不应写入数据库。",
        viewerRoles: ["student"],
        commenterRoles: ["student"],
      },
    });
    expect(limited.status()).toBe(429);
    expect(limited.headers()["ratelimit-limit"]).toBe("5");
    expect(limited.headers()["ratelimit-remaining"]).toBe("0");
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    await expect(limited.json()).resolves.toMatchObject({ rateLimited: true });
  } finally {
    if (userId) {
      await admin.from("community_posts").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});
