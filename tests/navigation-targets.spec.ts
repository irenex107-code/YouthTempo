import { expect, test } from "@playwright/test";
import { defaultAccountDestination, navigationTargetForRole, normalizeNavigationTarget } from "../lib/navigation";

test("任务返回只接受规范的站内目标，保留当前语言交给Next路由处理", () => {
  for (const [value, expected] of [
    ["garden", "/garden"], ["/garden", "/garden"], ["/en/community", "/community"],
    ["/zh-CN/feedback", "/feedback"], ["/community?topic=sleep#new-post", "/community?topic=sleep#new-post"],
    ["/", "/"], ["/en", "/"],
  ]) expect(normalizeNavigationTarget(value)).toBe(expected);
  for (const value of [
    undefined, null, ["/garden", "/admin"], "", "https://example.invalid", "//example.invalid", "/en//example.invalid",
    "\\\\example.invalid", "/\\example.invalid", "/%2f%2fexample.invalid", "/%5cexample.invalid",
    "/foo/../garden", "/./garden", "/garden\n", "/garden\u0000", "/garden next", "/garden#bad/path",
    "/community?next=https://example.invalid", "/feedback?redirect=//example.invalid", "/" + "x".repeat(512),
  ]) expect(normalizeNavigationTarget(value), JSON.stringify(value)).toBeNull();
});

test("学生原任务包括社区反馈与报告，不能返回管理或其他未知入口", () => {
  for (const role of ["学生", "支持老师", "家长", "专业支持者", "学校负责人", "平台管理员"]) {
    for (const target of ["/community", "/feedback", "/referral", "/resources"]) {
      expect(navigationTargetForRole(target, { role })).toBe(target);
    }
  }
  for (const target of ["/garden", "/mood-journal", "/check-in", "/worry-time", "/messages", "/support-request", "/reports"]) {
    expect(navigationTargetForRole(target, { role: "学生" })).toBe(target);
  }
  for (const target of ["/admin", "/admin/role-preview", "/api/account/status", "/account", "/unknown", "//example.invalid"]) {
    expect(navigationTargetForRole(target, { role: "学生" })).toBeNull();
  }
});

test("各角色和年龄只影响导航，不把未确认年龄当成成年资格", () => {
  for (const role of ["家长", "支持老师", "专业支持者", "学校负责人", "平台管理员", ""]) {
    expect(navigationTargetForRole("/garden", { role })).toBeNull();
  }
  for (const ageBand of [null, "under_14", "14_17"]) {
    for (const target of ["/peer-space", "/consultation", "/support/apply", "/support/workbench"]) {
      expect(navigationTargetForRole(target, { role: "学生", ageBand })).toBeNull();
    }
  }
  for (const target of ["/peer-space", "/consultation", "/support/apply", "/support/workbench"]) {
    expect(navigationTargetForRole(target, { role: "学生", ageBand: "18_plus" })).toBe(target);
  }
  expect(navigationTargetForRole("/messages", { role: "支持老师" })).toBe("/messages");
  expect(navigationTargetForRole("/messages", { role: "学校负责人" })).toBe("/messages");
  expect(navigationTargetForRole("/reports", { role: "家长" })).toBeNull();
  expect(navigationTargetForRole("/reports", { role: "学校负责人" })).toBeNull();
  for (const role of ["支持老师", "学校负责人", "平台管理员"]) {
    expect(navigationTargetForRole("/admin", { role })).toBe("/admin");
    expect(navigationTargetForRole("/admin/support", { role })).toBe(role === "平台管理员" ? "/admin/support" : null);
  }
  expect(navigationTargetForRole("/support/workbench", { role: "专业支持者" })).toBe("/support/workbench");
});

test("首次登录没有原任务时使用对应角色入口", () => {
  expect(defaultAccountDestination("学生")).toBe("/garden");
  expect(defaultAccountDestination("家长")).toBe("/for-parents");
  expect(defaultAccountDestination("支持老师")).toBe("/account#students");
  expect(defaultAccountDestination("学校负责人")).toBe("/admin");
  expect(defaultAccountDestination("平台管理员")).toBe("/admin");
  expect(defaultAccountDestination("专业支持者")).toBe("/support/apply");
  expect(defaultAccountDestination("unknown")).toBeNull();
});

test("受邀学校老师与按房间职责审核的人员保留原任务，不把岗位权限等同于账号角色", () => {
  for (const target of ["/support/apply", "/support/workbench"]) {
    expect(navigationTargetForRole(target, { role: "支持老师" })).toBe(target);
  }
  for (const role of ["学生", "支持老师", "专业支持者", "家长", "学校负责人", "平台管理员"]) {
    // The destination's API still decides whether this user has a current scoped staff assignment.
    expect(navigationTargetForRole("/admin/peer-space", { role })).toBe("/admin/peer-space");
    expect(navigationTargetForRole("/admin/support", { role })).toBe(role === "平台管理员" ? "/admin/support" : null);
  }
  expect(navigationTargetForRole("/admin/peer-space", { role: "" })).toBeNull();
  expect(navigationTargetForRole("/admin/peer-space?next=//example.invalid", { role: "支持老师" })).toBeNull();
});
