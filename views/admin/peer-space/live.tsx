import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n/client";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";

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
  const { locale, t } = useTranslation();
  const [cases, setCases] = useState<ReviewCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<(typeof statuses)[number]>("reviewing");
  const [messageAction, setMessageAction] = useState<(typeof actions)[number]>("none");
  const [note, setNote] = useState("");
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const current = cases.find((item) => item.id === selected) || null;

  const refresh = useCallback(async () => {
    const response = await peerSpaceRequest<{ cases: ReviewCase[] }>("/api/admin/peer-space/review", locale);
    setCases(response.cases);
    setSelected((previous) => previous && response.cases.some((item) => item.id === previous)
      ? previous : response.cases[0]?.id || null);
  }, [locale]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    refresh().catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : t("peerSpaceChat.errors.unavailable"));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh, t]);

  async function processCase() {
    if (!current) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await peerSpaceRequest("/api/admin/peer-space/review", locale, "POST", {
        caseId: current.id, nextStatus, messageAction, note: note.trim(), followUpRequired, escalated,
      });
      await refresh();
      setNote("");
      setMessageAction("none");
      setNotice(t("peerSpaceReview.saved"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("peerSpaceChat.errors.unavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="section section-muted min-h-[60vh]">
      <div className="container max-w-5xl">
        <Link href="/admin" className="text-sm font-bold text-sage-dark underline">{t("peerSpaceReview.back")}</Link>
        <h1 className="mt-5 text-3xl font-black text-ink">{t("peerSpaceReview.title")}</h1>
        <p className="mt-2 text-sm leading-7 text-muted">{t("peerSpaceReview.description")}</p>
        {loading ? <p role="status" className="mt-5">{t("peerSpace.loading")}</p> : null}
        {error ? <p role="alert" className="mt-5 rounded-xl bg-white p-4 text-sm">{error}</p> : null}
        {notice ? <p role="status" className="mt-5 rounded-xl bg-mint p-4 text-sm">{notice}</p> : null}
        {!loading && !error && cases.length === 0 ? <p className="card mt-6">{t("peerSpaceReview.empty")}</p> : null}
        {cases.length ? (
          <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
            <section className="card min-w-0" aria-label={t("peerSpaceReview.queue")}>
              <h2 className="text-xl font-bold">{t("peerSpaceReview.queue")}</h2>
              <div className="mt-4 grid gap-2">
                {cases.map((item) => <button key={item.id} type="button" className={`rounded-xl border p-3 text-left text-sm ${selected === item.id ? "border-sage bg-mist" : "border-ink/10"}`}
                  onClick={() => { setSelected(item.id); setNextStatus("reviewing"); setMessageAction("none"); setNote(""); }}>
                  <strong className="block">{t("peerSpaceReview.priority")} {item.priority}</strong>
                  <span className="mt-1 block">{item.category} · {item.status}</span>
                  <time dateTime={item.createdAt} className="mt-1 block text-xs text-muted">
                    {new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt))}
                  </time>
                </button>)}
              </div>
            </section>
            {current ? (
              <section className="card min-w-0">
                <h2 className="text-xl font-bold">{t("peerSpaceReview.case")}</h2>
                <p className="mt-2 text-sm">{t("peerSpaceReview.messageStatus")}: {current.messageStatus}</p>
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
          </div>
        ) : null}
      </div>
    </main>
  );
}
