import type { NextApiRequest, NextApiResponse } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeLocale, type Locale } from "@/lib/i18n/config";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { getServerTranslator } from "@/lib/i18n/server";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { isReportsLocalIntegrationEnabled } from "./availability";

type ReportErrorCode = "invalid_request" | "sign_in_required" | "access_denied" | "unavailable" | "refresh_required" | "stale_setting" | "temporarily_unavailable";
type Translator = ReturnType<typeof getServerTranslator>;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export class ReportApiError extends Error {
  constructor(public readonly statusCode: number, public readonly key: ReportErrorCode) { super("Report request unavailable"); }
}

export type ReportContext = { userId: string; locale: Locale; supabase: SupabaseClient };

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function uuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value); }

export function reportRequestLocale(req: NextApiRequest): Locale {
  return normalizeLocale(typeof req.body?.locale === "string" ? req.body.locale
    : typeof req.query.locale === "string" ? req.query.locale : req.cookies?.NEXT_LOCALE);
}

export function setReportHeaders(res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Vary", "Authorization, Origin");
}

function translatedError(res: NextApiResponse, t: Translator, status: number, key: ReportErrorCode) {
  return res.status(status).json({ error: t(`reportsV2.errors.${key}` as TranslationKey), code: key });
}

export function sendReportError(req: NextApiRequest, res: NextApiResponse, error: unknown, operation: string) {
  setReportHeaders(res);
  const known = error instanceof ReportApiError;
  const status = known ? error.statusCode : 503;
  if (status >= 500) {
    // Fixed operational metadata only. This local integration does not send an
    // external monitoring notification or log provider errors/request contents.
    console.error(JSON.stringify({ event: "reports_operation_failed", operation, statusCode: status }));
  }
  return translatedError(res, getServerTranslator(reportRequestLocale(req)), status, known ? error.key : "temporarily_unavailable");
}

function validateLocale(value: unknown) {
  if (value !== undefined && value !== "zh-CN" && value !== "en") throw new ReportApiError(400, "invalid_request");
}

async function hydrateReportBody(req: NextApiRequest) {
  // Parsing is intentionally inside the guarded handler. Next's built-in parser
  // would otherwise return malformed/oversize errors before no-store headers and
  // before the production/loopback gate. Already parsed unit-test inputs still
  // pass through the same shape and byte-limit validation below.
  if (req.body !== undefined || typeof req.on !== "function" || req.readableEnded) return;
  const length = req.headers["content-length"];
  if (length !== undefined && (typeof length !== "string" || !/^\d+$/.test(length) || Number(length) > 4096)) {
    req.once("error", () => {});
    req.resume();
    throw new ReportApiError(400, "invalid_request");
  }
  const raw = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onFailure);
      req.removeListener("aborted", onFailure);
    };
    const fail = () => {
      if (finished) return;
      finished = true;
      cleanup();
      chunks.length = 0;
      // An aborted IncomingMessage may emit its error after the aborted event.
      // Consume it while draining, without retaining or logging body data.
      req.once("error", () => {});
      req.resume();
      reject(new ReportApiError(400, "invalid_request"));
    };
    const onFailure = () => fail();
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 4096) { fail(); return; }
      chunks.push(buffer);
    };
    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onFailure);
    req.on("aborted", onFailure);
    timer = setTimeout(fail, 5_000);
    timer.unref?.();
  });
  if (!raw) return;
  if (typeof req.headers["content-type"] !== "string" || !/^application\/json(?:\s*;.*)?$/i.test(req.headers["content-type"])) {
    throw new ReportApiError(400, "invalid_request");
  }
  try { req.body = JSON.parse(raw); } catch { throw new ReportApiError(400, "invalid_request"); }
}

function jsonBody(req: NextApiRequest, allowed: readonly string[], required: boolean) {
  if (req.body === undefined || req.body === null) {
    if (required) throw new ReportApiError(400, "invalid_request");
    return;
  }
  if (!object(req.body) || !keys(req.body, allowed)) throw new ReportApiError(400, "invalid_request");
  const contentType = req.headers["content-type"];
  if (contentType !== undefined && (typeof contentType !== "string" || !/^application\/json(?:\s*;.*)?$/i.test(contentType))) {
    throw new ReportApiError(400, "invalid_request");
  }
  let serialized: string;
  try { serialized = JSON.stringify(req.body); } catch { throw new ReportApiError(400, "invalid_request"); }
  let bytes = 0;
  for (const character of serialized) {
    const point = character.codePointAt(0) || 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes > 4096) throw new ReportApiError(400, "invalid_request");
  }
  validateLocale(req.body.locale);
}

function validateOrigin(req: NextApiRequest) {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  const host = req.headers.host;
  if (typeof origin !== "string" || typeof host !== "string") throw new ReportApiError(403, "access_denied");
  try {
    const expected = new URL(`http://${host}`);
    const supplied = new URL(origin);
    if (expected.username || expected.password || expected.pathname !== "/" || expected.search || expected.hash
      || origin !== supplied.origin || supplied.origin !== expected.origin) throw new Error("Invalid origin");
  } catch { throw new ReportApiError(403, "access_denied"); }
}

/** The gate precedes authentication and all database work, including on errors. */
export async function requireReportContext(
  req: NextApiRequest, res: NextApiResponse, method: "GET" | "POST" | "DELETE",
  allowedQuery: readonly string[], allowedBody: readonly string[] = [],
): Promise<ReportContext | null> {
  setReportHeaders(res);
  const t = getServerTranslator(reportRequestLocale(req));
  if (!isReportsLocalIntegrationEnabled()) {
    translatedError(res, t, 404, "unavailable");
    return null;
  }
  if (req.method !== method) {
    res.setHeader("Allow", method);
    translatedError(res, t, 405, "invalid_request");
    return null;
  }
  if (!object(req.query) || !keys(req.query, allowedQuery)
    || Object.values(req.query).some((value) => typeof value !== "string")) throw new ReportApiError(400, "invalid_request");
  validateLocale(req.query.locale);
  validateOrigin(req);
  await hydrateReportBody(req);
  jsonBody(req, allowedBody, method === "POST");
  if (typeof req.query.locale === "string" && typeof req.body?.locale === "string" && req.query.locale !== req.body.locale) {
    throw new ReportApiError(400, "invalid_request");
  }
  const user = await getAuthenticatedUser(req);
  if (!user || !uuid(user.id)) throw new ReportApiError(401, "sign_in_required");
  return { userId: user.id.toLowerCase(), locale: reportRequestLocale(req), supabase: getSupabaseAdmin() };
}

export function reportEnrollmentId(value: unknown) {
  if (!uuid(value)) throw new ReportApiError(400, "invalid_request");
  return value.toLowerCase();
}
