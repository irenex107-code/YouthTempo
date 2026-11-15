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
  expect(schema).not.toContain('create policy "sweet_records_select_school_members"');
  expect(schema).not.toContain('create policy "sweet_records_select_authorized_grantee"');
  expect(schema).toContain('create policy "sweet_records_select_own"');
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

test("历史监护同意由Auth外键事务撤回，API不再提前分请求撤回或退出", async () => {
  const [accountData, migration] = await Promise.all([
    source("pages/api/account/data.ts"),
    source("supabase/migrations/20261028203506_withdraw_guardian_consent_with_auth_delete.sql"),
  ]);
  expect(accountData).not.toContain('status: "withdrawn", withdrawn_at:');
  expect(accountData).not.toContain("supabase.auth.admin.signOut");
  expect(accountData).toContain("supabase.auth.admin.deleteUser(user.id, false)");
  expect(migration).toContain("before update of guardian_user_id on public.student_consents");
  expect(migration).toContain("new.status := 'withdrawn'");
  expect(migration).toContain("'consent_withdrawn', old.age_band, old.consent_basis");
  expect(migration).toContain("student_consent_events_actor_context_check");
});

test("未登录不能访问家长政策相关私有接口", async ({ request }) => {
  const [messages, consent] = await Promise.all([
    request.get("/api/messages"),
    request.post("/api/account/consent", { data: { action: "guardian_consent", studentUserId: "fake" } }),
  ]);
  expect(messages.status()).toBe(401);
  expect(consent.status()).toBe(401);
});
