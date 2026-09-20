import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const source = (name: string) => readFile(path.join(process.cwd(), name), "utf8");

test("历史 active 监护关系不再授予 SWEET Data API 读取", async () => {
  const [migration, schema] = await Promise.all([
    source("supabase/migrations/20260919134538_pilot_guardian_data_boundary.sql"),
    source("supabase/schema.sql"),
  ]);
  expect(migration).toContain('drop policy if exists "sweet_records_select_guardian"');
  expect(migration).toContain('create policy "guardian_links_select_student_own"');
  expect(migration).toContain('using (student_user_id = (select auth.uid()))');
  expect(migration).toContain("check (status <> 'active') not valid");
  expect(migration).toContain("viewer.role <> '家长'");
  expect(schema).not.toContain('create policy "sweet_records_select_guardian"');
  expect(schema).toContain("viewer.role <> '家长'");
});

test("服务端不给家长读取留言、代撤回或重新确认学生同意", async () => {
  const [messages, consent, accountData] = await Promise.all([
    source("pages/api/messages.ts"),
    source("pages/api/account/consent.ts"),
    source("pages/api/account/data.ts"),
  ]);
  expect(messages).toContain('accountProfile?.role === "家长"');
  expect(consent).toContain("当前试点未开放家长确认");
  expect(consent).toContain("当前试点只有学生本人可以撤回确认");
  expect(accountData).toContain('guardianLinks: profile[0]?.role === "家长" ? []');
  expect(accountData).toContain('messages: profile[0]?.role === "家长" ? []');
});

test("历史监护同意在家长注销前撤回并保留事件", async () => {
  const accountData = await source("pages/api/account/data.ts");
  expect(accountData).toContain('.eq("guardian_user_id", user.id)');
  expect(accountData).toContain('event_type: "consent_withdrawn"');
  expect(accountData).toContain('.update({ status: "revoked", revoked_at: withdrawnAt');
  expect(accountData.indexOf('event_type: "consent_withdrawn"')).toBeLessThan(accountData.indexOf('supabase.auth.admin.deleteUser'));
});

test("未登录不能访问家长政策相关私有接口", async ({ request }) => {
  const [messages, consent] = await Promise.all([
    request.get("/api/messages"),
    request.post("/api/account/consent", { data: { action: "guardian_consent", studentUserId: "fake" } }),
  ]);
  expect(messages.status()).toBe(401);
  expect(consent.status()).toBe(401);
});
