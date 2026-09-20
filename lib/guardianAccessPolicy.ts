import type { StudentAgeBand } from "@/lib/studentConsent";

/**
 * The current student-only pilot does not create guardian accounts or links.
 * Keep the future minor workflow behind one explicit product-policy switch.
 */
export const CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED = false;

export const CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_MESSAGE =
  "当前学生自主试点尚未开放家长加入或亲子关系创建。";

export function isEligibleGuardianRelationshipAge(ageBand: StudentAgeBand | null | undefined) {
  return ageBand === "14_17";
}

export function canCreateGuardianRelationship(ageBand: StudentAgeBand | null | undefined) {
  return CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED && isEligibleGuardianRelationshipAge(ageBand);
}

export function isAdultWithoutGuardianFlow(ageBand: StudentAgeBand | null | undefined) {
  return ageBand === "18_plus";
}
