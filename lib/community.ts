import type { SupabaseClient, User } from "@supabase/supabase-js";

export const communityRoleKeys = ["student", "guardian", "teacher", "professional"] as const;
export type CommunityRole = (typeof communityRoleKeys)[number];

export const communityRoleLabels: Record<CommunityRole, string> = {
  student: "学生",
  guardian: "家长",
  teacher: "老师",
  professional: "专业支持者",
};

export function isCommunityRole(value: unknown): value is CommunityRole {
  return typeof value === "string" && communityRoleKeys.includes(value as CommunityRole);
}

export function normalizeRoleList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isCommunityRole)));
}

export async function getCommunityIdentity(supabase: SupabaseClient, user: User) {
  const email = (user.email || "").trim().toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const [
    { data: profile, error: profileError },
    { data: memberships, error: membershipError },
    { data: adminRole, error: adminError },
    { data: professionalVerification, error: professionalError },
  ] =
    await Promise.all([
      supabase.from("profiles").select("display_name,email,role").eq("id", user.id).maybeSingle(),
      supabase.from("school_members").select("member_role").eq("user_id", user.id).eq("status", "active"),
      email
        ? supabase.from("admin_roles").select("id").eq("email", email).eq("status", "active").maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("professional_verifications")
        .select("user_id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .or(`credential_expires_on.is.null,credential_expires_on.gte.${today}`)
        .maybeSingle(),
    ]);
  if (profileError) throw profileError;
  if (membershipError) throw membershipError;
  if (adminError) throw adminError;
  if (professionalError) throw professionalError;

  let role: CommunityRole = "student";
  if (profile?.role === "专业支持者" && professionalVerification) role = "professional";
  else if (profile?.role === "家长") role = "guardian";
  else if (
    profile?.role === "学校支持人员" ||
    Boolean(adminRole) ||
    (memberships || []).some((item) => ["school_support", "school_admin"].includes(item.member_role))
  ) role = "teacher";

  return {
    id: user.id,
    name: profile?.display_name || profile?.email || user.email || communityRoleLabels[role],
    role,
    roleLabel: communityRoleLabels[role],
    verifiedProfessional: role === "professional",
    canModerate: Boolean(adminRole),
  };
}

export async function getCommunityBlockedUserIds(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("community_blocks")
    .select("blocker_user_id,blocked_user_id")
    .or(`blocker_user_id.eq.${userId},blocked_user_id.eq.${userId}`);
  if (error) throw error;
  return new Set(
    (data || []).map((block) =>
      block.blocker_user_id === userId ? block.blocked_user_id as string : block.blocker_user_id as string,
    ),
  );
}

export async function getActiveCommunityMute(supabase: SupabaseClient, userId: string) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("community_restrictions")
    .select("id,reason,ends_at")
    .eq("user_id", userId)
    .eq("restriction_type", "mute")
    .eq("status", "active")
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; reason: string; ends_at: string | null } | null;
}
