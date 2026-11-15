import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import fixture from "./fixtures/permission-boundary.json";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

type UserKey = keyof typeof fixture.users;
type UserIds = Record<UserKey, string>;

async function sessionFor(key: UserKey) {
  if (!password || !supabaseAnonKey) throw new Error("缺少隔离环境的测试密码或匿名密钥");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: fixture.users[key].email,
    password,
  });
  if (error || !data.session) throw error || new Error(`无法登录 ${key}`);
  return { supabase, accessToken: data.session.access_token };
}

function assertResult<T>(result: { data: T; error: { message: string } | null }, label: string) {
  if (result.error) throw new Error(`${label}：${result.error.message}`);
  return result.data;
}

async function fixtureUserIds(admin: SupabaseClient): Promise<UserIds> {
  const users = [];
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error("读取虚拟账号失败。");
    users.push(...data.users);
    if (data.users.length < 200) break;
  }

  const byEmail = new Map(
    users.flatMap((user) =>
      user.email ? [[user.email.trim().toLowerCase(), user.id] as const] : [],
    ),
  );
  return Object.fromEntries(
    Object.entries(fixture.users).map(([key, definition]) => {
      const id = byEmail.get(definition.email.toLowerCase());
      if (!id) throw new Error(`找不到虚拟账号 ${definition.email}`);
      return [key, id];
    }),
  ) as UserIds;
}

async function restoreAccess(admin: SupabaseClient, ids: UserIds) {
  const schoolId = fixture.schools.a.id;
  const now = new Date().toISOString();
  const profiles = await Promise.all([
    admin
      .from("profiles")
      .update({ role: "学生", school_id: schoolId, updated_at: now })
      .eq("id", ids.studentOne),
    admin
      .from("profiles")
      .update({ role: "学校支持人员", school_id: schoolId, updated_at: now })
      .eq("id", ids.teacherOne),
    admin
      .from("profiles")
      .update({ role: "家长", school_id: schoolId, updated_at: now })
      .eq("id", ids.guardianOne),
  ]);
  profiles.forEach((result, index) => assertResult(result, `恢复虚拟资料 ${index + 1}`));

  // Restore the profile first: assignment/consent checks must see the current
  // school, rather than racing a parallel profile update after member removal.
  const relationships = await Promise.all([
    admin.from("school_members").upsert(
      {
        school_id: schoolId,
        user_id: ids.teacherOne,
        email: fixture.users.teacherOne.email,
        member_role: "school_support",
        status: "active",
        revoked_at: null,
      },
      { onConflict: "school_id,user_id" },
    ),
    admin.from("guardian_student_links").upsert(
      {
        school_id: schoolId,
        guardian_user_id: ids.guardianOne,
        student_user_id: ids.studentOne,
        confirmed_by: ids.schoolLead,
        status: "revoked",
        revoked_at: now,
        updated_at: now,
      },
      { onConflict: "school_id,guardian_user_id,student_user_id" },
    ),
  ]);
  relationships.forEach((result, index) => assertResult(result, `恢复虚拟关系 ${index + 1}`));

  assertResult(await admin.from("teacher_student_assignments").upsert({
    school_id: schoolId, teacher_user_id: ids.teacherOne, student_user_id: ids.studentOne,
    assigned_by: ids.schoolLead, status: "active", revoked_at: null, updated_at: now,
  }, { onConflict: "school_id,teacher_user_id,student_user_id" }), "恢复虚拟负责关系");
  assertResult(await admin.from("student_consents").upsert({
    student_user_id: ids.studentOne, school_id: schoolId, age_band: "14_17", consent_basis: "student_self_pilot",
    policy_version: "2026-08-28", status: "active", student_assented_at: now,
    guardian_user_id: null, guardian_consented_at: null, withdrawn_at: null, withdrawn_by: null, updated_at: now,
  }, { onConflict: "student_user_id" }), "恢复本人使用确认");
  assertResult(await admin.from("sweet_records").update({ school_id: schoolId })
    .eq("id", fixture.records.studentOne.id).eq("user_id", ids.studentOne), "恢复本人记录学校标记");
}

async function visibleRecordIds(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("sweet_records")
    .select("id")
    .eq("id", fixture.records.studentOne.id);
  expect(error).toBeNull();
  return (data || []).map((row) => row.id);
}

test("移出成员后，旧登录会话立即失去学校关系权限", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "关系撤销属于 API/RLS 测试，无需按视口重复执行");
  test.skip(!password || !serviceRoleKey, "需要本机虚拟测试密码和 Supabase 服务端密钥");
  test.setTimeout(120_000);

  const admin = createClient(supabaseUrl, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ids = await fixtureUserIds(admin);
  const lead = await sessionFor("schoolLead");
  const teacher = await sessionFor("teacherOne");
  const replacementTeacher = await sessionFor("teacherTwo");
  const guardian = await sessionFor("guardianOne");
  const student = await sessionFor("studentOne");
  const schoolId = fixture.schools.a.id;
  const messageIds: string[] = [];

  async function accountStatus(accessToken: string) {
    const response = await request.get("/api/account/status", { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(response.status()).toBe(200);
    return response.json();
  }

  async function expectAssignedRelationship(active: boolean) {
    const [teacherAccount, studentAccount] = await Promise.all([
      accountStatus(teacher.accessToken), accountStatus(student.accessToken),
    ]);
    expect(teacherAccount.assignedStudents.map((person: { id: string }) => person.id)).toEqual(active ? [ids.studentOne] : []);
    expect(studentAccount.assignedTeachers.map((person: { id: string }) => person.id)).toEqual(active ? [ids.teacherOne] : []);
    expect(studentAccount.linkedGuardians).toEqual([]);
  }

  async function sendToTeacher(expectedStatus: 201 | 403, anonymous = false,
    recipientUserId = ids.teacherOne, recipientToken = teacher.accessToken) {
    const body = `[E2E-MEMBERSHIP] ${Date.now()}-${messageIds.length} 我想聊聊这周的作息安排。`;
    const response = await request.post("/api/messages", {
      headers: { Authorization: `Bearer ${student.accessToken}` },
      data: { recipientType: "teacher", recipientUserId, anonymous, body },
    });
    expect(response.status(), await response.text()).toBe(expectedStatus);
    if (expectedStatus === 201) {
      const payload = await response.json();
      expect(payload).toMatchObject({ message: { id: expect.any(String), moderation_status: "sent" }, dutyEscalated: false });
      messageIds.push(payload.message.id);
      const inbox = await request.get("/api/messages", { headers: { Authorization: `Bearer ${recipientToken}` } });
      expect(inbox.status()).toBe(200);
      expect((await inbox.json()).messages.map((message: { id: string }) => message.id)).toContain(payload.message.id);
      return payload.message.id as string;
    } else {
      const check = assertResult(await admin.from("student_messages").select("id")
        .eq("sender_user_id", ids.studentOne).eq("body", body), "核对被拒留言没有写入");
      expect(check).toEqual([]);
    }
  }

  async function messageRows(idsToRead: string[]) {
    const rows = assertResult(await admin.from("student_messages")
      .select("id,school_id,sender_user_id,recipient_type,recipient_user_id,anonymous_to_recipient,body,moderation_status,read_at,created_at")
      .in("id", idsToRead).eq("sender_user_id", ids.studentOne).order("id"), "读取本次留言保留快照");
    expect(rows, "留言保留快照应返回行数组").not.toBeNull();
    if (rows === null) throw new Error("留言保留快照没有返回行数组");
    return rows;
  }

  async function expectNoMessageAccess(accessToken: string, rows: Awaited<ReturnType<typeof messageRows>>) {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const inbox = await request.get("/api/messages", { headers });
    expect(inbox.status()).toBe(200);
    const inboxPayload = await inbox.json();
    const download = await request.get("/api/account/data", { headers });
    expect(download.status()).toBe(200);
    const downloaded = await download.json();
    for (const row of rows) {
      expect(inboxPayload.messages.map((message: { id: string }) => message.id)).not.toContain(row.id);
      expect(downloaded.data.messages.map((message: { id: string }) => message.id)).not.toContain(row.id);
      expect(JSON.stringify(inboxPayload)).not.toContain(row.body);
      expect(JSON.stringify(downloaded)).not.toContain(row.body);
      const markRead = await request.patch("/api/messages", { headers, data: { id: row.id } });
      expect(markRead.status()).toBe(404);
    }
    expect(await messageRows(rows.map((row) => row.id))).toEqual(rows);
  }

  async function expectStudentExportRetains(rows: Awaited<ReturnType<typeof messageRows>>) {
    const download = await request.get("/api/account/data", {
      headers: { Authorization: `Bearer ${student.accessToken}` },
    });
    expect(download.status()).toBe(200);
    const downloaded = await download.json();
    for (const row of rows) {
      const copies = downloaded.data.messages.filter((message: { id: string }) => message.id === row.id);
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject(row);
    }
  }

  async function removeMember(userId: string) {
    const response = await request.delete("/api/admin/school-assignments", {
      headers: { Authorization: `Bearer ${lead.accessToken}` },
      data: { schoolId, userId },
    });
    expect(response.status(), await response.text()).toBe(200);
  }

  await restoreAccess(admin, ids);
  try {
    await test.step("取消负责分配后，旧会话名单、新留言及历史列表/已读/导出同步失效，学生历史保留", async () => {
      await expectAssignedRelationship(true);
      expect(await visibleRecordIds(teacher.supabase)).toEqual([]);
      expect(await visibleRecordIds(guardian.supabase)).toEqual([]);
      await sendToTeacher(201);
      await sendToTeacher(201, true);
      const oldMessageIds = [...messageIds];
      const validRead = await request.patch("/api/messages", {
        headers: { Authorization: `Bearer ${teacher.accessToken}` }, data: { id: oldMessageIds[0] },
      });
      expect(validRead.status()).toBe(200);
      const oldMessages = await messageRows(oldMessageIds);
      expect(oldMessages).toHaveLength(2);
      expect(oldMessages.find((message) => message.id === oldMessageIds[0])?.read_at).toEqual(expect.any(String));
      const teacherDownload = await request.get("/api/account/data", {
        headers: { Authorization: `Bearer ${teacher.accessToken}` },
      });
      expect(teacherDownload.status()).toBe(200);
      const teacherData = await teacherDownload.json();
      for (const messageId of oldMessageIds) {
        expect(teacherData.data.messages.map((message: { id: string }) => message.id)).toContain(messageId);
      }
      await expectStudentExportRetains(oldMessages);
      const response = await request.post("/api/admin/teacher-student-assignments", {
        headers: { Authorization: `Bearer ${lead.accessToken}` },
        data: { schoolId, teacherUserId: ids.teacherOne, studentUserIds: [] },
      });
      expect(response.status(), await response.text()).toBe(200);
      await expectAssignedRelationship(false);
      await sendToTeacher(403);
      await expectNoMessageAccess(teacher.accessToken, oldMessages);
      await expectStudentExportRetains(oldMessages);
      expect(await visibleRecordIds(student.supabase)).toEqual([fixture.records.studentOne.id]);

      const previousReplacementRows = assertResult(await admin.from("teacher_student_assignments")
        .select("student_user_id").eq("school_id", schoolId).eq("teacher_user_id", ids.teacherTwo)
        .eq("status", "active"), "读取接任老师原有负责范围");
      expect(previousReplacementRows, "原有负责范围应返回行数组").not.toBeNull();
      if (previousReplacementRows === null) throw new Error("原有负责范围没有返回行数组");
      const previousReplacementAssignments = previousReplacementRows.map((row) => row.student_user_id as string);
      try {
        const handover = await request.post("/api/admin/teacher-student-assignments", {
          headers: { Authorization: `Bearer ${lead.accessToken}` },
          data: { schoolId, teacherUserId: ids.teacherTwo,
            studentUserIds: [...new Set([...previousReplacementAssignments, ids.studentOne])] },
        });
        expect(handover.status(), await handover.text()).toBe(200);
        await expectNoMessageAccess(replacementTeacher.accessToken, oldMessages);
        const newMessageId = await sendToTeacher(201, false, ids.teacherTwo, replacementTeacher.accessToken);
        expect(newMessageId).toEqual(expect.any(String));
        const newMessages = await messageRows([newMessageId!]);
        expect(newMessages).toHaveLength(1);
        await expectNoMessageAccess(teacher.accessToken, newMessages);
        await expectStudentExportRetains([...oldMessages, ...newMessages]);
      } finally {
        const restored = await request.post("/api/admin/teacher-student-assignments", {
          headers: { Authorization: `Bearer ${lead.accessToken}` },
          data: { schoolId, teacherUserId: ids.teacherTwo, studentUserIds: previousReplacementAssignments },
        });
        expect(restored.status(), await restored.text()).toBe(200);
      }
    });

    await restoreAccess(admin, ids);
    await test.step("移出学生撤销学校目录与负责关系，本人记录和家长关闭边界保留", async () => {
      await expectAssignedRelationship(true);
      expect(await visibleRecordIds(teacher.supabase)).toEqual([]);
      expect(await visibleRecordIds(guardian.supabase)).toEqual([]);

      const previousMessages = (await messageRows(messageIds))
        .filter((message) => message.recipient_user_id === ids.teacherOne);
      expect(previousMessages).toHaveLength(2);
      await removeMember(ids.studentOne);

      expect(await visibleRecordIds(teacher.supabase)).toEqual([]);
      expect(await visibleRecordIds(guardian.supabase)).toEqual([]);
      expect(await visibleRecordIds(student.supabase)).toEqual([fixture.records.studentOne.id]);
      await expectAssignedRelationship(false);
      await sendToTeacher(403);
      await expectNoMessageAccess(teacher.accessToken, previousMessages);
      await expectStudentExportRetains(previousMessages);

      const overview = await request.get("/api/admin/overview", {
        headers: { Authorization: `Bearer ${lead.accessToken}` },
      });
      expect(overview.status()).toBe(200);
      const overviewBody = await overview.json();
      expect(overviewBody.privateRecordsRestricted).toBe(true);
      expect(overviewBody.recentRecords).toEqual([]);
      expect(overviewBody.schoolDirectories.find((directory: { school_id: string }) => directory.school_id === schoolId)
        .students.map((person: { id: string }) => person.id)).not.toContain(ids.studentOne);

      const account = await request.get("/api/account/status", {
        headers: { Authorization: `Bearer ${student.accessToken}` },
      });
      expect(account.status()).toBe(200);
      await expect(account.json()).resolves.toMatchObject({
        hasSchool: false,
        assignedTeachers: [],
        linkedGuardians: [],
      });
    });

    await restoreAccess(admin, ids);
    await test.step("移出老师让其旧会话失去工作台与负责资格，不扩大原文访问", async () => {
      await expectAssignedRelationship(true);
      expect(await visibleRecordIds(teacher.supabase)).toEqual([]);
      const previousMessages = (await messageRows(messageIds))
        .filter((message) => message.recipient_user_id === ids.teacherOne);
      expect(previousMessages).toHaveLength(2);
      await removeMember(ids.teacherOne);
      expect(await visibleRecordIds(teacher.supabase)).toEqual([]);
      await expectAssignedRelationship(false);
      await sendToTeacher(403);
      await expectNoMessageAccess(teacher.accessToken, previousMessages);
      await expectStudentExportRetains(previousMessages);
      expect(await visibleRecordIds(student.supabase)).toEqual([fixture.records.studentOne.id]);

      const overview = await request.get("/api/admin/overview", {
        headers: { Authorization: `Bearer ${teacher.accessToken}` },
      });
      expect(overview.status()).toBe(403);
    });

    await restoreAccess(admin, ids);
    await test.step("移出历史家长资料后旧会话仍无孩子资料或留言权限", async () => {
      expect(await visibleRecordIds(guardian.supabase)).toEqual([]);
      await removeMember(ids.guardianOne);
      expect(await visibleRecordIds(guardian.supabase)).toEqual([]);

      const account = await request.get("/api/account/status", {
        headers: { Authorization: `Bearer ${guardian.accessToken}` },
      });
      expect(account.status()).toBe(200);
      await expect(account.json()).resolves.toMatchObject({
        hasSchool: false,
        linkedChildren: [],
      });
      const inbox = await request.get("/api/messages", { headers: { Authorization: `Bearer ${guardian.accessToken}` } });
      expect(inbox.status()).toBe(403);
      expect(await visibleRecordIds(student.supabase)).toEqual([fixture.records.studentOne.id]);
      await expectAssignedRelationship(true);
    });
  } finally {
    try {
      if (messageIds.length) assertResult(await admin.from("student_messages").delete()
        .in("id", messageIds).eq("sender_user_id", ids.studentOne), "删除本次虚拟留言");
    } finally {
      await restoreAccess(admin, ids);
    }
  }
});
