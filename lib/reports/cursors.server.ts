import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import nodeProcess from "node:process";
import { parseReportInstant } from "./source";
import { ReportApiError } from "./http";

// Local integration only. Hot reload retains the process key; process restart
// deliberately invalidates cursors rather than persisting youth report state.
// Next development route bundles may use different VM globals. The native
// process object is shared across those bundles, so one route can validate a
// cursor issued by another without a file, database row or configured secret.
const processKey = Symbol.for("youthtempo.school-report-cursor-key.v2");
const processState = nodeProcess as unknown as Record<symbol, Buffer | undefined>;
if (!processState[processKey]) Object.defineProperty(nodeProcess, processKey, { value: randomBytes(32) });
const key = processState[processKey]!;
const associatedData = Buffer.from("youthtempo-school-reports-v2");
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export type ReportViewContext = {
  enrollmentId: string; studentId: string; actorId: string; asOf: string;
  sourceRevision: number; recipientEpoch: number; detailRevision: number; expiresAt: string;
};
export type ReportPosition = { beforeBin?: string; phase?: "dated" | "undated"; beforeDate?: string; afterId?: string | null };
export type AccessPosition = {
  section: "received" | "recipients"; afterId: string; enrollmentId?: string; recipientEpoch?: number;
};
type ViewToken = { kind: "view" | "trend" | "details"; actorId: string; context: ReportViewContext; position?: ReportPosition; until: number };
type AccessToken = { kind: "access"; actorId: string; position: AccessPosition; until: number };
type Token = ViewToken | AccessToken;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, allowed: string[]) { return Object.keys(value).every((name) => allowed.includes(name)); }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function id(value: unknown): value is string { return typeof value === "string" && uuid.test(value); }

export function validReportViewContext(value: unknown): value is ReportViewContext {
  return object(value) && exact(value, ["enrollmentId", "studentId", "actorId", "asOf", "sourceRevision", "recipientEpoch", "detailRevision", "expiresAt"])
    && id(value.enrollmentId) && id(value.studentId) && id(value.actorId)
    && parseReportInstant(value.asOf) !== null && parseReportInstant(value.expiresAt) !== null
    && integer(value.sourceRevision) && integer(value.recipientEpoch) && integer(value.detailRevision);
}

function encrypt(payload: Token) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(associatedData);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return `1.${Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64url")}`;
}
export function sealReportView(context: ReportViewContext, kind: ViewToken["kind"] = "view", position?: ReportPosition) {
  if (!validReportViewContext(context)) throw new ReportApiError(503, "temporarily_unavailable");
  return encrypt({ kind, actorId: context.actorId, context, ...(position ? { position } : {}),
    until: Math.min(Date.now() + 300_000, Math.floor(parseReportInstant(context.expiresAt)! / 1000)) });
}
export function sealReportAccess(actorId: string, position: AccessPosition) {
  return encrypt({ kind: "access", actorId, position, until: Date.now() + 300_000 });
}
export function opaqueReportEntryKey(context: ReportViewContext, sourceKey: string) {
  return createHmac("sha256", key).update(`entry\0${context.actorId}\0${context.enrollmentId}\0${sourceKey}`).digest("base64url");
}
export function openReportToken(raw: unknown, actorId: string, kind: Token["kind"]): Token {
  const invalid = () => new ReportApiError(409, "refresh_required");
  if (typeof raw !== "string" || raw.length > 2800 || !/^1\.[A-Za-z0-9_-]+$/.test(raw)) throw invalid();
  try {
    const bytes = Buffer.from(raw.slice(2), "base64url");
    if (bytes.length < 30) throw invalid();
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    cipher.setAAD(associatedData);
    cipher.setAuthTag(bytes.subarray(12, 28));
    const value: unknown = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8"));
    if (!object(value) || !exact(value, ["kind", "actorId", "context", "position", "until"])
      || value.kind !== kind || value.actorId !== actorId || !integer(value.until) || value.until <= Date.now()
      || value.until > Date.now() + 301_000) throw invalid();
    if (kind === "access") {
      const position = value.position;
      if (!object(position) || !exact(position, ["section", "afterId", "enrollmentId", "recipientEpoch"])
        || !["received", "recipients"].includes(String(position.section)) || !id(position.afterId)
        || (position.section === "recipients" && (!id(position.enrollmentId) || !integer(position.recipientEpoch)))) throw invalid();
    } else {
      if (!validReportViewContext(value.context) || value.context.actorId !== actorId) throw invalid();
      const position = value.position;
      if (position !== undefined && (!object(position) || !exact(position, ["beforeBin", "phase", "beforeDate", "afterId"])
        || (position.beforeBin !== undefined && parseReportInstant(position.beforeBin) === null)
        || (position.phase !== undefined && !["dated", "undated"].includes(String(position.phase)))
        || (position.beforeDate !== undefined && (typeof position.beforeDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(position.beforeDate)))
        || (position.afterId !== undefined && position.afterId !== null && !id(position.afterId)))) throw invalid();
    }
    return value as Token;
  } catch { throw invalid(); }
}

export function openReportView(raw: unknown, actorId: string, kind: ViewToken["kind"]) {
  return openReportToken(raw, actorId, kind) as ViewToken;
}
export function openReportAccess(raw: unknown, actorId: string) {
  return openReportToken(raw, actorId, "access") as AccessToken;
}
