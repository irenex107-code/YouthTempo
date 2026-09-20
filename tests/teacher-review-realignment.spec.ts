import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { classifyPeerSpaceMessage, classifyPeerSpaceMessageWithAi } from "@/lib/peerSpaceSafety";
import { parseStaffApplication, isPublicConsultationEnabled } from "@/lib/supportWorkflow";

const source = (file: string) => readFile(path.join(process.cwd(), file), "utf8");

test("成年聊天室的普通压力、隐私和危机分别走不同安全路径", async () => {
  const ordinary = classifyPeerSpaceMessage("最近考试有点累，想聊聊。", "zh-CN");
  expect(ordinary).toMatchObject({ status: "visible", priority: "standard", urgent: false });
  expect(classifyPeerSpaceMessage("请加我微信 abc123 私聊", "zh-CN"))
    .toMatchObject({ status: "safety_review", category: "privacy", urgent: false });
  expect(classifyPeerSpaceMessage("I want to kill myself tonight", "en"))
    .toMatchObject({ status: "safety_review", category: "crisis", urgent: true });
  expect(await classifyPeerSpaceMessageWithAi("I want to kill myself tonight", "en"))
    .toMatchObject({ status: "safety_review", category: "crisis", source: "deterministic" });
});

test("学校值班老师不能自助申请，倾听志愿者与咨询师资质门槛分开", () => {
  const base = {
    legalName: "测试人员", serviceLanguages: ["zh-CN"], ageScopes: ["14_17"],
    serviceScope: "倾听与转介", availability: "每周一", boundariesConfirmed: true,
    crisisRulesConfirmed: true, privacyRulesConfirmed: true,
  };
  expect(() => parseStaffApplication({ ...base, category: "school_duty_teacher" })).toThrow();
  expect(parseStaffApplication({ ...base, category: "listening_volunteer" }))
    .toMatchObject({ category: "listening_volunteer", credential_type: null });
  expect(() => parseStaffApplication({ ...base, category: "counselor" })).toThrow();
  expect(() => parseStaffApplication({ ...base, category: "listening_volunteer", privacyRulesConfirmed: false })).toThrow();
});

test("正式咨询和审核反馈默认保持受限", async ({ request }) => {
  expect(isPublicConsultationEnabled()).toBe(false);
  for (const endpoint of ["/api/support/cases", "/api/support/staff-cases", "/api/admin/support/cases", "/api/admin/support/staff", "/api/admin/pilot-experience", "/api/pilot-experience?feature=sweet"]) {
    expect((await request.get(endpoint)).status(), endpoint).toBe(401);
  }
  expect((await request.post("/api/support/cases", { data: { type: "adult_consultation", needSummary: "test" } })).status()).toBe(401);
});

test("服务端从有效同意确定年龄，支持和聊天室新表保持私有", async () => {
  const [support, chat, feedback] = await Promise.all([
    source("supabase/migrations/20260919142117_add_dark_launched_support_continuity.sql"),
    source("supabase/migrations/20260919140205_add_adult_peer_space_moderated_chat.sql"),
    source("supabase/migrations/20260919141714_add_micro_pilot_experience_feedback.sql"),
  ]);
  expect(support).toContain("alter table public.support_cases enable row level security");
  expect(support).toContain("'support-staff-evidence', false");
  expect(chat).toContain("alter table public.peer_space_messages enable row level security");
  expect(chat).not.toContain("alter publication supabase_realtime add table public.peer_space_messages");
  expect(feedback).toContain("interval '7 days'");
  expect(feedback).toContain("alter table public.pilot_experience_feedback enable row level security");
  const api = await source("pages/api/support/cases.ts");
  expect(api).toContain("requireSupportStudent(supabase, user.id)");
  expect(api).toContain('type === "youth_request" && student.ageBand !== "14_17"');
});

test("正式咨询关闭页在双语桌面与移动端可读", async ({ page, isMobile }) => {
  await page.goto("/consultation");
  await expect(page.getByRole("heading", { name: "服务正在准备中，暂未正式开放" })).toBeVisible();
  await expect(page.getByRole("button", { name: /提交|预约/ })).toHaveCount(0);
  await page.goto("/en/consultation");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (isMobile) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});
