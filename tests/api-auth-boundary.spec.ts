import { expect, test } from "@playwright/test";

const protectedReads = [
  "/api/account/status",
  "/api/admin/overview",
  "/api/admin/schools",
  "/api/admin/teacher-student-assignments?schoolId=school-a",
  "/api/messages",
];

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
