import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const deletionReceiptLifetimeMs = 24 * 60 * 60 * 1000;
export type DeletionReceipt = { operationId: string; secret: string };
export type DeletionReceiptState = "not_deleted" | "deleted_cleanup_pending" | "completed" | "unknown";
export type AuthAccountState = "present" | "absent" | "unknown";
type ReceiptMetadata = { version: 1; secretHash: string; expiresAt: string; attemptId: string; leaseUntil: string };
type AuditRow = { id: string; subject_hash: string; email_hash: string; status: string; completed_at: string | null; deletion_summary: unknown };

const operationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const subjectPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function accountDeletionHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function parseDeletionReceipt(value: unknown): DeletionReceipt | null {
  if (!object(value) || typeof value.operationId !== "string" || !operationPattern.test(value.operationId)
    || typeof value.secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.secret)) return null;
  const bytes = Buffer.from(value.secret, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value.secret) return null;
  return { operationId: value.operationId.toLowerCase(), secret: value.secret };
}
export function isDeletionSubject(value: unknown): value is string { return typeof value === "string" && subjectPattern.test(value); }
function metadata(summary: unknown): ReceiptMetadata | null {
  if (!object(summary) || !object(summary.receipt)) return null;
  const value = summary.receipt;
  if (value.version !== 1 || typeof value.secretHash !== "string" || !/^[a-f0-9]{64}$/.test(value.secretHash)
    || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) return null;
  return { version: 1, secretHash: value.secretHash, expiresAt: value.expiresAt,
    attemptId: typeof value.attemptId === "string" ? value.attemptId : "",
    leaseUntil: typeof value.leaseUntil === "string" ? value.leaseUntil : "" };
}
function matches(row: AuditRow, subject: string, receipt: DeletionReceipt, now: number) {
  const stored = metadata(row.deletion_summary);
  return row.subject_hash === accountDeletionHash(subject) && stored !== null && Date.parse(stored.expiresAt) > now
    && timingSafeEqual(Buffer.from(stored.secretHash, "hex"), Buffer.from(accountDeletionHash(receipt.secret), "hex"));
}
export class DeletionReceiptConflict extends Error {
  constructor() { super("deletion_receipt_conflict"); this.name = "DeletionReceiptConflict"; }
}
export class DeletionAttemptBusy extends Error {
  constructor(public retryAfter: number) { super("deletion_attempt_busy"); this.name = "DeletionAttemptBusy"; }
}
export type DeletionAuditAttempt = { id: string; attemptId: string | null; summary: Record<string, unknown> };
export async function prepareDeletionAudit(supabase: SupabaseClient, input: {
  userId: string; email: string; role: string; counts: Record<string, number>; receipt: DeletionReceipt | null;
}, now = Date.now()): Promise<DeletionAuditAttempt> {
  const receipt = input.receipt;
  const attemptId = randomUUID();
  const summary = receipt ? { ...input.counts, receipt: { version: 1, secretHash: accountDeletionHash(receipt.secret),
    expiresAt: new Date(now + deletionReceiptLifetimeMs).toISOString(), attemptId, leaseUntil: new Date(now + 30_000).toISOString() } } : input.counts;
  const payload = { ...(receipt ? { id: receipt.operationId } : {}), subject_hash: accountDeletionHash(input.userId),
    email_hash: accountDeletionHash(input.email), account_role: input.role, deletion_summary: summary,
    status: "cleanup_required", completed_at: null };
  const { data, error } = await supabase.from("account_deletion_audits").insert(payload).select("id").single();
  if (!error && data?.id) return { id: data.id as string, attemptId: receipt ? attemptId : null, summary };
  if (!receipt || error?.code !== "23505") throw new Error("deletion_audit_unavailable");
  const prior = await supabase.from("account_deletion_audits").select("id,subject_hash,email_hash,status,completed_at,deletion_summary")
    .eq("id", receipt.operationId).maybeSingle();
  if (prior.error) throw new Error("deletion_audit_unavailable");
  const row = prior.data as AuditRow | null;
  if (!row || row.email_hash !== payload.email_hash || !matches(row, input.userId, receipt, now)) throw new DeletionReceiptConflict();
  if (row.status === "completed") throw new DeletionReceiptConflict();
  const stored = metadata(row.deletion_summary)!;
  const remaining = Math.ceil((Date.parse(stored.leaseUntil) - now) / 1000);
  if (remaining > 0) throw new DeletionAttemptBusy(remaining);
  if (!stored.attemptId || !Number.isFinite(Date.parse(stored.leaseUntil))) throw new DeletionReceiptConflict();
  const nextSummary = { ...(row.deletion_summary as Record<string, unknown>), receipt: { ...stored, attemptId, leaseUntil: new Date(now + 30_000).toISOString() } };
  const claimed = await supabase.from("account_deletion_audits").update({ deletion_summary: nextSummary })
    .eq("id", row.id).eq("status", "cleanup_required")
    .eq("deletion_summary->receipt->>attemptId", stored.attemptId)
    .eq("deletion_summary->receipt->>leaseUntil", stored.leaseUntil).select("id").maybeSingle();
  if (claimed.error) throw new Error("deletion_audit_unavailable");
  if (!claimed.data) throw new DeletionAttemptBusy(30);
  return { id: row.id, attemptId, summary: nextSummary };
}

export async function completeDeletionAudit(supabase: SupabaseClient, audit: DeletionAuditAttempt) {
  let query = supabase.from("account_deletion_audits").update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", audit.id).eq("status", "cleanup_required");
  if (audit.attemptId) query = query.eq("deletion_summary->receipt->>attemptId", audit.attemptId);
  const result = await query.select("id").maybeSingle();
  return !result.error && Boolean(result.data);
}

export function receiptRetryAfter(summary: unknown, now = Date.now()) {
  const lease = metadata(summary)?.leaseUntil;
  return lease && Number.isFinite(Date.parse(lease)) ? Math.max(0, Math.min(30, Math.ceil((Date.parse(lease) - now) / 1000))) : 0;
}

export async function authAccountState(supabase: SupabaseClient, subject: string): Promise<AuthAccountState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      supabase.auth.admin.getUserById(subject),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 8_000); }),
    ]);
    if (!result) return "unknown";
    if (!result.error && result.data.user?.id === subject) return "present";
    if (result.error?.status === 404 && result.error.code === "user_not_found") return "absent";
    return "unknown";
  } catch { return "unknown"; }
  finally { if (timer) clearTimeout(timer); }
}

export async function readDeletionReceiptState(supabase: SupabaseClient, subject: string, receipt: DeletionReceipt, now = Date.now()): Promise<{ state: DeletionReceiptState; retryAfter?: number }> {
  const { data, error } = await supabase.from("account_deletion_audits").select("id,subject_hash,email_hash,status,completed_at,deletion_summary")
    .eq("id", receipt.operationId).abortSignal(AbortSignal.timeout(2_000)).maybeSingle();
  if (error || !data || !matches(data as AuditRow, subject, receipt, now)) return { state: "unknown" };
  const account = await authAccountState(supabase, subject);
  if (account === "present") return { state: "not_deleted", retryAfter: receiptRetryAfter((data as AuditRow).deletion_summary, now) };
  if (account === "unknown") return { state: "unknown" };
  const row = data as AuditRow;
  return { state: row.status === "completed" && row.completed_at && Number.isFinite(Date.parse(row.completed_at)) ? "completed" : "deleted_cleanup_pending" };
}
