import type { SupabaseClient, User } from "@supabase/supabase-js";

export const PILOT_FEEDBACK_VERSION = "2026-08";

export type PilotFeedbackRole = "student" | "guardian" | "teacher";

export type PilotFeedbackRow = {
  id: string;
  role: PilotFeedbackRole;
  form_version: string;
  overall_experience: number;
  clarity: number;
  safety: number;
  most_helpful: string;
  hard_to_use: string;
  suggestion: string;
  may_contact: boolean;
  created_at: string;
  updated_at: string;
};

export const pilotFeedbackRoleLabels: Record<PilotFeedbackRole, string> = {
  student: "学生",
  guardian: "家长",
  teacher: "老师",
};

export async function resolvePilotFeedbackRole(
  supabase: SupabaseClient,
  user: User,
): Promise<PilotFeedbackRole | null> {
  const email = user.email?.trim().toLowerCase() || "";
  const [{ data: profile, error: profileError }, { data: memberships, error: membershipError }, { data: platformAdmin, error: platformError }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("school_members").select("member_role").eq("user_id", user.id).eq("status", "active"),
    email
      ? supabase.from("admin_roles").select("email").eq("email", email).eq("status", "active").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (profileError) throw profileError;
  if (membershipError) throw membershipError;
  if (platformError) throw platformError;
  if (platformAdmin) return null;
  if ((memberships || []).some((membership) => membership.member_role === "school_support")) return "teacher";
  if (profile?.role === "家长") return "guardian";
  if (profile?.role === "学生") return "student";
  return null;
}

export function parsePilotFeedback(body: Record<string, unknown>) {
  const rating = (key: string) => {
    const value = Number(body[key]);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new Error("请为三个问题都选择 1 到 5 分。");
    }
    return value;
  };
  const text = (key: string) => {
    const value = typeof body[key] === "string" ? body[key].trim() : "";
    if (value.length > 1000) throw new Error("每段文字请控制在 1000 字以内。");
    return value;
  };

  return {
    overall_experience: rating("overallExperience"),
    clarity: rating("clarity"),
    safety: rating("safety"),
    most_helpful: text("mostHelpful"),
    hard_to_use: text("hardToUse"),
    suggestion: text("suggestion"),
    may_contact: body.mayContact === true,
  };
}
