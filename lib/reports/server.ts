import {
  schoolReportAccessVersion, schoolReportDetailPolicyVersion,
  type SchoolReportAccess, type SchoolReportDetailCommand, type SchoolReportDetailSettingResponse,
  type SchoolReportEntry, type SchoolReportOwner, type SchoolReportRecipient,
} from "./accessTypes";
import type { SchoolReportDetails, SchoolReportTrend } from "./comprehensiveTypes";
import { isSchoolReportDetails, isSchoolReportTrend } from "./comprehensiveValidation";
import {
  openReportAccess, openReportView, opaqueReportEntryKey, sealReportAccess, sealReportView,
  validReportViewContext, type ReportPosition, type ReportViewContext,
} from "./cursors.server";
import { ReportApiError, reportEnrollmentId, type ReportContext } from "./http";
import { parseReportInstant } from "./source";
export { requireReportContext, sendReportError, reportEnrollmentId } from "./http";

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const maximumListRows = 30;
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) { return Object.keys(value).every((key) => allowed.includes(key)); }
function id(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value); }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function malformed(): never { throw new ReportApiError(503, "temporarily_unavailable"); }
function badInput(): never { throw new ReportApiError(400, "invalid_request"); }
function instant(value: unknown): value is string { return typeof value === "string" && parseReportInstant(value) !== null; }

async function rpc(context: ReportContext, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await context.supabase.rpc(name, { p_actor_user_id: context.userId, ...args });
  if (error) {
    console.error(JSON.stringify({ event: "school_report_rpc_failed", operation: name,
      code: typeof error.code === "string" && /^[A-Z0-9]{5,12}$/.test(error.code) ? error.code : "unavailable" }));
    malformed();
  }
  if (!object(data)) malformed();
  if (data.status === "denied" || data.status === "expired") throw new ReportApiError(403, "access_denied");
  if (data.status === "refresh_required" || data.status === "source_changed") throw new ReportApiError(409, "refresh_required");
  if (data.status === "stale_setting") throw new ReportApiError(409, "stale_setting");
  if (data.status !== "ready") malformed();
  return data;
}
function entry(value: unknown): SchoolReportEntry {
  if (!object(value) || !id(value.enrollmentId) || typeof value.displayName !== "string" || [...value.displayName].length > 160
    || !instant(value.effectiveAt) || !instant(value.expiresAt) || parseReportInstant(value.expiresAt)! <= parseReportInstant(value.effectiveAt)!) malformed();
  return { enrollmentId: value.enrollmentId, displayName: value.displayName, effectiveAt: value.effectiveAt, expiresAt: value.expiresAt };
}
function recipient(value: unknown): SchoolReportRecipient {
  if (!object(value) || !keys(value, ["id", "displayName", "type"]) || !id(value.id) || value.type !== "teacher"
    || typeof value.displayName !== "string" || [...value.displayName].length > 160) malformed();
  return { id: value.id, displayName: value.displayName, type: "teacher" };
}
export async function loadReportAccess(context: ReportContext, rawCursor?: unknown): Promise<SchoolReportAccess> {
  const cursor = rawCursor === undefined ? null : openReportAccess(rawCursor, context.userId);
  const value = await rpc(context, "read_school_report_access", {
    p_after_id: cursor?.position.afterId ?? null, p_limit: maximumListRows,
    p_section: cursor?.position.section ?? "received", p_enrollment_id: cursor?.position.enrollmentId ?? null,
    p_expected_recipient_epoch: cursor?.position.recipientEpoch ?? null,
  });
  if (!keys(value, ["status", "version", "viewerRole", "eligibility", "owner", "received", "nextAfterId", "recipientNextAfterId"])
    || value.version !== schoolReportAccessVersion || !["student", "teacher", "unavailable"].includes(String(value.viewerRole))
    || !["enrolled", "not_enrolled", "expired", "not_available"].includes(String(value.eligibility))
    || !Array.isArray(value.received) || value.received.length > maximumListRows
    || (value.nextAfterId !== null && !id(value.nextAfterId))
    || (value.recipientNextAfterId !== null && !id(value.recipientNextAfterId))) malformed();
  const received = value.received.map((item) => {
    if (!object(item) || !keys(item, ["enrollmentId", "displayName", "effectiveAt", "expiresAt"])) malformed();
    return entry(item);
  });
  if (new Set(received.map((item) => item.enrollmentId)).size !== received.length) malformed();
  let owner: SchoolReportOwner | null = null;
  if (value.owner !== null) {
    const candidate = value.owner;
    if (!object(candidate) || !keys(candidate, ["enrollmentId", "displayName", "effectiveAt", "expiresAt", "status", "detailsEnabled", "detailRevision", "recipientEpoch", "recipients"])
      || !["active", "expired", "withdrawn", "invalidated"].includes(String(candidate.status)) || typeof candidate.detailsEnabled !== "boolean"
      || !integer(candidate.detailRevision) || !integer(candidate.recipientEpoch) || !Array.isArray(candidate.recipients)
      || candidate.recipients.length > maximumListRows || value.viewerRole !== "student") malformed();
    const recipients = candidate.recipients.map(recipient);
    if (new Set(recipients.map((item) => item.id)).size !== recipients.length) malformed();
    owner = { ...entry(candidate), status: candidate.status as SchoolReportOwner["status"], detailsEnabled: candidate.detailsEnabled,
      detailRevision: candidate.detailRevision, recipientEpoch: candidate.recipientEpoch, recipients,
      recipientNextCursor: value.recipientNextAfterId ? sealReportAccess(context.userId, {
        section: "recipients", afterId: value.recipientNextAfterId, enrollmentId: candidate.enrollmentId as string, recipientEpoch: candidate.recipientEpoch,
      }) : null };
  } else if (value.recipientNextAfterId !== null) malformed();
  if (value.viewerRole !== "teacher" && received.length) malformed();
  return { version: schoolReportAccessVersion, viewerRole: value.viewerRole as SchoolReportAccess["viewerRole"],
    eligibility: value.eligibility as SchoolReportAccess["eligibility"], owner, received,
    nextCursor: value.nextAfterId ? sealReportAccess(context.userId, { section: "received", afterId: value.nextAfterId }) : null };
}

function sameContext(a: ReportViewContext, b: ReportViewContext) {
  return a.enrollmentId === b.enrollmentId && a.studentId === b.studentId && a.actorId === b.actorId
    && a.sourceRevision === b.sourceRevision && a.recipientEpoch === b.recipientEpoch && a.detailRevision === b.detailRevision
    && parseReportInstant(a.asOf) === parseReportInstant(b.asOf) && parseReportInstant(a.expiresAt) === parseReportInstant(b.expiresAt);
}
async function revalidate(context: ReportContext, view: ReportViewContext, mode: "trend" | "detail") {
  if (view.actorId !== context.userId) throw new ReportApiError(403, "access_denied");
  const result = await rpc(context, "validate_school_report_view", {
    p_enrollment_id: view.enrollmentId, p_mode: mode, p_student_id: view.studentId, p_as_of: view.asOf,
    p_source_revision: view.sourceRevision, p_recipient_epoch: view.recipientEpoch, p_detail_revision: view.detailRevision, p_expires_at: view.expiresAt,
  });
  if (!validReportViewContext(result.context) || !sameContext(view, result.context) || typeof result.detailsEnabled !== "boolean") malformed();
  if (mode === "detail" && view.actorId !== view.studentId && result.detailsEnabled !== true) throw new ReportApiError(403, "access_denied");
  return result.detailsEnabled;
}
function viewFromResult(value: Record<string, unknown>, context: ReportContext, enrollmentId: string): ReportViewContext {
  if (!keys(value, ["status", "report", "context"]) || !validReportViewContext(value.context)
    || value.context.actorId !== context.userId || value.context.enrollmentId !== enrollmentId || !object(value.report)
    || parseReportInstant(value.report.asOf) !== parseReportInstant(value.context.asOf)) malformed();
  return value.context;
}
export async function readCurrentReport(context: ReportContext, enrollmentId: string, rawCursor?: unknown): Promise<SchoolReportTrend> {
  const cursor = rawCursor === undefined ? null : openReportView(rawCursor, context.userId, "trend");
  if (cursor && cursor.context.enrollmentId !== enrollmentId) throw new ReportApiError(403, "access_denied");
  if (cursor) await revalidate(context, cursor.context, "trend");
  const value = await rpc(context, "read_school_report_trend", {
    p_enrollment_id: enrollmentId, p_as_of: cursor?.context.asOf ?? null, p_before_bin: cursor?.position?.beforeBin ?? null,
  });
  const view = viewFromResult(value, context, enrollmentId);
  if (cursor && !sameContext(cursor.context, view)) throw new ReportApiError(409, "refresh_required");
  const report = value.report as Record<string, unknown>;
  if (!object(report.longTerm) || !keys(report.longTerm, ["unit", "bins", "hasMore", "nextBinStart"])
    || typeof report.longTerm.hasMore !== "boolean"
    || (report.longTerm.hasMore ? !instant(report.longTerm.nextBinStart) : report.longTerm.nextBinStart !== null)) malformed();
  const { hasMore, nextBinStart, ...longTerm } = report.longTerm;
  const result: unknown = { ...report, viewToken: sealReportView(view), longTerm: { ...longTerm,
    nextCursor: hasMore ? sealReportView(view, "trend", { beforeBin: nextBinStart as string }) : null } };
  if (!isSchoolReportTrend(result)) {
    console.error(JSON.stringify({ event: "school_report_contract_rejected", operation: "trend" }));
    malformed();
  }
  await revalidate(context, view, "trend");
  return result;
}
export async function readReportDetails(context: ReportContext, enrollmentId: string, rawView: unknown, rawCursor?: unknown): Promise<SchoolReportDetails> {
  const current = openReportView(rawView, context.userId, "view");
  const cursor = rawCursor === undefined || rawCursor === null ? null : openReportView(rawCursor, context.userId, "details");
  if (current.context.enrollmentId !== enrollmentId || (cursor && !sameContext(cursor.context, current.context))) throw new ReportApiError(409, "refresh_required");
  await revalidate(context, current.context, "detail");
  const position = cursor?.position;
  const value = await rpc(context, "read_school_report_details", {
    p_enrollment_id: enrollmentId, p_as_of: current.context.asOf, p_phase: position?.phase ?? "dated",
    p_before_day: position?.beforeDate ?? null, p_before_id: position?.afterId ?? null, p_limit: 25,
  });
  const view = viewFromResult(value, context, enrollmentId);
  if (!sameContext(current.context, view)) throw new ReportApiError(409, "refresh_required");
  const report = value.report as Record<string, unknown>;
  if (!keys(report, ["version", "asOf", "items", "hasMore", "nextPosition"]) || !Array.isArray(report.items) || report.items.length > 25
    || typeof report.hasMore !== "boolean") malformed();
  let next: ReportPosition | undefined;
  if (report.hasMore) {
    const position = report.nextPosition;
    if (!object(position) || !keys(position, ["phase", "beforeDate", "afterId"])) malformed();
    if (position.phase === "dated" && typeof position.beforeDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(position.beforeDate)) {
      next = { phase: "dated", beforeDate: position.beforeDate };
    } else if (position.phase === "undated" && (position.afterId === null || id(position.afterId))) {
      next = { phase: "undated", afterId: position.afterId as string | null };
    } else malformed();
  } else if (report.nextPosition !== null) malformed();
  const items = report.items.map((item) => {
    if (!object(item) || typeof item.key !== "string" || item.key.length > 100) malformed();
    return { ...item, key: opaqueReportEntryKey(view, item.key) };
  });
  const result: unknown = { version: report.version, asOf: report.asOf, viewToken: sealReportView(view), items,
    nextCursor: next ? sealReportView(view, "details", next) : null };
  if (!isSchoolReportDetails(result)) malformed();
  await revalidate(context, view, "detail");
  return result;
}
export function reportDetailCommand(value: unknown): SchoolReportDetailCommand {
  if (!object(value) || !id(value.enrollmentId) || !id(value.requestId) || typeof value.enabled !== "boolean") badInput();
  const common = { enrollmentId: value.enrollmentId.toLowerCase(), requestId: value.requestId.toLowerCase() };
  if (value.enabled === false) {
    if (!keys(value, ["enrollmentId", "requestId", "enabled", "locale"])) badInput();
    return { ...common, enabled: false };
  }
  if (!keys(value, ["enrollmentId", "requestId", "enabled", "locale", "expectedDetailRevision", "expectedRecipientEpoch", "policyVersion", "confirmed"])
    || !integer(value.expectedDetailRevision) || !integer(value.expectedRecipientEpoch)
    || value.policyVersion !== schoolReportDetailPolicyVersion || value.confirmed !== true) badInput();
  return { ...common, enabled: true, expectedDetailRevision: value.expectedDetailRevision,
    expectedRecipientEpoch: value.expectedRecipientEpoch, policyVersion: schoolReportDetailPolicyVersion, confirmed: true };
}
export async function setReportDetails(context: ReportContext, command: SchoolReportDetailCommand): Promise<SchoolReportDetailSettingResponse> {
  const result = await rpc(context, "set_school_report_details", {
    p_enrollment_id: command.enrollmentId, p_enabled: command.enabled, p_request_id: command.requestId,
    p_expected_detail_revision: command.enabled ? command.expectedDetailRevision : null,
    p_expected_recipient_epoch: command.enabled ? command.expectedRecipientEpoch : null,
    p_notice_version: command.enabled ? command.policyVersion : null, p_confirmed: command.enabled,
  });
  if (!keys(result, ["status", "enabled", "detailRevision", "recipientEpoch", "replayed"]) || typeof result.enabled !== "boolean"
    || !integer(result.detailRevision) || !integer(result.recipientEpoch) || typeof result.replayed !== "boolean") malformed();
  return { enabled: result.enabled, detailRevision: result.detailRevision, recipientEpoch: result.recipientEpoch, replayed: result.replayed };
}
export async function validateReport(context: ReportContext, enrollmentId: string, rawView: unknown) {
  const token = openReportView(rawView, context.userId, "view");
  if (token.context.enrollmentId !== enrollmentId) throw new ReportApiError(403, "access_denied");
  const detailsEnabled = await revalidate(context, token.context, "trend");
  return { valid: true, detailsEnabled };
}
export async function exitReportEnrollment(context: ReportContext, input: unknown) {
  if (!object(input) || !keys(input, ["enrollmentId", "requestId", "confirmed", "locale"]) || input.confirmed !== true || !id(input.requestId)) badInput();
  const enrollmentId = reportEnrollmentId(input.enrollmentId);
  const access = await loadReportAccess(context);
  if (access.owner?.enrollmentId !== enrollmentId) throw new ReportApiError(403, "access_denied");
  const result = await rpc(context, "end_school_report_enrollment", { p_enrollment_id: enrollmentId, p_request_id: input.requestId });
  if (result.ended !== true) malformed();
  return { ended: true };
}
