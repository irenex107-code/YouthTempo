import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED,
  canCreateGuardianRelationship,
  isAdultWithoutGuardianFlow,
  isEligibleGuardianRelationshipAge,
} from "@/lib/guardianAccessPolicy";

test("当前试点关闭家长关系，未来年龄边界仅保留给 14–17 岁", () => {
  expect(CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED).toBe(false);
  expect(canCreateGuardianRelationship("14_17")).toBe(false);
  expect(isEligibleGuardianRelationshipAge("14_17")).toBe(true);
  expect(isEligibleGuardianRelationshipAge("18_plus")).toBe(false);
  expect(isEligibleGuardianRelationshipAge("under_14")).toBe(false);
  expect(isAdultWithoutGuardianFlow("18_plus")).toBe(true);
});

test("新增关系与家长收件均由服务端策略阻断，解除旧关系路径仍保留", async () => {
  const [assignmentRoute, memberRoute, messageRoute] = await Promise.all([
    readFile(path.join(process.cwd(), "pages/api/admin/guardian-student-assignments.ts"), "utf8"),
    readFile(path.join(process.cwd(), "pages/api/admin/school-assignments.ts"), "utf8"),
    readFile(path.join(process.cwd(), "pages/api/messages.ts"), "utf8"),
  ]);

  expect(assignmentRoute).toContain("studentUserIds.length > 0 && !CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED");
  expect(assignmentRoute).toContain('update({ status: "revoked"');
  expect(memberRoute).toContain('assignmentRole === "家长" || guardianUserId || guardianEmail');
  expect(messageRoute).toContain('recipientType === "guardian" && !CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED');
  expect(messageRoute).toContain("isAdultWithoutGuardianFlow(activeConsent?.age_band)");
});

test("当前界面不展示家长新建或记录入口，但未来代码仍由同一开关保留", async () => {
  const [adminPage, accountPage, messagePage] = await Promise.all([
    readFile(path.join(process.cwd(), "views/admin/page.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "views/account/page.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "views/messages/page.tsx"), "utf8"),
  ]);

  expect(adminPage).toContain("CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED ? (");
  expect(adminPage).toContain("当前试点不创建家长关系");
  expect(accountPage).toContain('displayRole === "家长" && !CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED');
  expect(messagePage).toContain("showGuardianRecipient");
  expect(messagePage).toContain('value="guardian"');
});
