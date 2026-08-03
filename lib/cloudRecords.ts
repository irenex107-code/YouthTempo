import type { EmailOtpType, User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabaseClient";
import type { SavedSweetRecordStep } from "@/lib/sweetRecordTypes";
import type { CommunityReportCategory, CommunityReportPriority } from "@/lib/communityReports";

export type UserRole = "学生" | "家长" | "学校支持人员" | "专业支持者";

export type CommunityRole = "student" | "guardian" | "teacher" | "professional";

export type CommunityComment = {
  id: string;
  post_id: string;
  author_user_id: string;
  author_role: CommunityRole;
  author_name: string;
  author_role_label: string;
  verified_professional: boolean;
  can_delete: boolean;
  body: string;
  created_at: string;
};

export type CommunityPost = {
  id: string;
  author_user_id: string;
  author_role: CommunityRole;
  author_name: string;
  author_role_label: string;
  verified_professional: boolean;
  can_delete: boolean;
  title: string;
  body: string;
  viewer_roles: CommunityRole[];
  commenter_roles: CommunityRole[];
  can_comment: boolean;
  created_at: string;
  comments: CommunityComment[];
};

export type CommunityBlock = {
  user_id: string;
  name: string;
  role: string;
  created_at: string;
};

export type CommunityReport = {
  id: string;
  post_id: string | null;
  comment_id: string | null;
  reason: string;
  category: CommunityReportCategory;
  priority: CommunityReportPriority;
  status: "new" | "reviewing" | "resolved";
  created_at: string;
  target_review_at: string;
  resolved_at: string | null;
};

export type CloudProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: UserRole | string | null;
  school_id: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CloudSweetRecord = {
  id: string;
  user_id: string;
  school_id: string | null;
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

export type WechatIdentity = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
};

export type WechatBindSession = {
  scene: string;
  expiresAt: string;
  qrCodeDataUrl: string;
};

export type StudentMessage = {
  id: string;
  school_id: string | null;
  sender_user_id: string;
  recipient_type: "teacher" | "guardian" | "self";
  recipient_user_id: string;
  anonymous_to_recipient: boolean;
  body: string;
  moderation_status: "sent" | "safety_review";
  read_at: string | null;
  created_at: string;
  sender_name: string;
  recipient_name: string;
  canRevealSender: boolean;
};

export type AccountStatus = {
  profile: CloudProfile | null;
  displayRole: "学生" | "家长" | "支持老师" | "学校负责人" | "平台管理员" | string;
  adminAccess: { role: string; scope: "platform" | "school" } | null;
  schoolMemberships: Array<{ school_id: string; member_role: string; status: string }>;
  hasSchool: boolean;
  linkedChildren: Array<{ id: string; display_name: string; school_id: string }>;
  assignedStudents: Array<{ id: string; display_name: string; school_id: string }>;
  assignedTeachers: Array<{ id: string; display_name: string; school_id: string }>;
  linkedGuardians: Array<{ id: string; display_name: string; school_id: string }>;
  inviteSyncError?: string | null;
};

export type StudentConsentSummary = {
  studentUserId: string;
  studentName: string;
  ageBand: "under_14" | "14_17" | "18_plus" | null;
  policyVersion: string;
  status: "not_started" | "pending_guardian" | "active" | "withdrawn" | "ineligible";
  studentAssentedAt: string | null;
  guardianUserId: string | null;
  guardianConsentedAt: string | null;
  withdrawnAt: string | null;
  hasLinkedGuardian: boolean;
};

export type StudentConsentResponse = {
  role: "student" | "guardian" | "other";
  policyVersion: string;
  consent: StudentConsentSummary | null;
  children: StudentConsentSummary[];
};

function normalizeRole(role?: string | null): UserRole {
  if (role === "专业支持者") return "专业支持者";
  if (role === "家长" || role === "支持者") return "家长";
  if (role === "学校支持人员" || role === "老师" || role === "学校合作方") return "学校支持人员";
  return "学生";
}

function authRedirectTo() {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}/account`;
}

async function getAccessToken() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("请先登录，再继续。");
  return token;
}

export async function handleAuthRedirect() {
  const supabase = getSupabase();
  if (!supabase || typeof window === "undefined") return false;

  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const authType = (url.searchParams.get("type") || "email") as EmailOtpType;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`);
    return true;
  }

  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: authType });
    if (error) throw error;
    window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`);
    return true;
  }

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (hash.get("access_token") || hash.get("refresh_token")) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`);
    return Boolean(data.session);
  }

  return false;
}

export async function getCurrentUser() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function sendEmailOtp(email: string) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: authRedirectTo(),
      shouldCreateUser: true,
    },
  });
  if (error) throw error;
}

export async function verifyEmailOtp(email: string, token: string) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: "email",
  });
  if (error) throw error;
  return data.user;
}

export async function applySchoolInvites() {
  const token = await getAccessToken();
  const response = await fetch("/api/account/apply-school-invites", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "学校空间同步失败。");
  return data as { applied: number; roles: string[] };
}

export async function getAccountStatus() {
  const token = await getAccessToken();
  const response = await fetch("/api/account/status", {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "账户身份加载失败。");
  return data as AccountStatus;
}

export async function getStudentConsentStatus() {
  const token = await getAccessToken();
  const response = await fetch("/api/account/consent", {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "知情同意状态加载失败。");
  return data as StudentConsentResponse;
}

export async function submitStudentAssent(ageBand: "under_14" | "14_17" | "18_plus") {
  const token = await getAccessToken();
  const response = await fetch("/api/account/consent", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "student_assent", ageBand }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "学生确认提交失败。");
  return data as StudentConsentResponse;
}

export async function submitGuardianConsent(studentUserId: string) {
  const token = await getAccessToken();
  const response = await fetch("/api/account/consent", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "guardian_consent", studentUserId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "监护人确认提交失败。");
  return data as StudentConsentResponse;
}

export async function withdrawStudentConsent(studentUserId?: string) {
  const token = await getAccessToken();
  const response = await fetch("/api/account/consent", {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ studentUserId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "撤回确认失败。");
  return data as StudentConsentResponse;
}

export async function listStudentMessages() {
  const token = await getAccessToken();
  const response = await fetch("/api/messages", {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "留言加载失败。");
  return (data.messages || []) as StudentMessage[];
}

export async function sendStudentMessage(input: {
  recipientType: "teacher" | "guardian" | "self";
  recipientUserId?: string;
  anonymous?: boolean;
  body: string;
}) {
  const token = await getAccessToken();
  const response = await fetch("/api/messages", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "留言发送失败。");
  return data as { safetyNotice?: boolean };
}

export async function markStudentMessageRead(id: string) {
  const token = await getAccessToken();
  const response = await fetch("/api/messages", {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "留言状态更新失败。");
}

async function communityRequest(path: string, init?: RequestInit) {
  const token = await getAccessToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "社区暂时不可用。");
  return data;
}

export async function listCommunityPosts() {
  return communityRequest("/api/community/posts") as Promise<{
    currentUser: { id: string; name: string; role: CommunityRole; roleLabel: string; canModerate: boolean };
    roles: Record<CommunityRole, string>;
    posts: CommunityPost[];
  }>;
}

export async function createCommunityPost(input: {
  title: string;
  body: string;
  viewerRoles: CommunityRole[];
  commenterRoles: CommunityRole[];
}) {
  return communityRequest("/api/community/posts", {
    method: "POST",
    body: JSON.stringify(input),
  }) as Promise<{ safetyNotice?: boolean }>;
}

export async function createCommunityComment(postId: string, body: string) {
  return communityRequest("/api/community/comments", {
    method: "POST",
    body: JSON.stringify({ postId, body }),
  }) as Promise<{ safetyNotice?: boolean }>;
}

export async function deleteCommunityPost(postId: string) {
  return communityRequest("/api/community/posts", {
    method: "DELETE",
    body: JSON.stringify({ postId }),
  }) as Promise<{ ok: boolean }>;
}

export async function deleteCommunityComment(commentId: string) {
  return communityRequest("/api/community/comments", {
    method: "DELETE",
    body: JSON.stringify({ commentId }),
  }) as Promise<{ ok: boolean }>;
}

export async function reportCommunityContent(input: {
  postId?: string;
  commentId?: string;
  category: CommunityReportCategory;
  details?: string;
}) {
  return communityRequest("/api/community/reports", {
    method: "POST",
    body: JSON.stringify(input),
  }) as Promise<{ ok: boolean; report: CommunityReport; notice: string }>;
}

export async function listCommunityReports() {
  return communityRequest("/api/community/reports") as Promise<{ reports: CommunityReport[] }>;
}

export async function listCommunityBlocks() {
  return communityRequest("/api/community/blocks") as Promise<{ blocks: CommunityBlock[] }>;
}

export async function blockCommunityMember(targetUserId: string) {
  return communityRequest("/api/community/blocks", {
    method: "POST",
    body: JSON.stringify({ targetUserId }),
  }) as Promise<{ ok: boolean }>;
}

export async function unblockCommunityMember(targetUserId: string) {
  return communityRequest("/api/community/blocks", {
    method: "DELETE",
    body: JSON.stringify({ targetUserId }),
  }) as Promise<{ ok: boolean }>;
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
  if (!data) return null;
  return { ...data, role: normalizeRole(data.role) } as CloudProfile;
}

export async function saveProfile(user: User, displayName: string, role: string) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const payload = {
    id: user.id,
    email: user.email || null,
    display_name: displayName,
    role: normalizeRole(role),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("profiles").upsert(payload).select("*").single();
  if (error) throw error;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("youthtempo:profile-updated"));
  }
  return { ...data, role: normalizeRole(data.role) } as CloudProfile;
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
  const profile = await getProfile(user);
  if (profile?.role === "学生") {
    const consent = await getStudentConsentStatus();
    if (consent.consent?.status !== "active") {
      throw new Error("请先在账户页完成学生确认和监护人知情同意，再保存记录。");
    }
  }
  const { data: latestRecord, error: latestError } = await supabase
    .from("sweet_records")
    .select("id,user_id,school_id,records,summary,small_step,recommended_next_tool,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  if (
    latestRecord &&
    JSON.stringify(latestRecord.records) === JSON.stringify(record.records) &&
    Date.now() - new Date(latestRecord.created_at).getTime() < 10 * 60 * 1000
  ) {
    return latestRecord as CloudSweetRecord;
  }
  const { data, error } = await supabase
    .from("sweet_records")
    .insert({
      user_id: user.id,
      school_id: profile?.school_id || null,
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
      status: "active",
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

export async function listWechatIdentities() {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("wechat_identities")
    .select("id,user_id,created_at,updated_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as WechatIdentity[];
}

export async function createWechatBindSession() {
  const token = await getAccessToken();
  const response = await fetch("/api/wechat/create-bind-session", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "微信绑定二维码生成失败。");
  return data as WechatBindSession;
}

export async function checkWechatBindSession(scene: string) {
  const token = await getAccessToken();
  const response = await fetch(`/api/wechat/check-bind-session?scene=${encodeURIComponent(scene)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "微信绑定状态检查失败。");
  return data as { status: "pending" | "confirmed" | "expired"; bound: boolean; confirmedAt?: string | null };
}
