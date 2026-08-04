import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import fixture from "./fixtures/permission-boundary.json";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_NiIGAQ6Wf--HakVNwFnSmA_zqzSGHRv";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

type UserKey = "platformAdmin" | "schoolLead" | "teacherOne" | "guardianOne";

async function sessionFor(key: UserKey) {
  const client = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: fixture.users[key].email, password: password! });
  if (error || !data.session || !data.user) throw error || new Error(`无法登录 ${key}`);
  return { accessToken: data.session.access_token, userId: data.user.id, client };
}

const auth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

test("学生、家长和老师只管理自己的试点反馈，学校端不能读取汇总", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "API 权限与视口无关，无需重复执行");
  test.skip(!password || !serviceRoleKey, "需要正式权限测试账号和服务端密钥");

  const admin = createClient(supabaseUrl, serviceRoleKey!, { auth: { autoRefreshToken: false, persistSession: false } });
  const [platform, lead, teacher, guardian] = await Promise.all([
    sessionFor("platformAdmin"),
    sessionFor("schoolLead"),
    sessionFor("teacherOne"),
    sessionFor("guardianOne"),
  ]);
  const suffix = randomUUID();
  const studentEmail = `e2e-feedback-student-${suffix}@youthtempo.test`;
  const guardianEmail = `e2e-feedback-guardian-${suffix}@youthtempo.test`;
  const temporaryPassword = `${randomUUID()}Aa1!`;
  let studentUserId = "";
  let temporaryGuardianUserId = "";

  try {
    const [{ data: createdStudent, error: studentCreateError }, { data: createdGuardian, error: guardianCreateError }] = await Promise.all([
      admin.auth.admin.createUser({ email: studentEmail, password: temporaryPassword, email_confirm: true }),
      admin.auth.admin.createUser({ email: guardianEmail, password: temporaryPassword, email_confirm: true }),
    ]);
    expect(studentCreateError).toBeNull();
    expect(guardianCreateError).toBeNull();
    studentUserId = createdStudent.user?.id || "";
    temporaryGuardianUserId = createdGuardian.user?.id || "";
    expect(studentUserId).not.toBe("");
    expect(temporaryGuardianUserId).not.toBe("");

    const { error: profileError } = await admin.from("profiles").upsert([
      { id: studentUserId, email: studentEmail, display_name: "E2E 反馈学生", role: "学生", school_id: null, updated_at: new Date().toISOString() },
      { id: temporaryGuardianUserId, email: guardianEmail, display_name: "E2E 反馈监护人", role: "家长", school_id: null, updated_at: new Date().toISOString() },
    ]);
    expect(profileError).toBeNull();

    const { error: consentError } = await admin.from("student_consents").insert({
      student_user_id: studentUserId,
      school_id: null,
      age_band: "14_17",
      policy_version: "2026-08-03",
      status: "active",
      student_assented_at: new Date().toISOString(),
      guardian_user_id: temporaryGuardianUserId,
      guardian_consented_at: new Date().toISOString(),
    });
    expect(consentError).toBeNull();

    const studentClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: studentSession, error: studentSignInError } = await studentClient.auth.signInWithPassword({ email: studentEmail, password: temporaryPassword });
    expect(studentSignInError).toBeNull();
    expect(studentSession.session?.access_token).toBeTruthy();
    const student = { accessToken: studentSession.session!.access_token, userId: studentUserId, client: studentClient };

    const submissions = [
      [student, "student", "记录后的说明更容易看懂。"],
      [guardian, "guardian", "能看到孩子最近的变化。"],
      [teacher, "teacher", "每周摘要能帮助我先看重点。"],
    ] as const;

    const feedbackIds: string[] = [];
    for (const [session, expectedRole, mostHelpful] of submissions) {
      const response = await request.post("/api/pilot-feedback", {
        headers: auth(session.accessToken),
        data: { overallExperience: 4, clarity: 5, safety: 5, mostHelpful, hardToUse: "", suggestion: "", mayContact: false },
      });
      const responseText = await response.text();
      expect(response.status(), responseText).toBe(200);
      const body = JSON.parse(responseText);
      expect(body.notice).toContain("已经收到");
      expect(body.feedback.most_helpful).toBe(mostHelpful);
      feedbackIds.push(body.feedback.id);

      const own = await request.get("/api/pilot-feedback", { headers: auth(session.accessToken) });
      expect(own.status()).toBe(200);
      await expect(own.json()).resolves.toMatchObject({ feedback: { id: body.feedback.id }, role: expectedRole });
    }

    const leadList = await request.get("/api/admin/pilot-feedback", { headers: auth(lead.accessToken) });
    expect(leadList.status()).toBe(403);

    const platformList = await request.get("/api/admin/pilot-feedback", { headers: auth(platform.accessToken) });
    expect(platformList.status()).toBe(200);
    const platformBody = await platformList.json();
    const testFeedback = platformBody.feedback.filter((item: { id: string }) => feedbackIds.includes(item.id));
    expect(testFeedback).toHaveLength(3);
    for (const item of testFeedback) {
      expect(item).not.toHaveProperty("user_id");
      expect(item.contact_email).toBeNull();
    }

    const { data: browserRows, error: browserError } = await guardian.client.from("pilot_feedback").select("id");
    expect(browserRows || []).toHaveLength(0);
    expect(browserError).not.toBeNull();
  } finally {
    await admin.from("pilot_feedback").delete().in("user_id", [teacher.userId, guardian.userId]);
    if (studentUserId) await admin.auth.admin.deleteUser(studentUserId);
    if (temporaryGuardianUserId) await admin.auth.admin.deleteUser(temporaryGuardianUserId);
  }
});
