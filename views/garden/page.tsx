import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { MicroPilotFeedback } from "@/components/MicroPilotFeedback";
import {
  getCurrentUser,
  getTempoGarden,
  saveTempoQuickCheckIn,
  saveTempoReminderPreference,
  type TempoGardenData,
} from "@/lib/cloudRecords";
import { useTranslation } from "@/lib/i18n/client";

type Feeling = "steady" | "mixed" | "heavy" | "unsure";
const feelings: Feeling[] = ["steady", "mixed", "heavy", "unsure"];
const reminderModes: TempoGardenData["reminderMode"][] = ["off", "daily", "weekly"];

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

  useEffect(() => {
    let active = true;
    setLoading(true);
    getCurrentUser()
      .then(async (user) => {
        if (!user) {
          if (active) setSignedOut(true);
          return null;
        }
        return getTempoGarden(locale);
      })
      .then((garden) => { if (active && garden) setData(garden); })
      .catch(() => { if (active) setError(t("garden.status.unavailable")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [locale, t]);

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
          <MicroPilotFeedback feature="quick_check_in" trigger={feedbackTrigger} />
          {data ? (
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
                  <h2 id="garden-quick-title" className="text-xl font-bold text-ink">{t("garden.quick.title")}</h2>
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
        </div>
      </main>
    </>
  );
}
