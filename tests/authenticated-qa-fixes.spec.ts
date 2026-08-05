import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type Session } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";
import fixture from "./fixtures/permission-boundary.json";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

test("Account 为历史 SWEET 记录提供稳定的渲染 key fallback", async () => {
  const source = await readFile(path.join(process.cwd(), "views/account/page.tsx"), "utf8");

  expect(source).toContain('step.id || `${record.id}-step-${stepIndex}`');
  expect(source).toContain('field.id || `${stepKey}-field-${fieldIndex}`');
});

test("Account 英文数量文案区分单复数且中文显示保持不变", () => {
  expect(en.account.summary.recordCountOne).toBe("{{count}} record");
  expect(en.account.summary.recordCount).toBe("{{count}} records");
  expect(en.account.summary.daysRecordedOne).toBe("Records on {{count}} day");
  expect(en.account.summary.daysRecorded).toBe("Records on {{count}} days");
  expect(zhCN.account.summary.recordCountOne).toBe(zhCN.account.summary.recordCount);
  expect(zhCN.account.summary.daysRecordedOne).toBe(zhCN.account.summary.daysRecorded);
});

test("Account 英文隐私链接保留可访问文本间距", async () => {
  const source = await readFile(path.join(process.cwd(), "views/account/page.tsx"), "utf8");
  expect(source.match(/locale === "en" \? " " : null/g)).toHaveLength(2);
});

test("SWEET 卡片保留固定术语并避免英文辅助文本重复", () => {
  for (const item of Object.values(en.common.hero.rhythm).filter(
    (value): value is { title: string; label: string } => typeof value === "object",
  )) {
    expect(item.label).not.toBe(item.title);
  }

  expect(en.common.hero.rhythm.sleep.title).toBe("Sleep");
  expect(en.common.hero.rhythm.wake.title).toBe("Wake");
  expect(en.common.hero.rhythm.eat.title).toBe("Eat");
  expect(en.common.hero.rhythm.exercise.title).toBe("Exercise");
  expect(en.common.hero.rhythm.task.title).toBe("Task engagement");
  expect(zhCN.common.hero.rhythm.sleep).toEqual({ title: "睡眠", label: "Sleep" });
});

test("Account 加载缺少 step/field id 的历史记录时不再产生 key warning", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "登录态控制台回归无需重复视口执行");
  test.skip(!supabaseUrl || !supabaseAnonKey || !password, "需要隔离测试账号配置");
  test.setTimeout(60_000);

  const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: fixture.users.studentOne.email,
    password: password!,
  });
  expect(error).toBeNull();
  expect(data.session).not.toBeNull();

  const projectRef = new URL(supabaseUrl!).hostname.split(".")[0];
  await page.addInitScript(
    ({ key, value }: { key: string; value: Session }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: `sb-${projectRef}-auth-token`, value: data.session! },
  );

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/en/account", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("1 record", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main")).toContainText("under Privacy & Safety");
  expect(consoleErrors).not.toEqual(expect.arrayContaining([
    expect.stringContaining('unique "key" prop'),
  ]));
});
