import { GardenGuide, GardenWelcome } from "@/components/garden/GardenWelcome";
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
  deleteGardenKeepsake,
  getCurrentUser,
  getTempoGarden,
  saveGardenCare,
  saveGardenKeepsake,
  saveGardenLayout,
  saveTempoQuickCheckIn,
  saveTempoReminderPreference,
  TempoGardenRequestError,
  type TempoGardenData,
} from "@/lib/cloudRecords";
import type { GardenCareAction, GardenItemKey, GardenKeepsakeType, GardenLayoutSlot } from "@/lib/gardenCatalog";
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
  const [savingInteraction, setSavingInteraction] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [feedbackTrigger, setFeedbackTrigger] = useState(0);
  const [introUserId, setIntroUserId] = useState("");
  const [showIntro, setShowIntro] = useState(false);
  const [introStep, setIntroStep] = useState(0);
  const [activeSheet, setActiveSheet] = useState<GardenSheetName>(null);
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

  async function chooseCare(action: GardenCareAction) {
    setSavingInteraction(true);
    setError("");
    setNotice("");
    try {
      const result = await saveGardenCare(action, locale);
      setData((current) => current ? {
        ...current,
        canCareToday: false,
        todayCare: result.care,
      } : current);
      setSceneInteraction((current) => ({
        id: (current?.id || 0) + 1,
        kind: result.care.action,
        message: t(`garden.care.options.${result.care.action}.response`),
      }));
      setActiveSheet(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("garden.errors.unavailable"));
    } finally {
      setSavingInteraction(false);
    }
  }

  async function chooseLayout(slot: GardenLayoutSlot, item: GardenItemKey) {
    setSavingInteraction(true);
    setError("");
    setNotice("");
    try {
      const result = await saveGardenLayout(slot, item, locale);
      setData((current) => current ? {
        ...current,
        layout: { ...current.layout, [result.layoutItem.slot]: result.layoutItem.itemKey },
      } : current);
      setSceneInteraction((current) => ({
        id: (current?.id || 0) + 1,
        kind: "layout",
        slot: result.layoutItem.slot,
        message: t("garden.layout.saved"),
      }));
      setActiveSheet(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("garden.errors.unavailable"));
    } finally {
      setSavingInteraction(false);
    }
  }

  async function createKeepsake(type: GardenKeepsakeType) {
    setSavingInteraction(true);
    setError("");
    setNotice("");
    try {
      const result = await saveGardenKeepsake(type, locale);
      setData((current) => current ? {
        ...current,
        canAddKeepsakeToday: false,
        keepsakes: [result.keepsake, ...current.keepsakes.filter((item) => item.id !== result.keepsake.id)],
      } : current);
      setNotice(t(result.created ? "garden.keepsakes.saved" : "garden.keepsakes.alreadySaved"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("garden.errors.unavailable"));
    } finally {
      setSavingInteraction(false);
    }
  }

  async function removeKeepsake(id: string) {
    setSavingInteraction(true);
    setError("");
    setNotice("");
    try {
      await deleteGardenKeepsake(id, locale);
      const garden = await getTempoGarden(locale);
      setData(garden);
      setNotice(t("garden.keepsakes.removed"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("garden.errors.unavailable"));
    } finally {
      setSavingInteraction(false);
    }
  }

  if (signedOut) return <main><GardenWelcome /></main>;

  return (
    <main className="garden-page">
      <div className="container min-w-0 py-5 sm:py-8">
        <div className="mb-4 flex flex-wrap justify-between gap-3">
          <h1 className="text-2xl font-bold text-ink">{t("gardenWelcome.enter")}</h1>
          <Link href="/account" className="button-secondary">{t("garden.actions.account")}</Link>
        </div>

        {loading ? <div className="garden-loading" role="status">{t("garden.status.loading")}</div> : null}
        {signedOut ? <div className="garden-message"><Link href="/account" className="button-primary">{t("garden.status.signIn")}</Link></div> : null}
        {error ? <p role="alert" className="garden-message">{error}</p> : null}

        <details className="mb-5 rounded-2xl border border-sage/20 p-4">
          <summary className="cursor-pointer font-semibold text-sage-dark">{t("gardenWelcome.guide")}</summary>
          <GardenGuide />
        </details>

        {data ? (
          <>
            <GardenScene
              stage={data.stage}
              statusText={t(data.todayParticipated ? "garden.status.todayRecorded" : "garden.status.todayOpen")}
              onExplore={explore}
              selectedItems={data.layout}
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
                      : <button type="button" className="button-primary" onClick={() => finishIntro(false)}>{t("garden.intro.start")}</button>}
                  </div>
                </div>
              ) : undefined}
            />
            <GardenActionDock onRecord={() => setActiveSheet("record")} onCare={() => setActiveSheet("care")} onLayout={() => setActiveSheet("layout")} />

            {notice ? <p role="status" className="garden-notice">{notice}</p> : null}
            <GardenFactsPanel data={data} savingPreference={savingPreference} onReminderChange={updateReminder} onOpenKeepsakes={() => setActiveSheet("keepsakes")} />

            <GardenRecordSheet open={activeSheet === "record"} feeling={feeling} saving={saving} onFeelingChange={setFeeling} onSubmit={submitCheckIn} onClose={() => setActiveSheet(null)} />
            <GardenCareSheet
              open={activeSheet === "care"}
              todayParticipated={data.todayParticipated}
              todayCare={data.todayCare?.action || null}
              saving={savingInteraction}
              onChoose={chooseCare}
              onClose={() => setActiveSheet(null)}
            />
            <GardenLayoutSheet
              open={activeSheet === "layout"}
              unlockedPositions={data.unlockedPositions}
              unlockedItems={data.unlockedItems}
              selectedItems={data.layout}
              saving={savingInteraction}
              onChoose={chooseLayout}
              onClose={() => setActiveSheet(null)}
            />
            <GardenKeepsakeDrawer
              open={activeSheet === "keepsakes"}
              keepsakes={data.keepsakes}
              canCreateToday={data.canAddKeepsakeToday}
              saving={savingInteraction}
              onCreate={createKeepsake}
              onDelete={removeKeepsake}
              onClose={() => setActiveSheet(null)}
            />
          </>
        ) : null}

        {feedbackTrigger > 0 ? <div className="mt-6"><MicroPilotFeedback feature="quick_check_in" trigger={feedbackTrigger} /></div> : null}
      </div>
    </main>
  );
}
