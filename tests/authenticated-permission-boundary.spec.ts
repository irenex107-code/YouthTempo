import { createClient, type Session } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import fixture from "./fixtures/permission-boundary.json";
import zh from "../locales/zh-CN.json";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const authStorageKey = `sb-${projectRef}-auth-token`;

type UserKey = keyof typeof fixture.users;

async function sessionFor(key: UserKey) {
  if (!password || !supabaseAnonKey) throw new Error("缺少隔离环境的测试密码或匿名密钥");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: fixture.users[key].email,
    password,
  });
  if (error || !data.session || !data.user) throw error || new Error(`无法登录 ${key}`);
  return { supabase, accessToken: data.session.access_token, userId: data.user.id };
}

function sortedRecordIds(rows: Array<{ id: string }> | null) {
  return (rows || []).map((row) => row.id).sort();
}

function expectPrivateRecordsRestricted(body: Record<string, unknown>) {
  expect(body.privateRecordsRestricted).toBe(true);
  expect(body.counts).toMatchObject({ sweetRecords: null });
  for (const key of ["recentRecords", "attentionQueue", "teacherWeeklySummaries", "schoolMonthlyTrends", "studentParticipationStats"]) {
    expect(body[key], key).toEqual([]);
  }
  for (const record of Object.values(fixture.records)) expect(JSON.stringify(body)).not.toContain(record.summary);
}

test.describe("真实账号与 RLS 权限隔离", () => {
  test.skip(!password, "需要先初始化虚拟账号并配置 E2E_PERMISSION_TEST_PASSWORD");

  test("学生只能读取本人的 SWEET，不能读取同校或外校学生记录", async () => {
    for (const key of ["studentOne", "studentTwo", "studentThree"] as const) {
      const { supabase } = await sessionFor(key);
      const { data, error } = await supabase.from("sweet_records").select("id,user_id,records,summary")
        .in("id", Object.values(fixture.records).map((record) => record.id));
      expect(error).toBeNull();
      expect(sortedRecordIds(data)).toEqual([fixture.records[key].id]);
    }
  });

  test("家长、负责老师、学校负责人、专业人员和平台管理员均不能直读学生私人 SWEET", async () => {
    for (const key of ["guardianOne", "guardianTwo", "teacherOne", "teacherTwo", "schoolLead", "professional", "platformAdmin"] as const) {
      const { supabase } = await sessionFor(key);
      const { data, error } = await supabase.from("sweet_records").select("id,user_id,records,summary")
        .in("id", Object.values(fixture.records).map((record) => record.id));
      expect(error, key).toBeNull();
      expect(sortedRecordIds(data), key).toEqual([]);
    }
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
    expectPrivateRecordsRestricted(body);
    expect(body.schoolDirectories).toHaveLength(1);
    const directory = body.schoolDirectories[0];
    expect(directory.school_id).toBe(fixture.schools.a.id);
    expect(directory.students.map((person: { display_name: string }) => person.display_name).sort()).toEqual(
      [fixture.users.studentOne.displayName, fixture.users.studentTwo.displayName].sort(),
    );
    expect(directory.students.map((person: { display_name: string }) => person.display_name)).not.toContain(fixture.users.studentThree.displayName);
    expect(directory.guardianAssignments).toEqual([]);
  });

  test("老师工作台只返回当前学校运营范围，负责学生名单仍由本人关系接口提供", async ({ request }) => {
    const { accessToken } = await sessionFor("teacherOne");
    const response = await request.get("/api/admin/overview", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.admin).toMatchObject({ scope: "school", role: "支持老师", canManageMembers: false });
    expect(body.schools.map((school: { id: string }) => school.id)).toEqual([fixture.schools.a.id]);
    expect(body.schoolDirectories).toEqual([]);
    expectPrivateRecordsRestricted(body);
    const account = await request.get("/api/account/status", { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(account.status()).toBe(200);
    const status = await account.json();
    expect(status.assignedStudents.map((person: { display_name: string }) => person.display_name)).toEqual([fixture.users.studentOne.displayName]);
    expect(status.assignedStudents[0].school_id).toBe(fixture.schools.a.id);
    expect(status.assignedStudents.map((person: { display_name: string }) => person.display_name)).not.toContain(fixture.users.studentTwo.displayName);
    expect(status.assignedStudents.map((person: { display_name: string }) => person.display_name)).not.toContain(fixture.users.studentThree.displayName);
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
    expectPrivateRecordsRestricted(body);
    expect(body.schoolDirectories.map((directory: { school_id: string }) => directory.school_id)).toEqual(
      expect.arrayContaining([fixture.schools.a.id, fixture.schools.b.id]),
    );
  });

  test("家长旧关系只作撤销历史，不开放孩子资料或留言", async ({ request }) => {
    const { accessToken } = await sessionFor("guardianOne");
    const account = await request.get("/api/account/status", { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(account.status()).toBe(200);
    await expect(account.json()).resolves.toMatchObject({ displayRole: "家长", linkedChildren: [] });
    const messages = await request.get("/api/messages", { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(messages.status()).toBe(403);
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

  test("平台管理台显示社区审核入口和待查看列表", async ({ page }) => {
    const { supabase } = await sessionFor("platformAdmin");
    const { data } = await supabase.auth.getSession();
    expect(data.session).not.toBeNull();
    await page.addInitScript(
      ({ key, value }: { key: string; value: Session }) => {
        window.localStorage.setItem(key, JSON.stringify(value));
      },
      { key: authStorageKey, value: data.session! },
    );

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /社区审核/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#private-records-boundary").getByRole("heading", { name: zh.adminPrivateRecords.title, exact: true })).toBeVisible();
    await expect(page.locator("#member-management")).toBeAttached();
    await expect(page.getByRole("heading", { name: "学校近 4 周总体趋势" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "老师每周阶段摘要" })).toHaveCount(0);
    for (const record of Object.values(fixture.records)) await expect(page.locator("main")).not.toContainText(record.summary);
    await expect(page.getByRole("heading", { name: "需要平台查看的内容" })).toBeVisible();
  });
});
