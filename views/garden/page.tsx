import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { MicroPilotFeedback } from "@/components/MicroPilotFeedback";
import {
  getCurrentUser,
  getTempoGarden,
  saveTempoQuickCheckIn,
  saveTempoReminderPreference,
  TempoGardenRequestError,
  type TempoGardenData,
} from "@/lib/cloudRecords";
import { useTranslation } from "@/lib/i18n/client";

type Feeling = "steady" | "mixed" | "heavy" | "unsure";
const feelings: Feeling[] = ["steady", "mixed", "heavy", "unsure"];
const reminderModes: TempoGardenData["reminderMode"][] = ["off", "daily", "weekly"];
const introStages: TempoGardenData["stage"][] = ["seed", "sprout", "bloom"];
const introKeys = ["first", "second", "third"] as const;

function introStorageKey(userId: string) {
  return `youthtempo:garden:intro:v1:${userId}`;
}

function GardenPlant({ stage }: { stage: TempoGardenData["stage"] }) {
  const hasSprout = stage !== "seed";
  const hasLeaves = stage === "leaves" || stage === "bloom";
  const hasFlower = stage === "bloom";
  return (
    <svg viewBox="0 0 220 220" className="mx-auto h-52 w-52 max-w-full" aria-hidden="true">
      <ellipse cx="110" cy="192" rx="76" ry="16" fill="#dce8d9" />
      <path d="M48 173h124l-14 30H62z" fill="#bb8667" />
      <path d="M53 169h114v13H53z" fill="#d39a76" />
      <path d="M60 169c8-15 91-15 100 0" fill="#6c8b69" />
      {hasSprout ? <path d="M110 164c-2-24 1-52 1-75" fill="none" stroke="#517c59" strokeWidth="6" strokeLinecap="round" /> : null}
      {hasSprout ? <path d="M109 139C86 119 77 121 67 125c13 23 29 29 42 21" fill="#78a576" /> : null}
      {hasLeaves ? <path d="M111 119c19-22 32-25 47-21-7 24-27 34-47 28" fill="#7eae7c" /> : null}
      {hasLeaves ? <path d="M109 100C91 77 76 73 63 77c8 22 25 32 46 31" fill="#90b988" /> : null}
      {hasFlower ? (
        <g transform="translate(111 76)">
          <circle cx="-15" cy="0" r="14" fill="#eed0cb" />
          <circle cx="15" cy="0" r="14" fill="#eed0cb" />
          <circle cx="0" cy="-15" r="14" fill="#f1d9d2" />
          <circle cx="0" cy="15" r="14" fill="#f1d9d2" />
          <circle r="10" fill="#ddad65" />
        </g>
      ) : null}
      {!hasSprout ? <ellipse cx="110" cy="158" rx="9" ry="13" fill="#8e6b50" /> : null}
    </svg>
  );
}

export default function GardenPage() {
  const { locale, t } = useTranslation();
  const [data, setData] = useState<TempoGardenData | null>(null);
  const [feeling, setFeeling] = useState<Feeling | "">("");
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [feedbackTrigger, setFeedbackTrigger] = useState(0);
  const [introUserId, setIntroUserId] = useState("");
  const [showIntro, setShowIntro] = useState(false);
  const [introStep, setIntroStep] = useState(0);
  const quickTitleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    setSignedOut(false);
    getCurrentUser()
      .then(async (user) => {
        if (!user) {
          if (active) setSignedOut(true);
          return null;
        }
        const garden = await getTempoGarden(locale);
        if (active) {
          setIntroUserId(user.id);
          let introSeen = false;
          try {
            introSeen = window.localStorage.getItem(introStorageKey(user.id)) === "seen";
          } catch {
            // A blocked browser store should not prevent a first visit.
          }
          setShowIntro(garden.total === 0 && !introSeen);
          setData(garden);
        }
        return null;
      })
      .catch((caught) => {
        if (!active) return;
        if (caught instanceof TempoGardenRequestError && caught.status === 401) {
          setSignedOut(true);
          return;
        }
        setError(t(caught instanceof TempoGardenRequestError && caught.status === 403
          ? "garden.status.restricted" : "garden.status.unavailable"));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [locale, t]);

  function finishIntro() {
    try {
      window.localStorage.setItem(introStorageKey(introUserId), "seen");
    } catch {
      // The form is still usable if browser storage is unavailable.
    }
    setShowIntro(false);
    window.requestAnimationFrame(() => quickTitleRef.current?.focus());
  }

  async function submitCheckIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!feeling) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveTempoQuickCheckIn(feeling, locale);
      setData(await getTempoGarden(locale));
      setFeeling("");
      setNotice(t("garden.quick.saved"));
      setFeedbackTrigger((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("garden.errors.unavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function updateReminder(mode: TempoGardenData["reminderMode"]) {
    setSavingPreference(true);
    setError("");
    setNotice("");
    try {
      await saveTempoReminderPreference(mode, locale);
      setData((current) => current ? { ...current, reminderMode: mode } : current);
      setNotice(t("garden.reminders.saved"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("garden.errors.unavailable"));
    } finally {
      setSavingPreference(false);
    }
  }

  return (
    <>
      <PageHero
        label={t("garden.hero.label")}
        title={t("garden.hero.title")}
        subtitle={t("garden.hero.description")}
        action={<Link href="/account" className="button-secondary">{t("garden.actions.account")}</Link>}
      />
      <main className="section section-muted">
        <div className="container grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {loading ? <p role="status">{t("garden.status.loading")}</p> : null}
          {signedOut ? <p><Link href="/account" className="button-primary">{t("garden.status.signIn")}</Link></p> : null}
          {error ? <p role="alert" className="rounded-xl bg-white p-4 text-sm text-sage-dark">{error}</p> : null}
          {notice ? <p role="status" className="rounded-xl bg-mint p-4 text-sm text-sage-dark">{notice}</p> : null}
          {data && showIntro ? (
            <section className="card min-w-0 overflow-hidden lg:col-span-2" aria-labelledby="garden-intro-title">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="eyebrow">{t("garden.intro.eyebrow")}</p>
                <p className="text-sm font-semibold text-muted">{t("garden.intro.progress", { current: introStep + 1, total: introStages.length })}</p>
              </div>
              <div className="mt-5 flex gap-2" aria-hidden="true">
                {introStages.map((stage, index) => <span key={stage} className={`h-1.5 flex-1 rounded-full ${index <= introStep ? "bg-sage-dark" : "bg-sage/20"}`} />)}
              </div>
              <div className="mt-6" aria-live="polite" aria-atomic="true">
                <div key={introStep} className="garden-slide-enter grid min-h-[20rem] items-center gap-6 rounded-[1.5rem] bg-mist/60 p-6 sm:p-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                  <div>
                    <h2 id="garden-intro-title" className="text-3xl font-bold leading-tight text-ink sm:text-4xl">{t(`garden.intro.slides.${introKeys[introStep]}.title`)}</h2>
                    <p className="mt-5 max-w-xl text-base leading-8 text-muted">{t(`garden.intro.slides.${introKeys[introStep]}.description`)}</p>
                    <p className="mt-5 max-w-xl rounded-2xl bg-paper/80 px-4 py-3 text-sm leading-7 text-sage-dark">{t(`garden.intro.slides.${introKeys[introStep]}.note`)}</p>
                  </div>
                  <div className="rounded-[1.5rem] bg-paper/80 p-4" aria-hidden="true"><GardenPlant stage={introStages[introStep]} /></div>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <button type="button" className="text-sm font-semibold text-sage-dark underline underline-offset-4" onClick={finishIntro}>{t("garden.intro.skip")}</button>
                <div className="flex flex-wrap gap-3">
                  {introStep > 0 ? <button type="button" className="button-secondary" onClick={() => setIntroStep((step) => step - 1)}>{t("garden.intro.previous")}</button> : null}
                  {introStep < introStages.length - 1
                    ? <button type="button" className="button-primary" onClick={() => setIntroStep((step) => step + 1)}>{t("garden.intro.next")}</button>
                    : <button type="button" className="button-primary" onClick={finishIntro}>{t("garden.intro.start")}</button>}
                </div>
              </div>
            </section>
          ) : null}
          {data && !showIntro ? (
            <>
              <section className="card min-w-0 text-center" aria-labelledby="garden-stage-title">
                <GardenPlant stage={data.stage} />
                <h2 id="garden-stage-title" className="mt-3 text-2xl font-bold text-ink">{t(`garden.stage.${data.stage}`)}</h2>
                <p className="mt-3 text-sm text-muted">{t("garden.stats.week", { count: data.thisWeek })}</p>
                <p className="mt-1 text-sm text-muted">{t("garden.stats.month", { count: data.thisMonth })}</p>
                <p className="mt-1 text-xs text-muted">{t("garden.stats.total", { count: data.total })}</p>
                <div className="mt-6 rounded-2xl bg-mist/60 p-4 text-left">
                  <h3 className="font-bold text-ink">{t("garden.rhythm.title")}</h3>
                  <p className="mt-2 break-words text-sm leading-7 text-muted">{data.recentRhythm || t("garden.rhythm.empty")}</p>
                </div>
              </section>
              <div className="grid min-w-0 gap-6">
                <section className="card" aria-labelledby="garden-quick-title">
                  <h2 id="garden-quick-title" ref={quickTitleRef} tabIndex={-1} className="text-xl font-bold text-ink">{t("garden.quick.title")}</h2>
                  <p className="mt-2 text-sm leading-7 text-muted">{t("garden.quick.description")}</p>
                  <form onSubmit={submitCheckIn} className="mt-5 grid gap-3">
                    <fieldset className="grid gap-3">
                      <legend className="sr-only">{t("garden.quick.title")}</legend>
                      {feelings.map((option) => (
                        <label key={option} className="flex cursor-pointer items-center gap-3 rounded-xl border border-sage/25 bg-white p-3 text-sm text-ink focus-within:ring-2 focus-within:ring-sage">
                          <input type="radio" name="feeling" value={option} checked={feeling === option} onChange={() => setFeeling(option)} required />
                          {t(`garden.quick.${option}`)}
                        </label>
                      ))}
                    </fieldset>
                    <button type="submit" className="button-primary mt-2 w-fit" disabled={saving || !feeling}>
                      {saving ? t("garden.quick.saving") : t("garden.quick.submit")}
                    </button>
                  </form>
                  <Link href="/check-in" className="button-secondary mt-5 w-fit">{t("garden.actions.fullSweet")}</Link>
                </section>
                <section className="card" aria-labelledby="garden-reminders-title">
                  <h2 id="garden-reminders-title" className="text-xl font-bold text-ink">{t("garden.reminders.title")}</h2>
                  <p className="mt-2 text-sm leading-7 text-muted">{t("garden.reminders.description")}</p>
                  <label htmlFor="garden-reminder-mode" className="mt-4 block text-sm font-bold text-ink">{t("garden.reminders.title")}</label>
                  <select id="garden-reminder-mode" className="mt-2 w-full rounded-xl border border-sage/30 bg-white px-4 py-3 text-sm text-ink" value={data.reminderMode} disabled={savingPreference} onChange={(event) => updateReminder(event.target.value as TempoGardenData["reminderMode"])}>
                    {reminderModes.map((mode) => <option key={mode} value={mode}>{t(`garden.reminders.${mode}`)}</option>)}
                  </select>
                  {savingPreference ? <p role="status" className="mt-2 text-sm text-muted">{t("garden.reminders.saving")}</p> : null}
                </section>
              </div>
            </>
          ) : null}
          {feedbackTrigger > 0 ? <div className="lg:col-span-2"><MicroPilotFeedback feature="quick_check_in" trigger={feedbackTrigger} /></div> : null}
        </div>
      </main>
    </>
  );
}
