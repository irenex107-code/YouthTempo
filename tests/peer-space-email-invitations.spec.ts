import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import {
  claimAdultPeerSpaceInvitation,
  normalizeInvitationEmail,
} from "@/lib/peerSpaceInvitations";

test("邮箱预邀只接受规范登录邮箱", () => {
  expect(normalizeInvitationEmail("  Student@Example.edu  ")).toBe("student@example.edu");
  expect(normalizeInvitationEmail("not-an-email")).toBeNull();
  expect(normalizeInvitationEmail("student @example.edu")).toBeNull();
});

test("未确认邮箱不会触发认领；已确认邮箱只以 Auth 用户身份认领", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const supabase = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: "membership-id", error: null };
    },
  } as unknown as SupabaseClient;
  const user = {
    id: "00000000-0000-4000-8000-000000000101",
    email: "Student@Example.edu",
    email_confirmed_at: null,
  } as User;

  expect(await claimAdultPeerSpaceInvitation(supabase, user)).toBeNull();
  expect(calls).toHaveLength(0);

  user.email_confirmed_at = "2026-09-20T10:00:00.000Z";
  expect(await claimAdultPeerSpaceInvitation(supabase, user)).toBe("membership-id");
  expect(calls).toEqual([{
    name: "claim_peer_space_email_invitation",
    args: { p_user_id: user.id, p_email: "student@example.edu" },
  }]);
});

test("未登录无法列出、创建、更正或撤销邀请", async ({ request }) => {
  for (const [method, data] of [
    ["GET", undefined],
    ["POST", { action: "invite", email: "test@example.edu" }],
    ["PATCH", { action: "revoke", invitationId: "00000000-0000-4000-8000-000000000101" }],
  ] as const) {
    const response = await request.fetch("/api/admin/peer-space/invitations", { method, data });
    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain("test@example.edu");
  }
});

test("新迁移与合并 schema 一致，浏览器角色没有邀请表权限", async () => {
  const migration = await readFile(path.join(process.cwd(), "supabase/migrations/20260920122447_peer_space_email_invitations.sql"), "utf8");
  const schema = await readFile(path.join(process.cwd(), "supabase/schema.sql"), "utf8");
  expect(schema.endsWith(migration)).toBe(true);
  expect(migration).toContain("alter table public.peer_space_email_invitations enable row level security");
  expect(migration).toContain("revoke all on table public.peer_space_email_invitations from public, anon, authenticated, service_role");
  expect(migration).toContain("grant execute on function public.claim_peer_space_email_invitation(uuid, text)");
  expect(migration).toContain("grant execute on function public.revoke_peer_space_email_invitation(uuid, uuid, text)");
  expect(migration).not.toMatch(/grant\s+(?:select|insert|update|delete)\s+on\s+table\s+public\.peer_space_email_invitations\s+to\s+authenticated/i);
});

test("管理员邀请页加载，不在未授权页面显示邀请名单", async ({ page }) => {
  await page.goto("/admin/peer-space-invites");
  await expect(page.getByRole("heading", { name: "成年人解忧室邀请" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "邀请记录" })).toHaveCount(0);
});
