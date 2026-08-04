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

type UserKey = keyof typeof fixture.users;
type UserIds = Record<UserKey, string>;

async function sessionFor(key: UserKey) {
  if (!password) throw new Error("缺少 E2E_PERMISSION_TEST_PASSWORD");
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
    const data = assertResult(
      await admin.auth.admin.listUsers({ page, perPage: 200 }),
      "读取虚拟账号",
    );
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
  const results = await Promise.all([
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
    admin.from("teacher_student_assignments").upsert(
      {
        school_id: schoolId,
        teacher_user_id: ids.teacherOne,
        student_user_id: ids.studentOne,
        assigned_by: ids.schoolLead,
        status: "active",
        revoked_at: null,
        updated_at: now,
      },
      { onConflict: "school_id,teacher_user_id,student_user_id" },
    ),
    admin.from("guardian_student_links").upsert(
      {
        school_id: schoolId,
        guardian_user_id: ids.guardianOne,
        student_user_id: ids.studentOne,
        confirmed_by: ids.schoolLead,
        status: "active",
        revoked_at: null,
        updated_at: now,
      },
      { onConflict: "school_id,guardian_user_id,student_user_id" },
    ),
    admin
      .from("sweet_records")
      .update({ school_id: schoolId })
      .eq("id", fixture.records.studentOne.id),
  ]);

  results.forEach((result, index) => assertResult(result, `恢复虚拟关系 ${index + 1}`));
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
  const guardian = await sessionFor("guardianOne");
  const student = await sessionFor("studentOne");
  const schoolId = fixture.schools.a.id;

  async function removeMember(userId: string) {
    const response = await request.delete("/api/admin/school-assignments", {
      headers: { Authorization: `Bearer ${lead.accessToken}` },
      data: { schoolId, userId },
    });
    expect(response.status(), await response.text()).toBe(200);
  }

  await restoreAccess(admin, ids);
  try {
    await test.step("移出学生会同时撤销老师、家长和学校的查看权限", async () => {
      expect(await visibleRecordIds(teacher.supabase)).toEqual([fixture.records.studentOne.id]);
      expect(await visibleRecordIds(guardian.supabase)).toEqual([fixture.records.studentOne.id]);

      await removeMember(ids.studentOne);

      expect(await visibleRecordIds(teacher.supabase)).toEqual([]);
      expect(await visibleRecordIds(guardian.supabase)).toEqual([]);
      expect(await visibleRecordIds(student.supabase)).toEqual([fixture.records.studentOne.id]);

      const overview = await request.get("/api/admin/overview", {
        headers: { Authorization: `Bearer ${lead.accessToken}` },
      });
      expect(overview.status()).toBe(200);
      const overviewBody = await overview.json();
      expect(overviewBody.recentRecords.map((record: { id: string }) => record.id)).not.toContain(
        fixture.records.studentOne.id,
      );

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
    await test.step("移出老师会让其旧会话立即失去工作台和学生记录权限", async () => {
      expect(await visibleRecordIds(teacher.supabase)).toEqual([fixture.records.studentOne.id]);
      await removeMember(ids.teacherOne);
      expect(await visibleRecordIds(teacher.supabase)).toEqual([]);

      const overview = await request.get("/api/admin/overview", {
        headers: { Authorization: `Bearer ${teacher.accessToken}` },
      });
      expect(overview.status()).toBe(403);
    });

    await restoreAccess(admin, ids);
    await test.step("移出家长会让其旧会话立即失去孩子记录权限", async () => {
      expect(await visibleRecordIds(guardian.supabase)).toEqual([fixture.records.studentOne.id]);
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
    });
  } finally {
    await restoreAccess(admin, ids);
  }
});
