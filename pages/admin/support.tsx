import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/client";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";
import { useSessionActor, type SessionActor } from "@/lib/useSessionActor";
import { supportCaseStatusKey, supportStaffStatusKey, supportStaffCategoryKey, supportAssignmentRoleKey,
  supportAssignmentStatusKey, reviewPriorityKey, supportFeedbackStatusKey } from "@/lib/userStatusLabels";

type Staff = {
  user_id: string;
  category: "counselor" | "social_worker" | "listening_volunteer" | "school_duty_teacher";
  status: string;
  legal_name: string;
  evidence_path: string | null;
  age_scopes: string[];
  review_note: string | null;
  training_count: number;
};
type Case = {
  id: string;
  case_type: "youth_request" | "adult_consultation";
  status: string;
  risk_priority: string;
  need_summary: string;
  appointment_at: string | null;
  student_authorization_active: boolean;
  created_at: string;
  assignments: Array<{ id: string; staff_user_id: string; assignment_role: string; status: string }>;
};
type FeedbackSummary = {
  count: number;
  pendingComplaints: number;
  sampleLimited: boolean;
  ratios: { feltHeard: number | null; foundHelp: number | null; boundariesRespected: number | null; wouldChooseAgain: number | null };
  feedback: Array<{ caseId: string; complaint: boolean; safetyReview: boolean; comment: string | null; reviewStatus: string; createdAt: string }>;
};
const caseActions = ["triage", "ready_for_assignment", "offer_primary", "offer_backup", "transfer",
  "propose_appointment", "pause", "resume", "refer", "close"] as const;
const staffStatuses = ["trial", "approved", "paused", "removed", "rejected"] as const;
const referralTypes = ["school", "social_work", "medical", "professional", "community"] as const;

export default function AdminSupportPage() {
  const actor = useSessionActor();
  const { t } = useTranslation();
  if (actor.phase === "ready") return <AdminSupportContent key={actor.actorId} actor={actor} />;
  return <section className="section section-muted min-h-[70vh]"><div className="container max-w-6xl space-y-6">
    <Link href="/admin" className="text-sm font-bold text-sage-dark underline">{t("adminSupport.back")}</Link>
    <h1 className="mt-4 text-3xl font-black">{t("adminSupport.title")}</h1>
    {actor.phase === "loading" ? <p role="status">{t("peerSpace.loading")}</p> : <>
      {actor.phase === "error" ? <><p role="alert">{t("roleFollowup.professional.sessionFailed")}</p>
        <button type="button" className="button-secondary" onClick={() => void actor.refreshIdentity()}>{t("roleFollowup.professional.retry")}</button></> : null}
      <Link href={{ pathname: "/account", query: { next: "/admin/support" } }} className="button-secondary">{t("roleFollowup.professional.signInWorkbench")}</Link>
    </>}
  </div></section>;
}

function AdminSupportContent({ actor }: { actor: SessionActor }) {
  const { locale, t } = useTranslation();
  const loadSeq = useRef(0);
  const inFlight = useRef(false);
  const request = useCallback(<T,>(path: string, method = "GET", body?: Record<string, unknown>) =>
    peerSpaceRequest<T>(path, locale, method, body, actor.actorId), [locale, actor.actorId]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [feedback, setFeedback] = useState<FeedbackSummary | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<(typeof staffStatuses)[number]>("approved");
  const [reviewNote, setReviewNote] = useState("");
  const [trainingTitle, setTrainingTitle] = useState("");
  const [trainingDate, setTrainingDate] = useState("");
  const [caseAction, setCaseAction] = useState<(typeof caseActions)[number]>("triage");
  const [staffUserId, setStaffUserId] = useState("");
  const [caseNote, setCaseNote] = useState("");
  const [appointmentAt, setAppointmentAt] = useState("");
  const [referralType, setReferralType] = useState<(typeof referralTypes)[number]>("school");
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteSchoolId, setInviteSchoolId] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState(false);
  const currentStaff = staff.find((item) => item.user_id === selectedStaff) || null;
  const currentCase = cases.find((item) => item.id === selectedCase) || null;
  const eligibleStaff = staff.filter((item) => item.status === "approved"
    && item.age_scopes.includes(currentCase?.case_type === "adult_consultation" ? "18_plus" : "14_17")
    && (currentCase?.case_type !== "adult_consultation" || item.category === "counselor"));

  const clearPrivateData = useCallback(() => {
    setStaff([]); setCases([]); setFeedback(null); setSelectedStaff(null); setSelectedCase(null);
    setReviewStatus("approved"); setReviewNote(""); setTrainingTitle(""); setTrainingDate("");
    setCaseAction("triage"); setStaffUserId(""); setCaseNote(""); setAppointmentAt(""); setReferralType("school");
    setInviteUserId(""); setInviteSchoolId(""); setInviteName(""); setFeedbackNote(""); setNotice(false);
  }, []);

  const refresh = useCallback(async () => {
    const current = actor.trackRequest();
    const sequence = ++loadSeq.current;
    setLoading(true); setError(false);
    try {
      const [staffResponse, caseResponse, feedbackResponse] = await Promise.all([
        request<{ applications: Staff[] }>("/api/admin/support/staff"),
        request<{ cases: Case[] }>("/api/admin/support/cases"),
        request<FeedbackSummary>("/api/admin/support/feedback"),
      ]);
      if (!current() || sequence !== loadSeq.current) return false;
      if (!Array.isArray(staffResponse.applications) || !Array.isArray(caseResponse.cases)
        || !Array.isArray(feedbackResponse.feedback) || !feedbackResponse.ratios) throw new Error("invalid_response");
      setStaff(staffResponse.applications); setCases(caseResponse.cases); setFeedback(feedbackResponse);
      setSelectedStaff((previous) => previous && staffResponse.applications.some((item) => item.user_id === previous)
        ? previous : staffResponse.applications[0]?.user_id || null);
      setSelectedCase((previous) => previous && caseResponse.cases.some((item) => item.id === previous)
        ? previous : caseResponse.cases[0]?.id || null);
      return true;
    } catch {
      if (current() && sequence === loadSeq.current) { clearPrivateData(); setError(true); }
      return false;
    } finally { if (current() && sequence === loadSeq.current) setLoading(false); }
  }, [request, actor.trackRequest, clearPrivateData]);
  useEffect(() => {
    void refresh();
    return () => { ++loadSeq.current; };
    // Changing display language keeps the same-account draft and decision in place.
  }, [actor.actorId]);

  async function retry() {
    if (inFlight.current) return;
    const current = actor.trackRequest();
    await actor.refreshIdentity();
    if (current()) await refresh();
  }

  async function perform(action: () => Promise<void>) {
    if (loading || error || inFlight.current) return;
    const current = actor.trackRequest();
    if (!current()) return;
    inFlight.current = true; ++loadSeq.current;
    setBusy(true); setError(false); setNotice(false);
    try {
      await action();
      if (!current()) return;
      if (await refresh()) setNotice(true);
    } catch {
      if (current()) { clearPrivateData(); setError(true); }
    } finally { if (current()) { inFlight.current = false; setBusy(false); } }
  }

  async function openEvidence() {
    if (!currentStaff?.evidence_path || inFlight.current || loading || error) return;
    const current = actor.trackRequest();
    inFlight.current = true; setBusy(true); setError(false);
    try {
      const result = await request<{ url: string }>(
        `/api/admin/support/staff?userId=${encodeURIComponent(currentStaff.user_id)}&evidence=1`,
      );
      if (current()) window.open(result.url, "_blank", "noopener,noreferrer");
    } catch {
      if (current()) { clearPrivateData(); setError(true); }
    } finally { if (current()) { inFlight.current = false; setBusy(false); } }
  }

  return (
    <section className="section section-muted min-h-[70vh]">
      <div className="container max-w-6xl space-y-6">
        <Link href="/admin" className="text-sm font-bold text-sage-dark underline">{t("adminSupport.back")}</Link>
        <header><h1 className="mt-4 text-3xl font-black">{t("adminSupport.title")}</h1>
          <p className="mt-2 text-sm leading-7 text-muted">{t("adminSupport.description")}</p></header>
        {loading ? <p role="status">{t("peerSpace.loading")}</p> : null}
        {error ? <div className="card space-y-3"><p role="alert">{t("roleFollowup.professional.loadFailed")}</p>
          <button type="button" className="button-secondary" disabled={loading || busy} onClick={() => void retry()}>{t("roleFollowup.professional.retry")}</button>
          <Link href={{ pathname: "/account", query: { next: "/admin/support" } }} className="button-secondary">{t("roleFollowup.professional.signInWorkbench")}</Link>
        </div> : null}
        {notice ? <p role="status" className="rounded-xl bg-mint p-4 text-sm">{t("adminSupport.saved")}</p> : null}
        {!loading && !error ? <fieldset disabled={busy} className="min-w-0 space-y-6" aria-label={t("adminSupport.title")}>
        <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          <div className="card">
            <h2 className="text-xl font-bold">{t("adminSupport.applications")}</h2>
            <div className="mt-4 grid gap-2">{staff.map((item) =>
              <button key={item.user_id} type="button" className={`rounded-xl border p-3 text-left text-sm ${selectedStaff === item.user_id ? "border-sage bg-mist" : "border-ink/10"}`}
                onClick={() => setSelectedStaff(item.user_id)}><strong className="block">{item.legal_name}</strong>
                <span>{t(supportStaffCategoryKey(item.category))} · {t(supportStaffStatusKey(item.status))}</span>
              </button>)}</div>
            {!staff.length && !loading ? <p className="mt-3 text-sm text-muted">{t("adminSupport.emptyApplications")}</p> : null}
          </div>
          <div className="card min-w-0">
            {currentStaff ? (
              <>
                <h3 className="text-xl font-bold">{currentStaff.legal_name}</h3>
                <p className="mt-2 text-sm">{t(supportStaffCategoryKey(currentStaff.category))} · {t(supportStaffStatusKey(currentStaff.status))}</p>
                <p className="mt-2 text-sm text-muted">{t("adminSupport.evidence")}: {currentStaff.evidence_path ? t("supportStaff.evidenceUploaded") : t("supportStaff.evidenceMissing")}</p>
                <p className="mt-2 text-sm text-muted">{t("adminSupport.trainingCount")}: {currentStaff.training_count}</p>
                {currentStaff.evidence_path ? <button type="button" className="button-secondary mt-3" onClick={openEvidence}>{t("adminSupport.viewEvidence")}</button> : null}
                <div className="mt-5 grid gap-3">
                  <label className="text-sm font-bold">{t("adminSupport.reviewStatus")}
                    <select className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3" value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as typeof reviewStatus)}>
                      {staffStatuses.map((value) => <option key={value} value={value}>{t(`supportStaff.status.${value}`)}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-bold">{t("adminSupport.reviewNote")}
                    <textarea maxLength={500} rows={2} className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3 font-normal"
                      value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} />
                  </label>
                  <button type="button" className="button-primary w-fit" disabled={busy} onClick={() => perform(async () => {
                    await request("/api/admin/support/staff", "POST", {
                      action: "review", userId: currentStaff.user_id, status: reviewStatus, note: reviewNote,
                    });
                    setReviewNote("");
                  })}>{t("adminSupport.review")}</button>
                  <details className="mt-3 border-t border-ink/10 pt-3"><summary className="cursor-pointer font-bold">{t("adminSupport.recordTraining")}</summary>
                    <label className="mt-3 block text-sm font-bold">{t("adminSupport.trainingTitle")}
                      <input maxLength={160} className="mt-2 block w-full rounded-xl border p-3 font-normal" value={trainingTitle} onChange={(event) => setTrainingTitle(event.target.value)} />
                    </label>
                    <label className="mt-3 block text-sm font-bold">{t("adminSupport.trainingDate")}
                      <input type="date" className="mt-2 block w-full rounded-xl border p-3 font-normal" value={trainingDate} onChange={(event) => setTrainingDate(event.target.value)} />
                    </label>
                    <button type="button" className="button-secondary mt-3" disabled={busy || !trainingTitle || !trainingDate} onClick={() => perform(async () => {
                      await request("/api/admin/support/staff", "POST", {
                        action: "record_training", userId: currentStaff.user_id,
                        trainingTitle, completedAt: new Date(`${trainingDate}T12:00:00`).toISOString(),
                      });
                      setTrainingTitle("");
                      setTrainingDate("");
                    })}>{t("adminSupport.saveTraining")}</button>
                  </details>
                </div>
              </>
            ) : <p className="text-sm text-muted">{t("adminSupport.emptyApplications")}</p>}
          </div>
        </section>
        <details className="card"><summary className="cursor-pointer font-bold">{t("adminSupport.inviteSchool")}</summary>
          <div className="mt-4 grid gap-3">
            <label className="text-sm font-bold">{t("adminSupport.userId")}<input className="mt-2 block w-full rounded-xl border p-3 font-normal" value={inviteUserId} onChange={(event) => setInviteUserId(event.target.value)} /></label>
            <label className="text-sm font-bold">{t("adminSupport.schoolId")}<input className="mt-2 block w-full rounded-xl border p-3 font-normal" value={inviteSchoolId} onChange={(event) => setInviteSchoolId(event.target.value)} /></label>
            <label className="text-sm font-bold">{t("supportStaff.fields.legalName")}<input className="mt-2 block w-full rounded-xl border p-3 font-normal" value={inviteName} onChange={(event) => setInviteName(event.target.value)} /></label>
            <button type="button" className="button-secondary w-fit" disabled={busy} onClick={() => perform(async () => {
              await request("/api/admin/support/staff", "POST", {
                action: "invite_school_teacher", userId: inviteUserId, schoolId: inviteSchoolId, legalName: inviteName,
              });
            })}>{t("adminSupport.invite")}</button>
          </div>
        </details>
        <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          <div className="card">
            <h2 className="text-xl font-bold">{t("adminSupport.queue")}</h2>
            <div className="mt-4 grid gap-2">{cases.map((item) =>
              <button key={item.id} type="button" className={`rounded-xl border p-3 text-left text-sm ${selectedCase === item.id ? "border-sage bg-mist" : "border-ink/10"}`}
                onClick={() => setSelectedCase(item.id)}>
                <strong className="block">{item.case_type === "adult_consultation" ? t("supportWorkbench.adultCase") : t("supportWorkbench.youthCase")}</strong>
                <span>{t(supportCaseStatusKey(item.status))} · {t(reviewPriorityKey(item.risk_priority))}</span>
              </button>)}</div>
            {!cases.length && !loading ? <p className="mt-3 text-sm text-muted">{t("adminSupport.emptyCases")}</p> : null}
          </div>
          <div className="card min-w-0">
            {currentCase ? (
              <>
                <h3 className="text-xl font-bold">{t("adminSupport.case")}</h3>
                <p className="mt-3 break-words whitespace-pre-wrap rounded-xl bg-mist p-4 text-sm leading-7">{currentCase.need_summary}</p>
                <p className="mt-2 text-xs text-muted">{t("adminSupport.private")}</p>
                <div className="mt-4 space-y-2 text-sm">{currentCase.assignments.map((assignment) =>
                  <p key={assignment.id}>{t(supportAssignmentRoleKey(assignment.assignment_role))} · {staff.find((person) => person.user_id === assignment.staff_user_id)?.legal_name || assignment.staff_user_id} · {t(supportAssignmentStatusKey(assignment.status))}</p>)}</div>
                <div className="mt-5 grid gap-3">
                  <label className="text-sm font-bold">{t("adminSupport.action")}
                    <select className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3" value={caseAction} onChange={(event) => setCaseAction(event.target.value as typeof caseAction)}>
                      {caseActions.map((value) => <option key={value} value={value}>{t(`adminSupport.actions.${value}`)}</option>)}
                    </select>
                  </label>
                  {["offer_primary", "offer_backup", "transfer"].includes(caseAction) ? (
                    <label className="text-sm font-bold">{t("adminSupport.supporter")}
                      <select className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3" value={staffUserId} onChange={(event) => setStaffUserId(event.target.value)}>
                        <option value="">{t("adminSupport.choose")}</option>
                        {eligibleStaff.map((person) => <option key={person.user_id} value={person.user_id}>{person.legal_name} · {t(supportStaffCategoryKey(person.category))}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {caseAction === "propose_appointment" ? <label className="text-sm font-bold">{t("adminSupport.appointment")}
                    <input type="datetime-local" className="mt-2 block w-full rounded-xl border p-3 font-normal" value={appointmentAt} onChange={(event) => setAppointmentAt(event.target.value)} />
                  </label> : null}
                  {caseAction === "refer" ? <label className="text-sm font-bold">{t("adminSupport.referral")}
                    <select className="mt-2 block w-full rounded-xl border p-3" value={referralType} onChange={(event) => setReferralType(event.target.value as typeof referralType)}>
                      {referralTypes.map((value) => <option key={value} value={value}>{t(`adminSupport.referralTypes.${value}`)}</option>)}
                    </select>
                  </label> : null}
                  <label className="text-sm font-bold">{t("adminSupport.caseNote")}
                    <textarea maxLength={500} rows={2} className="mt-2 block w-full rounded-xl border p-3 font-normal" value={caseNote} onChange={(event) => setCaseNote(event.target.value)} />
                  </label>
                  <button type="button" className="button-primary w-fit" disabled={busy} onClick={() => perform(async () => {
                    await request("/api/admin/support/cases", "POST", {
                      caseId: currentCase.id, action: caseAction, staffUserId, note: caseNote,
                      appointmentAt: appointmentAt ? new Date(appointmentAt).toISOString() : null,
                      referralType,
                    });
                    setCaseNote("");
                  })}>{t("adminSupport.saveCase")}</button>
                </div>
              </>
            ) : <p className="text-sm text-muted">{t("adminSupport.emptyCases")}</p>}
          </div>
        </section>
        {feedback ? <section className="card">
          <h2 className="text-xl font-bold">{t("adminSupport.feedbackTitle")}</h2>
          <p className="mt-2 text-sm">{t("adminSupport.feedbackCount")}: {feedback.count} · {t("adminSupport.pendingComplaints")}: {feedback.pendingComplaints}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(feedback.ratios).map(([key, value]) => <div key={key} className="rounded-xl bg-mist p-3 text-sm">
              <strong>{t(`adminSupport.feedbackRatios.${key as "feltHeard" | "foundHelp" | "boundariesRespected" | "wouldChooseAgain"}`)}</strong>
              <p className="mt-2 text-xl font-bold">{value === null ? "—" : new Intl.NumberFormat(locale === "en" ? "en" : "zh-CN", { style: "percent", maximumFractionDigits: 0 }).format(value)}</p>
            </div>)}
          </div>
          {feedback.sampleLimited ? <p className="mt-3 text-xs text-muted">{t("microFeedbackAdmin.sampleLimited")}</p> : null}
          <details className="mt-5"><summary className="cursor-pointer font-bold">{t("adminSupport.privateFeedback")}</summary>
            <div className="mt-4 grid gap-3">{feedback.feedback.map((item) => <article key={item.caseId} className="rounded-xl bg-mist p-4 text-sm">
              <p className="font-bold">{item.complaint ? t("adminSupport.complaint") : t("adminSupport.comment")} {item.safetyReview ? `· ${t("adminSupport.safety")}` : ""}</p>
              <p className="mt-2 break-words whitespace-pre-wrap">{item.comment || "—"}</p>
              <time dateTime={item.createdAt} className="mt-2 block text-xs text-muted">{new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", { dateStyle: "medium" }).format(new Date(item.createdAt))}</time>
              {item.reviewStatus === "pending" ? <div className="mt-3">
                <label className="block font-bold">{t("adminSupport.feedbackReviewNote")}
                  <input maxLength={500} className="mt-2 block w-full rounded-xl border bg-white p-3 font-normal" value={feedbackNote} onChange={(event) => setFeedbackNote(event.target.value)} />
                </label>
                <button type="button" className="button-secondary mt-3" disabled={busy} onClick={() => perform(async () => {
                  await request("/api/admin/support/feedback", "POST", { caseId: item.caseId, note: feedbackNote });
                  setFeedbackNote("");
                })}>{t("adminSupport.markReviewed")}</button>
              </div> : <p className="mt-3 text-xs">{t(supportFeedbackStatusKey(item.reviewStatus))}</p>}
            </article>)}</div>
          </details>
        </section> : null}
        </fieldset> : null}
      </div>
    </section>
  );
}
