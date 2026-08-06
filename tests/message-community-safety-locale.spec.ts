import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { moderateCommunityContent, moderateStudentMessage } from "@/lib/messageSafety";

test("英文高风险消息进入 safety_review", () => {
  const examples = [
    "I want to die",
    "I might kill myself",
    "I am thinking about ending my life",
    "I am thinking about self harm",
    "I want to hurt myself",
    "I cannot keep myself safe",
    "Someone is hurting me",
  ];

  for (const body of examples) {
    expect(moderateStudentMessage(body, "en"), body).toMatchObject({
      status: "safety_review",
      reason: expect.any(String),
    });
  }
  expect(moderateStudentMessage("I want to die").status).toBe("safety_review");
});

test("英文普通压力表达保持正常消息流程", () => {
  const examples = [
    "I feel stressed about exams",
    "I feel sad today",
    "I am tired after school",
    "I feel overwhelmed by homework",
  ];

  for (const body of examples) {
    expect(moderateStudentMessage(body, "en"), body).toEqual({ status: "sent", reason: null });
  }
});

test("英文社区危机内容不直接发布", () => {
  expect(moderateCommunityContent("I want to die", "en")).toMatchObject({
    status: "safety_review",
  });
  expect(moderateCommunityContent("I feel stressed about exams", "en")).toEqual({
    status: "published",
    reason: null,
  });
});

test("中文消息与社区既有安全行为保持不变", () => {
  expect(moderateStudentMessage("我最近觉得活不下去", "zh-CN")).toMatchObject({
    status: "safety_review",
    reason: "检测到需要尽快获得现实支持的内容。",
  });
  expect(moderateCommunityContent("我有伤害自己的想法", "zh-CN")).toMatchObject({
    status: "safety_review",
  });
  expect(moderateStudentMessage("最近考试压力很大", "zh-CN")).toEqual({ status: "sent", reason: null });
});

test("Messages 与 Community 写入 API 使用 locale 检测结果作为原有审核状态", async () => {
  const files = [
    {
      path: "pages/api/messages.ts",
      call: "moderateStudentMessage(body, locale)",
      insert: "moderation_status: result.status",
    },
    {
      path: "pages/api/community/posts.ts",
      call: "moderateCommunityContent(`${title}\\n${body}`, locale)",
      insert: "moderation_status: moderation.status",
    },
    {
      path: "pages/api/community/comments.ts",
      call: "moderateCommunityContent(body, locale)",
      insert: "moderation_status: moderation.status",
    },
  ];

  for (const file of files) {
    const source = await readFile(path.join(process.cwd(), file.path), "utf8");
    expect(source, `${file.path} 应规范化 locale`).toContain("normalizeLocale(");
    expect(source, `${file.path} 应执行 locale-aware 安全检测`).toContain(file.call);
    expect(source, `${file.path} 应沿用现有 moderation_status 写入`).toContain(file.insert);
    expect(source, `${file.path} 应返回 safetyNotice`).toContain("safetyNotice:");
  }
});

test("Messages 与 Community 前端提交当前 locale", async () => {
  const [messages, community] = await Promise.all([
    readFile(path.join(process.cwd(), "views/messages/page.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "views/community/page.tsx"), "utf8"),
  ]);

  expect(messages).toMatch(/sendStudentMessage\(\{[\s\S]{0,240}\blocale,/);
  expect(community).toContain("createCommunityPost({ title, body, viewerRoles, commenterRoles, locale })");
  expect(community).toContain("createCommunityComment(postId, draft, locale)");
});

test("英文安全提示温和明确且不固定中国大陆资源", async () => {
  const dictionary = JSON.parse(
    await readFile(path.join(process.cwd(), "locales/en.json"), "utf8"),
  );
  const notices = [
    dictionary.messages.notices.safetySent,
    dictionary.community.messages.postSafety,
    dictionary.community.messages.commentSafety,
  ] as string[];

  expect(notices.join(" ")).toMatch(/trusted/i);
  expect(dictionary.messages.notices.safetySent).toContain("local emergency services");
  for (const notice of notices) {
    expect(notice).not.toMatch(/\b(?:110|120|12356)\b/);
    expect(notice).not.toMatch(/diagnos|disorder|illness/i);
  }
});
