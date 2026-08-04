import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type APIResponse } from "@playwright/test";
import fixture from "./fixtures/permission-boundary.json";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_NiIGAQ6Wf--HakVNwFnSmA_zqzSGHRv";
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

type UserKey = keyof typeof fixture.users;

async function sessionFor(key: UserKey) {
  if (!password) throw new Error("缺少 E2E_PERMISSION_TEST_PASSWORD");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: fixture.users[key].email,
    password,
  });
  if (error || !data.session || !data.user) throw error || new Error(`无法登录 ${key}`);
  return {
    supabase,
    accessToken: data.session.access_token,
    userId: data.user.id,
  };
}

function headers(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function expectStatus(response: APIResponse, status: number) {
  expect(response.status(), await response.text()).toBe(status);
}

async function recordIds(supabase: SupabaseClient, recordId: string) {
  const { data, error } = await supabase
    .from("sweet_records")
    .select("id")
    .eq("id", recordId);
  expect(error).toBeNull();
  return (data || []).map((row) => row.id);
}

test("已登录用户伪造 API 参数仍不能跨角色、跨学生或跨学校操作", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "API 权限与视口无关，无需重复执行");
  test.skip(!password, "需要先初始化虚拟账号并配置 E2E_PERMISSION_TEST_PASSWORD");
  test.setTimeout(120_000);

  const [
    schoolLead,
    teacherOne,
    teacherTwo,
    studentOne,
    studentTwo,
    studentThree,
    guardianOne,
    guardianTwo,
  ] = await Promise.all([
    sessionFor("schoolLead"),
    sessionFor("teacherOne"),
    sessionFor("teacherTwo"),
    sessionFor("studentOne"),
    sessionFor("studentTwo"),
    sessionFor("studentThree"),
    sessionFor("guardianOne"),
    sessionFor("guardianTwo"),
  ]);

  await test.step("普通用户和老师不能伪造管理台请求", async () => {
    await expectStatus(
      await request.get("/api/admin/overview", {
        headers: headers(guardianOne.accessToken),
      }),
      403,
    );
    await expectStatus(
      await request.post("/api/admin/schools", {
        headers: headers(studentOne.accessToken),
        data: { name: "[E2E] 不应被创建的学校" },
      }),
      403,
    );
    await expectStatus(
      await request.patch("/api/admin/schools", {
        headers: headers(teacherOne.accessToken),
        data: {
          schoolId: fixture.schools.a.id,
          confirmationName: fixture.schools.a.name,
          reason: "普通学校角色不应能让学校退出试点。",
        },
      }),
      403,
    );
    await expectStatus(
      await request.delete("/api/admin/school-assignments", {
        headers: headers(teacherOne.accessToken),
        data: { schoolId: fixture.schools.a.id, userId: studentOne.userId },
      }),
      403,
    );
  });

  await test.step("学校负责人不能跨校读取、移出成员或跟进记录", async () => {
    await expectStatus(
      await request.get(
        `/api/admin/teacher-student-assignments?schoolId=${fixture.schools.b.id}`,
        { headers: headers(schoolLead.accessToken) },
      ),
      403,
    );
    await expectStatus(
      await request.delete("/api/admin/school-assignments", {
        headers: headers(schoolLead.accessToken),
        data: { schoolId: fixture.schools.b.id, userId: studentThree.userId },
      }),
      403,
    );
    await expectStatus(
      await request.post("/api/admin/followups", {
        headers: headers(schoolLead.accessToken),
        data: {
          schoolId: fixture.schools.b.id,
          recordId: fixture.records.studentThree.id,
          status: "in_progress",
        },
      }),
      403,
    );
    expect(await recordIds(studentThree.supabase, fixture.records.studentThree.id)).toEqual([
      fixture.records.studentThree.id,
    ]);
  });

  await test.step("本校关系接口也会拒绝夹带外校学生 ID", async () => {
    await expectStatus(
      await request.post("/api/admin/teacher-student-assignments", {
        headers: headers(schoolLead.accessToken),
        data: {
          schoolId: fixture.schools.a.id,
          teacherUserId: teacherOne.userId,
          studentUserIds: [studentThree.userId],
        },
      }),
      400,
    );
    expect(await recordIds(teacherOne.supabase, fixture.records.studentOne.id)).toEqual([
      fixture.records.studentOne.id,
    ]);

    await expectStatus(
      await request.post("/api/admin/guardian-student-assignments", {
        headers: headers(schoolLead.accessToken),
        data: {
          schoolId: fixture.schools.a.id,
          guardianUserId: guardianOne.userId,
          studentUserIds: [studentThree.userId],
        },
      }),
      400,
    );
    expect(await recordIds(guardianOne.supabase, fixture.records.studentOne.id)).toEqual([
      fixture.records.studentOne.id,
    ]);
  });

  await test.step("老师不能跟进未分配学生，学生不能伪造留言收件人", async () => {
    await expectStatus(
      await request.post("/api/admin/followups", {
        headers: headers(teacherOne.accessToken),
        data: {
          schoolId: fixture.schools.a.id,
          recordId: fixture.records.studentTwo.id,
          status: "in_progress",
        },
      }),
      403,
    );
    await expectStatus(
      await request.post("/api/messages", {
        headers: headers(studentOne.accessToken),
        data: {
          recipientType: "teacher",
          recipientUserId: teacherTwo.userId,
          body: "[E2E] 这条伪造收件人的留言不应被发送",
        },
      }),
      403,
    );
    await expectStatus(
      await request.post("/api/messages", {
        headers: headers(studentOne.accessToken),
        data: {
          recipientType: "guardian",
          recipientUserId: guardianTwo.userId,
          body: "[E2E] 这条伪造家长收件人的留言不应被发送",
        },
      }),
      403,
    );
  });

  await test.step("直接调用 Supabase Data API 也不能读取或删除他人记录", async () => {
    expect(await recordIds(teacherOne.supabase, fixture.records.studentTwo.id)).toEqual([]);
    expect(await recordIds(guardianOne.supabase, fixture.records.studentTwo.id)).toEqual([]);

    const { data, error } = await studentOne.supabase
      .from("sweet_records")
      .delete()
      .eq("id", fixture.records.studentTwo.id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await recordIds(studentTwo.supabase, fixture.records.studentTwo.id)).toEqual([
      fixture.records.studentTwo.id,
    ]);
  });

  await test.step("用户不能通过 Data API 篡改自己的学校归属", async () => {
    const { data: before, error: beforeError } = await studentOne.supabase
      .from("profiles")
      .select("school_id")
      .eq("id", studentOne.userId)
      .single();
    expect(beforeError).toBeNull();
    expect(before?.school_id).toBe(fixture.schools.a.id);

    const { data: unchanged, error: unchangedError } = await studentOne.supabase
      .from("profiles")
      .update({ school_id: fixture.schools.a.id })
      .eq("id", studentOne.userId)
      .select("school_id")
      .single();
    expect(unchangedError).toBeNull();
    expect(unchanged?.school_id).toBe(fixture.schools.a.id);

    const { data: changed, error: changeError } = await studentOne.supabase
      .from("profiles")
      .update({ school_id: fixture.schools.b.id })
      .eq("id", studentOne.userId)
      .select("school_id");
    expect(changeError).not.toBeNull();
    expect(changed).toBeNull();

    const { data: after, error: afterError } = await studentOne.supabase
      .from("profiles")
      .select("school_id")
      .eq("id", studentOne.userId)
      .single();
    expect(afterError).toBeNull();
    expect(after?.school_id).toBe(fixture.schools.a.id);
  });
});
