import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { MicroPilotFeedback } from "@/components/MicroPilotFeedback";
import { PageHero } from "@/components/PageHero";
import { useTranslation } from "@/lib/i18n/client";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";

type CaseStatus = "requested" | "triage" | "awaiting_assignment" | "assigned" | "active"
  | "paused" | "transfer_requested" | "transferred" | "referred" | "closed" | "cancelled";
type CaseAction = "cancel" | "accept_assignment" | "reject_assignment" | "request_change"
  | "withdraw_authorization" | "close" | "accept_appointment" | "request_reschedule" | "cancel_appointment";
type CaseItem = {
  id: string;
  status: CaseStatus;
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
type PortalData = { consultationAvailable: boolean; ageBand: "14_17" | "18_plus"; cases: CaseItem[] };
const feedbackKeys = ["feltHeard", "foundHelp", "boundariesRespected", "wouldChooseAgain"] as const;

function CaseFeedback({ item, onSaved }: { item: CaseItem; onSaved: () => Promise<void> }) {
  const { locale, t } = useTranslation();
  const [answers, setAnswers] = useState<Record<(typeof feedbackKeys)[number], boolean | null>>({
    feltHeard: null, foundHelp: null, boundariesRespected: null, wouldChooseAgain: null,
  });
  const [complaint, setComplaint] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function submit() {
    setBusy(true);
    setNotice("");
    try {
      const result = await peerSpaceRequest<{ urgent: boolean }>("/api/support/feedback", locale, "POST", {
        caseId: item.id, ...answers, complaint, comment,
      });
      await onSaved();
      setNotice(result.urgent ? t("supportFlow.portal.urgent") : t("supportFlow.portal.feedbackSaved"));
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : t("supportFlow.errors.unavailable"));
    } finally { setBusy(false); }
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
        {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      </div>
    </div>
  );
}

export default function CasePortal({ mode }: { mode: "youth" | "adult" }) {
  const { locale, t } = useTranslation();
  const [data, setData] = useState<PortalData | null>(null);
  const [needSummary, setNeedSummary] = useState("");
  const [availability, setAvailability] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [feedbackTrigger, setFeedbackTrigger] = useState(0);
  const [urgent, setUrgent] = useState(false);
  const isAdult = mode === "adult";
  const allowed = data && (isAdult ? data.ageBand === "18_plus" && data.consultationAvailable : data.ageBand === "14_17");
  const heroKeys = isAdult && !allowed
    ? ["supportFlow.closed.label", "supportFlow.closed.title", "supportFlow.closed.description"] as const
    : isAdult
      ? ["supportFlow.portal.adultLabel", "supportFlow.portal.adultTitle", "supportFlow.portal.adultDescription"] as const
      : ["supportFlow.portal.youthLabel", "supportFlow.portal.youthTitle", "supportFlow.portal.youthDescription"] as const;

  const refresh = useCallback(async () => {
    const result = await peerSpaceRequest<PortalData>("/api/support/cases", locale);
    setData(result);
  }, [locale]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    refresh().catch((caught) => {
      if (active && mode === "youth") setError(caught instanceof Error ? caught.message : t("supportFlow.errors.unavailable"));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mode, refresh, t]);

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowed) return;
    setBusy(true);
    setError("");
    setNotice("");
    setUrgent(false);
    try {
      const result = await peerSpaceRequest<{ urgent: boolean }>("/api/support/cases", locale, "POST", {
        type: isAdult ? "adult_consultation" : "youth_request",
        needSummary, availability,
      });
      setNeedSummary("");
      setAvailability("");
      setUrgent(result.urgent);
      setNotice(result.urgent ? t("supportFlow.portal.urgent") : t("supportFlow.portal.submitted"));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("supportFlow.errors.unavailable"));
    } finally { setBusy(false); }
  }

  async function act(item: CaseItem, action: CaseAction) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await peerSpaceRequest("/api/support/case-action", locale, "POST", { caseId: item.id, action });
      await refresh();
      setNotice(t("supportFlow.portal.actionSaved"));
      if (action === "close") setFeedbackTrigger((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("supportFlow.errors.unavailable"));
    } finally { setBusy(false); }
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
    if (["paused", "transfer_requested", "transferred", "referred"].includes(item.status)) return ["close"];
    return [];
  }

  return (
    <>
      <PageHero
        label={t(heroKeys[0])}
        title={t(heroKeys[1])}
        subtitle={t(heroKeys[2])}
        action={<Link href="/referral" className="button-secondary">{t("supportFlow.closed.referral")}</Link>}
      />
      <main className="section section-muted">
        <div className="container max-w-4xl space-y-5">
          {loading && mode === "youth" ? <p role="status">{t("peerSpace.loading")}</p> : null}
          {error ? <p role="alert" className="rounded-xl bg-white p-4 text-sm">{error}</p> : null}
          {notice ? <p role="status" className="rounded-xl bg-mint p-4 text-sm">{notice}</p> : null}
          {isAdult && !allowed ? (
            <section className="card">
              <div className="flex flex-wrap gap-3">
                <Link href="/garden" className="button-secondary">{t("supportFlow.closed.record")}</Link>
                <Link href="/peer-space" className="button-secondary">{t("supportFlow.closed.peer")}</Link>
                <Link href="/referral" className="button-secondary">{t("supportFlow.closed.referral")}</Link>
              </div>
            </section>
          ) : null}
          {!isAdult && !allowed && !loading ? <Link href="/account" className="button-primary">{t("peerSpaceLive.account")}</Link> : null}
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
                  <button type="submit" className="button-primary w-fit" disabled={busy || !needSummary.trim()}>
                    {busy ? t("supportFlow.portal.saving") : t("supportFlow.portal.submit")}
                  </button>
                </form>
              </section>
              <section>
                <h2 className="text-xl font-bold">{t("supportFlow.portal.cases")}</h2>
                {!data.cases.length ? <p className="card mt-4 text-sm text-muted">{t("supportFlow.portal.empty")}</p> : null}
                <div className="mt-4 grid gap-4">
                  {data.cases.map((item) => (
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
                        {actions(item).map((action) => <button key={action} type="button" className="button-secondary text-sm"
                          disabled={busy} onClick={() => act(item, action)}>{t(`supportFlow.portal.actions.${action}`)}</button>)}
                      </div>
                      <details className="mt-5 border-t border-ink/10 pt-3">
                        <summary className="cursor-pointer text-sm font-bold">{t("supportFlow.portal.timeline")}</summary>
                        <ol className="mt-3 space-y-2 text-xs text-muted">
                          {item.events.map((event, index) => <li key={`${event.createdAt}-${index}`}>
                            <time dateTime={event.createdAt}>{new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(event.createdAt))}</time>
                            {" · "}{event.status ? t(`supportFlow.portal.status.${event.status}`) : event.action}
                          </li>)}
                        </ol>
                      </details>
                      {["closed", "referred"].includes(item.status) ? <CaseFeedback item={item} onSaved={refresh} /> : null}
                    </article>
                  ))}
                </div>
              </section>
              <MicroPilotFeedback feature="support" trigger={feedbackTrigger} crisis={urgent} />
            </>
          ) : null}
        </div>
      </main>
    </>
  );
}
