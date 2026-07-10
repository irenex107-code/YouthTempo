import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabaseClient";
import type { SavedSweetRecordStep } from "@/lib/localRecords";

export type UserRole = "学生" | "家长" | "老师" | "学校合作方";

export type CloudProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: UserRole | string | null;
  created_at?: string;
  updated_at?: string;
};

export type CloudSweetRecord = {
  id: string;
  user_id: string;
  records: SavedSweetRecordStep[];
  summary: string | null;
  small_step: string | null;
  recommended_next_tool: string | null;
  created_at: string;
};

export type UserPermission = {
  id: string;
  owner_user_id: string;
  grantee_email: string;
  permission_type: string;
  status: "pending" | "active" | "revoked";
  created_at: string;
  revoked_at: string | null;
};

export async function getCurrentUser() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function sendMagicLink(email: string) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/account` : undefined;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

export async function signOut() {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getProfile(user: User) {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  return data as CloudProfile | null;
}

export async function saveProfile(user: User, displayName: string, role: string) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const payload = {
    id: user.id,
    email: user.email || null,
    display_name: displayName,
    role,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("profiles").upsert(payload).select("*").single();
  if (error) throw error;
  return data as CloudProfile;
}

export async function listCloudSweetRecords() {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("sweet_records")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []) as CloudSweetRecord[];
}

export async function saveCloudSweetRecord(record: {
  records: SavedSweetRecordStep[];
  summary?: string;
  smallStep?: string;
  recommendedNextTool?: string;
}) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const user = await getCurrentUser();
  if (!user) throw new Error("请先登录，再保存到云端记录。");
  const { data, error } = await supabase
    .from("sweet_records")
    .insert({
      user_id: user.id,
      records: record.records,
      summary: record.summary || null,
      small_step: record.smallStep || null,
      recommended_next_tool: record.recommendedNextTool || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CloudSweetRecord;
}

export async function deleteCloudSweetRecord(recordId: string) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("sweet_records").delete().eq("id", recordId);
  if (error) throw error;
}

export async function listPermissions() {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("user_permissions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as UserPermission[];
}

export async function createPermission(granteeEmail: string, permissionType: string) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const user = await getCurrentUser();
  if (!user) throw new Error("请先登录，再管理授权。");
  const { data, error } = await supabase
    .from("user_permissions")
    .insert({
      owner_user_id: user.id,
      grantee_email: granteeEmail.trim().toLowerCase(),
      permission_type: permissionType,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as UserPermission;
}

export async function revokePermission(permissionId: string) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase
    .from("user_permissions")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", permissionId);
  if (error) throw error;
}
