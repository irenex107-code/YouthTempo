import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import fixture from "./fixtures/permission-boundary.json";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_NiIGAQ6Wf--HakVNwFnSmA_zqzSGHRv";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

function assertResult<T>(result: { data: T; error: { message: string } | null }, label: string) {
  if (result.error) throw new Error(`${label}：${result.error.message}`);
  return result.data;
}

async function signIn(email: string) {
  if (!password) throw new Error("缺少 E2E_PERMISSION_TEST_PASSWORD");
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error || new Error(`无法登录 ${email}`);
  return { client, token: data.session.access_token };
}

async function countRows(client: SupabaseClient, table: string, schoolId: string) {
  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("school_id", schoolId);
  if (error) throw new Error(`检查 ${table}：${error.message}`);
  return count || 0;
}

test("学校退出会原子撤销学校权限、保留个人数据并记录最小审计", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "学校退出属于 API/RLS 测试，无需按视口重复执行");
  test.skip(!password || !serviceRoleKey, "需要虚拟测试密码和 Supabase 服务端密钥");

  const admin = createClient(supabaseUrl, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = randomUUID();
  const schoolId = randomUUID();
  const recordId = randomUUID();
  const schoolName = `[E2E] 退出试点学校 ${suffix.slice(0, 8)}`;
  const definitions = {
    lead: { email: `e2e-exit-lead-${suffix}@example.com`, role: "学校支持人员" },
    teacher: { email: `e2e-exit-teacher-${suffix}@example.com`, role: "学校支持人员" },
    student: { email: `e2e-exit-student-${suffix}@example.com`, role: "学生" },
    guardian: { email: `e2e-exit-guardian-${suffix}@example.com`, role: "家长" },
  } as const;
  const userIds: Record<keyof typeof definitions, string> = {} as Record<keyof typeof definitions, string>;

  try {
    assertResult(
      await admin.from("schools").insert({ id: schoolId, name: schoolName, status: "active" }),
      "创建退出测试学校",
    );

    for (const [key, definition] of Object.entries(definitions) as Array<
      [keyof typeof definitions, (typeof definitions)[keyof typeof definitions]]
    >) {
      const data = assertResult(
        await admin.auth.admin.createUser({
          email: definition.email,
          password: password!,
          email_confirm: true,
          user_metadata: { display_name: `[E2E] ${key}` },
        }),
        `创建 ${key} 账号`,
      );
      userIds[key] = data.user.id;
    }

    assertResult(
      await admin.from("profiles").upsert(
        Object.entries(definitions).map(([key, definition]) => ({
          id: userIds[key as keyof typeof definitions],
          email: definition.email,
          display_name: `[E2E] ${key}`,
          role: definition.role,
          school_id: schoolId,
        })),
        { onConflict: "id" },
      ),
      "创建个人资料",
    );
    assertResult(
      await admin.from("school_members").insert([
        {
          school_id: schoolId,
          user_id: userIds.lead,
          email: definitions.lead.email,
          member_role: "school_admin",
        },
        {
          school_id: schoolId,
          user_id: userIds.teacher,
          email: definitions.teacher.email,
          member_role: "school_support",
        },
      ]),
      "创建学校成员",
    );
    assertResult(
      await admin.from("teacher_student_assignments").insert({
        school_id: schoolId,
        teacher_user_id: userIds.teacher,
        student_user_id: userIds.student,
        assigned_by: userIds.lead,
      }),
      "创建师生关系",
    );
    assertResult(
      await admin.from("guardian_student_links").insert({
        school_id: schoolId,
        guardian_user_id: userIds.guardian,
        student_user_id: userIds.student,
        confirmed_by: userIds.lead,
      }),
      "创建亲子关系",
    );
    assertResult(
      await admin.from("student_consents").insert({
        student_user_id: userIds.student,
        school_id: schoolId,
        age_band: "14_17",
        policy_version: "e2e-school-exit",
        status: "active",
        student_assented_at: new Date().toISOString(),
        guardian_user_id: userIds.guardian,
        guardian_consented_at: new Date().toISOString(),
      }),
      "创建知情同意",
    );
    assertResult(
      await admin.from("student_consent_events").insert({
        student_user_id: userIds.student,
        school_id: schoolId,
        guardian_user_id: userIds.guardian,
        actor_user_id: userIds.student,
        event_type: "student_assented",
        age_band: "14_17",
        policy_version: "e2e-school-exit",
      }),
      "创建同意事件",
    );
    assertResult(
      await admin.from("sweet_records").insert({
        id: recordId,
        user_id: userIds.student,
        school_id: schoolId,
        records: [{ title: "睡眠", fields: [{ label: "测试", value: "学校退出后仍归学生" }] }],
        summary: "[E2E] 学校退出个人记录",
      }),
      "创建个人记录",
    );
    assertResult(
      await admin.from("school_followups").insert({
        school_id: schoolId,
        record_id: recordId,
        student_user_id: userIds.student,
        status: "in_progress",
        note: "学校协作内容应删除",
        updated_by: userIds.teacher,
      }),
      "创建学校跟进",
    );
    assertResult(
      await admin.from("student_messages").insert({
        school_id: schoolId,
        sender_user_id: userIds.student,
        recipient_type: "self",
        recipient_user_id: userIds.student,
        body: "个人留言应保留并解除学校归属",
      }),
      "创建个人留言",
    );
    assertResult(
      await admin.from("school_invites").insert({
        school_id: schoolId,
        email: `pending-${suffix}@example.com`,
        assignment_role: "student",
        invited_by: userIds.lead,
      }),
      "创建未完成邀请",
    );

    const [platformAdmin, lead, student] = await Promise.all([
      signIn(fixture.users.platformAdmin.email),
      signIn(definitions.lead.email),
      signIn(definitions.student.email),
    ]);

    const wrongConfirmation = await request.patch("/api/admin/schools", {
      headers: { Authorization: `Bearer ${platformAdmin.token}` },
      data: {
        schoolId,
        confirmationName: `${schoolName}（错误）`,
        reason: "学校已确认结束本次试点合作。",
      },
    });
    expect(wrongConfirmation.status()).toBe(400);

    const response = await request.patch("/api/admin/schools", {
      headers: { Authorization: `Bearer ${platformAdmin.token}` },
      data: {
        schoolId,
        confirmationName: schoolName,
        reason: "学校已确认结束本次试点合作，并已知悉权限及数据处理规则。",
      },
    });
    expect(response.status(), await response.text()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      school: { id: schoolId, status: "archived" },
      eventId: expect.any(String),
      affectedCounts: {
        members: 2,
        teacherAssignments: 1,
        guardianLinks: 1,
        sweetRecordsDetached: 1,
        messagesDetached: 1,
        followupsDeleted: 1,
        invitesDeleted: 1,
      },
    });

    const school = assertResult(
      await admin.from("schools").select("status").eq("id", schoolId).single(),
      "检查学校状态",
    );
    expect(school.status).toBe("archived");
    for (const table of [
      "school_members",
      "teacher_student_assignments",
      "guardian_student_links",
      "school_followups",
      "school_invites",
    ]) {
      expect(await countRows(admin, table, schoolId), table).toBe(0);
    }

    const record = assertResult(
      await admin.from("sweet_records").select("user_id,school_id").eq("id", recordId).single(),
      "检查个人记录",
    );
    expect(record).toEqual({ user_id: userIds.student, school_id: null });
    const message = assertResult(
      await admin.from("student_messages").select("school_id").eq("sender_user_id", userIds.student).single(),
      "检查个人留言",
    );
    expect(message.school_id).toBeNull();
    const consent = assertResult(
      await admin.from("student_consents").select("school_id").eq("student_user_id", userIds.student).single(),
      "检查知情同意",
    );
    expect(consent.school_id).toBeNull();

    const leadOverview = await request.get("/api/admin/overview", {
      headers: { Authorization: `Bearer ${lead.token}` },
    });
    expect(leadOverview.status()).toBe(403);
    const { data: studentRecords, error: studentRecordError } = await student.client
      .from("sweet_records")
      .select("id")
      .eq("id", recordId);
    expect(studentRecordError).toBeNull();
    expect(studentRecords).toEqual([{ id: recordId }]);

    const events = assertResult(
      await admin
        .from("school_exit_events")
        .select("school_name,reason,actor_user_id,affected_counts,policy_version,completed_at,expires_at")
        .eq("school_id", schoolId),
      "检查退出审计",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      school_name: schoolName,
      actor_user_id: expect.any(String),
      policy_version: "2026-08-03",
    });
    expect(new Date(events[0].expires_at).getTime()).toBeGreaterThan(
      new Date(events[0].completed_at).getTime(),
    );
  } finally {
    await admin.from("school_exit_events").delete().eq("school_id", schoolId);
    for (const userId of Object.values(userIds)) {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
    await admin.from("schools").delete().eq("id", schoolId);
  }
});
