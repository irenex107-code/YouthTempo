import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { buildProfileWritePayload } from "@/lib/cloudRecords";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertResult<T>(result: { data: T; error: { message: string } | null }, label: string) {
  if (result.error) throw new Error(`${label}：${result.error.message}`);
  return result.data;
}

test("profile role 只能由可信服务端流程修改", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "数据库权限测试无需按视口重复执行");
  test.skip(!anonKey || !serviceRoleKey, "需要 Supabase anon key 和服务端密钥");
  test.setTimeout(60_000);

  const admin = createClient(supabaseUrl, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `e2e.profile-role.${suffix}@youthtempo.test`;
  const password = `Role-Security-${suffix}-Aa1!`;
  let userId = "";

  try {
    const createdUser = assertResult(
      await admin.auth.admin.createUser({ email, password, email_confirm: true }),
      "创建隔离角色测试账号",
    ).user;
    if (!createdUser) throw new Error("隔离角色测试账号创建失败");
    userId = createdUser.id;

    assertResult(
      await admin.from("profiles").upsert({
        id: userId,
        email,
        display_name: "角色安全测试用户",
        role: "学生",
        school_id: null,
        updated_at: new Date().toISOString(),
      }),
      "创建隔离 profile",
    );

    const userClient = createClient(supabaseUrl, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    assertResult(
      await userClient.auth.signInWithPassword({ email, password }),
      "登录隔离角色测试账号",
    );

    for (const forbiddenRole of ["家长", "专业支持者"]) {
      const { data, error } = await userClient
        .from("profiles")
        .update({ role: forbiddenRole })
        .eq("id", userId)
        .select("id,role");
      expect(error, `普通用户不应能把 role 改为${forbiddenRole}`).not.toBeNull();
      expect(data).toBeNull();
    }

    const updatedName = "角色安全测试用户（已更新）";
    const { data: updatedProfile, error: displayNameError } = await userClient
      .from("profiles")
      .update({ display_name: updatedName, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("id,display_name,role")
      .single();
    expect(displayNameError).toBeNull();
    expect(updatedProfile).toMatchObject({ id: userId, display_name: updatedName, role: "学生" });

    const { data: unchangedProfile, error: readError } = await userClient
      .from("profiles")
      .select("id,display_name,role")
      .eq("id", userId)
      .single();
    expect(readError).toBeNull();
    expect(unchangedProfile).toMatchObject({ id: userId, display_name: updatedName, role: "学生" });

    const { data: trustedUpdate, error: trustedUpdateError } = await admin
      .from("profiles")
      .update({ role: "家长", updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("id,role")
      .single();
    expect(trustedUpdateError).toBeNull();
    expect(trustedUpdate).toMatchObject({ id: userId, role: "家长" });

    const { data: existingGuardian, error: existingGuardianError } = await userClient
      .from("profiles")
      .upsert(buildProfileWritePayload(
        { id: userId, email },
        "已有家长资料（已更新）",
      ))
      .select("id,display_name,role")
      .single();
    expect(existingGuardianError).toBeNull();
    expect(existingGuardian).toMatchObject({
      id: userId,
      display_name: "已有家长资料（已更新）",
      role: "家长",
    });

    await userClient.auth.signOut();
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
});
