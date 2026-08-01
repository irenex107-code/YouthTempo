import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import fixture from "./fixtures/permission-boundary.json";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_NiIGAQ6Wf--HakVNwFnSmA_zqzSGHRv";
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const authStorageKey = `sb-${projectRef}-auth-token`;

async function studentSession() {
  if (!password) throw new Error("缺少 E2E_PERMISSION_TEST_PASSWORD");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: fixture.users.studentOne.email,
    password,
  });
  if (error || !data.session || !data.user) {
    throw error || new Error("无法登录 SWEET 生命周期虚拟学生");
  }
  return { supabase, session: data.session, userId: data.user.id };
}

async function findRecordByMarker(supabase: SupabaseClient, userId: string, marker: string) {
  const { data, error } = await supabase
    .from("sweet_records")
    .select("id,user_id,records,summary,small_step,recommended_next_tool,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data || []).find((record) => JSON.stringify(record.records).includes(marker)) || null;
}

async function cleanupMarker(supabase: SupabaseClient, userId: string, marker: string) {
  const record = await findRecordByMarker(supabase, userId, marker);
  if (!record) return;
  const { error } = await supabase.from("sweet_records").delete().eq("id", record.id);
  if (error) throw error;
}

test("学生可以生成 AI 小结、保存、重新读取并删除 SWEET 记录", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "完整数据流程与视口无关，无需重复执行");
  test.skip(!password, "需要先初始化虚拟账号并配置 E2E_PERMISSION_TEST_PASSWORD");
  test.setTimeout(120_000);

  const { supabase, session, userId } = await studentSession();
  const marker = `[E2E-LIFECYCLE] ${Date.now()}`;

  await page.addInitScript(
    ({ key, value }: { key: string; value: Session }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: authStorageKey, value: session },
  );

  try {
    await page.goto("/check-in", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "比较安稳", exact: true }).click();
    await page.getByRole("button", { name: /想补充更多/ }).click();
    await page.getByPlaceholder("例如：昨晚很晚才睡，睡前一直在想明天的事情。").fill(marker);
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await page.getByRole("button", { name: "平静", exact: true }).click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await page.getByRole("button", { name: "基本规律", exact: true }).click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await page.getByRole("button", { name: "5-10 分钟", exact: true }).click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await page.getByRole("button", { name: "能完成基本任务", exact: true }).click();
    await page.getByRole("button", { name: "生成小结并保存", exact: true }).click();

    await expect(page.getByRole("heading", { name: "今日 SWEET 节律小结" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("已保存，可以在“账号”中查看。", { exact: true })).toBeVisible();

    const savedRecord = await findRecordByMarker(supabase, userId, marker);
    expect(savedRecord).not.toBeNull();
    expect(savedRecord?.summary?.trim()).toBeTruthy();
    expect(savedRecord?.small_step?.trim()).toBeTruthy();
    expect(savedRecord?.recommended_next_tool?.trim()).toBeTruthy();

    await page.goto("/account", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(savedRecord!.summary, { exact: true })).toBeVisible({ timeout: 20_000 });

    const recordCard = page.locator("article").filter({ hasText: savedRecord!.summary }).first();
    await expect(recordCard).toBeVisible();
    await recordCard.getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.getByText("记录已删除。", { exact: true })).toBeVisible();

    expect(await findRecordByMarker(supabase, userId, marker)).toBeNull();
  } finally {
    await cleanupMarker(supabase, userId, marker);
  }
});
