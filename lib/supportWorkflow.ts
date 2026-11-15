import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isActiveStudentConsent, requireActiveStudentConsent } from "@/lib/studentConsent";

export type SupportCaseType = "youth_request" | "adult_consultation";
export const supportCaseStatuses = [
  "requested", "triage", "awaiting_assignment", "assigned", "active", "paused",
  "transfer_requested", "transferred", "referred", "closed", "cancelled",
] as const;
export type SupportCaseStatus = (typeof supportCaseStatuses)[number];
export const supportStaffCategories = [
  "counselor", "social_worker", "listening_volunteer", "school_duty_teacher",
] as const;
export type SupportStaffCategory = (typeof supportStaffCategories)[number];

export function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isPublicConsultationEnabled() {
  return process.env.FORMAL_CONSULTATION_PUBLIC_ENABLED === "true";
}

export async function canUseInternalConsultation(supabase: SupabaseClient, user: User) {
  if (process.env.FORMAL_CONSULTATION_INTERNAL_ENABLED !== "true") return false;
  const allowlist = (process.env.FORMAL_CONSULTATION_TEST_USER_IDS || "")
    .split(",").map((id) => id.trim()).filter(Boolean);
  if (allowlist.includes(user.id)) return true;
  const email = user.email?.trim().toLowerCase();
  if (!email) return false;
  const { data, error } = await supabase.from("admin_roles")
    .select("email").eq("email", email).eq("status", "active").maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export type AdultConsultationAvailability = "available" | "not_open" | "ineligible";

export async function getAdultConsultationAvailability(supabase: SupabaseClient, user: User): Promise<AdultConsultationAvailability> {
  if (isPublicConsultationEnabled()) return "available";
  if (process.env.FORMAL_CONSULTATION_INTERNAL_ENABLED !== "true") return "not_open";
  return await canUseInternalConsultation(supabase, user) ? "available" : "ineligible";
}

export async function canCreateAdultConsultation(supabase: SupabaseClient, user: User) {
  return await getAdultConsultationAvailability(supabase, user) === "available";
}

export async function requireSupportStudent(supabase: SupabaseClient, userId: string) {
  const consent = await requireActiveStudentConsent(supabase, userId);
  if (!consent || !["14_17", "18_plus"].includes(consent.age_band)) return null;
  return { ageBand: consent.age_band as "14_17" | "18_plus" };
}

export const supportTerminationActions = [
  "cancel", "withdraw_authorization", "close", "cancel_appointment",
] as const;
export type SupportTerminationAction = (typeof supportTerminationActions)[number];
export function isSupportTerminationAction(action: string): action is SupportTerminationAction {
  return supportTerminationActions.some((value) => value === action);
}

/** Authentication is performed by the caller; this verifies the database role only. */
export async function requireSupportTerminationStudent(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data?.role === "学生";
}

/** Existing self-owned history only. Consent/availability never grants ownership. */
export async function requireSupportHistoryStudent(supabase: SupabaseClient, userId: string) {
  const { data: profile, error } = await supabase.from("profiles")
    .select("role").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (profile?.role !== "学生") return null;
  try {
    const { data: consent, error: consentError } = await supabase.from("student_consents")
      .select("age_band,consent_basis,status,policy_version,student_assented_at,guardian_user_id,guardian_consented_at")
      .eq("student_user_id", userId).maybeSingle();
    if (consentError) throw consentError;
    const ageBand = consent?.age_band === "14_17" || consent?.age_band === "18_plus" ? consent.age_band : null;
    return { ageBand, canUseNewService: Boolean(ageBand && isActiveStudentConsent(consent)),
      historyReason: consent?.status === "withdrawn" ? "withdrawn" : "inactive" };
  } catch {
    // Identity and database student role were independently verified above.
    return { ageBand: null, canUseNewService: false, historyReason: "consent_unavailable" };
  }
}

export async function hasCurrentSupportStaffScope(
  supabase: SupabaseClient,
  staffUserId: string,
  category: string,
  item: { student_user_id: string; school_id: string | null; case_type: string },
) {
  // Other staff categories use the existing approval and case-assignment
  // boundaries. A school's duty teacher additionally needs a current school
  // relationship; an old accepted support assignment cannot preserve it.
  if (category !== "school_duty_teacher") return true;
  if (!item.school_id || item.case_type !== "youth_request") return false;
  const [{ data: profiles, error: profileError }, { data: membership, error: membershipError },
    { data: relationship, error: relationshipError }, { data: school, error: schoolError }] = await Promise.all([
    supabase.from("profiles").select("id,role,school_id").in("id", [staffUserId, item.student_user_id]),
    supabase.from("school_members").select("user_id").eq("school_id", item.school_id)
      .eq("user_id", staffUserId).eq("member_role", "school_support").eq("status", "active").maybeSingle(),
    supabase.from("teacher_student_assignments").select("id").eq("school_id", item.school_id)
      .eq("teacher_user_id", staffUserId).eq("student_user_id", item.student_user_id)
      .eq("status", "active").maybeSingle(),
    supabase.from("schools").select("id").eq("id", item.school_id).eq("status", "active").maybeSingle(),
  ]);
  if (profileError) throw profileError;
  if (membershipError) throw membershipError;
  if (relationshipError) throw relationshipError;
  if (schoolError) throw schoolError;
  const teacher = (profiles || []).find((profile) => profile.id === staffUserId);
  const student = (profiles || []).find((profile) => profile.id === item.student_user_id);
  return Boolean(school && membership && relationship
    && teacher?.role === "学校支持人员" && teacher.school_id === item.school_id
    && student?.role === "学生" && student.school_id === item.school_id);
}

export function parseStaffApplication(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("invalid_staff_application");
  const item = input as Record<string, unknown>;
  const category = item.category;
  if (!supportStaffCategories.includes(category as SupportStaffCategory)
    || category === "school_duty_teacher") throw new Error("invalid_staff_application");
  const text = (key: string, max: number, required = false) => {
    const value = typeof item[key] === "string" ? item[key].trim() : "";
    if ((required && !value) || value.length > max) throw new Error("invalid_staff_application");
    return value || null;
  };
  const languages = Array.isArray(item.serviceLanguages) ? item.serviceLanguages : [];
  const ageScopes = Array.isArray(item.ageScopes) ? item.ageScopes : [];
  if (!languages.length || languages.some((value) => !["zh-CN", "en"].includes(value))
    || !ageScopes.length || ageScopes.some((value) => !["14_17", "18_plus"].includes(value))
    || item.boundariesConfirmed !== true
    || item.crisisRulesConfirmed !== true
    || item.privacyRulesConfirmed !== true) throw new Error("invalid_staff_application");
  const legalName = text("legalName", 120, true);
  if ((legalName || "").length < 2) throw new Error("invalid_staff_application");
  return {
    category,
    legal_name: legalName,
    credential_type: text("credentialType", 120, category !== "listening_volunteer"),
    credential_number: text("credentialNumber", 120, category === "counselor"),
    service_languages: [...new Set(languages)],
    age_scopes: [...new Set(ageScopes)],
    service_scope: text("serviceScope", 500, true),
    availability: text("availability", 500, true),
    institution_name: text("institutionName", 160),
    boundaries_confirmed: true,
    crisis_rules_confirmed: true,
    privacy_rules_confirmed: true,
  };
}

export async function transitionSupportCase(
  supabase: SupabaseClient,
  item: {
    id: string;
    status: string;
    appointment_at: string | null;
    appointment_status: string;
    referral_type: string | null;
    student_authorization_active: boolean;
  },
  input: {
    actorId: string;
    actorRole: "student" | "admin" | "staff";
    action: string;
    nextStatus: SupportCaseStatus;
    note?: string;
    appointmentAt?: string | null;
    appointmentStatus?: string;
    referralType?: string | null;
    authorizationActive?: boolean;
  },
) {
  const { data, error } = await supabase.rpc("transition_support_case", {
    p_case_id: item.id,
    p_actor_id: input.actorId,
    p_actor_role: input.actorRole,
    p_action: input.action,
    p_next_status: input.nextStatus,
    p_expected_status: item.status,
    p_note: input.note || "",
    p_appointment_at: input.appointmentAt === undefined ? item.appointment_at : input.appointmentAt,
    p_appointment_status: input.appointmentStatus || item.appointment_status,
    p_referral_type: input.referralType === undefined ? item.referral_type : input.referralType,
    p_authorization_active: input.authorizationActive === undefined
      ? item.student_authorization_active : input.authorizationActive,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

/** Service-only termination; expectedRevision is the displayed row token for appointment cancellation. */
export async function terminateSupportCase(supabase: SupabaseClient, input: {
  caseId: string; actorId: string; action: SupportTerminationAction;
  expectedStatus: string; expectedRevision: string | null;
}) {
  const { data, error } = await supabase.rpc("terminate_support_case", {
    p_case_id: input.caseId, p_actor_id: input.actorId, p_action: input.action,
    p_expected_status: input.expectedStatus, p_expected_revision: input.expectedRevision,
  });
  if (error) throw error;
  return Array.isArray(data) && data.length === 1 ? data[0] : null;
}
