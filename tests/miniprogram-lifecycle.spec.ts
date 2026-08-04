import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test("小程序成年虚拟用户可独立确认并保存、读取、删除本人记录", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "数据流程与视口无关，无需重复执行");
  test.skip(!serviceRoleKey || !password || !supabaseAnonKey, "需要正式隔离测试配置");
  test.setTimeout(90_000);

  const admin = createClient(supabaseUrl, serviceRoleKey!, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `e2e-mini-adult-${randomUUID()}@youthtempo.test`;
  const temporaryPassword = `${randomUUID()}Aa1!`;
  let userId = "";

  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true });
    expect(createError).toBeNull();
    userId = created.user?.id || "";
    expect(userId).not.toBe("");

    const client = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password: temporaryPassword });
    expect(signInError).toBeNull();
    const token = signedIn.session?.access_token || "";
    expect(token).not.toBe("");

    const profileResponse = await request.post("/api/mini/profile", {
      headers: auth(token),
      data: { displayName: "小程序成年测试用户", ageBand: "18_plus" },
    });
    const profileText = await profileResponse.text();
    expect(profileResponse.status(), profileText).toBe(200);
    expect(JSON.parse(profileText)).toMatchObject({
      ready: true,
      profile: { id: userId, role: "学生", school_id: null },
      consent: { age_band: "18_plus", status: "active" },
    });

    const records = ["sleep", "wake", "eat", "exercise", "task"].map((id) => ({
      id,
      title: id,
      label: id,
      fields: [{ id: "state", title: "测试状态", value: "E2E 小程序记录" }],
    }));
    const saveResponse = await request.post("/api/mini/records", {
      headers: auth(token),
      data: { records, summary: "今天先照顾好自己的节奏。", smallStep: "先喝几口水。", recommendedNextTool: "今天先到这里。" },
    });
    const saveText = await saveResponse.text();
    expect(saveResponse.status(), saveText).toBe(201);
    const saved = JSON.parse(saveText);
    expect(saved.record.id).toBeTruthy();

    const listResponse = await request.get("/api/mini/records", { headers: auth(token) });
    expect(listResponse.status()).toBe(200);
    const list = await listResponse.json();
    expect(list.records.some((record: { id: string }) => record.id === saved.record.id)).toBe(true);

    const deleteResponse = await request.delete("/api/mini/records", { headers: auth(token), data: { recordId: saved.record.id } });
    expect(deleteResponse.status()).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({ deleted: true });

    const { data: remaining, error: remainingError } = await admin.from("sweet_records").select("id").eq("id", saved.record.id).maybeSingle();
    expect(remainingError).toBeNull();
    expect(remaining).toBeNull();
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});
