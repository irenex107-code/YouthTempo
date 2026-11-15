import { createClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext } from "@playwright/test";
import fixture from "./fixtures/permission-boundary.json";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

test.use({ trace: "off" });
test.describe.configure({ mode: "serial" });

type UserKey = keyof typeof fixture.users;

async function sessionFor(key: UserKey) {
  if (!supabaseUrl || !supabaseAnonKey || !password) throw new Error("缺少隔离环境地址、匿名密钥或虚拟测试密码");
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: fixture.users[key].email,
    password,
  });
  if (error || !data.session) throw new Error(`虚拟账号 ${key} 未能完成登录`);
  return { accessToken: data.session.access_token, userId: data.user.id };
}

function auth(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function publicPosts(request: APIRequestContext, accessToken: string) {
  const response = await request.get("/api/community/posts", { headers: auth(accessToken) });
  expect(response.status()).toBe(200);
  return (await response.json()).posts as Array<{ id: string; comments: Array<{ id: string }> }>;
}

test("平台管理员可处理、移除并恢复社区内容，其他角色不能进入审核接口", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "审核 API 权限与视口无关，无需重复执行");
  test.skip(!supabaseUrl || !supabaseAnonKey || !password || !serviceRoleKey, "需要完整的隔离虚拟学校环境");
  test.setTimeout(120_000);

  const [platformAdmin, guardian, schoolLead, student, professional] = await Promise.all([
    sessionFor("platformAdmin"),
    sessionFor("guardianOne"),
    sessionFor("schoolLead"),
    sessionFor("studentOne"),
    sessionFor("professional"),
  ]);
  const admin = createClient(supabaseUrl, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let postId = "";
  let unmutedPostId = "";

  try {
    for (const reader of [guardian, schoolLead, student, professional]) {
      const forbiddenQueue = await request.get("/api/admin/community-moderation", {
        headers: auth(reader.accessToken),
      });
      expect(forbiddenQueue.status()).toBe(403);
    }
    const guardianAccount = await request.get("/api/account/status", { headers: auth(guardian.accessToken) });
    expect(guardianAccount.status()).toBe(200);
    expect((await guardianAccount.json()).linkedChildren).toEqual([]);

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
    const created = await createPost.json();
    expect(created).toMatchObject({ post: { moderation_status: "safety_review" }, safetyNotice: true });
    postId = created.post.id as string;
    for (const reader of [guardian, schoolLead, student]) {
      expect((await publicPosts(request, reader.accessToken)).some((post) => post.id === postId)).toBe(false);
    }

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
    expect((await publicPosts(request, guardian.accessToken)).some((post) => post.id === postId)).toBe(true);
    expect((await publicPosts(request, schoolLead.accessToken)).some((post) => post.id === postId)).toBe(true);
    expect((await publicPosts(request, student.accessToken)).some((post) => post.id === postId)).toBe(false);

    const selfReport = await request.post("/api/community/reports", {
      headers: auth(guardian.accessToken),
      data: { postId, reason: "不应允许举报自己。" },
    });
    expect(selfReport.status()).toBe(400);

    const report = await request.post("/api/community/reports", {
      headers: auth(schoolLead.accessToken),
      data: {
        postId,
        category: "privacy_exposure",
        details: "自动化验收：请平台复核这条内容。",
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

    const ownReports = await request.get("/api/community/reports", {
      headers: auth(schoolLead.accessToken),
    });
    expect(ownReports.status()).toBe(200);
    expect((await ownReports.json()).reports).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: reportBody.report.id, category: "privacy_exposure", priority: "high" }),
    ]));
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
    for (const reader of [guardian, schoolLead]) {
      expect((await publicPosts(request, reader.accessToken)).some((post) => post.id === postId)).toBe(false);
    }

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
    for (const reader of [guardian, schoolLead]) {
      expect((await publicPosts(request, reader.accessToken)).some((post) => post.id === postId)).toBe(true);
    }
    expect((await publicPosts(request, student.accessToken)).some((post) => post.id === postId)).toBe(false);

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
      await admin.from("community_posts").delete().eq("id", postId).eq("author_user_id", guardian.userId);
    }
    if (unmutedPostId) await admin.from("community_posts").delete().eq("id", unmutedPostId).eq("author_user_id", guardian.userId);
    await admin.from("community_restrictions").delete().eq("user_id", guardian.userId);
  }
});

test("高风险评论先进入安全复核，只有平台管理员能审核且普通列表不泄露待审内容", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "评论审核的 API/数据库边界无需按视口重复执行");
  test.skip(!supabaseUrl || !supabaseAnonKey || !password || !serviceRoleKey, "需要完整的隔离虚拟学校环境");
  test.setTimeout(120_000);

  const [platformAdmin, guardian, teacher] = await Promise.all([
    sessionFor("platformAdmin"), sessionFor("guardianOne"), sessionFor("teacherOne"),
  ]);
  const admin = createClient(supabaseUrl, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let postId = "", commentId = "";
  const marker = `[E2E-COMMENT-REVIEW] ${Date.now()}`;
  try {
    const createPost = await request.post("/api/community/posts", {
      headers: auth(guardian.accessToken),
      data: { title: marker, body: "这是一条合成社区交流内容。", viewerRoles: ["guardian", "teacher"], commenterRoles: ["teacher"] },
    });
    expect(createPost.status()).toBe(201);
    postId = (await createPost.json()).post.id as string;
    const comment = await request.post("/api/community/comments", {
      headers: auth(teacher.accessToken),
      data: { postId, body: `${marker} 我觉得活着没有意义。此句仅用于隔离的安全复核验收。` },
    });
    expect(comment.status()).toBe(202);
    const created = await comment.json();
    expect(created).toMatchObject({ comment: { moderation_status: "safety_review" }, safetyNotice: true });
    commentId = created.comment.id as string;

    for (const reader of [guardian, teacher]) {
      const ordinaryPost = (await publicPosts(request, reader.accessToken)).find((post) => post.id === postId);
      expect(ordinaryPost).toBeDefined();
      expect(ordinaryPost?.comments.some((item) => item.id === commentId)).toBe(false);
    }
    const queue = await request.get("/api/admin/community-moderation", { headers: auth(platformAdmin.accessToken) });
    expect(queue.status()).toBe(200);
    expect((await queue.json()).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ content_id: commentId, content_type: "comment", moderation_status: "safety_review" }),
    ]));
    const forbidden = await request.post("/api/admin/community-moderation", {
      headers: auth(teacher.accessToken),
      data: { contentType: "comment", contentId: commentId, action: "publish", note: "不应允许普通老师发布待审评论" },
    });
    expect(forbidden.status()).toBe(403);
    const stillPending = await admin.from("community_comments").select("moderation_status")
      .eq("id", commentId).eq("author_user_id", teacher.userId).single();
    expect(stillPending.error).toBeNull();
    expect(stillPending.data?.moderation_status).toBe("safety_review");

    const remove = await request.post("/api/admin/community-moderation", {
      headers: auth(platformAdmin.accessToken),
      data: { contentType: "comment", contentId: commentId, action: "remove", note: "合成评论审核：从公开区移除并保留处理记录" },
    });
    expect(remove.status()).toBe(200);
    const removed = await admin.from("community_comments").select("moderation_status")
      .eq("id", commentId).eq("author_user_id", teacher.userId).single();
    expect(removed.error).toBeNull();
    expect(removed.data?.moderation_status).toBe("removed");
    const history = await request.get("/api/admin/community-moderation", { headers: auth(platformAdmin.accessToken) });
    expect(history.status()).toBe(200);
    expect((await history.json()).history).toEqual(expect.arrayContaining([
      expect.objectContaining({ content_id: commentId, content_type: "comment", current_status: "removed" }),
    ]));
    expect((await publicPosts(request, guardian.accessToken)).find((post) => post.id === postId)?.comments
      .some((item) => item.id === commentId)).toBe(false);
  } finally {
    if (commentId) {
      await admin.from("community_moderation_actions").delete().eq("content_type", "comment").eq("content_id", commentId);
      await admin.from("community_comments").delete().eq("id", commentId).eq("author_user_id", teacher.userId);
    }
    if (postId) await admin.from("community_posts").delete().eq("id", postId).eq("author_user_id", guardian.userId);
  }
});
