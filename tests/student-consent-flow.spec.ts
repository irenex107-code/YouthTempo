import { createClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext } from "@playwright/test";
import fixture from "./fixtures/permission-boundary.json";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_NiIGAQ6Wf--HakVNwFnSmA_zqzSGHRv";
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

async function sessionFor(email: string) {
  if (!password) throw new Error("缺少 E2E_PERMISSION_TEST_PASSWORD");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) throw error || new Error(`无法登录 ${email}`);
  return { accessToken: data.session.access_token, userId: data.user.id };
}

function auth(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function consentStatus(request: APIRequestContext, accessToken: string) {
  const response = await request.get("/api/account/consent", { headers: auth(accessToken) });
  expect(response.status()).toBe(200);
  return response.json();
}

test("14–17 岁学生与已关联监护人完成双向确认并可撤回", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "API 权限流程无需按视口重复执行");
  test.skip(!password, "需要先初始化虚拟账号并配置 E2E_PERMISSION_TEST_PASSWORD");

  const [student, guardian] = await Promise.all([
    sessionFor(fixture.users.studentOne.email),
    sessionFor(fixture.users.guardianOne.email),
  ]);
  const initial = await consentStatus(request, student.accessToken);
  const initiallyActive = initial.consent?.status === "active";
  const directClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: auth(student.accessToken) },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const recordMarker = `[E2E-CONSENT] ${Date.now()}`;
  let createdRecordId = "";

  try {
    if (initial.consent?.status && initial.consent.status !== "not_started") {
      const withdraw = await request.delete("/api/account/consent", { headers: auth(student.accessToken) });
      expect(withdraw.status()).toBe(200);
    }

    const { error: blockedRecordError } = await directClient.from("sweet_records").insert({
      user_id: student.userId,
      school_id: null,
      records: [{ id: "consent-test", fields: [{ id: "marker", value: recordMarker }] }],
    });
    expect(blockedRecordError?.message).toContain("student_consent_required");

    const studentAssent = await request.post("/api/account/consent", {
      headers: auth(student.accessToken),
      data: { action: "student_assent", ageBand: "14_17" },
    });
    expect(studentAssent.status()).toBe(200);
    expect((await studentAssent.json()).consent.status).toBe("pending_guardian");

    const blockedPost = await request.post("/api/community/posts", {
      headers: auth(student.accessToken),
      data: { title: "", body: "", viewerRoles: [], commenterRoles: [] },
    });
    expect(blockedPost.status()).toBe(403);

    const guardianConsent = await request.post("/api/account/consent", {
      headers: auth(guardian.accessToken),
      data: { action: "guardian_consent", studentUserId: student.userId },
    });
    expect(guardianConsent.status()).toBe(200);
    const child = (await guardianConsent.json()).children.find((item: { studentUserId: string }) => item.studentUserId === student.userId);
    expect(child?.status).toBe("active");

    const passedConsentGate = await request.post("/api/community/posts", {
      headers: auth(student.accessToken),
      data: { title: "", body: "", viewerRoles: [], commenterRoles: [] },
    });
    expect(passedConsentGate.status()).toBe(400);

    const { error: directReadError } = await directClient.from("student_consents").select("student_user_id").limit(1);
    expect(directReadError).not.toBeNull();

    const { data: allowedRecord, error: allowedRecordError } = await directClient.from("sweet_records").insert({
      user_id: student.userId,
      school_id: null,
      records: [{ id: "consent-test", fields: [{ id: "marker", value: recordMarker }] }],
    }).select("id").single();
    expect(allowedRecordError).toBeNull();
    expect(allowedRecord?.id).toBeTruthy();
    createdRecordId = allowedRecord?.id || "";

    const withdraw = await request.delete("/api/account/consent", {
      headers: auth(guardian.accessToken),
      data: { studentUserId: student.userId },
    });
    expect(withdraw.status()).toBe(200);
    const withdrawnChild = (await withdraw.json()).children.find((item: { studentUserId: string }) => item.studentUserId === student.userId);
    expect(withdrawnChild?.status).toBe("withdrawn");

    const { error: blockedAfterWithdrawError } = await directClient.from("sweet_records").insert({
      user_id: student.userId,
      school_id: null,
      records: [{ id: "consent-test-after-withdraw", fields: [{ id: "marker", value: recordMarker }] }],
    });
    expect(blockedAfterWithdrawError?.message).toContain("student_consent_required");
  } finally {
    if (createdRecordId) await directClient.from("sweet_records").delete().eq("id", createdRecordId);
    if (initiallyActive) {
      await request.post("/api/account/consent", {
        headers: auth(student.accessToken),
        data: { action: "student_assent", ageBand: "14_17" },
      });
      await request.post("/api/account/consent", {
        headers: auth(guardian.accessToken),
        data: { action: "guardian_consent", studentUserId: student.userId },
      });
    }
  }
});
