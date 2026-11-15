import type { EmailOtpType, User } from "@supabase/supabase-js";
import type { Locale } from "@/lib/i18n/config";
import type {
  GardenCareAction,
  GardenItemKey,
  GardenKeepsakeType,
  GardenLayoutSlot,
} from "@/lib/gardenCatalog";
import { getSupabase, signOutSupabaseSession } from "@/lib/supabaseClient";
import type { SavedSweetRecordStep } from "@/lib/sweetRecordTypes";
import type { SweetScope, SweetIntent, SweetCommand, SweetRecordInput, SweetReply, SweetFailure } from "@/lib/sweetPersistenceProtocol";
import type { CommunityReportCategory, CommunityReportPriority } from "@/lib/communityReports";
import { isActiveStudentConsent, STUDENT_CONSENT_POLICY_VERSION } from "@/lib/studentConsent";
import { SweetPersistenceError as AccountSweetPersistenceError } from "@/lib/sweetPersistenceProtocol";
import {
  latestSweetRecordsPerUserDay,
} from "@/lib/sweetRecordDays";

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
  sender_user_id: string | null;
  recipient_type: "teacher" | "guardian" | "self" | "pilot_duty";
  recipient_user_id: string | null;
  anonymous_to_recipient: boolean;
  body: string;
  moderation_status: "sent" | "safety_review";
  duty_status: "not_applicable" | "new" | "in_progress" | "resolved";
  alert_delivery_status: "not_requested" | "pending" | "sent" | "failed" | "not_configured";
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
  studentAgeBand: "under_14" | "14_17" | "18_plus" | null;
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
  consentBasis: "not_applicable" | "adult_self" | "student_self_pilot" | "student_guardian" | null;
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

/** Used only by the five Account-page writes; no retry or durable receipt. */
export type AccountWriteOptions = { current: () => boolean };
export type AccountWriteReason = "identity" | "permission" | "input" | "scope" | "not_found" | "service";
export class AccountWriteError extends Error {
  constructor(readonly outcome: "not_dispatched" | "rejected" | "unknown", readonly reason: AccountWriteReason = "service") {
    super(`account_write_${outcome}`);
    this.name = "AccountWriteError";
  }
}

export function isAccountConsentSnapshot(value: unknown, owner: string): value is StudentConsentResponse {
  if (!value || typeof value !== "object") return false;
  const data = value as StudentConsentResponse;
  const validSummary = (item: StudentConsentSummary | null) => Boolean(item
    && typeof item.studentUserId === "string" && item.studentUserId
    && item.policyVersion === STUDENT_CONSENT_POLICY_VERSION
    && ["not_started", "pending_guardian", "active", "withdrawn", "ineligible"].includes(item.status)
    && [null, "under_14", "14_17", "18_plus"].includes(item.ageBand)
    && [null, "not_applicable", "adult_self", "student_self_pilot", "student_guardian"].includes(item.consentBasis)
    && [item.studentAssentedAt, item.guardianUserId, item.guardianConsentedAt, item.withdrawnAt]
      .every(field => field === null || typeof field === "string")
    && typeof item.hasLinkedGuardian === "boolean"
    // A contradictory 2xx must not establish consent or settle an uncertain write.
    // Reuse the existing predicate; this does not introduce a new consent rule.
    && (item.status !== "active" || (item.ageBand !== null && item.consentBasis !== null && isActiveStudentConsent({
      age_band: item.ageBand, consent_basis: item.consentBasis, policy_version: item.policyVersion,
      status: item.status, student_assented_at: item.studentAssentedAt,
      guardian_user_id: item.guardianUserId, guardian_consented_at: item.guardianConsentedAt,
    }))));
  if (data.policyVersion !== STUDENT_CONSENT_POLICY_VERSION || !Array.isArray(data.children)) return false;
  if (data.role === "student") return validSummary(data.consent) && data.consent!.studentUserId === owner && data.children.length === 0;
  if (data.role === "guardian") return data.consent === null && data.children.every(validSummary);
  return data.role === "other" && data.consent === null && data.children.length === 0;
}

async function accountConsentWrite(method: "POST" | "DELETE", body: Record<string, string | undefined>,
  owner: string | undefined, options: AccountWriteOptions) {
  let dispatched = false;
  try {
    const token = await getAccessToken(owner);
    if (!owner || !options.current()) throw new AccountWriteError("not_dispatched", "identity");
    dispatched = true;
    const response = await fetch("/api/account/consent", {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json();
    if (!options.current()) throw new AccountWriteError("unknown");
    if (!response.ok) {
      // These are the existing handler's pre-write returns, never error-text matching.
      const reason: AccountWriteReason | undefined = response.status === 401 ? "identity"
        : response.status === 400 ? "input" : response.status === 403 ? "permission"
          : response.status === 409 && body.action === "guardian_consent" ? "scope"
            : response.status === 404 && method === "DELETE" ? "not_found" : undefined;
      if (reason && data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
        throw new AccountWriteError("rejected", reason);
      }
      throw new AccountWriteError("unknown");
    }
    const target = body.studentUserId || owner;
    if (!isAccountConsentSnapshot(data, owner)
      || (target === owner ? data.role !== "student"
        : data.role !== "guardian" || !data.children.some(child => child.studentUserId === target))) {
      throw new AccountWriteError("unknown");
    }
    // A 2xx reaches here only after the handler's write, event and final read.
    return data;
  } catch (error) {
    if (error instanceof AccountWriteError) throw error;
    throw new AccountWriteError(dispatched ? "unknown" : "not_dispatched", dispatched ? "service" : "identity");
  }
}

export function localizedCloudErrorMessage(_error: unknown, _locale: Locale, fallback: string) {
  // Legacy callers do not carry a verified reason. Never display exception text.
  // Callers with an existing machine-readable contract select their fixed copy.
  return fallback;
}

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

async function getAccessToken(expectedUserId?: string) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("账号服务暂时不可用，请稍后再试。");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (expectedUserId && data.session?.user.id !== expectedUserId) throw new Error("账号已变化，请确认后再继续。");
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

export function shouldCreateUserForEmailOtp(email: string) {
  return !email.trim().toLowerCase().endsWith("@youthtempo.test");
}

export async function sendEmailOtp(email: string) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("账号服务暂时不可用，请稍后再试。");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: authRedirectTo(),
      // `.test` is reserved for automated fixtures. Never let the public OTP
      // entry point recreate a fixture account after operational cleanup.
      shouldCreateUser: shouldCreateUserForEmailOtp(email),
    },
  });
  if (error) throw error;
}

export async function verifyEmailOtp(email: string, token: string) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("账号服务暂时不可用，请稍后再试。");
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

export async function getAccountStatus(expectedUserId?: string) {
  const token = await getAccessToken(expectedUserId);
  const response = await fetch("/api/account/status", {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "账户身份加载失败。");
  return data as AccountStatus;
}

export type OwnContentKind = "communityPosts" | "communityComments" | "peerSpaceMessages" | "peerSpaceControls";
export type OwnAccountContent = {
  communityPosts: Array<{ id: string; title: string; body: string; moderation_status: string; created_at: string }>;
  communityComments: Array<{ id: string; body: string; moderation_status: string; created_at: string }>;
  peerSpaceMessages: Array<{ id: string; room_id: string; body: string; moderation_status: string; created_at: string; deleted_at: string | null }>;
  peerSpaceControls: Array<{ id: string; room_id: string; control_type: "block" | "mute"; created_at: string }>;
};
export class OwnContentRequestError extends Error {
  constructor(public readonly outcome: "notSent" | "denied" | "unknown") { super("own_content_unavailable"); }
}

// Separate, bounded request lifetime; no change to existing export/delete callers.
async function ownContentJson(path: string, init: RequestInit, owner: string, current: () => boolean): Promise<unknown> {
  const controller = new AbortController();
  let expired = false;
  let dispatched = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    const token = await getAccessToken(owner);
    if (expired || !current()) throw new OwnContentRequestError("notSent");
    dispatched = true;
    const response = await fetch(path, {
      ...init, cache: "no-store", signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    });
    if (!response.ok) {
      // Only these existing handlers' explicit pre-write refusals are classified as denied.
      const denied = [400, 401, 403, 404, 405, 413, 429].includes(response.status);
      throw new OwnContentRequestError(denied ? "denied" : "unknown");
    }
    const result: unknown = await response.json();
    await getAccessToken(owner);
    if (expired || !current()) throw new OwnContentRequestError("unknown");
    return result;
  };
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true; controller.abort();
          reject(new OwnContentRequestError(dispatched ? "unknown" : "notSent"));
        }, 10_000);
      }),
    ]);
  } catch (error) {
    throw error instanceof OwnContentRequestError ? error : new OwnContentRequestError(dispatched ? "unknown" : "notSent");
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

function ownContentObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OwnContentRequestError("unknown");
  return value as Record<string, unknown>;
}
function ownContentString(row: Record<string, unknown>, field: string) {
  const value = row[field];
  if (typeof value !== "string") throw new OwnContentRequestError("unknown");
  return value;
}

export async function readOwnAccountContent(owner: string, current: () => boolean): Promise<OwnAccountContent> {
  const payload = ownContentObject(await ownContentJson("/api/account/data", { method: "GET" }, owner, current));
  if (ownContentObject(payload.account).id !== owner || payload.formatVersion !== 1) throw new OwnContentRequestError("unknown");
  const data = ownContentObject(payload.data);
  const readRows = (key: OwnContentKind, authorField?: string) => {
    const values = data[key];
    if (!Array.isArray(values)) throw new OwnContentRequestError("unknown");
    const ids = new Set<string>();
    return values.map((value: unknown) => {
      const row = ownContentObject(value);
      const id = ownContentString(row, "id");
      if (!id || ids.has(id) || !Number.isFinite(Date.parse(ownContentString(row, "created_at")))
        || (authorField && row[authorField] !== owner)) throw new OwnContentRequestError("unknown");
      ids.add(id);
      return row;
    });
  };
  // Project only existing management fields. Never return/store the full export object.
  return {
    communityPosts: readRows("communityPosts", "author_user_id").map((r) => ({
      id: ownContentString(r, "id"), title: ownContentString(r, "title"), body: ownContentString(r, "body"),
      moderation_status: ownContentString(r, "moderation_status"), created_at: ownContentString(r, "created_at"),
    })),
    communityComments: readRows("communityComments", "author_user_id").map((r) => ({
      id: ownContentString(r, "id"), body: ownContentString(r, "body"),
      moderation_status: ownContentString(r, "moderation_status"), created_at: ownContentString(r, "created_at"),
    })),
    peerSpaceMessages: readRows("peerSpaceMessages").map((r) => {
      if (r.deleted_at !== null && (typeof r.deleted_at !== "string" || !r.deleted_at.trim()
        || !Number.isFinite(Date.parse(r.deleted_at)))) throw new OwnContentRequestError("unknown");
      return { id: ownContentString(r, "id"), room_id: ownContentString(r, "room_id"), body: ownContentString(r, "body"),
        moderation_status: ownContentString(r, "moderation_status"), created_at: ownContentString(r, "created_at"), deleted_at: r.deleted_at as string | null };
    }),
    peerSpaceControls: readRows("peerSpaceControls").map((r) => {
      if (r.control_type !== "block" && r.control_type !== "mute") throw new OwnContentRequestError("unknown");
      return { id: ownContentString(r, "id"), room_id: ownContentString(r, "room_id"),
        control_type: r.control_type as "block" | "mute", created_at: ownContentString(r, "created_at") };
    }),
  };
}

export async function deleteOwnAccountContent(kind: OwnContentKind, id: string, owner: string, locale: Locale, current: () => boolean) {
  const contracts = {
    communityPosts: { path: "/api/community/posts", param: "postId", result: "ok" },
    communityComments: { path: "/api/community/comments", param: "commentId", result: "ok" },
    peerSpaceMessages: { path: "/api/peer-space/messages", param: "messageId", result: "deleted" },
    peerSpaceControls: { path: "/api/peer-space/controls", param: "controlId", result: "removed" },
  } as const;
  const contract = contracts[kind];
  const result = ownContentObject(await ownContentJson(contract.path, {
    method: "DELETE", body: JSON.stringify({ [contract.param]: id, locale }),
  }, owner, current));
  if (result[contract.result] !== true) throw new OwnContentRequestError("unknown");
  // Community CAS currently may affect zero rows. The account GET must confirm removed.
  return kind === "communityPosts" || kind === "communityComments" ? "acknowledged" as const : "confirmed" as const;
}

export async function downloadAccountDataExport(expectedUserId?: string, isCurrent: () => boolean = () => true) {
  if (!isCurrent()) return;
  const token = await getAccessToken(expectedUserId);
  if (!isCurrent()) return;
  const response = await fetch("/api/account/data", {
    cache: "no-store", headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "账户数据导出失败。");
  }
  const blob = await response.blob();
  if (!isCurrent()) return;
  await getAccessToken(expectedUserId);
  if (!isCurrent()) return;
  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || "YouthTempo-data-export.json";
  let url: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  try {
    url = URL.createObjectURL(blob);
    if (!isCurrent()) return;
    anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor);
    if (isCurrent()) anchor.click();
  } finally {
    try { anchor?.remove(); }
    finally { if (url) URL.revokeObjectURL(url); }
  }
}

export type AccountDeletionReceipt = { subjectUserId: string; operationId: string; secret: string; expiresAt: number };
export type AccountDeletionState = "not_deleted" | "deleted_cleanup_pending" | "completed" | "unknown";
export const accountDeletionReceiptStorageKey = "youthtempo:account-deletion-receipts:v1";
export const accountDeletionReceiptChanged = "youthtempo:account-deletion-receipts-changed";
const deletionReceiptLifetime = 24 * 60 * 60 * 1000;
const receiptUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const operationUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export class AccountDeletionError extends Error {
  constructor(public readonly deletionState: "not_deleted" | "unknown" = "unknown") {
    super("Account deletion unavailable");
    this.name = "AccountDeletionError";
  }
}

function validDeletionReceipt(value: unknown): value is AccountDeletionReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as AccountDeletionReceipt;
  return typeof receipt.subjectUserId === "string" && receiptUuid.test(receipt.subjectUserId)
    && typeof receipt.operationId === "string" && operationUuid.test(receipt.operationId)
    && typeof receipt.secret === "string" && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(receipt.secret)
    && Number.isFinite(receipt.expiresAt) && receipt.expiresAt > Date.now()
    && receipt.expiresAt <= Date.now() + deletionReceiptLifetime;
}

/** Tab-scoped capabilities only: never persist confirmation email or form data. */
export function listAccountDeletionReceipts(): AccountDeletionReceipt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(accountDeletionReceiptStorageKey);
    const values: unknown = raw ? JSON.parse(raw) : [];
    const receipts = (Array.isArray(values) ? values : []).filter(validDeletionReceipt)
      .map(({ subjectUserId, operationId, secret, expiresAt }) => ({ subjectUserId, operationId, secret, expiresAt }));
    if (raw && raw !== JSON.stringify(receipts)) {
      if (receipts.length) window.sessionStorage.setItem(accountDeletionReceiptStorageKey, JSON.stringify(receipts));
      else window.sessionStorage.removeItem(accountDeletionReceiptStorageKey);
    }
    return receipts;
  } catch { return []; }
}

export function createAccountDeletionReceipt(subjectUserId: string): AccountDeletionReceipt {
  try {
    if (typeof window === "undefined" || !receiptUuid.test(subjectUserId)) throw new Error("unavailable");
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const receipt = { subjectUserId, operationId: crypto.randomUUID(), secret, expiresAt: Date.now() + deletionReceiptLifetime };
    const receipts = listAccountDeletionReceipts();
    // An unresolved operation must keep its original capability, including after
    // reload. Checking status never authorizes another destructive request.
    const existing = receipts.find((value) => value.subjectUserId === subjectUserId);
    if (existing) return existing;
    window.sessionStorage.setItem(accountDeletionReceiptStorageKey, JSON.stringify([...receipts, receipt]));
    if (!listAccountDeletionReceipts().some((value) => value.operationId === receipt.operationId)) throw new Error("unavailable");
    window.dispatchEvent(new Event(accountDeletionReceiptChanged));
    return receipt;
  } catch { throw new AccountDeletionError("not_deleted"); }
}

async function deletionFetch(path: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(path, { ...init, signal: controller.signal, cache: "no-store" });
    return { response, data: await response.json() };
  }
  finally { clearTimeout(timeout); }
}

export async function checkAccountDeletionStatus(receipt: AccountDeletionReceipt): Promise<AccountDeletionState> {
  if (!validDeletionReceipt(receipt)) return "unknown";
  try {
    const { response, data } = await deletionFetch("/api/account/deletion-status", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ subjectUserId: receipt.subjectUserId, operationId: receipt.operationId, secret: receipt.secret }),
    });
    if (!response.ok || !["not_deleted", "deleted_cleanup_pending", "completed", "unknown"].includes(data?.state)) throw new Error("unavailable");
    return data.state as AccountDeletionState;
  } catch { throw new AccountDeletionError(); }
}

export async function deleteAccountPermanently(confirmationEmail: string, expectedUserId?: string, receipt?: AccountDeletionReceipt) {
  if (receipt && (!validDeletionReceipt(receipt) || (expectedUserId && receipt.subjectUserId !== expectedUserId))) {
    throw new AccountDeletionError("not_deleted");
  }
  try {
    const token = await getAccessToken(receipt?.subjectUserId || expectedUserId);
    const { response, data } = await deletionFetch("/api/account/data", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ confirmationEmail, acknowledge: true,
        ...(receipt ? { receipt: { operationId: receipt.operationId, secret: receipt.secret } } : {}) }),
    });
    if (!response.ok) throw new AccountDeletionError(data?.deletionState === "not_deleted" ? "not_deleted" : "unknown");
    if (data?.deleted !== true || (data.cleanupPending !== undefined && typeof data.cleanupPending !== "boolean")) throw new AccountDeletionError();
    return data as { deleted: true; cleanupPending?: boolean };
  } catch (error) {
    if (error instanceof AccountDeletionError) throw error;
    throw new AccountDeletionError();
  }
}

export async function getStudentConsentStatus(expectedUserId?: string) {
  const token = await getAccessToken(expectedUserId);
  const response = await fetch("/api/account/consent", {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "知情同意状态加载失败。");
  return data as StudentConsentResponse;
}

export async function submitStudentAssent(ageBand: "under_14" | "14_17" | "18_plus", expectedUserId?: string, options?: AccountWriteOptions) {
  if (options) return accountConsentWrite("POST", { action: "student_assent", ageBand }, expectedUserId, options);
  const token = await getAccessToken(expectedUserId);
  const response = await fetch("/api/account/consent", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "student_assent", ageBand }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "学生确认提交失败。");
  return data as StudentConsentResponse;
}

export async function submitGuardianConsent(studentUserId: string, expectedUserId?: string, options?: AccountWriteOptions) {
  if (options) return accountConsentWrite("POST", { action: "guardian_consent", studentUserId }, expectedUserId, options);
  const token = await getAccessToken(expectedUserId);
  const response = await fetch("/api/account/consent", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "guardian_consent", studentUserId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "监护人确认提交失败。");
  return data as StudentConsentResponse;
}

export async function withdrawStudentConsent(studentUserId?: string, expectedUserId?: string, options?: AccountWriteOptions) {
  if (options) return accountConsentWrite("DELETE", { studentUserId }, expectedUserId, options);
  const token = await getAccessToken(expectedUserId);
  const response = await fetch("/api/account/consent", {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ studentUserId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "撤回确认失败。");
  return data as StudentConsentResponse;
}

export class StudentMessageReadError extends Error {
  constructor(readonly status: number) {
    super("student_message_read_unavailable");
    this.name = "StudentMessageReadError";
  }
}

export async function listStudentMessages(expectedUserId?: string, isCurrent: () => boolean = () => true) {
  if (!isCurrent()) throw new Error("账号已变化，请确认后再继续。");
  const token = await getAccessToken(expectedUserId);
  if (!isCurrent()) throw new Error("账号已变化，请确认后再继续。");
  const response = await fetch("/api/messages", {
    cache: "no-store", headers: { authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!isCurrent()) throw new Error("账号已变化，请确认后再继续。");
  if (!response.ok) throw new StudentMessageReadError(response.status);
  if (!Array.isArray(data.messages)) throw new Error("留言加载失败。");
  return {
    messages: data.messages as StudentMessage[],
    pilotDutyAvailable: data.pilotDutyAvailable === true,
    pilotDutyEmailConfigured: data.pilotDutyEmailConfigured === true,
  };
}

export const STUDENT_MESSAGE_SEND_TIMEOUT_MS = 10_000;

export class StudentMessageSendUnknownError extends Error {
  constructor() {
    super("student_message_send_result_unknown");
    this.name = "StudentMessageSendUnknownError";
  }
}

export type StudentMessageSendRejection = "identity" | "access" | "input" | "safety" | "rate_limit";

export class StudentMessageSendRejectedError extends Error {
  constructor(readonly rejection: StudentMessageSendRejection) {
    super("student_message_send_rejected");
    this.name = "StudentMessageSendRejectedError";
  }
}

function studentMessageSendRejection(status: number): StudentMessageSendRejection | null {
  if (status === 401) return "identity";
  if (status === 403 || status === 409) return "access";
  if (status === 400) return "input";
  if (status === 422) return "safety";
  if (status === 429) return "rate_limit";
  return null;
}

export async function sendStudentMessage(input: {
  recipientType: "teacher" | "guardian" | "self" | "pilot_duty";
  recipientUserId?: string;
  anonymous?: boolean;
  body: string;
  locale?: "zh-CN" | "en";
}, expectedUserId?: string) {
  const token = await getAccessToken(expectedUserId);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // The bounded write window starts only after fetch is actually dispatched.
    const request = fetch("/api/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new StudentMessageSendUnknownError());
        controller.abort();
      }, STUDENT_MESSAGE_SEND_TIMEOUT_MS);
    });
    const response = await Promise.race([request, deadline]);
    // Keep the same deadline active while the response body is consumed.
    const data = await Promise.race([
      response.json().catch(() => null) as Promise<Record<string, unknown> | null>,
      deadline,
    ]);
    if (!response.ok) {
      const rejection = studentMessageSendRejection(response.status);
      if (rejection) throw new StudentMessageSendRejectedError(rejection);
      throw new StudentMessageSendUnknownError();
    }
    if (!data) throw new StudentMessageSendUnknownError();
    return data as {
      safetyNotice?: boolean;
      dutyEscalated?: boolean;
      dutyAlertStatus?: "sent" | "failed" | "not_configured" | null;
    };
  } catch (error) {
    if (error instanceof StudentMessageSendRejectedError || error instanceof StudentMessageSendUnknownError) throw error;
    throw new StudentMessageSendUnknownError();
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function markStudentMessageRead(id: string, expectedUserId?: string) {
  const token = await getAccessToken(expectedUserId);
  const response = await fetch("/api/messages", {
    method: "PATCH", cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id }),
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true) throw new Error(data.error || "留言状态更新失败。");
}

async function communityRequest(path: string, init?: RequestInit, expectedUserId?: string) {
  const token = await getAccessToken(expectedUserId);
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
  locale?: "zh-CN" | "en";
}, expectedUserId?: string) {
  return communityRequest("/api/community/posts", {
    method: "POST",
    body: JSON.stringify(input),
  }, expectedUserId) as Promise<{ safetyNotice?: boolean }>;
}

export async function createCommunityComment(postId: string, body: string, locale?: "zh-CN" | "en", expectedUserId?: string) {
  return communityRequest("/api/community/comments", {
    method: "POST",
    body: JSON.stringify({ postId, body, locale }),
  }, expectedUserId) as Promise<{ safetyNotice?: boolean }>;
}

export async function deleteCommunityPost(postId: string, expectedUserId?: string) {
  return communityRequest("/api/community/posts", {
    method: "DELETE",
    body: JSON.stringify({ postId }),
  }, expectedUserId) as Promise<{ ok: boolean }>;
}

export async function deleteCommunityComment(commentId: string, expectedUserId?: string) {
  return communityRequest("/api/community/comments", {
    method: "DELETE",
    body: JSON.stringify({ commentId }),
  }, expectedUserId) as Promise<{ ok: boolean }>;
}

export async function reportCommunityContent(input: {
  postId?: string;
  commentId?: string;
  category: CommunityReportCategory;
  details?: string;
}, expectedUserId?: string) {
  return communityRequest("/api/community/reports", {
    method: "POST",
    body: JSON.stringify(input),
  }, expectedUserId) as Promise<{ ok: boolean; report: CommunityReport; notice: string }>;
}

export async function listCommunityReports() {
  return communityRequest("/api/community/reports") as Promise<{ reports: CommunityReport[] }>;
}

export async function listCommunityBlocks() {
  return communityRequest("/api/community/blocks") as Promise<{ blocks: CommunityBlock[] }>;
}

export async function blockCommunityMember(targetUserId: string, expectedUserId?: string) {
  return communityRequest("/api/community/blocks", {
    method: "POST",
    body: JSON.stringify({ targetUserId }),
  }, expectedUserId) as Promise<{ ok: boolean }>;
}

export async function unblockCommunityMember(targetUserId: string, expectedUserId?: string) {
  return communityRequest("/api/community/blocks", {
    method: "DELETE",
    body: JSON.stringify({ targetUserId }),
  }, expectedUserId) as Promise<{ ok: boolean }>;
}

export async function signOut(expectedUserId?: string) {
  await signOutSupabaseSession(expectedUserId);
}

export async function getProfile(user: User) {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, role: normalizeRole(data.role) } as CloudProfile;
}

export function buildProfileWritePayload(
  user: Pick<User, "id" | "email">,
  displayName: string,
  updatedAt = new Date().toISOString(),
) {
  return {
    id: user.id,
    email: user.email || null,
    display_name: displayName,
    updated_at: updatedAt,
  };
}

export function buildProfileUpdatePayload(
  displayName: string,
  updatedAt = new Date().toISOString(),
) {
  return {
    display_name: displayName,
    updated_at: updatedAt,
  };
}

export async function saveProfile(user: User, displayName: string, options?: AccountWriteOptions) {
  let dispatched = false;
  try {
  const supabase = getSupabase();
  if (!supabase) throw new Error("账号服务暂时不可用，请稍后再试。");
  const payload = buildProfileWritePayload(user, displayName);
  const updatePayload = buildProfileUpdatePayload(displayName, payload.updated_at);
  if (options && !options.current()) throw new AccountWriteError("not_dispatched", "identity");
  const request = supabase
    .from("profiles")
    .update(updatePayload)
    .eq("id", user.id)
    .select("*");
  if (options && !options.current()) throw new AccountWriteError("not_dispatched", "identity");
  dispatched = true;
  const updated = await request.maybeSingle();
  if (options && !options.current()) throw new AccountWriteError("unknown");
  if (updated.error) {
    if (options && updated.status === 403 && updated.error.code === "42501") throw new AccountWriteError("rejected", "permission");
    if (options && updated.status === 401 && updated.error.code === "PGRST301") throw new AccountWriteError("rejected", "identity");
    throw updated.error;
  }

  const created = updated.data
    ? null
    : await supabase.from("profiles").insert(payload).select("*").single();
  if (options && !options.current()) throw new AccountWriteError("unknown");
  if (created?.error) throw created.error;
  const data = updated.data || created?.data;
  if (!data) throw new Error("账号资料保存失败，请稍后再试。");
  if (options && (data.id !== user.id || data.display_name !== displayName)) throw new AccountWriteError("unknown");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("youthtempo:profile-updated"));
  }
  return { ...data, role: normalizeRole(data.role) } as CloudProfile;
  } catch (error) {
    if (!options || error instanceof AccountWriteError) throw error;
    throw new AccountWriteError(dispatched ? "unknown" : "not_dispatched");
  }
}

export async function listCloudSweetRecords(expectedUserId?: string) {
  const supabase = getSupabase();
  if (!supabase) return [];
  const user = await getCurrentUser();
  if (!user) return [];
  if (expectedUserId && user.id !== expectedUserId) throw new Error("账号已变化，请确认后再继续。");
  const { data, error } = await supabase
    .from("sweet_records")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return latestSweetRecordsPerUserDay((data || []) as CloudSweetRecord[]);
}

export type TempoGardenData = {
  canUseGarden?: boolean;
  managementReason?: "withdrawn" | "consent_unavailable" | "consent_required" | null;
  hasExistingData?: boolean;
  stage: "seed" | "sprout" | "leaves" | "bloom";
  sceneLevel: "base" | "settled" | "mature";
  total: number;
  thisWeek: number;
  thisMonth: number;
  quickCheckIns: number;
  fullSweetRecords: number;
  todayParticipated: boolean;
  unlockedPositions: GardenLayoutSlot[];
  unlockedItems: GardenItemKey[];
  reminderMode: "off" | "daily" | "weekly";
  canCareToday: boolean;
  canAddKeepsakeToday: boolean;
  todayCare: { date: string; action: GardenCareAction } | null;
  layout: Partial<Record<GardenLayoutSlot, GardenItemKey>>;
  keepsakes: Array<{ id: string; date: string; type: GardenKeepsakeType }>;
};

export class TempoGardenRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TempoGardenRequestError";
  }
}

async function gardenRequest<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  locale: Locale,
  body?: Record<string, unknown>,
  path = "/api/garden",
  expectedUserId?: string,
) {
  const token = await getAccessToken(expectedUserId);
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${path}${separator}locale=${encodeURIComponent(locale)}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify({ ...body, locale }) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new TempoGardenRequestError(data.error || "Garden unavailable.", response.status);
  return data as T;
}

export function getTempoGarden(locale: Locale, expectedUserId?: string) {
  return gardenRequest<TempoGardenData>("GET", locale, undefined, "/api/garden", expectedUserId);
}

export function saveTempoQuickCheckIn(feeling: "steady" | "mixed" | "heavy" | "unsure", locale: Locale, expectedUserId?: string) {
  return gardenRequest<{ checkIn: { id: string; created_at: string } }>("POST", locale, { feeling }, "/api/garden", expectedUserId);
}

export type GardenAuxiliaryReason = "offline" | "timeout" | "unavailable" | "identity" | "forbidden" | "limited" | "invalid" | "conflict";

export class GardenAuxiliaryError extends Error {
  constructor(readonly reason: GardenAuxiliaryReason, readonly outcome: "notSent" | "rejected" | "unknown") {
    super("Garden auxiliary request could not be confirmed.");
    this.name = "GardenAuxiliaryError";
  }
}

// Only auxiliary writes use this transport. No retry, provider text or response body errors.
async function gardenAuxiliaryRequest<T>(method: "POST" | "PATCH" | "PUT", locale: Locale,
  body: Record<string, unknown>, path: string, expectedUserId: string | undefined,
  valid: (data: T) => boolean, current?: () => boolean): Promise<T> {
  let token: string;
  let identityTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    token = await Promise.race([getAccessToken(expectedUserId), new Promise<never>((_, reject) => {
      identityTimeout = setTimeout(() => reject(new GardenAuxiliaryError("identity", "notSent")), 10_000);
    })]);
    if (current && !current()) throw new GardenAuxiliaryError("identity", "notSent");
  } catch {
    throw new GardenAuxiliaryError("identity", "notSent");
  } finally { clearTimeout(identityTimeout); }
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Race as well as abort: an uncooperative/late response must never settle the UI.
    const expired = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new GardenAuxiliaryError("timeout", "unknown")); }, 10_000);
    });
    return await Promise.race([expired, (async () => {
      const response = await fetch(`${path}?locale=${encodeURIComponent(locale)}`, {
        method, signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ ...body, locale }),
      });
      if (!response.ok) {
        // The API's shared catch can emit these statuses after a write attempt.
        // No response marker proves a pre-write rejection. Preserve identity
        // precautions, but do not infer input/limit causes or a failed write.
        const reason: GardenAuxiliaryReason = response.status === 401 ? "identity" : response.status === 403 ? "forbidden" : "unavailable";
        throw new GardenAuxiliaryError(reason, "unknown");
      }
      const data = await response.json() as T;
      if (!data || !valid(data)) throw new GardenAuxiliaryError("unavailable", "unknown");
      return data;
    })()]);
  } catch (caught) {
    if (caught instanceof GardenAuxiliaryError) throw caught;
    throw new GardenAuxiliaryError(controller.signal.aborted ? "timeout" : caught instanceof TypeError ? "offline" : "unavailable", "unknown");
  } finally { clearTimeout(timeout); }
}

function validGardenReplyDay(day: unknown): day is string {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && Number.isFinite(Date.parse(`${day}T00:00:00+08:00`));
}

export function saveTempoReminderPreference(
  reminderMode: TempoGardenData["reminderMode"],
  locale: Locale,
  expectedUserId?: string,
  current?: () => boolean,
) {
  return gardenAuxiliaryRequest<{ reminderMode: TempoGardenData["reminderMode"] }>("PATCH", locale, { reminderMode }, "/api/garden", expectedUserId,
    (data) => data.reminderMode === reminderMode, current);
}

export function saveGardenCare(action: GardenCareAction, locale: Locale, expectedUserId?: string, current?: () => boolean) {
  return gardenAuxiliaryRequest<{ care: { date: string; action: GardenCareAction }; created: boolean }>(
    "POST",
    locale,
    { action },
    "/api/garden/care",
    expectedUserId,
    (data) => typeof data.created === "boolean" && validGardenReplyDay(data.care?.date)
      && ["water", "sunlight", "invite_visitor"].includes(data.care?.action) && (!data.created || data.care.action === action),
    current,
  );
}

export function saveGardenLayout(slot: GardenLayoutSlot, itemKey: GardenItemKey, locale: Locale, expectedUserId?: string, current?: () => boolean) {
  return gardenAuxiliaryRequest<{ layoutItem: { slot: GardenLayoutSlot; itemKey: GardenItemKey } }>(
    "PUT",
    locale,
    { slot, itemKey },
    "/api/garden/layout",
    expectedUserId,
    (data) => data.layoutItem?.slot === slot && data.layoutItem?.itemKey === itemKey,
    current,
  );
}

export function saveGardenKeepsake(type: GardenKeepsakeType, locale: Locale, date?: string, expectedUserId?: string, current?: () => boolean) {
  return gardenAuxiliaryRequest<{ keepsake: TempoGardenData["keepsakes"][number]; created: boolean }>(
    "POST",
    locale,
    date ? { type, date } : { type },
    "/api/garden/keepsakes",
    expectedUserId,
    (data) => typeof data.created === "boolean" && typeof data.keepsake?.id === "string" && Boolean(data.keepsake.id)
      && validGardenReplyDay(data.keepsake.date) && ["flower", "stone", "lantern"].includes(data.keepsake.type)
      && (!data.created || data.keepsake.type === type),
    current,
  );
}

export function deleteGardenKeepsake(id: string, locale: Locale, expectedUserId?: string) {
  return gardenRequest<{ deleted: true; id: string }>(
    "DELETE",
    locale,
    undefined,
    `/api/garden/keepsakes/${encodeURIComponent(id)}`,
    expectedUserId,
  );
}

/** No mutation retry or expected-head refresh occurs in this transport. */
async function sweetProtocolRequest(method: "GET" | "POST", actor: string, options: {
  targetDay?: string; command?: SweetCommand; current?: () => boolean; onDispatch?: () => void;
} = {}): Promise<SweetReply> {
  const { parseSweetReply, SweetPersistenceError, sweetHttpStatus } = await import("@/lib/sweetPersistenceProtocol");
  const token = await getAccessToken(actor);
  if (options.current && !options.current()) throw new SweetPersistenceError("interrupted");
  const locale = typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "zh-CN";
  const params = new URLSearchParams({ locale });
  if (options.targetDay) params.set("targetDay", options.targetDay);
  let response: Response;
  let data: unknown;
  try {
    if (method === "POST") options.onDispatch?.();
    response = await fetch(`/api/sweet-records?${params}`, {
      method, cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(options.command ? { body: JSON.stringify({ ...options.command, locale }) } : {}),
    });
    data = await response.json();
  } catch {
    throw new SweetPersistenceError(method === "POST" ? "outcome_unknown" : "protocol_unavailable");
  }
  if (!response.ok) {
    const body = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const known = ["conflict", "scope_expired", "denied", "not_found", "invalid_request", "write_rejected"];
    // A partial or contradictory failure packet cannot settle a dispatched
    // write. The bridge's 401/400 gates explicitly reject before RPC dispatch.
    const status = String(body.status);
    const notCommitted = body.writeOutcome === "not_committed"
      && [...known, "protocol_unavailable"].includes(status) && response.status === sweetHttpStatus(status);
    const beforeDispatch = (response.status === 401 && status === "denied")
      || (response.status === 400 && status === "invalid_request");
    const code = known.includes(status) && (method === "GET" || notCommitted || beforeDispatch) ? body.status as SweetFailure
      : method === "POST" && !notCommitted ? "outcome_unknown" : "protocol_unavailable";
    throw new SweetPersistenceError(code);
  }
  const parsed = parseSweetReply(data, actor);
  if (!parsed || (method === "GET" ? parsed.status !== "ready" : parsed.status === "ready")) {
    throw new SweetPersistenceError(method === "POST" ? "outcome_unknown" : "protocol_unavailable");
  }
  return parsed;
}

export async function readCloudSweetScope(expectedUserId: string, targetDay?: string, current?: () => boolean): Promise<SweetScope> {
  return sweetProtocolRequest("GET", expectedUserId, { targetDay, current });
}

export type SweetSaveOptions = {
  scope: SweetScope;
  intent: Extract<SweetIntent, "preserve_summary" | "replace_summary" | "clear_summary">;
  current?: () => boolean;
};

export async function saveCloudSweetRecord(record: SweetRecordInput, expectedUserId?: string, options?: SweetSaveOptions) {
  const { SweetPersistenceError } = await import("@/lib/sweetPersistenceProtocol");
  // A caller must freeze its baseline before dispatch; this function never
  // acquires a newer token on behalf of an old asynchronous operation.
  if (!expectedUserId || !options) throw new SweetPersistenceError("invalid_request");
  const command: SweetCommand = {
    operationDay: options.scope.operationDay, targetDay: options.scope.targetDay,
    expectedHead: options.scope.headToken, intent: options.intent,
    record: options.intent === "replace_summary" ? record : { records: record.records },
  };
  const reply = await sweetProtocolRequest("POST", expectedUserId, { command, current: options.current });
  if (!reply.record) throw new SweetPersistenceError("outcome_unknown");
  return reply.record;
}

export async function deleteCloudSweetRecord(recordId: string, expectedUserId?: string, current?: () => boolean, options?: AccountWriteOptions) {
  let dispatched = false;
  try {
  const { SweetPersistenceError, sweetStoredDay } = await import("@/lib/sweetPersistenceProtocol");
  const supabase = getSupabase();
  if (!supabase) throw new SweetPersistenceError("protocol_unavailable");
  const user = await getCurrentUser();
  if (!user) throw new Error("请先登录，再删除记录。");
  if (expectedUserId && user.id !== expectedUserId) throw new Error("账号已变化，请确认后再继续。");
  const actor = expectedUserId || user.id;
  if (current && !current()) throw new SweetPersistenceError("interrupted");
  // Freeze the operation day before the target lookup can be delayed. The
  // target may be historical; its date never supplies today's operation day.
  const operationScope = await readCloudSweetScope(actor, undefined, current);
  if (current && !current()) throw new SweetPersistenceError("interrupted");
  const { data: target, error } = await supabase.from("sweet_records")
    .select("id,user_id,created_at").eq("id", recordId).eq("user_id", actor).maybeSingle();
  if (error) throw error;
  if (current && !current()) throw new SweetPersistenceError("interrupted");
  if (!target) throw new SweetPersistenceError("not_found");
  // This is the persisted target instant, never a client clock deciding today.
  const targetDay = sweetStoredDay(target.created_at);
  if (!targetDay) throw new SweetPersistenceError("protocol_unavailable");
  const scope = targetDay === operationScope.targetDay ? operationScope : await readCloudSweetScope(actor, targetDay, current);
  if (scope.operationDay !== operationScope.operationDay) throw new SweetPersistenceError("scope_expired");
  await sweetProtocolRequest("POST", actor, { current, onDispatch: () => { dispatched = true; }, command: {
    operationDay: operationScope.operationDay, targetDay: scope.targetDay, expectedHead: scope.headToken,
    intent: "delete_day", recordId,
  } });
  } catch (error) {
    if (!options) throw error;
    const code = error instanceof AccountSweetPersistenceError ? error.code : null;
    const reason: AccountWriteReason = code === "denied" ? "permission"
      : code === "conflict" || code === "scope_expired" ? "scope"
        : code === "invalid_request" || code === "write_rejected" ? "input" : code === "not_found" ? "not_found" : "service";
    throw new AccountWriteError(!dispatched ? "not_dispatched"
      : code && code !== "outcome_unknown" && code !== "interrupted" ? "rejected" : "unknown", reason);
  }
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
  if (!supabase) throw new Error("账号服务暂时不可用，请稍后再试。");
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

export async function listWechatIdentities(expectedUserId?: string) {
  const supabase = getSupabase();
  if (!supabase) return [];
  if (expectedUserId) await getAccessToken(expectedUserId);
  let query = supabase
    .from("wechat_identities")
    .select("id,user_id,created_at,updated_at")
    .order("created_at", { ascending: false });
  if (expectedUserId) query = query.eq("user_id", expectedUserId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as WechatIdentity[];
}

export async function createWechatBindSession(expectedUserId?: string) {
  const token = await getAccessToken(expectedUserId);
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

export async function checkWechatBindSession(scene: string, expectedUserId?: string) {
  const token = await getAccessToken(expectedUserId);
  const response = await fetch(`/api/wechat/check-bind-session?scene=${encodeURIComponent(scene)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "微信绑定状态检查失败。");
  return data as { status: "pending" | "confirmed" | "expired"; bound: boolean; confirmedAt?: string | null };
}
