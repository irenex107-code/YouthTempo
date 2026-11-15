import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/client";
import type { PeerSpacePreviewState } from "@/lib/peerSpacePreview";

export type PeerSpacePageProps = {
  initialState: PeerSpacePreviewState;
};

const previewStates = new Set<PeerSpacePreviewState>([
  "rules",
  "loading",
  "open",
  "read-only",
  "paused",
  "unavailable",
]);

function parsePreviewState(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && previewStates.has(candidate as PeerSpacePreviewState)
    ? (candidate as PeerSpacePreviewState)
    : null;
}

export default function PeerSpacePage({ initialState }: PeerSpacePageProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [state, setState] = useState<PeerSpacePreviewState>(initialState);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    const requestedState = parsePreviewState(router.query.state);
    if (requestedState) setState(requestedState);
  }, [router.isReady, router.query.state]);

  if (state === "loading") {
    return <PeerSpaceLoading />;
  }

  if (state === "unavailable") {
    return <PeerSpaceUnavailable />;
  }

  if (state === "rules") {
    const noticeKeys = ["realtimeDuty", "identityVisibility", "privacySafety"] as const;
    return (
      <section className="section section-muted min-h-[calc(100vh-12rem)] pt-8 sm:pt-12">
        <div className="container max-w-4xl">
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-900">
            {t("peerSpace.previewNotice")}
          </div>
          <p className="eyebrow">{t("peerSpace.rules.label")}</p>
          <h1 className="mt-5 text-3xl font-black tracking-[-0.035em] text-ink sm:text-5xl">
            {t("peerSpace.rules.title")}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-muted">
            {t("peerSpace.rules.description")}
          </p>

          <div className="mt-7 grid gap-3">
            {noticeKeys.map((key, index) => (
              <article key={key} className="flex gap-4 rounded-[1.5rem] border border-ink/[0.08] bg-paper p-4 shadow-sm sm:items-start sm:p-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mist text-sm font-black text-sage-dark" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h2 className="text-base font-bold text-ink sm:text-lg">{t(`peerSpace.rules.items.${key}.title`)}</h2>
                  <p className="mt-1 text-sm leading-7 text-muted">{t(`peerSpace.rules.items.${key}.text`)}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-4 rounded-[1.5rem] border border-ink/10 bg-paper p-4 shadow-soft sm:p-5">
            <label className="flex cursor-pointer items-start gap-3 text-sm font-bold leading-7 text-ink">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-sage-dark"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              <span>{t("peerSpace.rules.confirmation")}</span>
            </label>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                className="button-primary"
                disabled={!accepted}
                onClick={() => setState("open")}
              >
                {t("peerSpace.rules.enterAction")}
              </button>
              <Link href="/for-young-adults" className="button-secondary">
                {t("peerSpace.rules.laterAction")}
              </Link>
              <Link href="/referral" className="text-center text-sm font-bold text-sage-dark underline decoration-sage/40 underline-offset-4 sm:ml-auto">
                {t("peerSpace.rules.supportAction")}
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return <PeerSpaceRoom state={state} />;
}

function PeerSpaceLoading() {
  const { t } = useTranslation();
  return (
    <section className="section section-muted min-h-[calc(100vh-12rem)] pt-8 sm:pt-12" aria-busy="true" aria-live="polite">
      <div className="container max-w-4xl">
        <h1 className="text-3xl font-black tracking-[-0.035em] text-ink sm:text-4xl">{t("peerSpace.metadata.name")}</h1>
        <p className="mt-3 text-sm text-muted">{t("peerSpace.loading")}</p>
        <div className="mt-7 overflow-hidden rounded-[2rem] border border-ink/[0.08] bg-paper shadow-soft">
          <div className="border-b border-ink/[0.07] p-5">
            <div className="h-5 w-40 animate-pulse rounded-full bg-mist" />
            <div className="mt-3 h-3 w-64 max-w-full animate-pulse rounded-full bg-ink/5" />
          </div>
          <div className="min-h-96 space-y-5 p-5 sm:p-7">
            <div className="h-16 w-3/4 animate-pulse rounded-3xl bg-ink/5" />
            <div className="ml-auto h-20 w-2/3 animate-pulse rounded-3xl bg-mist" />
            <div className="h-14 w-1/2 animate-pulse rounded-3xl bg-ink/5" />
          </div>
        </div>
      </div>
    </section>
  );
}

function PeerSpaceUnavailable() {
  const { t } = useTranslation();
  return (
    <section className="section section-muted min-h-[calc(100vh-12rem)] pt-8 sm:pt-12">
      <div className="container max-w-2xl">
        <div className="card text-center sm:p-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-mist text-2xl" aria-hidden="true">○</span>
          <h1 className="mt-5 text-3xl font-black tracking-[-0.03em] text-ink">{t("peerSpace.unavailable.title")}</h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-muted">{t("peerSpace.unavailable.description")}</p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/for-young-adults" className="button-primary">{t("peerSpace.unavailable.backAction")}</Link>
            <Link href="/referral" className="button-secondary">{t("peerSpace.unavailable.supportAction")}</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

type RoomIdentityMode = "nickname" | "anonymous";
type RoomExpectation = "none" | "vent" | "heard" | "similar" | "advice" | "resources";

const expectationOptions = ["none", "vent", "heard", "similar", "advice", "resources"] as const;

function PeerSpaceRoom({ state }: { state: "open" | "read-only" | "paused" }) {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [identityMode, setIdentityMode] = useState<RoomIdentityMode>("nickname");
  const [expectation, setExpectation] = useState<RoomExpectation>("none");
  const roomTitleRef = useRef<HTMLHeadingElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const statusKey = state === "open" ? "open" : state === "read-only" ? "readOnly" : "paused";
  const statusTone = state === "open"
    ? "bg-mint text-sage-dark"
    : state === "read-only"
      ? "bg-amber-100 text-amber-900"
      : "bg-rose-100 text-rose-800";
  const identitySummary = identityMode === "anonymous"
    ? t("peerSpace.room.settings.identity.anonymous.summary")
    : t("peerSpace.room.settings.identity.nickname.summary");
  const expectationSummary = t(`peerSpace.room.settings.expectations.options.${expectation}`);

  useEffect(() => {
    const frame = requestAnimationFrame(() => roomTitleRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const closeSettings = () => {
    setSettingsOpen(false);
    requestAnimationFrame(() => settingsTriggerRef.current?.focus());
  };

  return (
    <section className="section section-muted min-h-[calc(100vh-12rem)] py-6 sm:py-10">
      <div className="container max-w-4xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link href="/for-young-adults" className="text-sm font-bold text-sage-dark underline decoration-sage/40 underline-offset-4">
            {t("peerSpace.room.backAction")}
          </Link>
          <Link href="/referral" className="text-sm font-bold text-sage-dark underline decoration-sage/40 underline-offset-4">
            {t("peerSpace.room.supportAction")}
          </Link>
        </div>

        <div className="overflow-hidden rounded-[2rem] border border-ink/[0.08] bg-paper shadow-soft">
          <header className="border-b border-ink/[0.08] bg-gradient-to-br from-paper via-paper to-mist/45 px-5 py-5 sm:px-7 sm:py-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="eyebrow">{t("peerSpace.room.spaceLabel")}</p>
                <h1 ref={roomTitleRef} tabIndex={-1} className="mt-3 scroll-mt-24 text-2xl font-black tracking-[-0.03em] text-ink outline-none sm:text-3xl">
                  {t("peerSpace.room.title")}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{t("peerSpace.room.description")}</p>
              </div>
              <span className={`inline-flex items-center gap-2 rounded-full border border-current/10 px-3 py-1.5 text-xs font-bold ${statusTone}`} role="status">
                <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />
                {t(`peerSpace.room.status.${statusKey}`)}
              </span>
            </div>
            <div className="mt-5 grid gap-2 text-xs font-bold text-sage-dark sm:grid-cols-3" aria-live="polite">
              <span className="rounded-2xl border border-sage/15 bg-mist/85 px-3.5 py-2.5">{identitySummary}</span>
              <span className="rounded-2xl border border-sage/15 bg-cream/80 px-3.5 py-2.5">
                {t("peerSpace.room.settings.expectations.summary", { value: expectationSummary })}
              </span>
              <span className="rounded-2xl border border-sage/15 bg-paper/90 px-3.5 py-2.5">{t("peerSpace.room.schoolHidden")}</span>
            </div>
            {state !== "paused" ? (
              <button
                ref={settingsTriggerRef}
                type="button"
                className="button-secondary mt-4 min-h-10 w-full px-4 py-2 text-xs sm:w-auto"
                aria-expanded={settingsOpen}
                aria-controls="peer-space-room-settings"
                onClick={() => setSettingsOpen((open) => !open)}
              >
                {settingsOpen ? t("peerSpace.room.settings.closeAction") : t("peerSpace.room.settings.openAction")}
              </button>
            ) : null}
          </header>

          {settingsOpen && state !== "paused" ? (
            <section id="peer-space-room-settings" className="border-b border-ink/[0.08] bg-mist/30 p-5 sm:p-7" aria-labelledby="peer-space-room-settings-title">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div>
                  <h2 id="peer-space-room-settings-title" className="text-xl font-black tracking-[-0.02em] text-ink">
                    {t("peerSpace.room.settings.title")}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">{t("peerSpace.room.settings.description")}</p>
                </div>
                <span className="w-fit shrink-0 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900">
                  {t("peerSpace.room.settings.previewStatus")}
                </span>
              </div>

              <fieldset className="mt-6 rounded-[1.5rem] border border-ink/[0.07] bg-paper p-4 shadow-sm sm:p-5">
                <legend className="text-sm font-black text-ink">{t("peerSpace.room.settings.identity.legend")}</legend>
                <p className="mt-1 text-xs leading-6 text-muted">{t("peerSpace.room.settings.identity.description")}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(["nickname", "anonymous"] as const).map((mode) => (
                    <label
                      key={mode}
                      className={`cursor-pointer rounded-2xl border p-4 transition focus-within:ring-4 focus-within:ring-sage/15 ${identityMode === mode ? "border-sage bg-mist text-ink shadow-sm ring-1 ring-sage/20" : "border-ink/10 bg-cream/20 text-muted hover:border-sage/60 hover:bg-mist/25"}`}
                    >
                      <span className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="peer-space-identity"
                          value={mode}
                          className="mt-1 h-4 w-4 shrink-0 accent-sage-dark"
                          checked={identityMode === mode}
                          onChange={() => setIdentityMode(mode)}
                        />
                        <span>
                          <span className="block text-sm font-bold">{t(`peerSpace.room.settings.identity.${mode}.title`)}</span>
                          <span className="mt-1 block text-xs font-normal leading-6">{t(`peerSpace.room.settings.identity.${mode}.text`)}</span>
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="mt-4 rounded-[1.5rem] border border-ink/[0.07] bg-paper p-4 shadow-sm sm:p-5">
                <legend className="text-sm font-black text-ink">{t("peerSpace.room.settings.expectations.legend")}</legend>
                <p className="mt-1 text-xs leading-6 text-muted">{t("peerSpace.room.settings.expectations.description")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {expectationOptions.map((option) => (
                    <label
                      key={option}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2.5 text-xs font-bold transition focus-within:ring-4 focus-within:ring-sage/15 ${expectation === option ? "border-sage-dark bg-sage-dark text-white" : "border-sage/25 bg-paper text-sage-dark hover:border-sage"}`}
                    >
                      <input
                        type="radio"
                        name="peer-space-expectation"
                        value={option}
                        className={`h-4 w-4 shrink-0 ${expectation === option ? "accent-white" : "accent-sage-dark"}`}
                        checked={expectation === option}
                        onChange={() => setExpectation(option)}
                      />
                      {t(`peerSpace.room.settings.expectations.options.${option}`)}
                    </label>
                  ))}
                </div>
              </fieldset>

              <details className="mt-4 rounded-[1.5rem] border border-dashed border-ink/15 bg-cream/60 p-4 sm:p-5">
                <summary className="cursor-pointer text-sm font-bold text-ink marker:text-sage-dark">
                  {t("peerSpace.room.settings.future.summary")}
                </summary>
                <p className="mt-3 text-xs leading-6 text-muted">{t("peerSpace.room.settings.future.text")}</p>
              </details>

              <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-6 text-amber-900">
                {t("peerSpace.room.settings.previewHelp")}
              </p>
              <button type="button" className="button-primary mt-5 w-full sm:w-auto" onClick={closeSettings}>
                {t("peerSpace.room.settings.doneAction")}
              </button>
            </section>
          ) : null}

          {state === "paused" ? (
            <div className="flex min-h-96 items-center justify-center bg-cream/45 p-6 text-center sm:p-10">
              <div className="max-w-xl">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-800" aria-hidden="true">Ⅱ</span>
                <h2 className="mt-5 text-xl font-bold text-ink">{t("peerSpace.room.paused.title")}</h2>
                <p className="mt-3 text-sm leading-7 text-muted">{t("peerSpace.room.paused.text")}</p>
                <Link href="/referral" className="button-secondary mt-6">{t("peerSpace.room.supportAction")}</Link>
              </div>
            </div>
          ) : (
            <>
              <div className="flex min-h-[14rem] items-center justify-center bg-cream/35 p-5 text-center sm:min-h-[16rem] sm:p-8" aria-live="polite">
                <div className="max-w-2xl">
                  <h2 className="text-lg font-bold text-ink">
                    {state === "open" ? t("peerSpace.room.empty.title") : t("peerSpace.room.readOnly.title")}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-muted">
                    {state === "open" ? t("peerSpace.room.empty.text") : t("peerSpace.room.readOnly.text")}
                  </p>
                </div>
              </div>
              <div className="border-t border-ink/[0.08] bg-paper p-4 sm:p-5">
                {state === "read-only" ? (
                  <p className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-6 text-amber-900">
                    {t("peerSpace.room.readOnly.notice")}
                  </p>
                ) : null}
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
                  <textarea
                    className="field-control min-h-14 resize-none bg-ink/[0.025]"
                    rows={1}
                    disabled
                    placeholder={t("peerSpace.room.composer.placeholder")}
                    aria-label={t("peerSpace.room.composer.label")}
                  />
                  <button type="button" className="button-primary w-full shrink-0 sm:w-auto" disabled>
                    {t("peerSpace.room.composer.action")}
                  </button>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted">{t("peerSpace.room.composer.previewHelp")}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
