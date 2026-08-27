import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { buildPilotDutyAlertText } from "@/lib/pilotDutyAlerts";
import zh from "@/locales/zh-CN.json";
import en from "@/locales/en.json";

test("值班提醒邮件只包含事件元数据和安全后台链接", () => {
  const alert = buildPilotDutyAlertText({
    messageId: "11111111-1111-1111-1111-111111111111",
    createdAt: "2026-08-28T10:00:00.000Z",
    kind: "safety_review",
  }, "https://youthtempo.com/admin#message-duty");

  expect(alert).toContain("高风险内容待复核");
  expect(alert).toContain("11111111-1111-1111-1111-111111111111");
  expect(alert).toContain("https://youthtempo.com/admin#message-duty");
  expect(alert).toContain("不包含学生姓名、邮箱或留言正文");
  expect(alert).not.toContain("我现在想伤害自己");
  expect(alert).not.toContain("student@example.com");
});

test("无学校的安全留言和学生主动求助会进入同一值班队列", async () => {
  const source = await readFile(path.join(process.cwd(), "pages/api/messages.ts"), "utf8");
  expect(source).toContain('recipientType === "pilot_duty"');
  expect(source).toContain('result.status === "safety_review" && schoolId === null');
  expect(source).toContain('duty_status: needsPilotDuty ? "new" : "not_applicable"');
  expect(source).toContain("sendPilotDutyAlert({");
});

test("值班迁移保持服务端专用访问、RLS 与原子处理审计", async () => {
  const migration = await readFile(
    path.join(process.cwd(), "supabase/migrations/20260827194128_add_pilot_duty_message_queue.sql"),
    "utf8",
  );
  expect(migration).toContain("alter table public.student_message_duty_actions enable row level security");
  expect(migration).toContain("revoke all privileges on table public.student_message_duty_actions from anon, authenticated");
  expect(migration).toContain("security invoker");
  expect(migration).toContain("apply_student_message_duty_action");
  expect(migration).toContain("grant execute on function public.apply_student_message_duty_action");
  expect(migration).not.toMatch(/grant\s+(?:select|insert|update|delete|all).*student_message_duty_actions.*authenticated/i);
});

test("中英文均明确值班不是实时服务且邮件不含正文", () => {
  expect(zh.messages.compose.dutyDisclosureEmail).toContain("不含正文和身份信息");
  expect(zh.messages.compose.dutyDisclosureEmail).toContain("不会实时在线");
  expect(zh.messages.notices.safetyDutyAlerted).toContain("不要等待回复");
  expect(en.messages.compose.dutyDisclosureEmail).toContain("no message text or identity details");
  expect(en.messages.compose.dutyDisclosureEmail).toContain("not continuously online");
  expect(en.messages.notices.safetyDutyAlerted).toContain("do not wait for a reply");
  expect(en.messages.notices.safetyDutyAlerted).toContain("local emergency services");
});
