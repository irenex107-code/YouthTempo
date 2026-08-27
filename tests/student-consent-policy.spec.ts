import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { STUDENT_CONSENT_POLICY_VERSION, isActiveStudentConsent } from "@/lib/studentConsent";

const assentedAt = "2026-08-28T00:00:00.000Z";

function consent(overrides: Partial<Parameters<typeof isActiveStudentConsent>[0]> = {}) {
  return {
    age_band: "14_17" as const,
    consent_basis: "student_self_pilot" as const,
    policy_version: STUDENT_CONSENT_POLICY_VERSION,
    status: "active" as const,
    student_assented_at: assentedAt,
    guardian_user_id: null,
    guardian_consented_at: null,
    ...overrides,
  };
}

test("当前学生自主试用本人确认可生效且不伪造监护人确认", () => {
  expect(STUDENT_CONSENT_POLICY_VERSION).toBe("2026-08-28");
  expect(isActiveStudentConsent(consent())).toBe(true);
  expect(consent()).toMatchObject({ guardian_user_id: null, guardian_consented_at: null });
});

test("过期、撤回、不适龄或不完整的监护人依据不能通过", () => {
  expect(isActiveStudentConsent(consent({ policy_version: "2026-08-03" }))).toBe(false);
  expect(isActiveStudentConsent(consent({ status: "withdrawn" }))).toBe(false);
  expect(isActiveStudentConsent(consent({ age_band: "under_14", consent_basis: "not_applicable" }))).toBe(false);
  expect(isActiveStudentConsent(consent({ consent_basis: "student_guardian", guardian_user_id: "guardian", guardian_consented_at: null }))).toBe(false);
  expect(isActiveStudentConsent(consent({ consent_basis: "student_guardian", guardian_user_id: null, guardian_consented_at: assentedAt }))).toBe(false);
  expect(isActiveStudentConsent(consent({ consent_basis: "student_guardian", guardian_user_id: "guardian", guardian_consented_at: assentedAt }))).toBe(true);
});

test("迁移和合并 schema 使用同一同意依据与当前版本", async () => {
  const [migration, schema] = await Promise.all([
    readFile(path.join(process.cwd(), "supabase/migrations/20260827174237_enable_student_self_pilot_consent.sql"), "utf8"),
    readFile(path.join(process.cwd(), "supabase/schema.sql"), "utf8"),
  ]);
  for (const sql of [migration, schema]) {
    expect(sql).toContain("student_self_pilot");
    expect(sql).toContain("consent.policy_version = '2026-08-28'");
    expect(sql).toContain("consent.guardian_user_id is not null");
    expect(sql).toContain("consent.guardian_consented_at is not null");
  }
});
