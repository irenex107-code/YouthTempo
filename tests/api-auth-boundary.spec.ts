import { expect, test } from "@playwright/test";

const protectedReads = [
  "/api/account/data",
  "/api/account/status",
  "/api/admin/overview",
  "/api/admin/schools",
  "/api/admin/teacher-student-assignments?schoolId=school-a",
  "/api/admin/community-moderation",
  "/api/admin/community-restrictions",
  "/api/community/blocks",
  "/api/community/reports",
  "/api/messages",
  "/api/pilot-feedback",
  "/api/admin/pilot-feedback",
  "/api/mini/profile",
  "/api/mini/records",
];

test("未登录不能注销账号", async ({ request }) => {
  const response = await request.delete("/api/account/data", {
    data: { confirmationEmail: "nobody@example.com", acknowledge: true },
  });
  expect(response.status()).toBe(401);
});

for (const path of protectedReads) {
  test(`未登录不能读取 ${path}`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("登录") });
  });
}

test("未登录不能创建学校", async ({ request }) => {
  const response = await request.post("/api/admin/schools", {
    data: { name: "不应被创建的学校" },
  });
  expect(response.status()).toBe(401);
});

test("未登录不能让学校退出试点", async ({ request }) => {
  const response = await request.patch("/api/admin/schools", {
    data: {
      schoolId: "00000000-0000-0000-0000-000000000000",
      confirmationName: "不应被操作的学校",
      reason: "未登录请求不应进入学校退出流程。",
    },
  });
  expect(response.status()).toBe(401);
});

test("未登录不能分配老师、确认亲子关系或移出成员", async ({ request }) => {
  const teacherAssignment = await request.post("/api/admin/teacher-student-assignments", {
    data: { schoolId: "school-a", teacherUserId: "teacher-a", studentUserIds: ["student-a"] },
  });
  expect(teacherAssignment.status()).toBe(401);

  const guardianAssignment = await request.post("/api/admin/guardian-student-assignments", {
    data: { schoolId: "school-a", guardianUserId: "guardian-a", studentUserIds: ["student-a"] },
  });
  expect(guardianAssignment.status()).toBe(401);

  const memberRemoval = await request.delete("/api/admin/school-assignments", {
    data: { schoolId: "school-a", userId: "student-a" },
  });
  expect(memberRemoval.status()).toBe(401);
});

test("未登录不能修改跟进状态或发送悄悄话", async ({ request }) => {
  const followup = await request.post("/api/admin/followups", {
    data: { schoolId: "school-a", recordId: "record-a", status: "in_progress" },
  });
  expect(followup.status()).toBe(401);

  const message = await request.post("/api/messages", {
    data: { recipientType: "self", body: "不应被发送" },
  });
  expect(message.status()).toBe(401);
});

test("未登录不能提交试点反馈", async ({ request }) => {
  const response = await request.post("/api/pilot-feedback", {
    data: { overallExperience: 5, clarity: 5, safety: 5 },
  });
  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("登录") });
});

test("未登录不能处理社区审核内容", async ({ request }) => {
  const response = await request.post("/api/admin/community-moderation", {
    data: {
      contentType: "post",
      contentId: "00000000-0000-0000-0000-000000000000",
      action: "remove",
      note: "不应被保存",
    },
  });
  expect(response.status()).toBe(401);
});

test("未登录不能屏蔽成员或禁言账号", async ({ request }) => {
  const block = await request.post("/api/community/blocks", {
    data: { targetUserId: "00000000-0000-0000-0000-000000000000" },
  });
  expect(block.status()).toBe(401);

  const mute = await request.post("/api/admin/community-restrictions", {
    data: {
      targetUserId: "00000000-0000-0000-0000-000000000000",
      durationMinutes: 1440,
      reason: "不应被保存",
    },
  });
  expect(mute.status()).toBe(401);
});
