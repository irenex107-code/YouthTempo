import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { useTranslation } from "@/lib/i18n/client";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";

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

export default function SupportStaffWorkbench() {
  const { locale, t } = useTranslation();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const result = await peerSpaceRequest<{ assignments: Assignment[] }>("/api/support/staff-cases", locale);
    setAssignments(result.assignments);
  }, [locale]);
  useEffect(() => {
    let active = true;
    refresh().catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : t("supportFlow.errors.staffScope")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh, t]);
  async function decide(item: Assignment, decision: "accepted" | "rejected") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await peerSpaceRequest("/api/support/staff-cases", locale, "POST", { assignmentId: item.id, decision });
      await refresh();
      setNotice(t("supportWorkbench.saved"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("supportFlow.errors.unavailable"));
    } finally { setBusy(false); }
  }
  return (
    <>
      <PageHero label={t("supportWorkbench.label")} title={t("supportWorkbench.title")}
        subtitle={t("supportWorkbench.description")}
        action={<Link href="/support/apply" className="button-secondary">{t("supportWorkbench.application")}</Link>} />
      <main className="section section-muted min-h-[50vh]">
        <div className="container max-w-4xl">
          {loading ? <p role="status">{t("peerSpace.loading")}</p> : null}
          {error ? <p role="alert" className="rounded-xl bg-white p-4 text-sm">{error}</p> : null}
          {notice ? <p role="status" className="rounded-xl bg-mint p-4 text-sm">{notice}</p> : null}
          {!loading && !error && !assignments.length ? <p className="card">{t("supportWorkbench.empty")}</p> : null}
          <div className="grid gap-4">
            {assignments.map((item) => (
              <article key={item.id} className="card min-w-0">
                <div className="flex flex-wrap justify-between gap-3">
                  <h2 className="font-bold">{t(item.role === "primary" ? "supportFlow.portal.primary" : "supportFlow.portal.backup")}</h2>
                  <time dateTime={item.createdAt} className="text-xs text-muted">
                    {new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", { dateStyle: "medium" }).format(new Date(item.createdAt))}
                  </time>
                </div>
                <p className="mt-2 text-sm text-muted">{item.caseType === "adult_consultation" ? t("supportWorkbench.adultCase") : t("supportWorkbench.youthCase")} · {item.caseStatus || "—"}</p>
                {item.status === "offered" ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" className="button-primary" disabled={busy} onClick={() => decide(item, "accepted")}>{t("supportWorkbench.accept")}</button>
                    <button type="button" className="button-secondary" disabled={busy} onClick={() => decide(item, "rejected")}>{t("supportWorkbench.reject")}</button>
                  </div>
                ) : null}
                {item.needSummary ? (
                  <div className="mt-4 rounded-xl bg-mist p-4">
                    <p className="text-xs font-bold">{t("supportWorkbench.limitedScope")}</p>
                    <p className="mt-2 break-words whitespace-pre-wrap text-sm leading-7">{item.needSummary}</p>
                    {item.availability ? <p className="mt-3 text-sm">{item.availability}</p> : null}
                    {item.appointmentAt ? <p className="mt-3 text-sm">
                      {new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.appointmentAt))}
                    </p> : null}
                  </div>
                ) : <p className="mt-4 text-sm text-muted">{t("supportWorkbench.noContent")}</p>}
              </article>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
