import { expect, test } from "@playwright/test";
import type { AdminContext } from "../lib/adminAccess";
import {
  canAccessStudent,
  canManageSchool,
  canManageSchoolMembers,
} from "../lib/adminAccess";

function context(overrides: Partial<AdminContext>): AdminContext {
  return {
    supabase: {} as AdminContext["supabase"],
    user: { id: "user-1" } as AdminContext["user"],
    kind: "school",
    email: "test@example.com",
    roleLabel: "支持老师",
    platformAdminRole: null,
    managedSchoolIds: [],
    schoolRoles: {},
    assignedStudentIds: [],
    ...overrides,
  };
}

test("平台管理员可以管理任意学校并访问学生", () => {
  const platformAdmin = context({ kind: "platform", roleLabel: "平台管理员" });

  expect(canManageSchool(platformAdmin, "school-any")).toBe(true);
  expect(canManageSchoolMembers(platformAdmin, "school-any")).toBe(true);
  expect(canAccessStudent(platformAdmin, "school-any", "student-any")).toBe(true);
});

test("学校负责人只能管理本校，但可以访问本校学生", () => {
  const schoolLead = context({
    roleLabel: "学校负责人",
    managedSchoolIds: ["school-a"],
    schoolRoles: { "school-a": "school_admin" },
  });

  expect(canManageSchool(schoolLead, "school-a")).toBe(true);
  expect(canManageSchoolMembers(schoolLead, "school-a")).toBe(true);
  expect(canAccessStudent(schoolLead, "school-a", "student-a")).toBe(true);

  expect(canManageSchool(schoolLead, "school-b")).toBe(false);
  expect(canManageSchoolMembers(schoolLead, "school-b")).toBe(false);
  expect(canAccessStudent(schoolLead, "school-b", "student-b")).toBe(false);
});

test("支持老师只能访问本校分配给自己的学生", () => {
  const teacher = context({
    managedSchoolIds: ["school-a"],
    schoolRoles: { "school-a": "school_support" },
    assignedStudentIds: ["student-a"],
  });

  expect(canManageSchool(teacher, "school-a")).toBe(true);
  expect(canManageSchoolMembers(teacher, "school-a")).toBe(false);
  expect(canAccessStudent(teacher, "school-a", "student-a")).toBe(true);
  expect(canAccessStudent(teacher, "school-a", "student-b")).toBe(false);
  expect(canAccessStudent(teacher, "school-b", "student-a")).toBe(false);
});
