import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/client";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";
import { useSessionActor, type SessionActor } from "@/lib/useSessionActor";
import { peerReviewStatusKey, peerMessageStatusKey, peerReviewCategoryKey, reviewPriorityKey } from "@/lib/userStatusLabels";

type ReviewCase = {
  id: string;
  roomId: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  followUpRequired: boolean;
  escalated: boolean;
  message: string | null;
  messageStatus: string | null;
};
const statuses = ["assigned", "reviewing", "action_required", "referred", "resolved", "closed"] as const;
const actions = ["none", "hide", "publish"] as const;

export default function PeerSpaceStaffLivePage() {
  const actor = useSessionActor();
  const { t } = useTranslation();
  if (actor.phase === "ready") return <PeerSpaceStaffContent key={actor.actorId} actor={actor} />;
  return <section className="section section-muted min-h-[60vh]"><div className="container max-w-5xl space-y-4">
    <Link href="/admin" className="text-sm font-bold text-sage-dark underline">{t("peerSpaceReview.back")}</Link>
    <h1 className="mt-5 text-3xl font-black text-ink">{t("peerSpaceReview.title")}</h1>
    {actor.phase === "loading" ? <p role="status">{t("peerSpace.loading")}</p> : <>
      {actor.phase === "error" ? <><p role="alert">{t("roleFollowup.professional.sessionFailed")}</p>
        <button type="button" className="button-secondary" onClick={() => void actor.refreshIdentity()}>{t("roleFollowup.professional.retry")}</button></> : null}
      <Link href={{ pathname: "/account", query: { next: "/admin/peer-space" } }} className="button-secondary">{t("roleFollowup.professional.signInWorkbench")}</Link>
    </>}
  </div></section>;
}

function PeerSpaceStaffContent({ actor }: { actor: SessionActor }) {
  const { locale, t } = useTranslation();
  const loadSeq = useRef(0);
  const inFlight = useRef(false);
  const [cases, setCases] = useState<ReviewCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<(typeof statuses)[number]>("reviewing");
  const [messageAction, setMessageAction] = useState<(typeof actions)[number]>("none");
  const [note, setNote] = useState("");
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const current = cases.find((item) => item.id === selected) || null;

  const clearPrivateData = useCallback(() => {
    setCases([]); setSelected(null); setNextStatus("reviewing"); setMessageAction("none");
    setNote(""); setFollowUpRequired(false); setEscalated(false); setNotice(false);
  }, []);
  const refresh = useCallback(async () => {
    const valid = actor.trackRequest();
    const sequence = ++loadSeq.current;
    setLoading(true); setError(false);
    try {
      const response = await peerSpaceRequest<{ cases: ReviewCase[] }>("/api/admin/peer-space/review", locale, "GET", undefined, actor.actorId);
      if (!valid() || sequence !== loadSeq.current) return false;
      if (!Array.isArray(response.cases)) throw new Error("invalid_response");
      setCases(response.cases);
      setSelected((previous) => previous && response.cases.some((item) => item.id === previous)
        ? previous : response.cases[0]?.id || null);
      return true;
    } catch {
      if (valid() && sequence === loadSeq.current) { clearPrivateData(); setError(true); }
      return false;
    } finally { if (valid() && sequence === loadSeq.current) setLoading(false); }
  }, [locale, actor.actorId, actor.trackRequest, clearPrivateData]);

  useEffect(() => {
    void refresh();
    return () => { ++loadSeq.current; };
    // Keep the same-account review draft when only display language changes.
  }, [actor.actorId]);

  async function retry() {
    if (inFlight.current) return;
    const valid = actor.trackRequest();
    await actor.refreshIdentity();
    if (valid()) await refresh();
  }

  async function processCase() {
    if (!current || loading || error || inFlight.current) return;
    const valid = actor.trackRequest();
    if (!valid()) return;
    inFlight.current = true; ++loadSeq.current;
    setBusy(true); setError(false); setNotice(false);
    try {
      await peerSpaceRequest("/api/admin/peer-space/review", locale, "POST", {
        caseId: current.id, nextStatus, messageAction, note: note.trim(), followUpRequired, escalated,
      }, actor.actorId);
      if (!valid()) return;
      setNote(""); setMessageAction("none"); setFollowUpRequired(false); setEscalated(false);
      if (await refresh()) setNotice(true);
    } catch {
      if (valid()) { clearPrivateData(); setError(true); }
    } finally { if (valid()) { inFlight.current = false; setBusy(false); } }
  }
  function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN",
      { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  return (
    <section className="section section-muted min-h-[60vh]">
      <div className="container max-w-5xl">
        <Link href="/admin" className="text-sm font-bold text-sage-dark underline">{t("peerSpaceReview.back")}</Link>
        <h1 className="mt-5 text-3xl font-black text-ink">{t("peerSpaceReview.title")}</h1>
        <p className="mt-2 text-sm leading-7 text-muted">{t("peerSpaceReview.description")}</p>
        {loading ? <p role="status" className="mt-5">{t("peerSpace.loading")}</p> : null}
        {error ? <div className="card mt-5 space-y-3"><p role="alert">{t("roleFollowup.professional.loadFailed")}</p>
          <button type="button" className="button-secondary" disabled={loading || busy} onClick={() => void retry()}>{t("roleFollowup.professional.retry")}</button>
          <Link href={{ pathname: "/account", query: { next: "/admin/peer-space" } }} className="button-secondary">{t("roleFollowup.professional.signInWorkbench")}</Link>
        </div> : null}
        {notice ? <p role="status" className="mt-5 rounded-xl bg-mint p-4 text-sm">{t("peerSpaceReview.saved")}</p> : null}
        {!loading && !error && cases.length === 0 ? <p className="card mt-6">{t("peerSpaceReview.empty")}</p> : null}
        {!loading && !error && cases.length ? (
          <fieldset disabled={busy} className="mt-6 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]" aria-label={t("peerSpaceReview.case")}>
            <section className="card min-w-0" aria-label={t("peerSpaceReview.queue")}>
              <h2 className="text-xl font-bold">{t("peerSpaceReview.queue")}</h2>
              <div className="mt-4 grid gap-2">
                {cases.map((item) => <button key={item.id} type="button" className={`rounded-xl border p-3 text-left text-sm ${selected === item.id ? "border-sage bg-mist" : "border-ink/10"}`}
                  onClick={() => { setSelected(item.id); setNextStatus("reviewing"); setMessageAction("none"); setNote(""); setFollowUpRequired(false); setEscalated(false); }}>
                  <strong className="block">{t("peerSpaceReview.priority")} {t(reviewPriorityKey(item.priority))}</strong>
                  <span className="mt-1 block">{t(peerReviewCategoryKey(item.category))} · {t(peerReviewStatusKey(item.status))}</span>
                  <time dateTime={item.createdAt} className="mt-1 block text-xs text-muted">
                    {formatDate(item.createdAt)}
                  </time>
                </button>)}
              </div>
            </section>
            {current ? (
              <section className="card min-w-0">
                <h2 className="text-xl font-bold">{t("peerSpaceReview.case")}</h2>
                <p className="mt-2 text-sm">{t("peerSpaceReview.messageStatus")}: {t(peerMessageStatusKey(current.messageStatus))}</p>
                <p className="mt-4 break-words whitespace-pre-wrap rounded-xl bg-mist p-4 text-sm leading-7">{current.message || t("peerSpaceReview.noMessage")}</p>
                <p className="mt-3 text-xs text-muted">{t("peerSpaceReview.private")}</p>
                <div className="mt-5 grid gap-4">
                  <label className="text-sm font-bold">{t("peerSpaceReview.nextStatus")}
                    <select className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3" value={nextStatus} onChange={(event) => setNextStatus(event.target.value as typeof nextStatus)}>
                      {statuses.map((status) => <option key={status} value={status}>{t(`peerSpaceReview.status.${status}`)}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-bold">{t("peerSpaceReview.messageAction")}
                    <select className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3" value={messageAction} onChange={(event) => setMessageAction(event.target.value as typeof messageAction)}>
                      {actions.map((action) => <option key={action} value={action}>{t(`peerSpaceReview.actions.${action}`)}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-bold">{t("peerSpaceReview.note")}
                    <textarea className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3" rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
                  </label>
                  <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={followUpRequired} onChange={(event) => setFollowUpRequired(event.target.checked)} />{t("peerSpaceReview.followUp")}</label>
                  <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={escalated} onChange={(event) => setEscalated(event.target.checked)} />{t("peerSpaceReview.escalated")}</label>
                  <button type="button" disabled={busy} className="button-primary w-fit" onClick={processCase}>{t("peerSpaceReview.save")}</button>
                </div>
              </section>
            ) : null}
          </fieldset>
        ) : null}
      </div>
    </section>
  );
}
