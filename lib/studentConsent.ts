import type { SupabaseClient } from "@supabase/supabase-js";

export const STUDENT_CONSENT_POLICY_VERSION = "2026-08-28";

export type StudentAgeBand = "under_14" | "14_17" | "18_plus";
export type StudentConsentState = "not_started" | "pending_guardian" | "active" | "withdrawn" | "ineligible";
export type StudentConsentBasis = "not_applicable" | "adult_self" | "student_self_pilot" | "student_guardian";

export type StudentConsentSummary = {
  studentUserId: string;
  studentName: string;
  ageBand: StudentAgeBand | null;
  consentBasis: StudentConsentBasis | null;
  policyVersion: string;
  status: StudentConsentState;
  studentAssentedAt: string | null;
  guardianUserId: string | null;
  guardianConsentedAt: string | null;
  withdrawnAt: string | null;
  hasLinkedGuardian: boolean;
};

type ConsentRow = {
  student_user_id: string;
  age_band: StudentAgeBand;
  consent_basis: StudentConsentBasis;
  policy_version: string;
  status: Exclude<StudentConsentState, "not_started">;
  student_assented_at: string | null;
  guardian_user_id: string | null;
  guardian_consented_at: string | null;
  withdrawn_at: string | null;
};

export function emptyStudentConsent(studentUserId: string, studentName: string, hasLinkedGuardian: boolean): StudentConsentSummary {
  return {
    studentUserId,
    studentName,
    ageBand: null,
    consentBasis: null,
    policyVersion: STUDENT_CONSENT_POLICY_VERSION,
    status: "not_started",
    studentAssentedAt: null,
    guardianUserId: null,
    guardianConsentedAt: null,
    withdrawnAt: null,
    hasLinkedGuardian,
  };
}

export function consentSummary(
  row: ConsentRow | null,
  studentUserId: string,
  studentName: string,
  hasLinkedGuardian: boolean,
): StudentConsentSummary {
  if (!row || row.policy_version !== STUDENT_CONSENT_POLICY_VERSION) {
    return emptyStudentConsent(studentUserId, studentName, hasLinkedGuardian);
  }
  return {
    studentUserId,
    studentName,
    ageBand: row.age_band,
    consentBasis: row.consent_basis,
    policyVersion: row.policy_version,
    status: row.status,
    studentAssentedAt: row.student_assented_at,
    guardianUserId: row.guardian_user_id,
    guardianConsentedAt: row.guardian_consented_at,
    withdrawnAt: row.withdrawn_at,
    hasLinkedGuardian,
  };
}

type ActiveConsentRow = Pick<
  ConsentRow,
  "age_band" | "consent_basis" | "policy_version" | "status" | "student_assented_at" | "guardian_user_id" | "guardian_consented_at"
>;

export function isActiveStudentConsent(consent: ActiveConsentRow | null | undefined) {
  if (
    !consent ||
    consent.status !== "active" ||
    consent.policy_version !== STUDENT_CONSENT_POLICY_VERSION ||
    !consent.student_assented_at
  ) {
    return false;
  }
  if (consent.age_band === "18_plus") return consent.consent_basis === "adult_self";
  if (consent.age_band !== "14_17") return false;
  if (consent.consent_basis === "student_self_pilot") return true;
  return consent.consent_basis === "student_guardian" && Boolean(consent.guardian_user_id && consent.guardian_consented_at);
}

export async function requireActiveStudentConsent(supabase: SupabaseClient, userId: string) {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (profile?.role !== "学生") return;

  const { data: consent, error: consentError } = await supabase
    .from("student_consents")
    .select("age_band,consent_basis,status,policy_version,student_assented_at,guardian_user_id,guardian_consented_at")
    .eq("student_user_id", userId)
    .maybeSingle();
  if (consentError) throw consentError;
  if (!isActiveStudentConsent(consent)) {
    const error = new Error("请先在账户页完成适用的知情确认，再使用这项功能。") as Error & { statusCode?: number };
    error.statusCode = 403;
    throw error;
  }
}
