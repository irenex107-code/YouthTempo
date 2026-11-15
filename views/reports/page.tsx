import Head from "next/head";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { localizedStoredCheckInValue, storedCheckInLabel } from "@/lib/checkInHistoryCopy";
import { schoolReportAccessVersion, schoolReportDetailPolicyVersion, type SchoolReportAccess, type SchoolReportDetailCommand, type SchoolReportEntry, type SchoolReportOwner } from "@/lib/reports/accessTypes";
import { detailFieldDefinitions } from "@/lib/reports/comprehensive";
import type { SchoolReportDetails, SchoolReportDetailItem, SchoolReportRecent, SchoolReportTrend, SchoolReportWindow } from "@/lib/reports/comprehensiveTypes";
import { isSchoolReportDetails, isSchoolReportTrend } from "@/lib/reports/comprehensiveValidation";
import { endSchoolReportEnrollment, loadSchoolReportAccess, loadSchoolReportDetails, loadSchoolReportHistory, loadSchoolReportTrend, observeReportSession, ReportClientError, setSchoolReportDetails, validateSchoolReportView } from "@/lib/reports/client";

type SessionState = "checking" | "signed_in" | "signed_out";
type ReadKind = "access" | "entries" | "trend" | "history" | "details";
type ReadScope = { controller: AbortController; generation: number; userId: string };
type ViewMarker = { enrollmentId: string; viewToken: string; asOf: string; expiresAt: string; detailsEnabled: boolean };
type PendingCommand = { kind: "setting"; command: SchoolReportDetailCommand } | { kind: "exit"; enrollmentId: string; requestId: string };

function activeEntry(entry: SchoolReportEntry) { return Date.parse(entry.effectiveAt) <= Date.now() && Date.parse(entry.expiresAt) > Date.now(); }
function validEntry(entry: SchoolReportEntry) {
  return entry && typeof entry.enrollmentId === "string" && typeof entry.displayName === "string"
    && Number.isFinite(Date.parse(entry.effectiveAt)) && Number.isFinite(Date.parse(entry.expiresAt));
}
function validAccess(payload: SchoolReportAccess) {
  return payload?.version === schoolReportAccessVersion && ["student", "teacher", "unavailable"].includes(payload.viewerRole)
    && ["enrolled", "not_enrolled", "expired", "not_available"].includes(payload.eligibility)
    && Array.isArray(payload.received) && payload.received.every(validEntry)
    && (payload.owner === null || payload.viewerRole === "student")
    && (payload.received.length === 0 || payload.viewerRole === "teacher")
    && (payload.nextCursor === null || typeof payload.nextCursor === "string")
    && (payload.owner === null || (validEntry(payload.owner) && typeof payload.owner.detailsEnabled === "boolean"
      && Number.isSafeInteger(payload.owner.detailRevision) && payload.owner.detailRevision >= 0
      && Number.isSafeInteger(payload.owner.recipientEpoch) && payload.owner.recipientEpoch >= 0
      && ["active", "expired", "withdrawn", "invalidated"].includes(payload.owner.status)
      && Array.isArray(payload.owner.recipients) && payload.owner.recipients.every((recipient) => recipient?.type === "teacher" && typeof recipient.id === "string" && typeof recipient.displayName === "string")
      && (payload.owner.recipientNextCursor === null || typeof payload.owner.recipientNextCursor === "string")));
}
function sameOwnerVersion(left: SchoolReportOwner, right: SchoolReportOwner) {
  return left.enrollmentId === right.enrollmentId && left.detailRevision === right.detailRevision
    && left.recipientEpoch === right.recipientEpoch && left.detailsEnabled === right.detailsEnabled && left.status === right.status;
}
function shanghai(value: string, locale: string, dateOnly = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { timeZone: "Asia/Shanghai", year: "numeric", month: "short", day: "numeric",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit", hour12: false }) }).format(date);
}

export default function ReportsPage() {
  const { locale, t } = useTranslation();
  const [session, setSession] = useState<SessionState>("checking");
  const [access, setAccess] = useState<SchoolReportAccess | null>(null);
  const [selected, setSelected] = useState<SchoolReportEntry | null>(null);
  const [trend, setTrend] = useState<SchoolReportTrend | null>(null);
  const [details, setDetails] = useState<SchoolReportDetails | null>(null);
  const [loading, setLoading] = useState<ReadKind | null>(null);
  const [checking, setChecking] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [noticeKey, setNoticeKey] = useState<TranslationKey | null>(null);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandUnknown, setCommandUnknown] = useState(false);
  const [exitConfirmation, setExitConfirmation] = useState(false);
  const mounted = useRef(false);
  const userId = useRef<string | null>(null);
  const generation = useRef(0);
  const readRequests = useRef(new Set<AbortController>());
  const commandRequests = useRef(new Set<AbortController>());
  const commandSequence = useRef(0);
  const accessRef = useRef<SchoolReportAccess | null>(null);
  const accessViewerRole = useRef<SchoolReportAccess["viewerRole"] | null>(null);
  const marker = useRef<ViewMarker | null>(null);
  const pendingRef = useRef<PendingCommand | null>(null);
  const localeRef = useRef(locale);
  const lifecycleCheck = useRef<() => void>(() => {});
  localeRef.current = locale;

  function updateAccess(value: SchoolReportAccess | null) {
    if (value) accessViewerRole.current = value.viewerRole;
    accessRef.current = value; setAccess(value);
  }
  function updatePending(value: PendingCommand | null) { pendingRef.current = value; setPending(value); }
  function clearContent(clearAccess = false, keepMarker = false) {
    generation.current += 1;
    for (const request of readRequests.current) request.abort();
    readRequests.current.clear();
    setTrend(null); setDetails(null); setSelected(null); setLoading(null); setChecking(false);
    if (!keepMarker) marker.current = null;
    if (clearAccess) updateAccess(null);
  }
  function interruptCommands() {
    commandSequence.current += 1;
    for (const request of commandRequests.current) request.abort();
    commandRequests.current.clear(); setCommandBusy(false);
    if (pendingRef.current) setCommandUnknown(true);
  }
  function resetIdentity() {
    clearContent(true); interruptCommands(); userId.current = null;
    accessViewerRole.current = null;
    updatePending(null); setCommandUnknown(false); setExitConfirmation(false);
    setErrorKey(null); setNoticeKey(null); setSession("signed_out");
  }
  function beginRead(): ReadScope | null {
    if (!mounted.current || !userId.current || document.visibilityState === "hidden") return null;
    const controller = new AbortController(); readRequests.current.add(controller);
    return { controller, generation: generation.current, userId: userId.current };
  }
  function isCurrent(scope: ReadScope) {
    return mounted.current && !scope.controller.signal.aborted && scope.generation === generation.current
      && scope.userId === userId.current && document.visibilityState !== "hidden";
  }
  function failRead(error: unknown, scope: ReadScope) {
    if (!isCurrent(scope)) return;
    if (error instanceof ReportClientError && error.status === 401) { resetIdentity(); return; }
    clearContent(true);
    accessViewerRole.current = null;
    setErrorKey(error instanceof ReportClientError && [403, 404, 409].includes(error.status)
      ? `reportsV2.errors.${error.code}` : "reportsV2.errors.load");
    setNoticeKey(null);
  }
  async function readTrend(entry: SchoolReportEntry) {
    if (!activeEntry(entry) || pendingRef.current) return;
    clearContent(); setErrorKey(null); setNoticeKey(null); setSelected(entry);
    const scope = beginRead(); if (!scope) return;
    setLoading("trend");
    try {
      const payload = await loadSchoolReportTrend(entry.enrollmentId, localeRef.current, scope.controller.signal);
      if (!isCurrent(scope)) return;
      if (!isSchoolReportTrend(payload) || !activeEntry(entry)) throw new ReportClientError(409, "refresh_required");
      marker.current = { enrollmentId: entry.enrollmentId, viewToken: payload.viewToken, asOf: payload.asOf, expiresAt: entry.expiresAt, detailsEnabled: payload.detailsState === "available" };
      setTrend(payload);
    } catch (error) { failRead(error, scope); }
    finally { readRequests.current.delete(scope.controller); if (isCurrent(scope)) setLoading(null); }
  }
  async function reloadAccess(openDefault = true): Promise<SchoolReportAccess | null> {
    clearContent(true); setErrorKey(null); setNoticeKey(null);
    const scope = beginRead(); if (!scope) return null;
    setLoading("access");
    try {
      const payload = await loadSchoolReportAccess(localeRef.current, scope.controller.signal);
      if (!isCurrent(scope)) return null;
      if (!validAccess(payload)) throw new ReportClientError(503);
      updateAccess(payload);
      if (openDefault && !pendingRef.current) {
        const entry = payload.owner?.status === "active" && payload.eligibility === "enrolled" ? payload.owner : payload.received.length === 1 ? payload.received[0] : null;
        if (entry && activeEntry(entry)) void readTrend(entry);
      }
      return payload;
    } catch (error) { failRead(error, scope); return null; }
    finally { readRequests.current.delete(scope.controller); if (isCurrent(scope)) setLoading(null); }
  }
  async function moreAccess(cursor: string) {
    if (loading || pendingRef.current) return;
    const previous = accessRef.current; if (!previous) return;
    const scope = beginRead(); if (!scope) return;
    setLoading("entries"); setErrorKey(null);
    try {
      const page = await loadSchoolReportAccess(localeRef.current, scope.controller.signal, cursor);
      if (!isCurrent(scope)) return;
      if (!validAccess(page) || page.viewerRole !== previous.viewerRole || page.eligibility !== previous.eligibility
        || Boolean(page.owner) !== Boolean(previous.owner)
        || (page.owner && previous.owner && !sameOwnerVersion(previous.owner, page.owner))) throw new ReportClientError(409, "refresh_required");
      const owner = page.owner && previous.owner ? { ...page.owner, recipients: [...new Map([...previous.owner.recipients, ...page.owner.recipients].map((recipient) => [recipient.id, recipient])).values()] } : page.owner;
      updateAccess({ ...page, owner, received: [...new Map([...previous.received, ...page.received].map((entry) => [entry.enrollmentId, entry])).values()] });
    } catch (error) { failRead(error, scope); }
    finally { readRequests.current.delete(scope.controller); if (isCurrent(scope)) setLoading(null); }
  }
  async function validateOnly() {
    const current = marker.current;
    if (!current || !userId.current || document.visibilityState === "hidden" || commandRequests.current.size) return;
    const scope = beginRead(); if (!scope) return;
    setChecking(true);
    try {
      const checked = await validateSchoolReportView(current.enrollmentId, current.viewToken, localeRef.current, scope.controller.signal);
      if (!isCurrent(scope)) return;
      if (checked?.valid !== true || typeof checked.detailsEnabled !== "boolean" || checked.detailsEnabled !== current.detailsEnabled) throw new ReportClientError(409, "refresh_required");
      if (!accessRef.current) setNoticeKey("reportsV2.status.verified");
    } catch (error) { failRead(error, scope); }
    finally { readRequests.current.delete(scope.controller); if (isCurrent(scope)) setChecking(false); }
  }
  async function refreshReceivedAccess() {
    if (marker.current || pendingRef.current || commandRequests.current.size || readRequests.current.size) return;
    const previous = accessRef.current;
    const scope = beginRead(); if (!scope) return;
    setLoading("access");
    try {
      const payload = await loadSchoolReportAccess(localeRef.current, scope.controller.signal);
      if (!isCurrent(scope) || marker.current || pendingRef.current || accessRef.current !== previous) return;
      if (!validAccess(payload)) throw new ReportClientError(503);
      // Refresh only the minimum access metadata. A remaining single recipient
      // must not start a report read or reopen details without a user action.
      updateAccess({ ...payload, received: payload.received.filter(activeEntry) });
    } catch (error) { failRead(error, scope); }
    finally { readRequests.current.delete(scope.controller); if (isCurrent(scope)) setLoading(null); }
  }
  lifecycleCheck.current = () => {
    if (!marker.current && accessViewerRole.current === "teacher") void refreshReceivedAccess();
    else void validateOnly();
  };
  async function moreHistory() {
    const current = marker.current; const previous = trend;
    if (!current || !previous?.longTerm.nextCursor || loading || pendingRef.current) return;
    const scope = beginRead(); if (!scope) return;
    setLoading("history"); setErrorKey(null);
    try {
      const checked = await validateSchoolReportView(current.enrollmentId, current.viewToken, localeRef.current, scope.controller.signal);
      if (!isCurrent(scope)) return;
      if (!checked.valid || checked.detailsEnabled !== current.detailsEnabled) throw new ReportClientError(409, "refresh_required");
      const payload = await loadSchoolReportHistory(current.enrollmentId, previous.longTerm.nextCursor, localeRef.current, scope.controller.signal);
      if (!isCurrent(scope)) return;
      if (!isSchoolReportTrend(payload) || payload.asOf !== previous.asOf
        || JSON.stringify([payload.overview, payload.recent, payload.coverage, payload.longTerm.unit, payload.detailsState]) !== JSON.stringify([previous.overview, previous.recent, previous.coverage, previous.longTerm.unit, previous.detailsState])
        || payload.longTerm.bins.some((bin) => previous.longTerm.bins.some((old) => old.start === bin.start))) throw new ReportClientError(409, "refresh_required");
      marker.current = { ...current, viewToken: payload.viewToken };
      setTrend({ ...payload, longTerm: { ...payload.longTerm, bins: [...previous.longTerm.bins, ...payload.longTerm.bins] } });
    } catch (error) { failRead(error, scope); }
    finally { readRequests.current.delete(scope.controller); if (isCurrent(scope)) setLoading(null); }
  }
  async function readDetails(append = false) {
    const current = marker.current; const isOwner = current && accessRef.current?.owner?.enrollmentId === current.enrollmentId;
    if (!current || !trend || (!isOwner && trend.detailsState !== "available") || loading || pendingRef.current) return;
    const previous = append ? details : null;
    if (append && !previous?.nextCursor) return;
    const scope = beginRead(); if (!scope) return;
    setLoading("details"); setErrorKey(null); if (!append) setDetails(null);
    try {
      const checked = await validateSchoolReportView(current.enrollmentId, current.viewToken, localeRef.current, scope.controller.signal);
      if (!isCurrent(scope)) return;
      if (!checked.valid || checked.detailsEnabled !== current.detailsEnabled) throw new ReportClientError(409, "refresh_required");
      const payload = await loadSchoolReportDetails(current.enrollmentId, current.viewToken, localeRef.current, scope.controller.signal, previous?.nextCursor || undefined);
      if (!isCurrent(scope)) return;
      if (!isSchoolReportDetails(payload) || payload.asOf !== current.asOf || payload.items.some((item) => previous?.items.some((old) => old.key === item.key))) throw new ReportClientError(409, "refresh_required");
      marker.current = { ...current, viewToken: payload.viewToken };
      setDetails({ ...payload, items: [...(previous?.items || []), ...payload.items] });
    } catch (error) { failRead(error, scope); }
    finally { readRequests.current.delete(scope.controller); if (isCurrent(scope)) setLoading(null); }
  }
  async function sendCommand(command: PendingCommand) {
    if (!mounted.current || !userId.current || document.visibilityState === "hidden") return;
    interruptCommands(); clearContent(); updatePending(command); setCommandBusy(true); setCommandUnknown(false); setErrorKey(null); setNoticeKey(null);
    const sequence = ++commandSequence.current; const actor = userId.current;
    const controller = new AbortController(); commandRequests.current.add(controller);
    const currentCommand = () => mounted.current && userId.current === actor && sequence === commandSequence.current && !controller.signal.aborted && document.visibilityState !== "hidden";
    try {
      if (command.kind === "setting") await setSchoolReportDetails(command.command, localeRef.current, controller.signal);
      else await endSchoolReportEnrollment(command.enrollmentId, command.requestId, localeRef.current, controller.signal);
      if (!currentCommand()) return;
      commandRequests.current.delete(controller); setCommandBusy(false); setCommandUnknown(true);
      const payload = await reloadAccess(false);
      if (!currentCommand() || pendingRef.current !== command || !payload) return;
      const enrollmentId = command.kind === "setting" ? command.command.enrollmentId : command.enrollmentId;
      if (command.kind === "setting") {
        if (payload.owner?.enrollmentId !== enrollmentId || payload.owner.status !== "active" || payload.owner.detailsEnabled !== command.command.enabled) return;
        updatePending(null); setCommandUnknown(false);
        void readTrend(payload.owner);
        setNoticeKey(command.command.enabled ? "reportsV2.details.confirmedOn" : "reportsV2.details.confirmedOff");
      } else if (!payload.owner || payload.owner.enrollmentId !== enrollmentId || payload.owner.status !== "active") {
        updatePending(null); setCommandUnknown(false); setExitConfirmation(false); setNoticeKey("reportsV2.actions.exited");
      }
    } catch (error) {
      if (!currentCommand()) return;
      setCommandBusy(false);
      if (error instanceof ReportClientError && error.status === 401) { resetIdentity(); return; }
      if (error instanceof ReportClientError && [403, 404, 409].includes(error.status)) {
        updatePending(null); setCommandUnknown(false); await reloadAccess(false);
        if (mounted.current && userId.current === actor && sequence === commandSequence.current) setErrorKey(`reportsV2.errors.${error.code}`);
      } else { setCommandUnknown(true); setErrorKey("reportsV2.errors.mutation"); }
    } finally { commandRequests.current.delete(controller); }
  }
  function enableDetails() {
    const owner = accessRef.current?.owner;
    if (!owner || accessRef.current?.viewerRole !== "student" || accessRef.current.eligibility !== "enrolled" || owner.status !== "active" || !activeEntry(owner)
      || owner.recipientNextCursor || owner.recipients.length === 0 || pendingRef.current) return;
    void sendCommand({ kind: "setting", command: { enrollmentId: owner.enrollmentId, requestId: crypto.randomUUID(), enabled: true,
      expectedDetailRevision: owner.detailRevision, expectedRecipientEpoch: owner.recipientEpoch, policyVersion: schoolReportDetailPolicyVersion, confirmed: true } });
  }
  function disableDetails() {
    const old = pendingRef.current; const enrollmentId = old?.kind === "setting" ? old.command.enrollmentId : accessRef.current?.owner?.enrollmentId;
    if (!enrollmentId || old?.kind === "exit") return;
    const command = old?.kind === "setting" && !old.command.enabled ? old : { kind: "setting" as const, command: { enrollmentId, requestId: crypto.randomUUID(), enabled: false as const } };
    void sendCommand(command);
  }
  function confirmExit() {
    const owner = accessRef.current?.owner;
    if (!owner || owner.status !== "active" || pendingRef.current) return;
    void sendCommand({ kind: "exit", enrollmentId: owner.enrollmentId, requestId: crypto.randomUUID() });
  }

  useEffect(() => {
    mounted.current = true;
    const stop = observeReportSession((next) => {
      const changed = userId.current !== next;
      clearContent(true, !changed); interruptCommands(); userId.current = next;
      if (changed) { accessViewerRole.current = null; updatePending(null); setCommandUnknown(false); setExitConfirmation(false); setErrorKey(null); setNoticeKey(null); }
      setSession(next ? "signed_in" : "signed_out");
      if (next) queueMicrotask(() => { if (mounted.current && userId.current === next) { if (changed) void reloadAccess(); else lifecycleCheck.current(); } });
    });
    const lifecycle = () => { clearContent(true, true); interruptCommands(); setNoticeKey("reportsV2.status.refresh"); if (document.visibilityState !== "hidden") lifecycleCheck.current(); };
    const focus = () => { if (document.visibilityState !== "hidden") lifecycle(); };
    document.addEventListener("visibilitychange", lifecycle); window.addEventListener("focus", focus);
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") lifecycleCheck.current(); }, 30_000);
    return () => {
      mounted.current = false; generation.current += 1; commandSequence.current += 1;
      for (const request of [...readRequests.current, ...commandRequests.current]) request.abort();
      readRequests.current.clear(); commandRequests.current.clear(); stop(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", lifecycle); window.removeEventListener("focus", focus);
    };
  }, []);
  useEffect(() => {
    const receivedExpiry = access?.viewerRole === "teacher" ? access.received.reduce<string | undefined>((earliest, entry) =>
      !earliest || Date.parse(entry.expiresAt) < Date.parse(earliest) ? entry.expiresAt : earliest, undefined) : undefined;
    const expiry = selected?.expiresAt || access?.owner?.expiresAt || receivedExpiry;
    if (!expiry) return;
    const expire = () => {
      if (!marker.current && accessRef.current?.viewerRole === "teacher") {
        const current = accessRef.current;
        updateAccess({ ...current, received: current.received.filter(activeEntry) });
        void refreshReceivedAccess();
        return;
      }
      clearContent(true, true); interruptCommands(); setNoticeKey("reportsV2.status.ended"); lifecycleCheck.current();
    };
    const remaining = Date.parse(expiry) - Date.now();
    if (remaining <= 0) { expire(); return; }
    const timer = window.setTimeout(expire, Math.min(remaining + 1, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [selected?.expiresAt, access?.owner?.expiresAt, access?.received]);

  const owner = access?.viewerRole === "student" ? access.owner : null;
  const activeOwner = owner?.status === "active" && access?.eligibility === "enrolled" && activeEntry(owner) ? owner : null;
  const ownView = selected && owner?.enrollmentId === selected.enrollmentId;
  const pendingOn = pending?.kind === "setting" && pending.command.enabled;
  const detailLabel = commandBusy && pending?.kind === "setting" ? pending.command.enabled ? "reportsV2.details.enabling" : "reportsV2.details.disabling" : owner?.detailsEnabled ? "reportsV2.details.on" : "reportsV2.details.off";
  return <>
    <Head><title>{t("reportsV2.metadata.title")}</title><meta name="description" content={t("reportsV2.metadata.description")} /><meta name="robots" content="noindex,nofollow" /></Head>
    <section className="section section-muted pt-8 sm:pt-12"><div className="container max-w-5xl">
      <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-7 text-amber-900">{t("reportsV2.localNotice")}</p>
      <h1 className="mt-6 text-3xl font-black tracking-[-0.035em] text-ink sm:text-4xl">{t("reportsV2.title")}</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-muted">{t("reportsV2.intro")}</p><p className="mt-2 text-sm leading-7 text-muted">{t("reportsV2.allHistory")}</p>
      <div className="mt-6" data-report-v2-state={session === "signed_in" ? access?.eligibility || "pending" : session}>
        {session === "checking" || loading ? <p role="status" className="text-sm leading-7 text-muted">{t("reportsV2.status.loading")}</p> : null}
        {session === "signed_out" ? <div className="card"><p>{t("reportsV2.session.description")}</p><Link href="/account?next=/reports" className="button-primary mt-4">{t("reportsV2.session.signIn")}</Link></div> : null}
        {errorKey ? <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm leading-7 text-ink">{t(errorKey)}</p> : null}
        {noticeKey ? <p role="status" className="mt-4 text-sm leading-7 text-muted">{t(noticeKey)}</p> : null}
        {checking ? <p role="status" className="mt-3 text-sm text-muted">{t("reportsV2.status.checking")}</p> : null}
        {session === "signed_in" ? <button type="button" className="button-secondary mt-4 max-w-full whitespace-normal" disabled={commandBusy || Boolean(loading)} onClick={() => void reloadAccess()}>{t("reportsV2.actions.refresh")}</button> : null}
      </div>
      {pending && (commandBusy || commandUnknown) ? <section className="card mt-6" data-report-setting-pending>
        <p role="status" className="text-sm leading-7 text-ink">{t(pending.kind === "exit" ? commandBusy ? "reportsV2.actions.exiting" : "reportsV2.actions.exitUnknown" : commandBusy ? pending.command.enabled ? "reportsV2.details.enabling" : "reportsV2.details.disabling" : pending.command.enabled ? "reportsV2.details.unknownOn" : "reportsV2.details.unknownOff")}</p>
        <div className="mt-4 flex flex-wrap gap-3">{commandUnknown ? <button type="button" className="button-secondary max-w-full whitespace-normal" onClick={() => void sendCommand(pending)}>{t(pending.kind === "exit" ? "reportsV2.actions.exitRetry" : "reportsV2.details.retry")}</button> : null}{pendingOn ? <button type="button" data-report-detail-off className="button-secondary max-w-full whitespace-normal" onClick={disableDetails}>{t("reportsV2.details.stopPossible")}</button> : null}</div>
      </section> : null}
      {access && !owner && access.received.length === 0 ? <p role="status" className="card mt-6 text-sm leading-7 text-muted">{t(`reportsV2.access.${access.eligibility === "enrolled" ? "not_enrolled" : access.eligibility}`)}</p> : null}
      {owner ? <section className="card mt-6 min-w-0" aria-labelledby="report-owner-title" data-report-owner={owner.enrollmentId}>
        <h2 id="report-owner-title" className="text-xl font-bold text-ink">{t("reportsV2.access.owner")}</h2><p className="mt-3 text-sm leading-7 text-muted">{t("reportsV2.automatic")}</p><p className="mt-2 text-sm leading-7 text-muted">{t("reportsV2.access.period", { start: shanghai(owner.effectiveAt, locale), end: shanghai(owner.expiresAt, locale) })}</p><p className="mt-2 text-sm leading-7 text-muted">{t("reportsV2.access.scope")}</p>
        <h3 className="mt-5 font-bold text-ink">{t("reportsV2.access.teachers")}</h3><ul className="mt-3 space-y-2" data-report-recipients>{owner.recipients.map((recipient) => <li key={recipient.id} className="break-words text-sm leading-7 text-ink">{recipient.displayName}</li>)}</ul>
        {owner.recipients.length === 0 ? <p className="mt-2 text-sm text-muted">{t("reportsV2.access.none")}</p> : null}
        {owner.recipientNextCursor ? <><p className="mt-3 text-sm leading-7 text-muted">{t("reportsV2.access.recipientIncomplete")}</p><button type="button" className="button-secondary mt-3 max-w-full whitespace-normal" disabled={Boolean(loading) || Boolean(pending)} onClick={() => void moreAccess(owner.recipientNextCursor!)}>{t("reportsV2.access.recipientMore")}</button></> : owner.recipients.length > 0 ? <p className="mt-3 text-sm leading-7 text-muted">{t("reportsV2.access.recipientComplete")}</p> : null}
        {activeOwner ? <div className="mt-6 rounded-2xl border border-sage/25 bg-mist/60 p-4"><h3 className="font-bold text-ink">{t("reportsV2.details.switch")}</h3><p id="report-details-disclosure" className="mt-3 text-sm leading-7 text-ink">{t("reportsV2.details.disclosure")}</p>
          <button type="button" role="switch" aria-checked={owner.detailsEnabled} aria-describedby="report-details-disclosure" aria-label={t("reportsV2.details.switch")} data-report-detail-switch data-report-detail-off={owner.detailsEnabled ? true : undefined} className="button-secondary mt-4 max-w-full whitespace-normal" disabled={commandBusy || Boolean(pending) || Boolean(loading) || (!owner.detailsEnabled && (Boolean(owner.recipientNextCursor) || owner.recipients.length === 0))} onClick={() => owner.detailsEnabled ? disableDetails() : enableDetails()}>{t(detailLabel)}</button>
        </div> : <p role="status" className="mt-4 text-sm text-muted">{t(owner.status === "expired" || access?.eligibility === "expired" ? "reportsV2.access.expired" : "reportsV2.status.ended")}</p>}
        {activeOwner ? <div className="mt-5 flex flex-wrap gap-3"><button type="button" className="button-secondary max-w-full whitespace-normal" data-report-open={owner.enrollmentId} disabled={Boolean(loading) || Boolean(pending)} onClick={() => void readTrend(owner)}>{t("reportsV2.actions.open")}</button><button type="button" className="button-secondary max-w-full whitespace-normal" disabled={Boolean(pending)} onClick={() => setExitConfirmation(true)}>{t("reportsV2.actions.exit")}</button></div> : null}
        {exitConfirmation && activeOwner ? <div className="mt-4 rounded-2xl bg-amber-50 p-4"><p className="text-sm leading-7 text-ink">{t("reportsV2.actions.exitExplanation")}</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" className="button-secondary max-w-full whitespace-normal" disabled={Boolean(pending)} onClick={confirmExit}>{t("reportsV2.actions.exitConfirm")}</button><button type="button" className="button-secondary" disabled={Boolean(pending)} onClick={() => setExitConfirmation(false)}>{t("reportsV2.actions.cancel")}</button></div></div> : null}
      </section> : null}
      {access?.viewerRole === "teacher" ? <section className="card mt-6" aria-labelledby="report-received-title"><h2 id="report-received-title" className="text-xl font-bold text-ink">{t("reportsV2.access.received")}</h2>
        {access.received.length === 0 ? <p className="mt-3 text-sm leading-7 text-muted">{t("reportsV2.access.empty")}</p> : <div className="mt-4 grid gap-4 sm:grid-cols-2">{access.received.map((entry) => <article key={entry.enrollmentId} className="min-w-0 rounded-2xl border border-ink/10 p-4" data-report-received={entry.enrollmentId}><h3 className="break-words font-bold text-ink">{entry.displayName}</h3><p className="mt-2 text-sm leading-7 text-muted">{t("reportsV2.access.period", { start: shanghai(entry.effectiveAt, locale), end: shanghai(entry.expiresAt, locale) })}</p><button type="button" className="button-secondary mt-3 max-w-full whitespace-normal" data-report-open={entry.enrollmentId} disabled={!activeEntry(entry) || Boolean(loading) || Boolean(pending)} onClick={() => void readTrend(entry)}>{t("reportsV2.actions.open")}</button></article>)}</div>}
        {access.nextCursor ? <button type="button" className="button-secondary mt-4 max-w-full whitespace-normal" disabled={Boolean(loading)} onClick={() => void moreAccess(access.nextCursor!)}>{t("reportsV2.actions.moreEntries")}</button> : null}
      </section> : null}
      {trend && selected ? <section className="card mt-6 min-w-0" data-report-comprehensive="ready" aria-labelledby="report-trend-title"><h2 id="report-trend-title" className="text-xl font-bold text-ink">{t("reportsV2.trend.title")}</h2><p className="mt-2 text-sm leading-7 text-muted">{t("reportsV2.trend.asOf", { date: shanghai(trend.asOf, locale) })}</p><p className="mt-2 text-sm leading-7 text-muted">{t(`reportsV2.trend.coverage.${trend.coverage.state}`)}</p><p className="mt-2 text-sm leading-7 text-muted">{t("reportsV2.trend.range", { start: trend.coverage.start ? shanghai(trend.coverage.start, locale) : t("reportsV2.trend.noStart"), end: shanghai(trend.coverage.end, locale) })}</p>
        <div className="mt-5"><h3 className="font-bold text-ink">{t("reportsV2.trend.overview")}</h3><WindowResult window={trend.overview} /></div><p className="mt-6 text-sm leading-7 text-muted">{t("reportsV2.trend.rolling")}</p><RecentResult value={trend.recent.days7} title={t("reportsV2.trend.days7")} /><RecentResult value={trend.recent.days30} title={t("reportsV2.trend.days30")} />
        <h3 className="mt-7 font-bold text-ink">{t("reportsV2.trend.longTerm")}</h3><p className="mt-2 text-sm text-muted">{t(`reportsV2.trend.${trend.longTerm.unit}`)}</p>{trend.longTerm.bins.length === 0 ? <p className="mt-3 text-sm text-muted">{t("reportsV2.trend.noBins")}</p> : <div className="mt-4 grid gap-4">{trend.longTerm.bins.map((bin) => <article key={bin.start} data-report-time-bin className="min-w-0 rounded-2xl border border-ink/10 p-4"><h4 className="text-sm font-bold text-ink">{shanghai(bin.start, locale, true)} — {shanghai(bin.end, locale, true)}</h4>{bin.partial ? <p className="mt-2 text-sm text-muted">{t("reportsV2.trend.partialBin")}</p> : null}<WindowResult window={bin} /></article>)}</div>}
        {trend.longTerm.nextCursor ? <button type="button" className="button-secondary mt-4 max-w-full whitespace-normal" disabled={Boolean(loading)} onClick={() => void moreHistory()}>{t("reportsV2.trend.more")}</button> : null}<p className="mt-5 text-sm leading-7 text-muted">{t("reportsV2.trend.disclaimer")}</p>
        {ownView || trend.detailsState === "available" ? <div className="mt-6 border-t border-ink/10 pt-5"><h3 className="font-bold text-ink">{t("reportsV2.details.title")}</h3><p className="mt-2 text-sm leading-7 text-muted">{t("reportsV2.details.scope")}</p>{ownView ? <p className="mt-2 text-sm leading-7 text-muted">{t("reportsV2.details.previewNotice")}</p> : null}<button type="button" className="button-secondary mt-4 max-w-full whitespace-normal" data-report-details-open disabled={Boolean(loading) || Boolean(pending)} onClick={() => void readDetails()}>{t(ownView ? "reportsV2.details.preview" : "reportsV2.details.show")}</button></div> : null}
      </section> : null}
      {details ? <section className="card mt-6 min-w-0" data-report-details="ready"><h2 className="text-xl font-bold text-ink">{t("reportsV2.details.title")}</h2><p className="mt-2 text-sm leading-7 text-muted">{t("reportsV2.details.textNotice")}</p>{details.items.length === 0 ? <p className="mt-4 text-sm text-muted">{t("reportsV2.details.empty")}</p> : <div className="mt-4 space-y-4">{details.items.map((item) => <DetailItem key={item.key} item={item} />)}</div>}{details.nextCursor ? <button type="button" className="button-secondary mt-5 max-w-full whitespace-normal" disabled={Boolean(loading)} onClick={() => void readDetails(true)}>{t("reportsV2.details.more")}</button> : null}</section> : null}
      {session === "signed_in" ? <p className="mt-6 rounded-2xl bg-mist p-4 text-sm leading-7 text-muted">{t("reportsV2.guardianClosed")}</p> : null}
    </div></section>
  </>;
}

function WindowResult({ window, comparisons }: { window: SchoolReportWindow; comparisons?: SchoolReportRecent["comparisons"] }) {
  const { t } = useTranslation();
  return <div className="mt-3 grid gap-3 sm:grid-cols-2" data-report-window>{window.dimensions.map((dimension) => <div key={dimension.id} className="min-w-0 rounded-xl bg-mist/60 p-3" data-report-dimension={dimension.id}><h4 className="text-sm font-bold text-ink">{t(`reportsPreview.dimensions.${dimension.id}`)}</h4><p className="mt-2 text-sm leading-7 text-muted">{dimension.state === "category" && dimension.category ? t("reportsV2.trend.category", { category: t(`reportsV2.categories.${dimension.category}`) }) : t(`reportsV2.trend.${dimension.state}`)}</p>{comparisons ? <p className="mt-1 text-sm leading-7 text-muted">{t(`reportsV2.trend.${comparisons.find((comparison) => comparison.id === dimension.id)?.state || "unavailable"}`)}</p> : null}</div>)}</div>;
}
function RecentResult({ value, title }: { value: SchoolReportRecent; title: string }) {
  const { t } = useTranslation();
  return <section className="mt-6"><h3 className="font-bold text-ink">{title}</h3><WindowResult window={value.current} comparisons={value.comparisons} /><details className="mt-3 rounded-xl border border-ink/10 p-3"><summary className="cursor-pointer text-sm font-bold text-ink">{t("reportsV2.trend.previous")}</summary><WindowResult window={value.previous} /></details></section>;
}
function DetailItem({ item }: { item: SchoolReportDetailItem }) {
  const { locale, t } = useTranslation();
  return <details className="min-w-0 rounded-2xl border border-ink/10 p-4" data-report-detail-item><summary className="cursor-pointer break-words text-sm font-bold text-ink">{item.date ? shanghai(item.date, locale, true) : t("reportsV2.details.unknownDate")}</summary>
    {item.state === "unsupported" || item.state === "conflict" ? <p className="mt-3 text-sm leading-7 text-muted">{t(`reportsV2.details.${item.state}`)}</p> : <>{item.state === "partial" ? <p className="mt-3 text-sm leading-7 text-muted">{t("reportsV2.details.partial")}</p> : null}{item.dimensions?.map((dimension) => <section key={dimension.id} className="mt-4"><h3 className="font-bold text-ink">{t(`reportsPreview.dimensions.${dimension.id}`)}</h3><dl className="mt-2 space-y-3">{dimension.fields.map((field) => {
      const definition = detailFieldDefinitions[dimension.id].find((candidate) => candidate.id === field.id); if (!definition) return null;
      return <div key={field.id} className="min-w-0"><dt className="text-sm font-bold leading-7 text-ink">{storedCheckInLabel(locale, `checkIn.steps.${dimension.id}.fields.${field.id}.title`, t("reportsV2.details.fieldUnsupported"))}</dt><dd className="whitespace-pre-wrap break-words text-sm leading-7 text-muted [overflow-wrap:anywhere]">{field.state !== "available" || field.value === undefined ? t("reportsV2.details.fieldUnsupported") : (Array.isArray(field.value) ? field.value : [field.value]).map((value) => definition.kind === "text" ? value : localizedStoredCheckInValue(value, locale, dimension.id, field.id)).join(" / ")}</dd></div>;
    })}</dl></section>)}<h3 className="mt-5 text-sm font-bold text-ink">{t("reportsV2.details.summary")}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-muted [overflow-wrap:anywhere]">{item.summaryState === "available" && typeof item.summary === "string" ? item.summary : t(item.summaryState === "unsupported" ? "reportsV2.details.unsupportedSummary" : "reportsV2.details.missingSummary")}</p></>}
  </details>;
}
