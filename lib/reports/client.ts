import { getSupabase } from "@/lib/supabaseClient";
import type { SchoolReportAccess, SchoolReportDetailCommand, SchoolReportDetailSettingResponse, SchoolReportValidation } from "./accessTypes";
import type { SchoolReportDetails, SchoolReportTrend } from "./comprehensiveTypes";

const safeCodes = ["invalid_request", "sign_in_required", "access_denied", "unavailable", "refresh_required", "stale_setting", "temporarily_unavailable"] as const;
export type ReportClientCode = typeof safeCodes[number];

export class ReportClientError extends Error {
  constructor(public readonly status: number, public readonly code: ReportClientCode = "temporarily_unavailable") { super("Report request unavailable"); }
}

async function reportRequest<T>(path: string, locale: string, signal: AbortSignal, method = "GET", body?: unknown) {
  const supabase = getSupabase();
  if (!supabase) throw new ReportClientError(401, "sign_in_required");
  const controller = new AbortController();
  let rejectPending: (error: Error) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => { rejectPending = reject; });
  const abort = () => { controller.abort(); rejectPending(new ReportClientError(408)); };
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  try {
    if (signal.aborted) throw new ReportClientError(408);
    const { data, error } = await Promise.race([supabase.auth.getSession(), interrupted]);
    if (error || !data.session?.access_token) throw new ReportClientError(401, "sign_in_required");
    if (controller.signal.aborted) throw new ReportClientError(408);
    const response = await Promise.race([fetch(path, {
      method, signal: controller.signal, cache: "no-store", credentials: "omit",
      headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify({ ...body as object, locale }),
    }), interrupted]);
    if (!response.ok) {
      const payload: unknown = await Promise.race([response.json().catch(() => null), interrupted]);
      const code = payload && typeof payload === "object" && "code" in payload ? payload.code : null;
      throw new ReportClientError(response.status, typeof code === "string" && safeCodes.includes(code as ReportClientCode)
        ? code as ReportClientCode : response.status === 401 ? "sign_in_required" : response.status === 403 ? "access_denied" : "temporarily_unavailable");
    }
    return await Promise.race([response.json() as Promise<T>, interrupted]);
  } catch (error) {
    if (error instanceof ReportClientError) throw error;
    throw new ReportClientError(503);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export function loadSchoolReportAccess(locale: string, signal: AbortSignal, cursor?: string) {
  return cursor
    ? reportRequest<SchoolReportAccess>("/api/reports/access", locale, signal, "POST", { cursor })
    : reportRequest<SchoolReportAccess>(`/api/reports/access?locale=${encodeURIComponent(locale)}`, locale, signal);
}

export function loadSchoolReportTrend(enrollmentId: string, locale: string, signal: AbortSignal) {
  return reportRequest<SchoolReportTrend>(`/api/reports/current?enrollmentId=${encodeURIComponent(enrollmentId)}&locale=${encodeURIComponent(locale)}`, locale, signal);
}

export function loadSchoolReportHistory(enrollmentId: string, cursor: string, locale: string, signal: AbortSignal) {
  return reportRequest<SchoolReportTrend>("/api/reports/history", locale, signal, "POST", { enrollmentId, cursor });
}

export function loadSchoolReportDetails(enrollmentId: string, viewToken: string, locale: string, signal: AbortSignal, cursor?: string) {
  return reportRequest<SchoolReportDetails>("/api/reports/details", locale, signal, "POST", { enrollmentId, viewToken, ...(cursor ? { cursor } : {}) });
}

export function setSchoolReportDetails(input: SchoolReportDetailCommand, locale: string, signal: AbortSignal) {
  return reportRequest<SchoolReportDetailSettingResponse>("/api/reports/details-setting", locale, signal, "POST", input);
}

export function validateSchoolReportView(enrollmentId: string, viewToken: string, locale: string, signal: AbortSignal) {
  return reportRequest<SchoolReportValidation>("/api/reports/validate", locale, signal, "POST", { enrollmentId, viewToken });
}

export function endSchoolReportEnrollment(enrollmentId: string, requestId: string, locale: string, signal: AbortSignal) {
  return reportRequest<{ ended: true }>("/api/reports/enrollment-exit", locale, signal, "POST", { enrollmentId, requestId, confirmed: true });
}

export function observeReportSession(onChange: (userId: string | null) => void) {
  const supabase = getSupabase();
  if (!supabase) { onChange(null); return () => {}; }
  let active = true;
  let eventSeen = false;
  let initialDelivered = false;
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    eventSeen = true;
    if (event === "INITIAL_SESSION" && initialDelivered) return;
    initialDelivered = true;
    if (active) onChange(session?.user.id || null);
  });
  void supabase.auth.getSession().then(({ data: session, error }) => {
    if (active && !eventSeen) { initialDelivered = true; onChange(error ? null : session.session?.user.id || null); }
  }).catch(() => { if (active && !eventSeen) { initialDelivered = true; onChange(null); } });
  return () => { active = false; data.subscription.unsubscribe(); };
}
