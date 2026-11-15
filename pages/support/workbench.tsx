import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { useTranslation } from "@/lib/i18n/client";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";
import { useSessionActor } from "@/lib/useSessionActor";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

type Assignment = {
  id: string;
  caseId: string;
  role: "primary" | "backup";
  status: "offered" | "accepted";
  caseType: string | null;
  caseStatus: string | null;
  createdAt: string;
  needSummary: string | null;
  availability: string | null;
  appointmentAt: string | null;
  appointmentStatus: string | null;
};
const caseStatuses = new Set(["requested", "triage", "awaiting_assignment", "assigned", "active", "paused",
  "transfer_requested", "transferred", "referred", "closed", "cancelled"]);

function isAssignment(value: unknown): value is Assignment {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Assignment>;
  return typeof item.id === "string" && typeof item.caseId === "string" && typeof item.createdAt === "string"
    && ["primary", "backup"].includes(item.role || "") && ["offered", "accepted"].includes(item.status || "");
}

export default function SupportStaffWorkbench() {
  const { locale, t } = useTranslation();
  const actor = useSessionActor();
  const loadSeq = useRef(0);
  const inFlight = useRef(false);
  const [loadedOwner, setLoadedOwner] = useState("");
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState(false);
  const refresh = useCallback(async () => {
    if (actor.phase !== "ready") return false;
    const current = actor.trackRequest();
    const sequence = ++loadSeq.current;
    setLoading(true); setError(false);
    try {
      const result = await peerSpaceRequest<{ assignments: unknown }>("/api/support/staff-cases", locale, "GET", undefined, actor.actorId);
      if (!current() || sequence !== loadSeq.current) return false;
      if (!Array.isArray(result.assignments) || !result.assignments.every(isAssignment)) throw new Error("invalid_assignments");
      setAssignments(result.assignments); setLoadedOwner(actor.actorId);
      return true;
    } catch {
      if (current() && sequence === loadSeq.current) { setAssignments([]); setLoadedOwner(""); setError(true); }
      return false;
    } finally { if (current() && sequence === loadSeq.current) setLoading(false); }
  }, [locale, actor.actorId, actor.phase, actor.trackRequest]);
  useEffect(() => {
    ++loadSeq.current; inFlight.current = false;
    setAssignments([]); setLoadedOwner(""); setError(false); setNotice(false); setBusy(false);
    setLoading(actor.phase === "loading" || actor.phase === "ready");
    if (actor.phase === "ready") void refresh();
    return () => { ++loadSeq.current; };
    // Translation changes only affect display; they must not restart an in-flight decision.
  }, [actor.actorId, actor.phase]);
  const loaded = actor.phase === "ready" && loadedOwner === actor.actorId;
  const visibleAssignments = loaded ? assignments : [];

  async function retry() {
    const current = actor.trackRequest();
    await actor.refreshIdentity();
    if (current()) await refresh();
  }

  async function decide(item: Assignment, decision: "accepted" | "rejected") {
    if (!loaded || loading || inFlight.current || item.status !== "offered") return;
    const current = actor.trackRequest();
    const owner = actor.actorId;
    ++loadSeq.current; inFlight.current = true;
    setBusy(true);
    setError(false);
    setNotice(false);
    try {
      await peerSpaceRequest("/api/support/staff-cases", locale, "POST", { assignmentId: item.id, decision }, owner);
      if (!current()) return;
      if (await refresh()) setNotice(true);
    } catch {
      if (!current()) return;
      setAssignments([]); setLoadedOwner(""); setError(true);
    } finally { if (current()) { inFlight.current = false; setBusy(false); } }
  }
  function formatDate(value: string, time = false) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN",
      { dateStyle: "medium", ...(time ? { timeStyle: "short" as const } : {}) }).format(date);
  }
  return (
    <>
      <PageHero label={t("supportWorkbench.label")} title={t("supportWorkbench.title")}
        subtitle={t("supportWorkbench.description")}
        action={<Link href="/support/apply" className="button-secondary">{t("supportWorkbench.application")}</Link>} />
      <section className="section section-muted min-h-[50vh]">
        <div className="container max-w-4xl">
          {loading ? <p role="status">{t("peerSpace.loading")}</p> : null}
          {error ? <p role="alert" className="rounded-xl bg-white p-4 text-sm">{t("roleFollowup.professional.loadFailed")}</p> : null}
          {notice ? <p role="status" className="rounded-xl bg-mint p-4 text-sm">{t("supportWorkbench.saved")}</p> : null}
          {actor.phase === "signed_out" || actor.phase === "error" || error ? <div className="card flex flex-wrap items-center gap-3">
            {actor.phase === "error" ? <p role="alert" className="w-full text-sm">{t("roleFollowup.professional.sessionFailed")}</p> : null}
            {actor.phase !== "signed_out" ? <button type="button" disabled={loading || busy} className="button-secondary"
              onClick={() => void retry()}>{t("roleFollowup.professional.retry")}</button> : null}
            <Link href={{ pathname: "/account", query: { next: "/support/workbench" } }} className="button-secondary">{t("roleFollowup.professional.signInWorkbench")}</Link>
          </div> : null}
          {!loading && loaded && !visibleAssignments.length ? <p className="card">{t("supportWorkbench.empty")}</p> : null}
          <div className="grid gap-4">
            {visibleAssignments.map((item) => (
              <article key={item.id} className="card min-w-0">
                <div className="flex flex-wrap justify-between gap-3">
                  <h2 className="font-bold">{t(item.role === "primary" ? "supportFlow.portal.primary" : "supportFlow.portal.backup")}</h2>
                  <time dateTime={item.createdAt} className="text-xs text-muted">
                    {formatDate(item.createdAt)}
                  </time>
                </div>
                <p className="mt-2 text-sm text-muted">{item.caseType === "adult_consultation" ? t("supportWorkbench.adultCase") : t("supportWorkbench.youthCase")} · {item.caseStatus && caseStatuses.has(item.caseStatus)
                  ? t(`supportFlow.portal.status.${item.caseStatus}` as TranslationKey) : t("roleFollowup.professional.unknownStatus")}</p>
                {item.status === "offered" ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" className="button-primary" disabled={busy || loading} onClick={() => decide(item, "accepted")}>{t("supportWorkbench.accept")}</button>
                    <button type="button" className="button-secondary" disabled={busy || loading} onClick={() => decide(item, "rejected")}>{t("supportWorkbench.reject")}</button>
                  </div>
                ) : null}
                {item.needSummary ? (
                  <div className="mt-4 rounded-xl bg-mist p-4">
                    <p className="text-xs font-bold">{t("supportWorkbench.limitedScope")}</p>
                    <p className="mt-2 break-words whitespace-pre-wrap text-sm leading-7">{item.needSummary}</p>
                    {item.availability ? <p className="mt-3 text-sm">{item.availability}</p> : null}
                    {item.appointmentAt ? <p className="mt-3 text-sm">
                      {formatDate(item.appointmentAt, true)}
                    </p> : null}
                  </div>
                ) : <p className="mt-4 text-sm text-muted">{t("supportWorkbench.noContent")}</p>}
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
