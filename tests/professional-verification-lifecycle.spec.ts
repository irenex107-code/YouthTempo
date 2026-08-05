import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertResult<T>(result: { data: T; error: { message: string } | null }, label: string) {
  if (result.error) throw new Error(`${label}：${result.error.message}`);
  return result.data;
}

test("隔离账号完成专业身份提交、补充、通过和撤销闭环", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "数据库闭环无需按视口重复执行");
  test.skip(!serviceRoleKey, "需要正式 Supabase 服务端密钥");
  test.setTimeout(90_000);

  const admin = createClient(supabaseUrl, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let applicantId = "";
  let reviewerId = "";

  try {
    const applicant = assertResult(
      await admin.auth.admin.createUser({
        email: `e2e.professional.applicant.${suffix}@youthtempo.test`,
        email_confirm: true,
      }),
      "创建隔离申请账号",
    ).user;
    const reviewer = assertResult(
      await admin.auth.admin.createUser({
        email: `e2e.professional.reviewer.${suffix}@youthtempo.test`,
        email_confirm: true,
      }),
      "创建隔离审核账号",
    ).user;
    if (!applicant || !reviewer) throw new Error("隔离账号创建失败");
    applicantId = applicant.id;
    reviewerId = reviewer.id;

    assertResult(
      await admin.from("profiles").upsert({
        id: applicantId,
        email: applicant.email,
        display_name: "E2E 专业申请人",
        role: "学生",
        school_id: null,
        updated_at: new Date().toISOString(),
      }),
      "创建隔离账号资料",
    );

    const submission = {
      p_user_id: applicantId,
      p_institution_name: "E2E 青少年支持中心",
      p_position_title: "心理咨询师",
      p_credential_type: "E2E 专业能力证书",
      p_credential_number: `E2E-${suffix}`,
      p_credential_issuer: "E2E 专业登记机构",
      p_credential_expires_on: null,
      p_evidence_reference: `E2E 隔离核验材料 ${suffix}`,
      p_applicant_statement: "仅用于正式数据库权限闭环验收。",
    };

    const submitted = assertResult(
      await admin.rpc("submit_professional_verification", submission),
      "提交专业资料",
    );
    expect(submitted).toMatchObject([{ status: "pending" }]);

    const requested = assertResult(
      await admin.rpc("review_professional_verification", {
        p_user_id: applicantId,
        p_action: "request_changes",
        p_note: "请补充机构公开核验页面。",
        p_actor_user_id: reviewerId,
      }),
      "要求补充资料",
    );
    expect(requested).toMatchObject([{ status: "needs_more_info" }]);

    const resubmitted = assertResult(
      await admin.rpc("submit_professional_verification", {
        ...submission,
        p_evidence_reference: `E2E 补充后的隔离核验材料 ${suffix}`,
      }),
      "重新提交专业资料",
    );
    expect(resubmitted).toMatchObject([{ status: "pending" }]);

    const approved = assertResult(
      await admin.rpc("review_professional_verification", {
        p_user_id: applicantId,
        p_action: "approve",
        p_note: "隔离材料核验通过。",
        p_actor_user_id: reviewerId,
      }),
      "通过专业身份",
    );
    expect(approved).toMatchObject([{ status: "active" }]);

    const { data: activeProfile, error: activeProfileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", applicantId)
      .single();
    if (activeProfileError) throw activeProfileError;
    expect(activeProfile.role).toBe("专业支持者");

    const revoked = assertResult(
      await admin.rpc("review_professional_verification", {
        p_user_id: applicantId,
        p_action: "revoke",
        p_note: "E2E 闭环完成后撤销隔离身份。",
        p_actor_user_id: reviewerId,
      }),
      "撤销专业身份",
    );
    expect(revoked).toMatchObject([{ status: "revoked" }]);

    const [{ data: finalProfile, error: finalProfileError }, { data: events, error: eventError }] = await Promise.all([
      admin.from("profiles").select("role").eq("id", applicantId).single(),
      admin
        .from("professional_verification_events")
        .select("action,new_status")
        .eq("user_id", applicantId)
        .order("created_at", { ascending: true }),
    ]);
    if (finalProfileError) throw finalProfileError;
    if (eventError) throw eventError;
    expect(finalProfile.role).toBe("学生");
    expect(events).toEqual([
      { action: "submitted", new_status: "pending" },
      { action: "changes_requested", new_status: "needs_more_info" },
      { action: "resubmitted", new_status: "pending" },
      { action: "approved", new_status: "active" },
      { action: "revoked", new_status: "revoked" },
    ]);
  } finally {
    if (applicantId) await admin.auth.admin.deleteUser(applicantId).catch(() => undefined);
    if (reviewerId) await admin.auth.admin.deleteUser(reviewerId).catch(() => undefined);
  }
});
