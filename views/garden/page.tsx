import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { GardenActionDock } from "@/components/garden/GardenActionDock";
import { GardenCareSheet } from "@/components/garden/GardenCareSheet";
import { GardenFactsPanel } from "@/components/garden/GardenFactsPanel";
import { GardenKeepsakeDrawer } from "@/components/garden/GardenKeepsakeDrawer";
import { GardenLayoutSheet } from "@/components/garden/GardenLayoutSheet";
import { GardenRecordSheet, type GardenFeeling } from "@/components/garden/GardenRecordSheet";
import { GardenScene, type GardenSceneInteraction } from "@/components/garden/GardenScene";
import { MicroPilotFeedback } from "@/components/MicroPilotFeedback";
import {
  getCurrentUser,
  getTempoGarden,
  saveTempoQuickCheckIn,
  saveTempoReminderPreference,
  TempoGardenRequestError,
  type TempoGardenData,
} from "@/lib/cloudRecords";
import type { GardenCareAction, GardenItemKey, GardenLayoutSlot } from "@/lib/gardenCatalog";
import { useTranslation } from "@/lib/i18n/client";

type GardenSheetName = "record" | "care" | "layout" | "keepsakes" | null;
type ExplorePlace = "pond" | "bench" | "bird";

function introStorageKey(userId: string) {
  return `youthtempo:garden:intro:v2:${userId}`;
}

export default function GardenPage() {
  const { locale, t } = useTranslation();
  const [data, setData] = useState<TempoGardenData | null>(null);
  const [feeling, setFeeling] = useState<GardenFeeling | "">("");
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
  const [activeSheet, setActiveSheet] = useState<GardenSheetName>(null);
  const [selectedItems, setSelectedItems] = useState<Partial<Record<GardenLayoutSlot, GardenItemKey>>>({});
  const [sceneInteraction, setSceneInteraction] = useState<GardenSceneInteraction | null>(null);

  useEffect(() => {
    if (!sceneInteraction) return;
    const timeout = window.setTimeout(() => setSceneInteraction(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [sceneInteraction]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    setSignedOut(false);
    setError("");
    getCurrentUser()
      .then(async (user) => {
        if (!user) {
          if (active) setSignedOut(true);
          return;
        }
        const garden = await getTempoGarden(locale);
        if (!active) return;
        setIntroUserId(user.id);
        let introSeen = false;
        try {
          introSeen = window.localStorage.getItem(introStorageKey(user.id)) === "seen";
        } catch {
          // A blocked browser store should not hide the garden.
        }
        setShowIntro(!introSeen);
        setData(garden);
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

  function finishIntro(openRecord = false) {
    try {
      window.localStorage.setItem(introStorageKey(introUserId), "seen");
    } catch {
      // The garden remains usable if browser storage is unavailable.
    }
    setShowIntro(false);
    if (openRecord) setActiveSheet("record");
  }

  async function submitCheckIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!feeling) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveTempoQuickCheckIn(feeling, locale);
      const garden = await getTempoGarden(locale);
      setData(garden);
      setFeeling("");
      setFeedbackTrigger((current) => current + 1);
      setActiveSheet("care");
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

  function explore(place: ExplorePlace) {
    setSceneInteraction((current) => ({
      id: (current?.id || 0) + 1,
      kind: place,
      message: t(`garden.explore.${place}.response`),
    }));
  }

  function previewCare(action: GardenCareAction) {
    setSceneInteraction((current) => ({
      id: (current?.id || 0) + 1,
      kind: action,
      message: t(`garden.care.options.${action}.response`),
    }));
    setActiveSheet(null);
  }

  function previewLayout(slot: GardenLayoutSlot, item: GardenItemKey) {
    setSelectedItems((current) => ({ ...current, [slot]: item }));
    setSceneInteraction((current) => ({
      id: (current?.id || 0) + 1,
      kind: "layout",
      slot,
      message: t("garden.layout.previewSaved"),
    }));
    setActiveSheet(null);
  }

  return (
    <main className="garden-page">
      <div className="container min-w-0 py-5 sm:py-8">
        <div className="mb-4 flex justify-end">
          <Link href="/account" className="button-secondary">{t("garden.actions.account")}</Link>
        </div>

        {loading ? <div className="garden-loading" role="status">{t("garden.status.loading")}</div> : null}
        {signedOut ? <div className="garden-message"><Link href="/account" className="button-primary">{t("garden.status.signIn")}</Link></div> : null}
        {error ? <p role="alert" className="garden-message">{error}</p> : null}

        {data ? (
          <>
            <GardenScene
              stage={data.stage}
              statusText={t(data.todayParticipated ? "garden.status.todayRecorded" : "garden.status.todayOpen")}
              onExplore={explore}
              selectedItems={selectedItems}
              interaction={sceneInteraction}
              overlay={showIntro ? (
                <div className="garden-intro-overlay" aria-live="polite">
                  <p className="eyebrow">{t("garden.intro.eyebrow")}</p>
                  <div className="mt-3 flex gap-2" aria-hidden="true">
                    {[0, 1].map((step) => <span key={step} className={`h-1 flex-1 rounded-full ${step <= introStep ? "bg-sage-dark" : "bg-sage/20"}`} />)}
                  </div>
                  <h2 className="mt-5 text-2xl font-bold leading-tight text-ink sm:text-3xl">{t(`garden.intro.slides.${introStep === 0 ? "first" : "second"}.title`)}</h2>
                  <p className="mt-3 text-sm leading-7 text-muted">{t(`garden.intro.slides.${introStep === 0 ? "first" : "second"}.description`)}</p>
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <button type="button" className="text-sm font-semibold text-sage-dark underline underline-offset-4" onClick={() => finishIntro(false)}>{t("garden.intro.skip")}</button>
                    {introStep === 0
                      ? <button type="button" className="button-primary" onClick={() => setIntroStep(1)}>{t("garden.intro.next")}</button>
                      : <button type="button" className="button-primary" onClick={() => finishIntro(true)}>{t("garden.intro.start")}</button>}
                  </div>
                </div>
              ) : undefined}
            />
            <GardenActionDock onRecord={() => setActiveSheet("record")} onCare={() => setActiveSheet("care")} onLayout={() => setActiveSheet("layout")} />

            {notice ? <p role="status" className="garden-notice">{notice}</p> : null}
            <GardenFactsPanel data={data} savingPreference={savingPreference} onReminderChange={updateReminder} onOpenKeepsakes={() => setActiveSheet("keepsakes")} />

            <GardenRecordSheet open={activeSheet === "record"} feeling={feeling} saving={saving} onFeelingChange={setFeeling} onSubmit={submitCheckIn} onClose={() => setActiveSheet(null)} />
            <GardenCareSheet open={activeSheet === "care"} available={data.todayParticipated} onChoose={previewCare} onClose={() => setActiveSheet(null)} />
            <GardenLayoutSheet
              open={activeSheet === "layout"}
              unlockedPositions={data.unlockedPositions}
              unlockedItems={data.unlockedItems}
              selectedItems={selectedItems}
              onChoose={previewLayout}
              onClose={() => setActiveSheet(null)}
            />
            <GardenKeepsakeDrawer open={activeSheet === "keepsakes"} onClose={() => setActiveSheet(null)} />
          </>
        ) : null}

        {feedbackTrigger > 0 ? <div className="mt-6"><MicroPilotFeedback feature="quick_check_in" trigger={feedbackTrigger} /></div> : null}
      </div>
    </main>
  );
}
