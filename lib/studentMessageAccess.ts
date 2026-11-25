import type { SupabaseClient } from "@supabase/supabase-js";
import { isActiveStudentConsent } from "@/lib/studentConsent";

export type TeacherMessageScope = {
  teacherId: string;
  schoolId: string | null;
  studentIds: string[];
};

type MessageAddress = {
  school_id: string | null;
  sender_user_id: string;
  recipient_type: string;
  recipient_user_id: string | null;
};

/** Teacher inbox scope only. Assignment lists remain responsibility facts. */
export async function loadTeacherMessageScope(supabase: SupabaseClient, teacherId: string): Promise<TeacherMessageScope> {
  const empty: TeacherMessageScope = { teacherId, schoolId: null, studentIds: [] };
  const { data: teacher, error: teacherError } = await supabase.from("profiles")
    .select("role,school_id").eq("id", teacherId).maybeSingle();
  if (teacherError) throw teacherError;
  if (teacher?.role !== "学校支持人员" || !teacher.school_id) return empty;

  const schoolId = teacher.school_id as string;
  const [{ data: school, error: schoolError }, { data: membership, error: membershipError }] = await Promise.all([
    supabase.from("schools").select("id").eq("id", schoolId).eq("status", "active").maybeSingle(),
    supabase.from("school_members").select("user_id").eq("school_id", schoolId)
      .eq("user_id", teacherId).eq("member_role", "school_support").eq("status", "active").maybeSingle(),
  ]);
  if (schoolError) throw schoolError;
  if (membershipError) throw membershipError;
  if (!school || !membership) return empty;

  const assignedIds: string[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("teacher_student_assignments").select("student_user_id")
      .eq("school_id", schoolId).eq("teacher_user_id", teacherId).eq("status", "active")
      .order("student_user_id", { ascending: true }).range(offset, offset + 499);
    if (error) throw error;
    const page = data || [];
    assignedIds.push(...page.map((row) => row.student_user_id as string));
    if (page.length < 500) break;
  }

  const studentIds: string[] = [];
  for (let offset = 0; offset < assignedIds.length; offset += 100) {
    const { data, error } = await supabase.from("profiles").select("id")
      .in("id", assignedIds.slice(offset, offset + 100)).eq("role", "学生").eq("school_id", schoolId);
    if (error) throw error;
    studentIds.push(...(data || []).map((row) => row.id as string));
  }
  const consentingStudentIds: string[] = [];
  for (let offset = 0; offset < studentIds.length; offset += 100) {
    const { data, error } = await supabase.from("student_consents")
      .select("student_user_id,age_band,consent_basis,status,policy_version,student_assented_at,guardian_user_id,guardian_consented_at")
      .in("student_user_id", studentIds.slice(offset, offset + 100));
    if (error) throw error;
    consentingStudentIds.push(...(data || []).filter((consent) => isActiveStudentConsent(consent))
      .map((consent) => consent.student_user_id as string));
  }
  return { teacherId, schoolId, studentIds: consentingStudentIds };
}

export function canAccessTeacherMessage(scope: TeacherMessageScope, message: MessageAddress): boolean {
  return message.recipient_type === "teacher"
    && message.recipient_user_id === scope.teacherId
    && scope.schoolId !== null && message.school_id === scope.schoolId
    && scope.studentIds.includes(message.sender_user_id);
}
