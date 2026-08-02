import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import fixture from "./fixtures/permission-boundary.json";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_NiIGAQ6Wf--HakVNwFnSmA_zqzSGHRv";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

type UserKey = keyof typeof fixture.users;

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
  return { accessToken: data.session.access_token, userId: data.user.id };
}

function auth(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

test("平台管理员可处理、移除并恢复社区内容，其他角色不能进入审核接口", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "审核 API 权限与视口无关，无需重复执行");
  test.skip(!password || !serviceRoleKey, "需要虚拟账号密码和服务端测试密钥");
  test.setTimeout(120_000);

  const [platformAdmin, guardian, schoolLead] = await Promise.all([
    sessionFor("platformAdmin"),
    sessionFor("guardianOne"),
    sessionFor("schoolLead"),
  ]);
  const admin = createClient(supabaseUrl, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let postId = "";
  let unmutedPostId = "";

  try {
    const forbiddenQueue = await request.get("/api/admin/community-moderation", {
      headers: auth(schoolLead.accessToken),
    });
    expect(forbiddenQueue.status()).toBe(403);

    const createPost = await request.post("/api/community/posts", {
      headers: auth(guardian.accessToken),
      data: {
        title: `[E2E-审核] ${Date.now()}`,
        body: "我有伤害自己的想法，这是一条自动化安全审核测试内容。",
        viewerRoles: ["guardian", "teacher", "professional"],
        commenterRoles: ["teacher", "professional"],
      },
    });
    expect(createPost.status()).toBe(202);
    postId = (await createPost.json()).post.id as string;

    const queue = await request.get("/api/admin/community-moderation", {
      headers: auth(platformAdmin.accessToken),
    });
    expect(queue.status()).toBe(200);
    expect((await queue.json()).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ content_id: postId, moderation_status: "safety_review" }),
    ]));

    const forbiddenAction = await request.post("/api/admin/community-moderation", {
      headers: auth(schoolLead.accessToken),
      data: { contentType: "post", contentId: postId, action: "publish", note: "不应成功" },
    });
    expect(forbiddenAction.status()).toBe(403);

    const publish = await request.post("/api/admin/community-moderation", {
      headers: auth(platformAdmin.accessToken),
      data: { contentType: "post", contentId: postId, action: "publish", note: "复核上下文后允许发布" },
    });
    expect(publish.status()).toBe(200);

    const selfReport = await request.post("/api/community/reports", {
      headers: auth(guardian.accessToken),
      data: { postId, reason: "不应允许举报自己。" },
    });
    expect(selfReport.status()).toBe(400);

    const report = await request.post("/api/community/reports", {
      headers: auth(schoolLead.accessToken),
      data: { postId, reason: "自动化验收：请平台复核这条内容。" },
    });
    expect(report.status()).toBe(201);
    const duplicateReport = await request.post("/api/community/reports", {
      headers: auth(schoolLead.accessToken),
      data: { postId, reason: "自动化验收：重复举报不应成功。" },
    });
    expect(duplicateReport.status()).toBe(409);

    const remove = await request.post("/api/admin/community-moderation", {
      headers: auth(platformAdmin.accessToken),
      data: { contentType: "post", contentId: postId, action: "remove", note: "复测移除与恢复流程" },
    });
    expect(remove.status()).toBe(200);

    const afterRemove = await request.get("/api/admin/community-moderation", {
      headers: auth(platformAdmin.accessToken),
    });
    expect(afterRemove.status()).toBe(200);
    expect((await afterRemove.json()).history).toEqual(expect.arrayContaining([
      expect.objectContaining({ content_id: postId, current_status: "removed", note: "复测移除与恢复流程" }),
    ]));

    const restore = await request.post("/api/admin/community-moderation", {
      headers: auth(platformAdmin.accessToken),
      data: { contentType: "post", contentId: postId, action: "publish", note: "确认误移除，恢复显示" },
    });
    expect(restore.status()).toBe(200);

    const forbiddenMute = await request.post("/api/admin/community-restrictions", {
      headers: auth(schoolLead.accessToken),
      data: { targetUserId: guardian.userId, durationMinutes: 1440, reason: "不应成功" },
    });
    expect(forbiddenMute.status()).toBe(403);

    const mute = await request.post("/api/admin/community-restrictions", {
      headers: auth(platformAdmin.accessToken),
      data: { targetUserId: guardian.userId, durationMinutes: 1440, reason: "自动化验收禁言" },
    });
    expect(mute.status()).toBe(200);
    const mutedPost = await request.post("/api/community/posts", {
      headers: auth(guardian.accessToken),
      data: {
        title: "禁言期间不应发布",
        body: "这条内容不应被写入数据库。",
        viewerRoles: ["guardian"],
        commenterRoles: [],
      },
    });
    expect(mutedPost.status()).toBe(403);
    expect(await mutedPost.json()).toMatchObject({ muted: true });

    const restrictions = await request.get("/api/admin/community-restrictions", {
      headers: auth(platformAdmin.accessToken),
    });
    expect(restrictions.status()).toBe(200);
    expect((await restrictions.json()).restrictions).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: guardian.userId, reason: "自动化验收禁言" }),
    ]));

    const unmute = await request.delete("/api/admin/community-restrictions", {
      headers: auth(platformAdmin.accessToken),
      data: { targetUserId: guardian.userId, reason: "自动化验收解除禁言" },
    });
    expect(unmute.status()).toBe(200);
    const createAfterUnmute = await request.post("/api/community/posts", {
      headers: auth(guardian.accessToken),
      data: {
        title: `[E2E-解除禁言] ${Date.now()}`,
        body: "解除限制后可以正常发布。",
        viewerRoles: ["guardian"],
        commenterRoles: [],
      },
    });
    expect(createAfterUnmute.status()).toBe(201);
    unmutedPostId = (await createAfterUnmute.json()).post.id as string;

    const [{ data: post }, { data: reports }, { data: actions }] = await Promise.all([
      admin.from("community_posts").select("moderation_status").eq("id", postId).single(),
      admin.from("community_reports").select("status,resolved_at,resolved_by").eq("post_id", postId),
      admin.from("community_moderation_actions").select("action,note,actor_user_id").eq("content_id", postId),
    ]);
    expect(post?.moderation_status).toBe("published");
    expect(reports).toEqual([expect.objectContaining({ status: "resolved", resolved_at: expect.any(String), resolved_by: expect.any(String) })]);
    expect(actions).toHaveLength(3);
    expect(actions?.every((action) => Boolean(action.actor_user_id))).toBe(true);
  } finally {
    if (postId) {
      await admin.from("community_moderation_actions").delete().eq("content_id", postId);
      await admin.from("community_posts").delete().eq("id", postId);
    }
    if (unmutedPostId) await admin.from("community_posts").delete().eq("id", unmutedPostId);
    await admin.from("community_restrictions").delete().eq("user_id", guardian.userId);
  }
});
