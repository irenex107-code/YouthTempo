import { createClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext } from "@playwright/test";
import fixture from "./fixtures/permission-boundary.json";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_NiIGAQ6Wf--HakVNwFnSmA_zqzSGHRv";
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

type UserKey = keyof typeof fixture.users;
type Session = { accessToken: string };
type CommunityPost = {
  id: string;
  can_comment: boolean;
  comments: Array<{ id: string }>;
};

async function sessionFor(key: UserKey): Promise<Session> {
  if (!password) throw new Error("缺少 E2E_PERMISSION_TEST_PASSWORD");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: fixture.users[key].email,
    password,
  });
  if (error || !data.session) throw error || new Error(`无法登录 ${key}`);
  return { accessToken: data.session.access_token };
}

function auth(session: Session) {
  return { Authorization: `Bearer ${session.accessToken}` };
}

async function listCommunity(request: APIRequestContext, session: Session) {
  const response = await request.get("/api/community/posts", { headers: auth(session) });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{
    currentUser: { role: string; canModerate: boolean };
    posts: CommunityPost[];
  }>;
}

function findPost(posts: CommunityPost[], id: string) {
  return posts.find((post) => post.id === id);
}

test.describe("社区帖子与评论可见范围", () => {
  test.skip(!password, "需要先初始化虚拟账号并配置 E2E_PERMISSION_TEST_PASSWORD");

  test("按作者选择的身份限制查看、评论与删除", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "API 权限矩阵无需按视口重复执行");
    test.setTimeout(120_000);

    const [studentOne, studentTwo, guardianOne, teacherOne, professional, platformAdmin] =
      await Promise.all([
        sessionFor("studentOne"),
        sessionFor("studentTwo"),
        sessionFor("guardianOne"),
        sessionFor("teacherOne"),
        sessionFor("professional"),
        sessionFor("platformAdmin"),
      ]);
    const createdPostIds: string[] = [];
    const createdCommentIds: string[] = [];
    const marker = `[E2E-COMMUNITY] ${Date.now()}`;

    try {
      const invalidResponse = await request.post("/api/community/posts", {
        headers: auth(studentOne),
        data: {
          title: `${marker} 无效范围`,
          body: "用于确认评论者必须先有查看权限。",
          viewerRoles: ["student"],
          commenterRoles: ["teacher"],
        },
      });
      expect(invalidResponse.status()).toBe(400);

      const studentPostResponse = await request.post("/api/community/posts", {
        headers: auth(studentOne),
        data: {
          title: `${marker} 阅读分享`,
          body: "这是一条自动化验收内容，用于确认社区查看范围。",
          viewerRoles: ["student", "professional"],
          commenterRoles: ["professional"],
        },
      });
      expect(studentPostResponse.status()).toBe(201);
      const studentPostBody = await studentPostResponse.json();
      const studentPostId = studentPostBody.post.id as string;
      createdPostIds.push(studentPostId);

      const guardianPostResponse = await request.post("/api/community/posts", {
        headers: auth(guardianOne),
        data: {
          title: `${marker} 家校交流`,
          body: "这是一条自动化验收内容，用于确认家长与老师的交流范围。",
          viewerRoles: ["guardian", "teacher"],
          commenterRoles: ["teacher"],
        },
      });
      expect(guardianPostResponse.status()).toBe(201);
      const guardianPostBody = await guardianPostResponse.json();
      const guardianPostId = guardianPostBody.post.id as string;
      createdPostIds.push(guardianPostId);

      const [studentView, guardianView, teacherView, professionalView, adminView] =
        await Promise.all([
          listCommunity(request, studentTwo),
          listCommunity(request, guardianOne),
          listCommunity(request, teacherOne),
          listCommunity(request, professional),
          listCommunity(request, platformAdmin),
        ]);

      expect(studentView.currentUser.role).toBe("student");
      expect(guardianView.currentUser.role).toBe("guardian");
      expect(teacherView.currentUser.role).toBe("teacher");
      expect(professionalView.currentUser.role).toBe("professional");
      expect(adminView.currentUser.canModerate).toBe(true);

      expect(findPost(studentView.posts, studentPostId)?.can_comment).toBe(false);
      expect(findPost(studentView.posts, guardianPostId)).toBeUndefined();
      expect(findPost(guardianView.posts, guardianPostId)?.can_comment).toBe(false);
      expect(findPost(guardianView.posts, studentPostId)).toBeUndefined();
      expect(findPost(teacherView.posts, guardianPostId)?.can_comment).toBe(true);
      expect(findPost(teacherView.posts, studentPostId)).toBeUndefined();
      expect(findPost(professionalView.posts, studentPostId)?.can_comment).toBe(true);
      expect(findPost(professionalView.posts, guardianPostId)).toBeUndefined();

      const studentCommentAttempt = await request.post("/api/community/comments", {
        headers: auth(studentTwo),
        data: { postId: studentPostId, body: `${marker} 学生越权评论` },
      });
      expect(studentCommentAttempt.status()).toBe(403);

      const guardianCommentAttempt = await request.post("/api/community/comments", {
        headers: auth(guardianOne),
        data: { postId: studentPostId, body: `${marker} 家长越权评论` },
      });
      expect(guardianCommentAttempt.status()).toBe(404);

      const professionalCommentResponse = await request.post("/api/community/comments", {
        headers: auth(professional),
        data: { postId: studentPostId, body: `${marker} 专业支持者回复` },
      });
      expect(professionalCommentResponse.status()).toBe(201);
      const professionalCommentId = (await professionalCommentResponse.json()).comment.id as string;
      createdCommentIds.push(professionalCommentId);

      const teacherCommentResponse = await request.post("/api/community/comments", {
        headers: auth(teacherOne),
        data: { postId: guardianPostId, body: `${marker} 老师回复` },
      });
      expect(teacherCommentResponse.status()).toBe(201);
      const teacherCommentId = (await teacherCommentResponse.json()).comment.id as string;
      createdCommentIds.push(teacherCommentId);

      const guardianCommentAttemptOnOwnPost = await request.post("/api/community/comments", {
        headers: auth(guardianOne),
        data: { postId: guardianPostId, body: `${marker} 家长未开放评论` },
      });
      expect(guardianCommentAttemptOnOwnPost.status()).toBe(403);

      const studentAfterComments = await listCommunity(request, studentTwo);
      expect(findPost(studentAfterComments.posts, studentPostId)?.comments.map(({ id }) => id)).toContain(
        professionalCommentId,
      );
      expect(findPost(studentAfterComments.posts, guardianPostId)).toBeUndefined();

      const nonAuthorCommentDelete = await request.delete("/api/community/comments", {
        headers: auth(studentTwo),
        data: { commentId: professionalCommentId },
      });
      expect(nonAuthorCommentDelete.status()).toBe(403);

      const authorCommentDelete = await request.delete("/api/community/comments", {
        headers: auth(professional),
        data: { commentId: professionalCommentId },
      });
      expect(authorCommentDelete.status()).toBe(200);
      createdCommentIds.splice(createdCommentIds.indexOf(professionalCommentId), 1);

      const nonAuthorPostDelete = await request.delete("/api/community/posts", {
        headers: auth(studentTwo),
        data: { postId: studentPostId },
      });
      expect(nonAuthorPostDelete.status()).toBe(403);

      const authorPostDelete = await request.delete("/api/community/posts", {
        headers: auth(studentOne),
        data: { postId: studentPostId },
      });
      expect(authorPostDelete.status()).toBe(200);
      createdPostIds.splice(createdPostIds.indexOf(studentPostId), 1);

      const adminPostDelete = await request.delete("/api/community/posts", {
        headers: auth(platformAdmin),
        data: { postId: guardianPostId },
      });
      expect(adminPostDelete.status()).toBe(200);
      createdPostIds.splice(createdPostIds.indexOf(guardianPostId), 1);

      const finalStudentView = await listCommunity(request, studentTwo);
      const finalGuardianView = await listCommunity(request, guardianOne);
      expect(findPost(finalStudentView.posts, studentPostId)).toBeUndefined();
      expect(findPost(finalGuardianView.posts, guardianPostId)).toBeUndefined();
    } finally {
      for (const commentId of createdCommentIds) {
        await request.delete("/api/community/comments", {
          headers: auth(platformAdmin),
          data: { commentId },
        });
      }
      for (const postId of createdPostIds) {
        await request.delete("/api/community/posts", {
          headers: auth(platformAdmin),
          data: { postId },
        });
      }
    }
  });
});
