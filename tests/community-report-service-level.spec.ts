import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import fixture from "./fixtures/permission-boundary.json";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_NiIGAQ6Wf--HakVNwFnSmA_zqzSGHRv";
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

type UserKey = "platformAdmin" | "guardianOne" | "schoolLead";

async function sessionFor(key: UserKey) {
  if (!password) throw new Error("缺少 E2E_PERMISSION_TEST_PASSWORD");
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: fixture.users[key].email,
    password,
  });
  if (error || !data.session) throw error || new Error(`无法登录 ${key}`);
  return { accessToken: data.session.access_token };
}

function auth(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

test("举报分类、首次复核目标和用户进度形成闭环", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "API 服务级别无需按视口重复执行");
  test.skip(!password, "需要虚拟账号密码");
  test.setTimeout(60_000);

  const [platformAdmin, guardian, schoolLead] = await Promise.all([
    sessionFor("platformAdmin"),
    sessionFor("guardianOne"),
    sessionFor("schoolLead"),
  ]);
  let postId = "";

  try {
    const createPost = await request.post("/api/community/posts", {
      headers: auth(guardian.accessToken),
      data: {
        title: `[E2E-举报时限] ${Date.now()}`,
        body: "自动化验收内容，将在测试结束后通过平台接口删除。",
        viewerRoles: ["guardian", "teacher"],
        commenterRoles: ["teacher"],
      },
    });
    expect(createPost.status()).toBe(201);
    postId = (await createPost.json()).post.id as string;

    const report = await request.post("/api/community/reports", {
      headers: auth(schoolLead.accessToken),
      data: {
        postId,
        category: "privacy_exposure",
        details: "自动化验收：检查隐私类举报的服务目标。",
      },
    });
    const reportText = await report.text();
    expect(report.status(), reportText).toBe(201);
    const reportBody = JSON.parse(reportText);
    expect(reportBody.report).toMatchObject({
      category: "privacy_exposure",
      priority: "high",
      status: "new",
      target_review_at: expect.any(String),
    });
    expect(new Date(reportBody.report.target_review_at).getTime() - new Date(reportBody.report.created_at).getTime())
      .toBe(24 * 60 * 60 * 1000);

    const ownBefore = await request.get("/api/community/reports", {
      headers: auth(schoolLead.accessToken),
    });
    expect(ownBefore.status()).toBe(200);
    expect((await ownBefore.json()).reports).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: reportBody.report.id, status: "new", priority: "high" }),
    ]));

    const queue = await request.get("/api/admin/community-moderation", {
      headers: auth(platformAdmin.accessToken),
    });
    expect(queue.status()).toBe(200);
    expect((await queue.json()).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ content_id: postId, priority: "high", target_review_at: reportBody.report.target_review_at }),
    ]));

    const resolve = await request.post("/api/admin/community-moderation", {
      headers: { ...auth(platformAdmin.accessToken), "content-type": "application/json" },
      data: {
        contentType: "post",
        contentId: postId,
        action: "remove",
        note: "自动化验收：完成隐私类举报复核",
      },
    });
    expect(resolve.status()).toBe(200);

    const ownAfter = await request.get("/api/community/reports", {
      headers: auth(schoolLead.accessToken),
    });
    expect(ownAfter.status()).toBe(200);
    expect((await ownAfter.json()).reports).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: reportBody.report.id, status: "resolved", resolved_at: expect.any(String) }),
    ]));
  } finally {
    if (postId) {
      const cleanup = await request.delete("/api/community/posts", {
        headers: auth(platformAdmin.accessToken),
        data: { postId },
      });
      expect([200, 404]).toContain(cleanup.status());
    }
  }
});
