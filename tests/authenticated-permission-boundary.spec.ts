import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
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
  if (error || !data.session) throw error || new Error(`无法登录 ${key}`);
  return { supabase, accessToken: data.session.access_token };
}

function sortedRecordIds(rows: Array<{ id: string }> | null) {
  return (rows || []).map((row) => row.id).sort();
}

test.describe("真实账号与 RLS 权限隔离", () => {
  test.skip(!password, "需要先初始化虚拟账号并配置 E2E_PERMISSION_TEST_PASSWORD");

  test("家长只能读取已关联孩子的原始 SWEET 记录", async () => {
    const { supabase } = await sessionFor("guardianOne");
    const { data, error } = await supabase
      .from("sweet_records")
      .select("id,user_id,records,summary")
      .in("id", Object.values(fixture.records).map((record) => record.id));

    expect(error).toBeNull();
    expect(sortedRecordIds(data)).toEqual([fixture.records.studentOne.id]);
    expect(data?.[0]?.records).toBeTruthy();
  });

  test("老师只能读取分配给自己的学生记录", async () => {
    const { supabase } = await sessionFor("teacherOne");
    const { data, error } = await supabase
      .from("sweet_records")
      .select("id")
      .in("id", Object.values(fixture.records).map((record) => record.id));

    expect(error).toBeNull();
    expect(sortedRecordIds(data)).toEqual([fixture.records.studentOne.id]);
  });

  test("学校负责人只能通过工作台 API 查看本校", async ({ request }) => {
    const { accessToken } = await sessionFor("schoolLead");
    const response = await request.get("/api/admin/overview", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.admin).toMatchObject({ scope: "school", role: "学校负责人" });
    expect(body.schools.map((school: { id: string }) => school.id)).toContain(
      fixture.schools.a.id,
    );
    expect(body.schools.map((school: { id: string }) => school.id)).not.toContain(
      fixture.schools.b.id,
    );
    expect(body.recentRecords.map((record: { id: string }) => record.id)).toEqual(
      expect.arrayContaining([fixture.records.studentOne.id, fixture.records.studentTwo.id]),
    );
    expect(body.recentRecords.map((record: { id: string }) => record.id)).not.toContain(
      fixture.records.studentThree.id,
    );
  });

  test("老师工作台 API 也不会返回未分配学生", async ({ request }) => {
    const { accessToken } = await sessionFor("teacherOne");
    const response = await request.get("/api/admin/overview", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    const recordIds = body.recentRecords.map((record: { id: string }) => record.id);
    expect(recordIds).toContain(fixture.records.studentOne.id);
    expect(recordIds).not.toContain(fixture.records.studentTwo.id);
    expect(recordIds).not.toContain(fixture.records.studentThree.id);
  });

  test("平台管理员工作台可以查看两所虚拟学校", async ({ request }) => {
    const { accessToken } = await sessionFor("platformAdmin");
    const response = await request.get("/api/admin/overview", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.admin).toMatchObject({ scope: "platform", role: "平台管理员" });
    const schoolIds = body.schools.map((school: { id: string }) => school.id);
    expect(schoolIds).toEqual(expect.arrayContaining([fixture.schools.a.id, fixture.schools.b.id]));
  });

  test("只有平台管理员可以读取社区审核队列", async ({ request }) => {
    const [platformAdmin, schoolLead, teacher] = await Promise.all([
      sessionFor("platformAdmin"),
      sessionFor("schoolLead"),
      sessionFor("teacherOne"),
    ]);

    const platformResponse = await request.get("/api/admin/community-moderation", {
      headers: { Authorization: `Bearer ${platformAdmin.accessToken}` },
    });
    expect(platformResponse.status()).toBe(200);
    const payload = await platformResponse.json();
    expect(payload).toMatchObject({
      counts: {
        total: expect.any(Number),
        safetyReview: expect.any(Number),
        reports: expect.any(Number),
      },
      items: expect.any(Array),
    });

    for (const session of [schoolLead, teacher]) {
      const response = await request.get("/api/admin/community-moderation", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      expect(response.status()).toBe(403);
    }
  });
});
