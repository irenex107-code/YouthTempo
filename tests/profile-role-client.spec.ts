import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildProfileWritePayload } from "@/lib/cloudRecords";
import { roleDisplayLabel } from "@/views/account/page";
import type { TranslationKey, TranslationValues } from "@/lib/i18n/dictionaries";

test("客户端保存 profile 时不提交 role", () => {
  const payload = buildProfileWritePayload(
    { id: "00000000-0000-0000-0000-000000000001", email: "student@example.com" },
    "小林",
    "2026-08-06T00:00:00.000Z",
  );

  expect(payload).toEqual({
    id: "00000000-0000-0000-0000-000000000001",
    email: "student@example.com",
    display_name: "小林",
    updated_at: "2026-08-06T00:00:00.000Z",
  });
  expect(payload).not.toHaveProperty("role");
});

test("Account 保留已有角色的只读显示映射", () => {
  const translate = (key: TranslationKey, _values?: TranslationValues) => key;

  expect(roleDisplayLabel("学生", translate)).toBe("account.roles.student");
  expect(roleDisplayLabel("家长", translate)).toBe("account.roles.guardian");
  expect(roleDisplayLabel("学校学生", translate)).toBe("account.roles.schoolStudent");
  expect(roleDisplayLabel("学校家长", translate)).toBe("account.roles.schoolGuardian");
  expect(roleDisplayLabel("支持老师", translate)).toBe("account.roles.supportTeacher");
  expect(roleDisplayLabel("学校负责人", translate)).toBe("account.roles.schoolLead");
  expect(roleDisplayLabel("平台管理员", translate)).toBe("account.roles.platformAdmin");
  expect(roleDisplayLabel("专业支持者", translate)).toBe("account.roles.professionalSupporter");
});

test("Account 不再提供客户端角色切换控件", async () => {
  const source = await readFile(path.join(process.cwd(), "views/account/page.tsx"), "utf8");

  expect(source).not.toContain("setRole(");
  expect(source).not.toContain("value={role}");
  expect(source).toContain("roleDisplayLabel(displayRole, t)");
  expect(source).toContain("roleDisplayLabel(confirmedRoleLabel, t)");
});
