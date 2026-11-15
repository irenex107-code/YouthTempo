import Link from "next/link";
import { useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/client";

type ChecklistKey = "workspace" | "coverage" | "handoff";
type RoomStatus = "preparing" | "open" | "readOnly" | "paused" | "handoff";
type FeedbackState = "idle" | "signedIn" | "open" | "readOnly" | "paused" | "handoff" | "reset";

const checklistKeys: ChecklistKey[] = ["workspace", "coverage", "handoff"];
const serviceKeys = ["realtime", "history", "review", "alert"] as const;

const roomStatusTone: Record<RoomStatus, string> = {
  preparing: "bg-cream text-amber-900",
  open: "bg-mint text-sage-dark",
  readOnly: "bg-amber-100 text-amber-900",
  paused: "bg-rose-100 text-rose-800",
  handoff: "bg-mist text-sage-dark",
};

function createEmptyChecklist(): Record<ChecklistKey, boolean> {
  return { workspace: false, coverage: false, handoff: false };
}

export default function PeerSpaceStaffPreviewPage() {
  const { t } = useTranslation();
  const roomControlRef = useRef<HTMLElement>(null);
  const [checks, setChecks] = useState<Record<ChecklistKey, boolean>>(createEmptyChecklist);
  const [signedIn, setSignedIn] = useState(false);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>("preparing");
  const [noticeKey, setNoticeKey] = useState<FeedbackState>("idle");
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false);
  const allReady = checklistKeys.every((key) => checks[key]);
  const stageKey = !signedIn ? "prepare" : roomStatus === "handoff" ? "handoff" : "manage";

  function toggleCheck(key: ChecklistKey) {
    setChecks((current) => ({ ...current, [key]: !current[key] }));
  }

  function signIn() {
    if (!allReady) return;
    setSignedIn(true);
    setNoticeKey("signedIn");
    requestAnimationFrame(() => roomControlRef.current?.focus());
  }

  function changeRoomStatus(nextStatus: Exclude<RoomStatus, "preparing">) {
    if (!signedIn) return;
    setRoomStatus(nextStatus);
    setNoticeKey(nextStatus);
    setPauseConfirmOpen(false);
  }

  function resetPreview() {
    setChecks(createEmptyChecklist());
    setSignedIn(false);
    setRoomStatus("preparing");
    setNoticeKey("reset");
    setPauseConfirmOpen(false);
  }

  return (
    <section className="section section-muted min-h-[calc(100vh-12rem)] py-6 sm:py-10">
      <div className="container max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin" className="text-sm font-bold text-sage-dark underline decoration-sage/40 underline-offset-4">
            {t("peerSpaceStaff.navigation.back")}
          </Link>
          <Link href="/peer-space?state=open" className="text-sm font-bold text-sage-dark underline decoration-sage/40 underline-offset-4">
            {t("peerSpaceStaff.navigation.studentPreview")}
          </Link>
        </div>

        <header className="rounded-[2rem] border border-ink/[0.08] bg-gradient-to-br from-paper via-paper to-mist/50 p-5 shadow-soft sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="eyebrow">{t("peerSpaceStaff.header.label")}</p>
              <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] text-ink sm:text-4xl">
                {t("peerSpaceStaff.header.title")}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-muted">{t("peerSpaceStaff.header.description")}</p>
            </div>
            <span className="w-fit shrink-0 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900">
              {t("peerSpaceStaff.header.previewStatus")}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-sage-dark">
            <span className="rounded-full border border-sage/15 bg-paper/80 px-3 py-2">{t("peerSpaceStaff.context.capabilityValue")}</span>
            <span className="rounded-full border border-sage/15 bg-paper/80 px-3 py-2">{t("peerSpaceStaff.context.scopeValue")}</span>
            <span className={`rounded-full border border-sage/15 px-3 py-2 ${signedIn ? "bg-mint" : "bg-cream"}`}>
              {signedIn ? t("peerSpaceStaff.context.shiftActive") : t("peerSpaceStaff.context.shiftPending")}
            </span>
            <span className={`rounded-full border border-current/10 px-3 py-2 ${roomStatusTone[roomStatus]}`}>
              {t(`peerSpaceStaff.room.status.${roomStatus}`)}
            </span>
          </div>

          <div className="mt-4 rounded-2xl bg-sage-dark px-4 py-3 text-paper sm:flex sm:items-center sm:justify-between sm:gap-5">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-paper/70">{t("peerSpaceStaff.stage.label")}</p>
            <p className="mt-1 text-sm font-bold sm:mt-0">{t(`peerSpaceStaff.stage.${stageKey}`)}</p>
          </div>
        </header>

        <details className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <summary className="cursor-pointer font-bold focus:outline-none focus:ring-4 focus:ring-amber-200/60">
            {t("peerSpaceStaff.previewNotice.title")}
          </summary>
          <p className="mt-2 leading-6">{t("peerSpaceStaff.previewNotice.text")}</p>
        </details>

        <main className="mt-5 space-y-4">
          {!signedIn ? (
            <section className="card" aria-labelledby="peer-space-shift-title">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="eyebrow">{t("peerSpaceStaff.shift.label")}</p>
                  <h2 id="peer-space-shift-title" className="mt-3 text-2xl font-black tracking-[-0.025em] text-ink">
                    {t("peerSpaceStaff.shift.title")}
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-muted">{t("peerSpaceStaff.shift.description")}</p>
                </div>
                <span className="w-fit rounded-full bg-cream px-3 py-1.5 text-xs font-bold text-amber-900" role="status">
                  {t("peerSpaceStaff.shift.status.pending")}
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <CompactDetail label={t("peerSpaceStaff.shift.timeLabel")} value={t("peerSpaceStaff.shift.timeValue")} />
                <CompactDetail label={t("peerSpaceStaff.shift.coverageLabel")} value={t("peerSpaceStaff.shift.coverageValue")} muted />
              </div>

              <fieldset className="mt-6 border-t border-ink/[0.08] pt-5">
                <legend className="text-sm font-black text-ink">{t("peerSpaceStaff.checklist.title")}</legend>
                <p className="mt-1 text-xs leading-6 text-muted">{t("peerSpaceStaff.checklist.description")}</p>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {checklistKeys.map((key) => (
                    <label
                      key={key}
                      className={`cursor-pointer rounded-2xl border p-4 transition focus-within:ring-4 focus-within:ring-sage/15 ${checks[key] ? "border-sage/35 bg-mist/75 text-ink shadow-sm" : "border-ink/[0.08] bg-cream/20 text-muted hover:border-sage/45"}`}
                    >
                      <span className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-5 w-5 shrink-0 accent-sage-dark"
                          checked={checks[key]}
                          onChange={() => toggleCheck(key)}
                        />
                        <span>
                          <span className="block text-sm font-black text-ink">{t(`peerSpaceStaff.checklist.items.${key}.title`)}</span>
                          <span className="mt-1 block text-xs font-normal leading-6">{t(`peerSpaceStaff.checklist.items.${key}.text`)}</span>
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/15 disabled:text-ink/40 sm:w-auto"
                  disabled={!allReady}
                  onClick={signIn}
                >
                  {t("peerSpaceStaff.shift.signInAction")}
                </button>
                <p className="text-xs leading-5 text-muted">
                  {allReady ? t("peerSpaceStaff.checklist.readyHelp") : t("peerSpaceStaff.checklist.pendingHelp")}
                </p>
              </div>
            </section>
          ) : (
            <>
              <section
                ref={roomControlRef}
                tabIndex={-1}
                className="scroll-mt-24 overflow-hidden rounded-[2rem] border border-ink/[0.08] bg-paper shadow-soft focus:outline-none focus:ring-4 focus:ring-sage/15"
                aria-labelledby="peer-space-room-control-title"
              >
                <div className="bg-gradient-to-br from-paper via-paper to-mist/40 p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="eyebrow">{t("peerSpaceStaff.room.label")}</p>
                      <h2 id="peer-space-room-control-title" className="mt-3 text-2xl font-black tracking-[-0.025em] text-ink">
                        {t("peerSpaceStaff.room.title")}
                      </h2>
                      <p className="mt-2 text-sm leading-7 text-muted">{t("peerSpaceStaff.room.description")}</p>
                    </div>
                    <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${roomStatusTone[roomStatus]}`} role="status" aria-live="polite">
                      <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />
                      {t(`peerSpaceStaff.room.status.${roomStatus}`)}
                    </span>
                  </div>
                </div>

                <div className="border-t border-ink/[0.07] p-5 sm:p-6">
                  <h3 className="text-sm font-black text-ink">{t("peerSpaceStaff.room.controlsTitle")}</h3>
                  <p className="mt-1 text-xs leading-6 text-muted">{t("peerSpaceStaff.room.controlsDescription")}</p>

                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <button type="button" className={`button-primary w-full sm:w-auto ${roomStatus === "open" ? "ring-4 ring-sage/20" : ""}`} onClick={() => changeRoomStatus("open")}>
                      {t("peerSpaceStaff.room.actions.open")}
                    </button>
                    <button type="button" className={`button-secondary w-full sm:w-auto ${roomStatus === "readOnly" ? "border-sage bg-mist" : ""}`} onClick={() => changeRoomStatus("readOnly")}>
                      {t("peerSpaceStaff.room.actions.readOnly")}
                    </button>
                    <button type="button" className={`button-secondary w-full sm:w-auto ${roomStatus === "handoff" ? "border-sage bg-mist" : ""}`} onClick={() => changeRoomStatus("handoff")}>
                      {t("peerSpaceStaff.room.actions.handoff")}
                    </button>
                  </div>

                  <div className="mt-5 border-t border-ink/[0.08] pt-4">
                    <p className="text-xs font-black text-rose-800">{t("peerSpaceStaff.room.pauseLabel")}</p>
                    {!pauseConfirmOpen ? (
                      <button
                        type="button"
                        className="mt-2 w-full rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 transition hover:bg-rose-100 focus:outline-none focus:ring-4 focus:ring-rose-200 sm:w-auto"
                        onClick={() => setPauseConfirmOpen(true)}
                      >
                        {t("peerSpaceStaff.room.actions.pause")}
                      </button>
                    ) : (
                      <div className="mt-2 rounded-2xl border border-rose-300 bg-rose-50 p-4" role="alert">
                        <h4 className="text-sm font-black text-rose-900">{t("peerSpaceStaff.room.pauseConfirm.title")}</h4>
                        <p className="mt-1 text-xs leading-6 text-rose-800">{t("peerSpaceStaff.room.pauseConfirm.text")}</p>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            className="rounded-full bg-rose-700 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rose-800 focus:outline-none focus:ring-4 focus:ring-rose-200"
                            onClick={() => changeRoomStatus("paused")}
                          >
                            {t("peerSpaceStaff.room.pauseConfirm.confirm")}
                          </button>
                          <button type="button" className="button-secondary" onClick={() => setPauseConfirmOpen(false)}>
                            {t("peerSpaceStaff.room.pauseConfirm.cancel")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="mt-4 rounded-2xl border border-sage/15 bg-mist/55 px-4 py-3 text-sm leading-6 text-sage-dark" aria-live="polite">
                    {t(`peerSpaceStaff.feedback.states.${noticeKey}`)}
                  </p>
                </div>
              </section>

              <details className="rounded-[1.5rem] border border-ink/[0.08] bg-paper px-5 py-4 shadow-sm">
                <summary className="cursor-pointer text-sm font-black text-ink focus:outline-none focus:ring-4 focus:ring-sage/15">
                  {t("peerSpaceStaff.checklist.completedSummary")}
                </summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {checklistKeys.map((key) => (
                    <p key={key} className="rounded-2xl bg-mist/55 px-3 py-2 text-xs font-bold leading-5 text-sage-dark">
                      {t(`peerSpaceStaff.checklist.items.${key}.title`)}
                    </p>
                  ))}
                </div>
              </details>

              <section className="rounded-[1.5rem] border border-ink/[0.08] bg-paper p-5 shadow-sm" aria-labelledby="peer-space-empty-tasks-title">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="eyebrow">{t("peerSpaceStaff.tasks.label")}</p>
                    <h2 id="peer-space-empty-tasks-title" className="mt-2 text-lg font-black text-ink">{t("peerSpaceStaff.tasks.emptyTitle")}</h2>
                    <p className="mt-1 text-xs leading-6 text-muted">{t("peerSpaceStaff.tasks.emptyText")}</p>
                  </div>
                  <span className="w-fit rounded-full bg-mint px-3 py-1.5 text-xs font-bold text-sage-dark">{t("peerSpaceStaff.tasks.emptyStatus")}</span>
                </div>
              </section>
            </>
          )}

          <details className="rounded-[1.5rem] border border-ink/[0.08] bg-paper px-5 py-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-black text-ink focus:outline-none focus:ring-4 focus:ring-sage/15">
              {t("peerSpaceStaff.services.summary")}
            </summary>
            <p className="mt-2 text-xs leading-6 text-muted">{t("peerSpaceStaff.services.description")}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {serviceKeys.map((key) => (
                <div key={key} className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-ink/10 bg-ink/[0.02] px-4 py-3">
                  <span className="text-sm font-bold text-ink">{t(`peerSpaceStaff.services.items.${key}`)}</span>
                  <span className="shrink-0 text-xs font-bold text-muted">{t("peerSpaceStaff.services.notConnected")}</span>
                </div>
              ))}
            </div>
          </details>

          {signedIn ? (
            <div className="flex justify-end">
              <button type="button" className="text-sm font-bold text-sage-dark underline decoration-sage/40 underline-offset-4" onClick={resetPreview}>
                {t("peerSpaceStaff.feedback.resetAction")}
              </button>
            </div>
          ) : null}
        </main>
      </div>
    </section>
  );
}

function CompactDetail({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${muted ? "border-dashed border-ink/10 bg-ink/[0.02]" : "border-ink/[0.08] bg-cream/30"}`}>
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className="mt-1 text-sm font-black leading-6 text-ink">{value}</p>
    </div>
  );
}
