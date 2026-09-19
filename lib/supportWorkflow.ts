import type { SupabaseClient, User } from "@supabase/supabase-js";
import { requireActiveStudentConsent } from "@/lib/studentConsent";

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

export async function canCreateAdultConsultation(supabase: SupabaseClient, user: User) {
  return isPublicConsultationEnabled() || await canUseInternalConsultation(supabase, user);
}

export async function requireSupportStudent(supabase: SupabaseClient, userId: string) {
  const consent = await requireActiveStudentConsent(supabase, userId);
  if (!consent || !["14_17", "18_plus"].includes(consent.age_band)) return null;
  return { ageBand: consent.age_band as "14_17" | "18_plus" };
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
