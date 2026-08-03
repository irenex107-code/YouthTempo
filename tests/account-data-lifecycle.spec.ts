import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_NiIGAQ6Wf--HakVNwFnSmA_zqzSGHRv";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

test("账号可导出自己的数据并在双重确认后永久注销", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "API 数据生命周期无需按视口重复执行");
  test.skip(!serviceRoleKey, "需要服务端密钥创建和清理临时 E2E 账号");

  const suffix = randomUUID();
  const email = `e2e-account-data-${suffix}@youthtempo.test`;
  const password = `${randomUUID()}Aa1!`;
  const marker = `[E2E-ACCOUNT-DATA] ${Date.now()}`;
  const admin = createClient(supabaseUrl, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const browserClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let userId = "";
  let subjectHash = "";

  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createError).toBeNull();
    userId = created.user?.id || "";
    expect(userId).not.toBe("");
    subjectHash = createHash("sha256").update(userId).digest("hex");

    const { error: profileError } = await admin.from("profiles").upsert({
      id: userId,
      email,
      display_name: "E2E 数据生命周期账号",
      role: "家长",
      school_id: null,
      updated_at: new Date().toISOString(),
    });
    expect(profileError).toBeNull();

    const { error: recordError } = await admin.from("sweet_records").insert({
      user_id: userId,
      school_id: null,
      records: [{ id: "account-data-test", fields: [{ id: "marker", value: marker }] }],
      summary: marker,
    });
    expect(recordError).toBeNull();

    const { data: sessionData, error: signInError } = await browserClient.auth.signInWithPassword({ email, password });
    expect(signInError).toBeNull();
    const accessToken = sessionData.session?.access_token || "";
    expect(accessToken).not.toBe("");
    const headers = { Authorization: `Bearer ${accessToken}` };

    const exported = await request.get("/api/account/data", { headers });
    expect(exported.status()).toBe(200);
    expect(exported.headers()["cache-control"]).toContain("no-store");
    expect(exported.headers()["content-disposition"]).toContain("YouthTempo-data-export-");
    const payload = await exported.json();
    expect(payload.account).toMatchObject({ id: userId, email });
    expect(payload.data.profile).toHaveLength(1);
    expect(payload.data.sweetRecords).toHaveLength(1);
    expect(payload.data.sweetRecords[0].summary).toBe(marker);
    expect(JSON.stringify(payload)).not.toContain(serviceRoleKey);

    const rejected = await request.delete("/api/account/data", {
      headers,
      data: { confirmationEmail: `wrong-${email}`, acknowledge: true },
    });
    expect(rejected.status()).toBe(400);
    const { data: stillExists } = await admin.auth.admin.getUserById(userId);
    expect(stillExists.user?.id).toBe(userId);

    const deleted = await request.delete("/api/account/data", {
      headers,
      data: { confirmationEmail: email, acknowledge: true },
    });
    expect(deleted.status()).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({ deleted: true });

    const { data: deletedUser } = await admin.auth.admin.getUserById(userId);
    expect(deletedUser.user).toBeNull();
    const { data: deletedProfile, error: profileLookupError } = await admin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    expect(profileLookupError).toBeNull();
    expect(deletedProfile).toBeNull();

    const { data: audit, error: auditLookupError } = await admin
      .from("account_deletion_audits")
      .select("subject_hash,email_hash,status,expires_at")
      .eq("subject_hash", subjectHash)
      .single();
    expect(auditLookupError).toBeNull();
    expect(audit?.status).toBe("completed");
    expect(audit?.email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit?.email_hash).not.toContain(email);
    expect(new Date(audit!.expires_at).getTime()).toBeGreaterThan(Date.now());
    userId = "";
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (subjectHash) await admin.from("account_deletion_audits").delete().eq("subject_hash", subjectHash);
  }
});
