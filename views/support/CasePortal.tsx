import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { InlineStudentConsent } from "@/components/InlineStudentConsent";
import { useSessionActor } from "@/lib/useSessionActor";
import { useInlineStudentConsent } from "@/lib/useInlineStudentConsent";
import { MicroPilotFeedback } from "@/components/MicroPilotFeedback";
import { PageHero } from "@/components/PageHero";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { getSupabase } from "@/lib/supabaseClient";
import { YOUNG_ADULT_REFERRAL_HREF } from "@/lib/referralDisplayContext";

type CaseStatus = "requested" | "triage" | "awaiting_assignment" | "assigned" | "active"
  | "paused" | "transfer_requested" | "transferred" | "referred" | "closed" | "cancelled";
type CaseAction = "cancel" | "accept_assignment" | "reject_assignment" | "request_change"
  | "withdraw_authorization" | "close" | "accept_appointment" | "request_reschedule" | "cancel_appointment";
type CaseItem = {
  id: string;
  case_type: "youth_request" | "adult_consultation";
  status: CaseStatus;
  student_authorization_active: boolean;
  row_revision: string;
  need_summary: string;
  availability: string | null;
  appointment_at: string | null;
  appointment_status: "none" | "proposed" | "accepted" | "reschedule_requested" | "cancelled";
  referral_type: string | null;
  created_at: string;
  assignments: Array<{ role: "primary" | "backup"; status: "offered" | "accepted"; name: string | null; category: string | null }>;
  events: Array<{ action: string; status: CaseStatus | null; createdAt: string }>;
  feedbackSubmitted: boolean;
};
type AdultAvailabilityReason = "available" | "not_open" | "ineligible" | "unavailable";
type PortalData = { consultationAvailable: boolean; ageBand: "14_17" | "18_plus" | null; cases: CaseItem[];
  canUseNewService: boolean; historyReason: string; adultAvailabilityReason: AdultAvailabilityReason };
type CreateReason = "offline" | "timeout" | "unavailable" | "identity" | "forbidden" | "limited" | "invalid";
type CreateOutcome = "notSent" | "rejected" | "unknown";
type CreateRecovery = { reason: Extract<CreateReason, "offline" | "timeout" | "unavailable">; checked: boolean; current: () => boolean };
type CreateReceipt = { id: string; status: "requested" | "triage"; urgent: boolean };
class CreateCaseError extends Error {
  constructor(readonly reason: CreateReason, readonly outcome: CreateOutcome) {
    super("Support request result could not be confirmed.");
    this.name = "CreateCaseError";
  }
}
type TerminationAction = Extract<CaseAction, "cancel" | "withdraw_authorization" | "close" | "cancel_appointment">;
type TerminationPhase = "saving" | "saved" | "rejected" | "unknown" | "not_sent";
type TerminationAttempt = {
  action: TerminationAction; phase: TerminationPhase; current: () => boolean;
  readAtOutcome: number; reread: boolean;
};
function isTerminationAction(action: CaseAction): action is TerminationAction {
  return ["cancel", "withdraw_authorization", "close", "cancel_appointment"].includes(action);
}
function validTermination(item: CaseItem, action: TerminationAction) {
  if (action === "cancel") return ["requested", "triage", "awaiting_assignment", "assigned"].includes(item.status);
  if (action === "withdraw_authorization") return ["active", "paused", "transfer_requested"].includes(item.status);
  if (action === "close") return ["active", "paused", "transfer_requested", "transferred", "referred"].includes(item.status);
  return item.status === "active" && ["proposed", "accepted"].includes(item.appointment_status);
}
type TerminationReceipt = {
  caseId: string; action: TerminationAction; status: CaseStatus; appointmentAt: string | null;
  appointmentStatus: CaseItem["appointment_status"]; referralType: string | null;
  authorizationActive: boolean; matchedRevision: string; revision: string;
};
type ConfirmedTermination = {
  caseId: string; action: TerminationAction; current: () => boolean; receipt: TerminationReceipt;
};
const uuidValue = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function validCreateReceipt(value: unknown): value is CreateReceipt {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return uuidValue(result.id) && ["requested", "triage"].includes(String(result.status))
    && typeof result.urgent === "boolean";
}
function validReceipt(value: unknown, item: CaseItem, action: TerminationAction): value is TerminationReceipt {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const next = action === "cancel" ? "cancelled" : action === "withdraw_authorization" ? "paused"
    : action === "close" ? "closed" : "active";
  return result.caseId === item.id && result.action === action && result.status === next
    && uuidValue(result.matchedRevision) && uuidValue(result.revision) && result.matchedRevision !== result.revision
    && typeof result.appointmentStatus === "string"
    && ["none", "proposed", "accepted", "reschedule_requested", "cancelled"].includes(result.appointmentStatus)
    && (result.appointmentAt === null || (typeof result.appointmentAt === "string" && Number.isFinite(Date.parse(result.appointmentAt))))
    && (result.referralType === null || (typeof result.referralType === "string"
      && ["school", "social_work", "medical", "professional", "community"].includes(result.referralType)))
    && typeof result.authorizationActive === "boolean"
    && (action !== "cancel_appointment" ? result.authorizationActive === false
      : result.matchedRevision === item.row_revision && result.appointmentStatus === "cancelled"
        && result.authorizationActive === item.student_authorization_active);
}
const feedbackKeys = ["feltHeard", "foundHelp", "boundariesRespected", "wouldChooseAgain"] as const;

const eventLabelKeys: Record<string, TranslationKey> = {
  requested: "supportFlow.portal.eventLabels.requested",
  triage: "supportFlow.portal.eventLabels.triage",
  ready_for_assignment: "supportFlow.portal.eventLabels.readyForAssignment",
  structured_handoff: "supportFlow.portal.eventLabels.handoff",
  primary_offer_accepted: "supportFlow.portal.eventLabels.primaryAccepted",
  assignment_primary_offered: "supportFlow.portal.eventLabels.primaryOffered",
  assignment_primary_accepted: "supportFlow.portal.eventLabels.primaryAccepted",
  assignment_primary_declined: "supportFlow.portal.eventLabels.primaryDeclined",
  assignment_primary_revoked: "supportFlow.portal.eventLabels.primaryRevoked",
  assignment_backup_offered: "supportFlow.portal.eventLabels.backupOffered",
  assignment_backup_accepted: "supportFlow.portal.eventLabels.backupAccepted",
  assignment_backup_declined: "supportFlow.portal.eventLabels.backupDeclined",
  assignment_backup_revoked: "supportFlow.portal.eventLabels.backupRevoked",
  cancel: "supportFlow.portal.eventLabels.cancelled",
  accept_assignment: "supportFlow.portal.eventLabels.assignmentAccepted",
  reject_assignment: "supportFlow.portal.eventLabels.assignmentDeclined",
  request_change: "supportFlow.portal.eventLabels.changeRequested",
  withdraw_authorization: "supportFlow.portal.eventLabels.authorizationWithdrawn",
  close: "supportFlow.portal.eventLabels.closed",
  propose_appointment: "supportFlow.portal.eventLabels.appointmentProposed",
  accept_appointment: "supportFlow.portal.eventLabels.appointmentAccepted",
  request_reschedule: "supportFlow.portal.eventLabels.rescheduleRequested",
  cancel_appointment: "supportFlow.portal.eventLabels.appointmentCancelled",
  pause: "supportFlow.portal.eventLabels.paused",
  resume: "supportFlow.portal.eventLabels.resumed",
  refer: "supportFlow.portal.eventLabels.referred",
};
const eventStatusValues = new Set([
  "requested", "triage", "awaiting_assignment", "assigned", "active", "paused",
  "transfer_requested", "transferred", "referred", "closed", "cancelled",
]);

function eventLabelKey(event: CaseItem["events"][number]): TranslationKey {
  if (Object.prototype.hasOwnProperty.call(eventLabelKeys, event.action)) return eventLabelKeys[event.action];
  if (event.status && eventStatusValues.has(event.status)) return `supportFlow.portal.status.${event.status}`;
  return "supportFlow.portal.eventLabels.updated";
}

type SupportServiceRequest = <T>(path: string, body: Record<string, unknown>) => Promise<T>;
function CaseFeedback({ item, onSaved, consent, canSubmit, requestService }: { item: CaseItem; onSaved: () => Promise<void>;
  consent: ReturnType<typeof useInlineStudentConsent>; canSubmit: () => boolean; requestService: SupportServiceRequest }) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<Record<(typeof feedbackKeys)[number], boolean | null>>({
    feltHeard: null, foundHelp: null, boundariesRespected: null, wouldChooseAgain: null,
  });
  const [complaint, setComplaint] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; urgent?: boolean } | null>(null);
  async function submit() {
    if (busy || !canSubmit()) return;
    const current = consent.trackRequest();
    setBusy(true);
    setNotice(null);
    try {
      const result = await requestService<{ urgent: boolean }>("/api/support/feedback", {
        caseId: item.id, ...answers, complaint, comment,
      });
      if (!current()) return;
      await onSaved();
      if (!current()) return;
      setNotice({ message: t("supportFlow.portal.feedbackSaved"), urgent: result.urgent });
    } catch (caught) {
      if (!current()) return;
      setNotice({ message: caught instanceof Error ? caught.message : t("supportFlow.errors.unavailable") });
    } finally { if (current()) setBusy(false); }
  }
  if (item.feedbackSubmitted) return <p className="mt-4 text-sm text-muted">{t("supportFlow.portal.feedbackDone")}</p>;
  return (
    <div className="mt-5 border-t border-ink/10 pt-5">
      <h4 className="font-bold">{t("supportFlow.portal.feedbackTitle")}</h4>
      <div className="mt-3 grid gap-3">
        {feedbackKeys.map((key) => (
          <fieldset key={key}>
            <legend className="text-sm font-bold">{t(`supportFlow.portal.feedbackQuestions.${key}`)}</legend>
            <div className="mt-1 flex flex-wrap gap-4 text-sm">
              {([true, false] as const).map((answer) => (
                <label key={String(answer)} className="flex items-center gap-2">
                  <input type="radio" name={`${item.id}-${key}`} checked={answers[key] === answer}
                    onChange={() => setAnswers((current) => ({ ...current, [key]: answer }))} />
                  {t(answer ? "microFeedback.yes" : "microFeedback.no")}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={complaint} onChange={(event) => setComplaint(event.target.checked)} />
          {t("supportFlow.portal.complaint")}
        </label>
        <label className="text-sm font-bold">{t("supportFlow.portal.comment")}
          <textarea rows={2} maxLength={500} className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3 font-normal"
            value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        <button type="button" className="button-secondary w-fit" disabled={busy} onClick={submit}>{t("supportFlow.portal.feedbackSubmit")}</button>
        {notice ? <p role={notice.urgent ? "alert" : "status"} className="text-sm">
          {notice.message}
          {notice.urgent ? <> <a href="#support-immediate-help" className="font-bold text-sage-dark underline">
            {t("supportFlow.portal.immediateHelpTitle")}
          </a></> : null}
        </p> : null}
      </div>
    </div>
  );
}

export default function CasePortal({ mode }: { mode: "youth" | "adult" }) {
  const { locale, t } = useTranslation();
  const consent = useInlineStudentConsent();
  const actor = useSessionActor();
  const readEpoch = useRef(0);
  const termAttempts = useRef(new Map<string, TerminationAttempt>());
  const [termView, setTermView] = useState(new Map<string, TerminationAttempt>());
  const confirmed = useRef(new Map<string, ConfirmedTermination[]>());
  const [confirmedView, setConfirmedView] = useState(new Map<string, ConfirmedTermination[]>());
  const identityGate = useRef({ blocked: false, revision: 0 });
  const [identityBlocked, setIdentityBlocked] = useState(false);
  const [lastWriteOutcome, setLastWriteOutcome] = useState<{ phase: TerminationPhase; current: () => boolean } | null>(null);
  const dataSnapshot = useRef<PortalData | null>(null);
  const [dataKey, setDataKey] = useState("");
  const historyKey = JSON.stringify([locale, actor.actorId, actor.phase, consent.userId, consent.phase, consent.studentReady]);
  const draftOwner = useRef("");
  const [data, setData] = useState<PortalData | null>(null);
  const [needSummary, setNeedSummary] = useState("");
  const [availability, setAvailability] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const createInFlight = useRef(false);
  const createRecoveryRef = useRef<CreateRecovery | null>(null);
  const [createRecovery, setCreateRecovery] = useState<CreateRecovery | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [feedbackTrigger, setFeedbackTrigger] = useState(0);
  const [urgent, setUrgent] = useState(false);
  useEffect(() => {
    if (draftOwner.current && draftOwner.current !== consent.userId) {
      setNeedSummary(""); setAvailability(""); setData(null); setNotice(""); setError(""); setUrgent(false);
      createInFlight.current = false; createRecoveryRef.current = null; setCreateRecovery(null);
      setBusy(false); setFeedbackTrigger(0);
    }
    draftOwner.current = consent.userId;
  }, [consent.userId]);
  const isAdult = mode === "adult";
  const referralHref = isAdult ? YOUNG_ADULT_REFERRAL_HREF : "/referral";
  const visibleData = !identityBlocked && actor.phase === "ready" && consent.phase !== "signed_out" && dataKey === historyKey ? data : null;
  const allowed = visibleData && visibleData.canUseNewService && consent.studentReady
    && consent.userId === actor.actorId && (isAdult ? visibleData.ageBand === "18_plus" && visibleData.consultationAvailable : visibleData.ageBand === "14_17");
  const canActOn = (item: CaseItem) => Boolean(allowed && item.case_type === (isAdult ? "adult_consultation" : "youth_request"));
  function hideIdentity() {
    identityGate.current = { blocked: true, revision: identityGate.current.revision + 1 };
    ++readEpoch.current;
    dataSnapshot.current = null;
    setIdentityBlocked(true); setData(null); setDataKey(""); setNotice(""); setLoading(false); setBusy(false);
    setError(t("supportFlow.portal.historyIdentity"));
    // Keep actor-scoped success records and accurate write outcomes in memory.
  }
  const confirmedKey = (id: string, action: TerminationAction) => `${id}:${action}`;
  const hasConfirmedRecord = (records: ConfirmedTermination[], item: CaseItem, action: TerminationAction) =>
    records.some((record) => record.current() && (action !== "cancel_appointment"
      || record.receipt.matchedRevision === item.row_revision));
  const hasConfirmed = (item: CaseItem, action: TerminationAction) =>
    hasConfirmedRecord(confirmedView.get(confirmedKey(item.id, action)) || [], item, action);
  const hasConfirmedSynchronously = (item: CaseItem, action: TerminationAction) =>
    hasConfirmedRecord(confirmed.current.get(confirmedKey(item.id, action)) || [], item, action);
  const confirmedForCase = (records: ConfirmedTermination[], item: CaseItem) =>
    records.some((record) => record.caseId === item.id && record.current());
  const anyConfirmed = (item: CaseItem) =>
    [...confirmedView.values()].some((records) => confirmedForCase(records, item));
  const anyConfirmedSynchronously = (item: CaseItem) =>
    [...confirmed.current.values()].some((records) => confirmedForCase(records, item));
  const termAttempt = (id: string) => {
    const value = termView.get(id);
    return value?.current() ? value : null;
  };
  const publishTermAttempt = (id: string, value: TerminationAttempt) => {
    termAttempts.current.set(id, value);
    setTermView(new Map(termAttempts.current));
  };
  const caseWriteBlocked = (item: CaseItem) => {
    const value = termAttempt(item.id);
    return Boolean(value && (value.phase === "saving" || value.phase === "unknown"
      || ((value.phase === "rejected" || value.phase === "not_sent") && !value.reread)));
  };
  const canTerminate = (item: CaseItem, action: TerminationAction) => {
    const owned = visibleData?.cases.find((value) => value.id === item.id);
    return Boolean(actor.phase === "ready" && !loading && owned === item
      && ["youth_request", "adult_consultation"].includes(item.case_type)
      && validTermination(item, action) && !caseWriteBlocked(item) && !hasConfirmed(item, action)
      && (action !== "cancel_appointment" || uuidValue(item.row_revision)));
  };
  const canTakeAction = (item: CaseItem, action: CaseAction) => isTerminationAction(action)
    ? canTerminate(item, action)
    : canActOn(item) && item.student_authorization_active === true && !caseWriteBlocked(item);
  const canShowFeedback = (item: CaseItem) => canActOn(item) && !caseWriteBlocked(item)
    && !anyConfirmed(item);
  const adultAvailabilityReason: AdultAvailabilityReason = visibleData?.adultAvailabilityReason
    || (visibleData?.consultationAvailable ? "available" : "unavailable");
  const adultAvailabilityKey: TranslationKey = adultAvailabilityReason === "not_open"
    ? "supportFlow.portal.adultNotOpen"
    : adultAvailabilityReason === "ineligible"
      ? "supportFlow.portal.adultIneligible"
      : "supportFlow.portal.adultEligibilityUnavailable";
  const historyOnlyKey: TranslationKey = visibleData?.historyReason === "withdrawn"
    ? "supportFlow.portal.historyWithdrawn"
    : isAdult ? adultAvailabilityKey : "supportFlow.portal.historyOnly";
  const heroKeys = visibleData && !allowed
    ? [isAdult ? "supportFlow.portal.adultLabel" : "supportFlow.portal.youthLabel", "supportFlow.portal.cases",
      historyOnlyKey] as const
    : isAdult
      ? ["supportFlow.portal.adultLabel", "supportFlow.portal.adultTitle",
        visibleData ? "supportFlow.portal.adultDescription" : "supportFlow.portal.adultReadDescription"] as const
      : ["supportFlow.portal.youthLabel", "supportFlow.portal.youthTitle", "supportFlow.portal.youthDescription"] as const;

  const refresh = useCallback(async (): Promise<boolean> => {
    if (identityGate.current.blocked) return false;
    const revision = ++readEpoch.current;
    const currentActor = actor.trackRequest();
    const currentConsent = consent.trackRequest();
    const current = () => revision === readEpoch.current && currentActor() && currentConsent()
      && !identityGate.current.blocked;
    setError(""); setLoading(true);
    try {
      let token: string;
      try { token = await actor.getToken(actor.actorId); }
      catch { if (current()) hideIdentity(); return false; }
      if (!current()) return false;
      const response = await fetch(`/api/support/cases?locale=${encodeURIComponent(locale)}`, {
        method: "GET", cache: "no-store", headers: { authorization: `Bearer ${token}` },
      });
      if (!current()) return false;
      if (response.status === 401 || response.status === 403) { hideIdentity(); return false; }
      const result = await response.json() as PortalData;
      if (!current()) return false;
      if (!response.ok || !Array.isArray(result.cases)) throw new Error(t("supportFlow.errors.unavailable"));
      for (const [id, attempt] of termAttempts.current) {
        if (attempt.current() && ["rejected", "not_sent"].includes(attempt.phase) && revision > attempt.readAtOutcome) {
          termAttempts.current.set(id, { ...attempt, reread: true });
        }
      }
      setTermView(new Map(termAttempts.current));
      dataSnapshot.current = result;
      setData(result); setDataKey(historyKey);
      return true;
    } catch {
      if (!current()) return false;
      dataSnapshot.current = null; setData(null); setError(t("supportFlow.errors.unavailable"));
      return false;
    } finally { if (current()) setLoading(false); }
  // Lifetime guards + historyKey retire old reads; no POST is queued by recovery.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey]);

  async function verifyIdentityAndReload() {
    if (!identityGate.current.blocked || actor.phase !== "ready") return;
    const gateRevision = ++identityGate.current.revision;
    const readRevision = ++readEpoch.current;
    const currentActor = actor.trackRequest();
    const currentConsent = consent.trackRequest();
    const current = () => currentActor() && currentConsent() && identityGate.current.blocked
      && identityGate.current.revision === gateRevision && readEpoch.current === readRevision;
    setLoading(true); setError("");
    try {
      const token = await actor.getToken(actor.actorId);
      if (!current()) return;
      const supabase = getSupabase();
      if (!supabase) throw new Error("identity_unavailable");
      const identity = await supabase.auth.getUser(token); // Read-only server identity verification.
      if (!current()) return;
      if (identity.error || identity.data.user?.id !== actor.actorId) throw new Error("identity_unavailable");
      const response = await fetch(`/api/support/cases?locale=${encodeURIComponent(locale)}`, {
        method: "GET", cache: "no-store", headers: { authorization: `Bearer ${token}` },
      });
      if (!current()) return;
      const result = await response.json() as PortalData;
      if (!current()) return;
      if (!response.ok || !Array.isArray(result.cases)) throw new Error("history_unavailable");
      // Only this identity-verified, later GET can lift the barrier.
      for (const [id, attempt] of termAttempts.current) {
        if (attempt.current() && ["rejected", "not_sent"].includes(attempt.phase) && readRevision > attempt.readAtOutcome) {
          termAttempts.current.set(id, { ...attempt, reread: true });
        }
      }
      setTermView(new Map(termAttempts.current));
      dataSnapshot.current = result;
      setData(result); setDataKey(historyKey);
      identityGate.current.blocked = false; setIdentityBlocked(false); setLoading(false);
    } catch {
      if (!current()) return;
      dataSnapshot.current = null; setData(null); setDataKey(""); setLoading(false);
      setError(t("supportFlow.portal.historyIdentity"));
    }
  }

  useEffect(() => {
    ++readEpoch.current;
    dataSnapshot.current = null;
    setData(null);
    setError("");
    setBusy(false);
    setLoading(!identityGate.current.blocked && (actor.phase === "loading" || consent.phase === "loading"));
    if (!identityGate.current.blocked && actor.phase === "ready" && consent.phase !== "loading" && consent.phase !== "signed_out") void refresh();
    return () => { ++readEpoch.current; };
  }, [refresh, actor.phase, consent.phase]);

  async function requestService<T>(path: string, body: Record<string, unknown>): Promise<T> {
    setLastWriteOutcome(null);
    const currentActor = actor.trackRequest();
    const currentConsent = consent.trackRequest();
    if (identityGate.current.blocked || !allowed) throw new Error(t("supportFlow.portal.historyIdentity"));
    let token: string;
    try { token = await actor.getToken(actor.actorId); }
    catch {
      if (currentActor() && currentConsent()) {
        setLastWriteOutcome({ phase: "not_sent", current: currentActor }); hideIdentity();
      }
      throw new Error(t("supportFlow.portal.historyIdentity"));
    }
    if (!currentActor() || !currentConsent() || identityGate.current.blocked) {
      throw new Error(t("supportFlow.portal.historyIdentity"));
    }
    const response = await fetch(`${path}?locale=${encodeURIComponent(locale)}`, {
      method: "POST", cache: "no-store", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...body, locale }),
    });
    if (currentActor() && (response.status === 401 || response.status === 403)) hideIdentity();
    const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
    if (!response.ok || !payload) throw new Error(payload?.error || t("supportFlow.errors.unavailable"));
    return payload;
  }

  async function requestCaseCreation(body: Record<string, unknown>, current: () => boolean): Promise<CreateReceipt> {
    let token: string;
    let identityTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      token = await Promise.race([actor.getToken(actor.actorId), new Promise<never>((_, reject) => {
        identityTimeout = setTimeout(() => reject(new CreateCaseError("identity", "notSent")), 10_000);
      })]);
      if (!current() || identityGate.current.blocked) throw new CreateCaseError("identity", "notSent");
    } catch {
      throw new CreateCaseError("identity", "notSent");
    } finally { clearTimeout(identityTimeout); }

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const expired = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new CreateCaseError("timeout", "unknown"));
        }, 10_000);
      });
      const response = await Promise.race([fetch(`/api/support/cases?locale=${encodeURIComponent(locale)}`, {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ ...body, locale }),
      }), expired]);
      if (!current()) throw new CreateCaseError("identity", "unknown");
      if (response.status === 401) throw new CreateCaseError("identity", "rejected");
      if (response.status === 403) throw new CreateCaseError("forbidden", "rejected");
      if (response.status === 429) throw new CreateCaseError("limited", "rejected");
      if (response.status === 400) throw new CreateCaseError("invalid", "rejected");
      if (!response.ok) throw new CreateCaseError("unavailable", "unknown");
      const payload: unknown = await response.json().catch(() => null);
      if (!validCreateReceipt(payload)) throw new CreateCaseError("unavailable", "unknown");
      return payload;
    } catch (caught) {
      if (caught instanceof CreateCaseError) throw caught;
      throw new CreateCaseError(controller.signal.aborted ? "timeout"
        : caught instanceof TypeError ? "offline" : "unavailable", "unknown");
    } finally { clearTimeout(timeout); }
  }

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (identityGate.current.blocked || !allowed || busy || createInFlight.current || createRecoveryRef.current?.current()) return;
    if (!consent.studentReady) { setError(t("inlineConsent.consentNeeded")); return; }
    const currentConsent = consent.trackRequest();
    const currentActor = actor.trackRequest();
    const current = () => currentConsent() && currentActor();
    createInFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setUrgent(false);
    try {
      const result = await requestCaseCreation({
        type: isAdult ? "adult_consultation" : "youth_request",
        needSummary, availability,
      }, current);
      if (!current()) return;
      createRecoveryRef.current = null; setCreateRecovery(null);
      setNeedSummary("");
      setAvailability("");
      setUrgent(result.urgent);
      setNotice(t("supportFlow.portal.submitted"));
      await refresh();
    } catch (caught) {
      if (!current()) return;
      const failure = caught instanceof CreateCaseError
        ? caught : new CreateCaseError("unavailable", "unknown");
      if (failure.outcome === "unknown") {
        const recovery: CreateRecovery = {
          reason: failure.reason === "offline" || failure.reason === "timeout" ? failure.reason : "unavailable",
          checked: false,
          current,
        };
        createRecoveryRef.current = recovery; setCreateRecovery(recovery); setError("");
      } else if (failure.reason === "identity") {
        hideIdentity();
      } else {
        setError(t(failure.reason === "forbidden" ? "supportFlow.errors.noAccess"
          : failure.reason === "limited" ? "supportFlow.errors.tooMany"
            : failure.reason === "invalid" ? "supportFlow.errors.invalid" : "supportFlow.errors.unavailable"));
      }
    } finally {
      createInFlight.current = false;
      if (current()) setBusy(false);
    }
  }

  async function checkCreateOutcome() {
    const recovery = createRecoveryRef.current;
    if (!recovery?.current() || recovery.checked) return;
    if (await refresh()) {
      const latest = createRecoveryRef.current;
      if (latest === recovery && latest.current()) {
        const checked = { ...latest, checked: true };
        createRecoveryRef.current = checked; setCreateRecovery(checked);
      }
    }
  }

  async function terminate(item: CaseItem, action: TerminationAction) {
    const existing = termAttempts.current.get(item.id);
    if (identityGate.current.blocked || !dataSnapshot.current?.cases.includes(item)
      || hasConfirmedSynchronously(item, action) || busy || !canTerminate(item, action)
      || (existing?.current() && (existing.phase === "unknown" || existing.phase === "saving"
        || (["rejected", "not_sent"].includes(existing.phase) && !existing.reread)))
      || [...termAttempts.current.values()].some((value) => value.current() && value.phase === "saving")) return;
    const current = actor.trackRequest();
    const sameConsentForRefresh = consent.trackRequest();
    const readAtStart = readEpoch.current;
    const attempt: TerminationAttempt = { action, phase: "saving", current, readAtOutcome: readEpoch.current, reread: false };
    publishTermAttempt(item.id, attempt);
    const pending = () => current() && termAttempts.current.get(item.id) === attempt;
    const finish = (phase: TerminationPhase) => {
      if (pending()) {
        publishTermAttempt(item.id, { ...attempt, phase, readAtOutcome: readEpoch.current });
        setLastWriteOutcome({ phase, current });
      }
    };
    setError(""); setNotice(""); setLastWriteOutcome(null);
    let dispatched = false;
    try {
      let token: string;
      try { token = await actor.getToken(actor.actorId); }
      catch { if (pending()) { finish("not_sent"); hideIdentity(); } return; }
      if (!pending() || identityGate.current.blocked) { if (pending()) finish("not_sent"); return; }
      dispatched = true;
      const response = await fetch(`/api/support/case-action?locale=${encodeURIComponent(locale)}`, {
        method: "POST", cache: "no-store",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ caseId: item.id, action, expectedStatus: item.status,
          ...(action === "cancel_appointment" ? { expectedAppointmentRevision: item.row_revision } : {}), locale }),
      });
      if (!pending()) return;
      // HTTP status retires private reads immediately, even if its body is malformed.
      if (response.status === 401 || response.status === 403) hideIdentity();
      const payload: unknown = await response.json().catch(() => null);
      if (!pending()) return;
      const result = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
      if ([400, 401, 403, 404, 409].includes(response.status) && typeof result?.error === "string") {
        finish("rejected"); return;
      }
      if (response.status !== 200 || !validReceipt(payload, item, action)) { finish("unknown"); return; }
      const key = confirmedKey(item.id, action);
      const record: ConfirmedTermination = { caseId: item.id, action, current, receipt: payload };
      confirmed.current.set(key, [...(confirmed.current.get(key) || []), record]); // Before React commit.
      setConfirmedView(new Map(confirmed.current));
      finish("saved");
      if (!identityGate.current.blocked && sameConsentForRefresh() && readEpoch.current === readAtStart) await refresh();
    } catch {
      finish(dispatched ? "unknown" : "not_sent");
    }
  }

  function currentCaseWriteBlocked(item: CaseItem, forFeedback = false) {
    const attempt = termAttempts.current.get(item.id);
    return identityGate.current.blocked || (forFeedback && anyConfirmedSynchronously(item)) || Boolean(attempt?.current() && (attempt.phase === "saving" || attempt.phase === "unknown"
      || (["rejected", "not_sent"].includes(attempt.phase) && !attempt.reread)
      ));
  }

  async function act(item: CaseItem, action: CaseAction) {
    if (isTerminationAction(action)) { await terminate(item, action); return; }
    if (busy || currentCaseWriteBlocked(item) || !canActOn(item) || item.student_authorization_active !== true) return;
    const currentConsent = consent.trackRequest();
    const currentActor = actor.trackRequest();
    const current = () => currentConsent() && currentActor();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await requestService("/api/support/case-action", { caseId: item.id, action });
      if (!current()) return;
      await refresh();
      if (!current()) return;
      setNotice(t("supportFlow.portal.actionSaved"));
    } catch (caught) {
      if (!current()) return;
      setError(caught instanceof Error ? caught.message : t("supportFlow.errors.unavailable"));
    } finally { if (current()) setBusy(false); }
  }

  function actions(item: CaseItem): CaseAction[] {
    if (["requested", "triage", "awaiting_assignment"].includes(item.status)) return ["cancel"];
    if (item.status === "assigned") return ["accept_assignment", "reject_assignment", "cancel"];
    if (item.status === "active") {
      return [
        ...(item.appointment_status === "proposed" ? ["accept_appointment"] as const : []),
        ...(["proposed", "accepted"].includes(item.appointment_status)
          ? ["request_reschedule", "cancel_appointment"] as const : []),
        "request_change", "withdraw_authorization", "close",
      ];
    }
    if (["paused", "transfer_requested"].includes(item.status)) return ["withdraw_authorization", "close"];
    if (["transferred", "referred"].includes(item.status)) return ["close"];
    return [];
  }

  return (
    <>
      <PageHero
        label={t(heroKeys[0])}
        title={t(heroKeys[1])}
        subtitle={t(heroKeys[2])}
        action={<Link href={referralHref} className="button-secondary">{t("supportFlow.closed.referral")}</Link>}
      />
      <div className="section section-muted">
        <div className="container max-w-4xl space-y-5">
          <section id="support-immediate-help" aria-labelledby="support-immediate-help-title"
            className={`rounded-2xl p-5 ${urgent ? "border-2 border-clay bg-clay-soft/40" : "border border-sage/25 bg-white"}`}>
            <h2 id="support-immediate-help-title" className="flex items-center gap-2 text-lg font-bold">
              {urgent ? <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-current">!</span> : null}
              {t("supportFlow.portal.immediateHelpTitle")}
            </h2>
            <p key={urgent ? "urgent" : "default"} role={urgent ? "alert" : undefined} aria-atomic="true"
              className={`mt-2 text-sm leading-7 ${urgent ? "font-bold text-ink" : "text-muted"}`}>
              {t("supportFlow.portal.urgent")}
            </p>
          </section>
          {allowed || actor.phase === "signed_out" || consent.phase === "signed_out"
            || (actor.phase === "ready" && !error && consent.phase === "needs_consent" && consent.summary?.consent?.status === "not_started") ? <InlineStudentConsent controller={consent} studentOnly /> : null}
          {loading ? <p role="status">{t("peerSpace.loading")}</p> : null}
          {visibleData && !allowed ? <div role="status" className="card" data-testid="support-history-only">
            <p>{t(historyOnlyKey)}</p>
            {isAdult && visibleData.historyReason !== "withdrawn" && adultAvailabilityReason === "unavailable" ?
              <button type="button" className="button-secondary mt-3" disabled={loading}
                onClick={() => { void refresh(); }}>{t("supportFlow.portal.historyRetry")}</button> : null}
          </div> : null}
          {error || actor.phase === "error" || identityBlocked ? <div className="card" data-testid="support-history-error">
            <p role="alert">{error || t("supportFlow.portal.historyIdentity")}</p>
            {identityBlocked && lastWriteOutcome?.current() ? <p role="status">{t(
              lastWriteOutcome.phase === "not_sent" ? "supportFlow.portal.terminationNotSent"
                : lastWriteOutcome.phase === "rejected" ? "supportFlow.portal.terminationDenied"
                : lastWriteOutcome.phase === "saved" ? "supportFlow.portal.actionSaved"
                : "supportFlow.portal.terminationUnknown")}</p> : null}
            <button type="button" className="button-secondary mt-3" disabled={loading} onClick={() => {
              if (identityGate.current.blocked && actor.phase === "ready") void verifyIdentityAndReload();
              else if (actor.phase === "ready") void refresh();
              else void actor.refreshIdentity();
            }}>{t(actor.phase === "ready" && !identityBlocked ? "supportFlow.portal.historyRetry" : "supportFlow.portal.historyVerify")}</button>
          </div> : null}
          {createRecovery?.current() ? <div className="card" data-testid="support-create-recovery" role="alert">
            <p>{t("supportFlow.portal.createUnknown")}</p>
            <p className="mt-2">{t(createRecovery.reason === "offline" ? "supportFlow.portal.createUnknownOffline"
              : createRecovery.reason === "timeout" ? "supportFlow.portal.createUnknownTimeout"
                : "supportFlow.portal.createUnknownUnavailable")}</p>
            {createRecovery.checked ? <>
              <p className="mt-2">{t("supportFlow.portal.createUnknownChecked")}</p>
              <button type="button" className="button-secondary mt-3" data-testid="support-create-acknowledge"
                onClick={() => {
                  if (createRecoveryRef.current?.checked) {
                    createRecoveryRef.current = null; setCreateRecovery(null);
                  }
                }}>{t("supportFlow.portal.createUnknownAcknowledge")}</button>
            </> : <button type="button" className="button-secondary mt-3" disabled={loading}
              onClick={() => { void checkCreateOutcome(); }}>{t("supportFlow.portal.historyRetry")}</button>}
          </div> : null}
          {notice ? <p role="status" className="rounded-xl bg-mint p-4 text-sm">{notice}</p> : null}
          {!identityBlocked && [...confirmedView.entries()].map(([key, records]) => {
            const record = [...records].reverse().find((value) => value.current());
            return record ? <p key={key} role="status" className="rounded-xl bg-mint p-4 text-sm">
              {t(`supportFlow.portal.actions.${record.action}`)}: {t("supportFlow.portal.actionSaved")}
              <button type="button" className="button-secondary ml-2" disabled={loading}
                onClick={() => { void refresh(); }}>{t("supportFlow.portal.historyRetry")}</button>
            </p> : null;
          })}
          {!identityBlocked && [...termView.entries()].filter(([, attempt]) => attempt.current() && attempt.phase !== "saved").map(([id, attempt]) => (
            <div key={id} className="card text-sm" role={attempt.phase === "unknown" ? "alert" : "status"}>
              <p>{t(`supportFlow.portal.actions.${attempt.action}`)}: {t(
                attempt.phase === "saved" ? "supportFlow.portal.actionSaved"
                  : attempt.phase === "saving" ? "supportFlow.portal.saving"
                  : attempt.phase === "unknown" ? "supportFlow.portal.terminationUnknown"
                  : attempt.phase === "not_sent" ? "supportFlow.portal.terminationNotSent"
                  : "supportFlow.portal.terminationDenied")}</p>
              {attempt.phase !== "saving" ?
                <button type="button" className="button-secondary mt-2" disabled={loading}
                  onClick={() => { void refresh(); }}>{t("supportFlow.portal.historyRetry")}</button> : null}
            </div>
          ))}
          {isAdult && !allowed ? (
            <section className="card">
              <div className="flex flex-wrap gap-3">
                <Link href="/garden" className="button-secondary">{t("supportFlow.closed.record")}</Link>
                <Link href="/peer-space" className="button-secondary">{t("supportFlow.closed.peer")}</Link>
                <Link href={referralHref} className="button-secondary">{t("supportFlow.closed.referral")}</Link>
              </div>
            </section>
          ) : null}
          {allowed ? (
            <>
              {isAdult ? (
                <section className="card">
                  <h2 className="text-lg font-bold">{t("supportFlow.portal.categoriesTitle")}</h2>
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7">
                    {(["counselor", "socialWorker", "listener", "schoolDuty"] as const).map((key) =>
                      <li key={key}>{t(`supportFlow.portal.categories.${key}`)}</li>)}
                  </ul>
                </section>
              ) : null}
              <section className="card">
                <h2 className="text-xl font-bold">{t("supportFlow.portal.newTitle")}</h2>
                <form onSubmit={createCase} className="mt-4 grid gap-4">
                  <label className="text-sm font-bold">{t("supportFlow.portal.need")}
                    <textarea required maxLength={1000} rows={4} className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3 font-normal"
                      value={needSummary} onChange={(event) => setNeedSummary(event.target.value)} />
                  </label>
                  <label className="text-sm font-bold">{t("supportFlow.portal.availability")}
                    <input maxLength={500} className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3 font-normal"
                      value={availability} onChange={(event) => setAvailability(event.target.value)} />
                  </label>
                  <button type="submit" className="button-primary w-fit" disabled={busy || Boolean(createRecovery?.current()) || !needSummary.trim()}>
                    {busy ? t("supportFlow.portal.saving") : t("supportFlow.portal.submit")}
                  </button>
                </form>
              </section>
            </>
          ) : null}
          {visibleData ? (
              <section>
                <h2 className="text-xl font-bold">{t("supportFlow.portal.cases")}</h2>
                {!visibleData.cases.length ? <p className="card mt-4 text-sm text-muted">{t("supportFlow.portal.empty")}</p> : null}
                <div className="mt-4 grid gap-4">
                  {visibleData.cases.map((item) => (
                    <article key={item.id} className="card min-w-0">
                      <div className="flex flex-wrap justify-between gap-3">
                        <h3 className="font-bold">{t(`supportFlow.portal.status.${item.status}`)}</h3>
                        <time dateTime={item.created_at} className="text-xs text-muted">
                          {new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", { dateStyle: "medium" }).format(new Date(item.created_at))}
                        </time>
                      </div>
                      <p className="mt-3 break-words whitespace-pre-wrap text-sm leading-7">{item.need_summary}</p>
                      {item.assignments.map((assignment) => (
                        <p key={assignment.role} className="mt-3 text-sm">
                          <strong>{t(assignment.role === "primary" ? "supportFlow.portal.primary" : "supportFlow.portal.backup")}:</strong>{" "}
                          {assignment.name || t("supportFlow.portal.pendingOffer")}
                        </p>
                      ))}
                      {item.appointment_at ? <p className="mt-3 text-sm">
                        <strong>{t("supportFlow.portal.appointment")}:</strong>{" "}
                        {new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.appointment_at))}
                        {" · "}{t(`supportFlow.portal.appointmentStatus.${item.appointment_status}`)}
                      </p> : null}
                      <div className="mt-4 flex flex-wrap gap-3">
                        {actions(item).map((action) => <button key={action} type="button" className={`button-secondary text-sm disabled:cursor-not-allowed disabled:opacity-50${action === "withdraw_authorization" ? " max-w-full whitespace-normal" : ""}`}
                          disabled={busy || !canTakeAction(item, action)} onClick={() => act(item, action)}>{t(`supportFlow.portal.actions.${action}`)}</button>)}
                      </div>
                      <details className="mt-5 border-t border-ink/10 pt-3">
                        <summary className="cursor-pointer text-sm font-bold">{t("supportFlow.portal.timeline")}</summary>
                        <ol className="mt-3 space-y-2 text-xs text-muted">
                          {item.events.map((event, index) => <li key={`${event.createdAt}-${index}`}>
                            <time dateTime={event.createdAt}>{new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(event.createdAt))}</time>
                            {" · "}{t(eventLabelKey(event))}
                          </li>)}
                        </ol>
                      </details>
                      {canShowFeedback(item) && ["closed", "referred"].includes(item.status) ? <CaseFeedback key={`${consent.userId}:${item.id}`} item={item} onSaved={async () => { await refresh(); }} consent={consent}
                        canSubmit={() => !identityGate.current.blocked && actor.isSameActor(consent.userId) && canActOn(item) && !currentCaseWriteBlocked(item, true)}
                        requestService={requestService} /> : null}
                    </article>
                  ))}
                </div>
              </section>
          ) : null}
          {allowed ? <MicroPilotFeedback feature="support" trigger={feedbackTrigger} crisis={urgent} /> : null}
        </div>
      </div>
    </>
  );
}
