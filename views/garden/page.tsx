import { GardenGuide, GardenWelcome } from "@/components/garden/GardenWelcome";
import { InlineStudentConsent } from "@/components/InlineStudentConsent";
import { useInlineStudentConsent } from "@/lib/useInlineStudentConsent";
import { useSessionActor } from "@/lib/useSessionActor";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { GardenActionDock } from "@/components/garden/GardenActionDock";
import { GardenCareSheet } from "@/components/garden/GardenCareSheet";
import { GardenFactsPanel } from "@/components/garden/GardenFactsPanel";
import { GardenKeepsakeDrawer } from "@/components/garden/GardenKeepsakeDrawer";
import { GardenLayoutSheet } from "@/components/garden/GardenLayoutSheet";
import { GardenParticipationFeedback, type GardenParticipationFeedbackData } from "@/components/garden/GardenParticipationFeedback";
import { GardenRecordSheet, type GardenFeeling } from "@/components/garden/GardenRecordSheet";
import { GardenScene, type GardenSceneInteraction } from "@/components/garden/GardenScene";
import { MicroPilotFeedback } from "@/components/MicroPilotFeedback";
import {
  deleteGardenKeepsake,
  GardenAuxiliaryError,
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
type CheckInRecovery = "saved" | "unconfirmed";
type GardenReadFailure = "identity" | "restricted" | "unavailable";

function introStorageKey(userId: string) {
  return `youthtempo:garden:intro:v2:${userId}`;
}

export default function GardenPage() {
  const { locale, t } = useTranslation();
  const consent = useInlineStudentConsent();
  const actor = useSessionActor();
  const [data, setData] = useState<TempoGardenData | null>(null);
  const [dataOwner, setDataOwner] = useState("");
  const [deleteRecovery, setDeleteRecovery] = useState<"unknown" | "deleted" | null>(null);
  const deleting = useRef(false);
  const [auxRecovery, setAuxRecovery] = useState<{ outcome: "pending" | "confirmed" | "notSent" | "rejected" | "unknown";
    reason: GardenAuxiliaryError["reason"]; checked: boolean } | null>(null);
  const auxiliaryBusy = useRef(false);
  const auxiliaryActor = useRef<(() => boolean) | null>(null);
  const [feeling, setFeeling] = useState<GardenFeeling | "">("");
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [readFailure, setReadFailure] = useState<GardenReadFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const [checkInRecovery, setCheckInRecovery] = useState<CheckInRecovery | null>(null);
  const [participationFeedback, setParticipationFeedback] = useState<GardenParticipationFeedbackData | null>(null);
  const pendingParticipation = useRef<Pick<TempoGardenData, "total" | "unlockedPositions"> | null>(null);
  const [layoutFocusSlot, setLayoutFocusSlot] = useState<GardenLayoutSlot | null>(null);
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
  const gardenLifecycle = useRef(0);
  const gardenReadRevision = useRef(0);
  const visibleData = actor.phase === "ready" && dataOwner === actor.actorId && !signedOut && !restricted ? data : null;
  const canUseGarden = Boolean(visibleData && consent.studentReady && consent.userId === actor.actorId
    && visibleData.canUseGarden !== false);

  function trackGardenRequest() {
    const lifecycle = gardenLifecycle.current;
    const current = consent.trackRequest();
    const currentActor = actor.trackRequest();
    return {
      current: () => lifecycle === gardenLifecycle.current && current() && currentActor(),
      // A same-account background consent check may invalidate content, but
      // must still release that page's busy state. Actor changes reset it below.
      settled: () => lifecycle === gardenLifecycle.current && currentActor(),
    };
  }

  function trackGardenRead(request = trackGardenRequest()) {
    const revision = ++gardenReadRevision.current;
    return {
      current: () => revision === gardenReadRevision.current && request.current(),
      settled: () => revision === gardenReadRevision.current && request.settled(),
    };
  }

  function applyGardenRead(garden: TempoGardenData, userId: string) {
    // Call only after fresh identity + owner-scoped GET succeed under the read guard.
    setIntroUserId(userId);
    let introSeen = false;
    try { introSeen = window.localStorage.getItem(introStorageKey(userId)) === "seen"; } catch {
      // A blocked browser store should not hide the garden.
    }
    setShowIntro(consent.studentReady && garden.canUseGarden !== false && !introSeen);
    setData(garden); setDataOwner(userId);
    setSignedOut(false); setRestricted(false); setReadFailure(null); setError("");
    setAuxRecovery((current) => current && current.outcome !== "pending" ? { ...current, checked: true } : current);
  }

  function failGardenRead(failure: GardenReadFailure) {
    setData(null); setDataOwner(""); setActiveSheet(null);
    setReadFailure(failure);
    // Retain restrictions while retrying. Only an authoritative success clears them.
    if (failure === "identity") setSignedOut(true);
    if (failure === "restricted") setRestricted(true);
  }

  function classifyGardenReadFailure(caught: unknown, identityVerified: boolean): GardenReadFailure {
    if (!identityVerified || (caught instanceof TempoGardenRequestError && caught.status === 401)) return "identity";
    return caught instanceof TempoGardenRequestError && caught.status === 403 ? "restricted" : "unavailable";
  }

  useEffect(() => {
    if (!sceneInteraction) return;
    const timeout = window.setTimeout(() => setSceneInteraction(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [sceneInteraction]);

  useEffect(() => {
    let active = true;
    let identityVerified = false;
    ++gardenLifecycle.current;
    const guard = trackGardenRead();
    setLoading(actor.phase === "loading" || actor.phase === "ready");
    setData(null);
    setDataOwner("");
    setSignedOut(actor.phase === "signed_out" || consent.phase === "signed_out");
    setRestricted(false);
    setReadFailure(actor.phase === "error" ? "identity" : null);
    setError("");
    setParticipationFeedback(null);
    setFeeling(""); setActiveSheet(null); setNotice(""); setCheckInRecovery(null);
    setSaving(false); setSavingPreference(false); setSavingInteraction(false);
    setIntroUserId(""); setShowIntro(false); setIntroStep(0); setSceneInteraction(null);
    setLayoutFocusSlot(null); setFeedbackTrigger(0); pendingParticipation.current = null;
    setDeleteRecovery(null); deleting.current = false;
    // Same-account consent rechecks retire content, not an unresolved write receipt.
    if (!auxiliaryActor.current?.()) { setAuxRecovery(null); auxiliaryActor.current = null; auxiliaryBusy.current = false; }
    const cleanup = () => { active = false; ++gardenLifecycle.current; };
    if (actor.phase !== "ready" || consent.phase === "loading" || consent.phase === "signed_out") return cleanup;
    getCurrentUser()
      .then(async (user) => {
        if (!active || !guard.current()) return;
        if (!user || user.id !== actor.actorId) {
          failGardenRead("identity");
          return;
        }
        await actor.getToken(user.id);
        if (!active || !guard.current()) return;
        identityVerified = true;
        const garden = await getTempoGarden(locale, actor.actorId);
        if (!active || !guard.current()) return;
        applyGardenRead(garden, user.id);
      })
      .catch((caught) => {
        if (!active || !guard.current()) return;
        failGardenRead(classifyGardenReadFailure(caught, identityVerified));
      })
      .finally(() => { if (active && guard.settled()) setLoading(false); });
    return cleanup;
  }, [locale, t, consent.studentReady, consent.userId, consent.phase, actor.actorId, actor.phase]);

  function finishIntro(openRecord = false) {
    if (!canUseGarden || introUserId !== actor.actorId) return;
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
    if (!canUseGarden || auxRecovery || !feeling || !data || saving || checkInRecovery) return;
    const guard = trackGardenRequest();
    setSaving(true);
    setError("");
    setNotice("");
    setParticipationFeedback(null);
    pendingParticipation.current = { total: data.total, unlockedPositions: [...data.unlockedPositions] };
    try {
      await saveTempoQuickCheckIn(feeling, locale, consent.userId);
    } catch {
      if (!guard.current()) return;
      // A failed response does not prove that the server did not save the record.
      setCheckInRecovery("unconfirmed");
      pendingParticipation.current = null;
      setActiveSheet(null);
      setSaving(false);
      return;
    } finally {
      if (guard.settled()) setSaving(false);
    }
    if (!guard.current()) return;
    setFeeling("");
    setActiveSheet(null);
    await refreshAfterCheckIn("saved");
  }

  async function refreshAfterCheckIn(recovery: CheckInRecovery) {
    if (!canUseGarden) return;
    const guard = trackGardenRequest();
    setSaving(true);
    setCheckInRecovery(recovery);
    setError("");
    setNotice("");
    try {
      const garden = await getTempoGarden(locale, consent.userId);
      if (!guard.current()) return;
      setData(garden);
      setCheckInRecovery(null);
      setRestricted(false);
      if (recovery === "saved") {
        const before = pendingParticipation.current;
        setParticipationFeedback({
          total: garden.total,
          stage: garden.stage,
          newParticipationDay: Boolean(before && garden.total > before.total),
          unlockedPositions: before ? garden.unlockedPositions.filter((slot) => !before.unlockedPositions.includes(slot)) : [],
        });
        pendingParticipation.current = null;
        setNotice(t("garden.quick.saved"));
        setFeedbackTrigger((current) => current + 1);
        setActiveSheet(null);
      } else {
        pendingParticipation.current = null;
        // Participation days cannot identify a particular request or prove it saved.
        setNotice(t("garden.quick.refreshedUnconfirmed"));
      }
    } catch (caught) {
      if (!guard.current()) return;
      if (caught instanceof TempoGardenRequestError && [401, 403].includes(caught.status)) {
        setData(null);
        if (caught.status === 401) setSignedOut(true);
        else {
          setRestricted(true);
          setError(t("garden.status.restricted"));
        }
      }
    } finally {
      if (guard.settled()) setSaving(false);
    }
  }

  function openLayout(slot: GardenLayoutSlot | null = null) {
    if (!canUseGarden || auxRecovery || !data) return;
    setLayoutFocusSlot(slot);
    setActiveSheet("layout");
  }

  function dismissUnlocks() {
    setParticipationFeedback((current) => current ? { ...current, unlockedPositions: [] } : current);
    setActiveSheet(null);
  }

  function beginAuxiliary() {
    if (auxiliaryBusy.current || auxRecovery || saving || savingPreference || savingInteraction) return null;
    const currentActor = actor.trackRequest();
    auxiliaryActor.current = currentActor;
    auxiliaryBusy.current = true;
    setAuxRecovery({ outcome: "pending", reason: "unavailable", checked: false });
    return currentActor;
  }

  function failAuxiliary(caught: unknown) {
    const failure = caught instanceof GardenAuxiliaryError ? caught : new GardenAuxiliaryError("unavailable", "unknown");
    setActiveSheet(null);
    setAuxRecovery({ outcome: failure.outcome, reason: failure.reason, checked: false });
    if (failure.reason === "identity") failGardenRead("identity");
    else if (failure.reason === "forbidden") failGardenRead("restricted");
  }

  async function updateReminder(mode: TempoGardenData["reminderMode"]) {
    if (!canUseGarden || !data || savingPreference) return;
    const currentActor = beginAuxiliary();
    if (!currentActor) return;
    const guard = trackGardenRequest();
    setSavingPreference(true);
    setError("");
    setNotice("");
    try {
      await saveTempoReminderPreference(mode, locale, consent.userId, currentActor);
      if (!currentActor()) return;
      if (!guard.current()) {
        setAuxRecovery({ outcome: "confirmed", reason: "unavailable", checked: false });
        return;
      }
      setAuxRecovery(null);
      setData((current) => current ? { ...current, reminderMode: mode } : current);
      setNotice(t("garden.reminders.saved"));
    } catch (caught) {
      if (!currentActor()) return;
      failAuxiliary(caught);
    } finally {
      if (auxiliaryActor.current === currentActor) auxiliaryBusy.current = false;
      if (currentActor()) setSavingPreference(false);
      else if (auxiliaryActor.current === currentActor) { setAuxRecovery(null); setSavingPreference(false); }
    }
  }

  function explore(place: ExplorePlace) {
    if (!canUseGarden || !data) return;
    setSceneInteraction((current) => ({
      id: (current?.id || 0) + 1,
      kind: place,
      message: t(`garden.explore.${place}.response`),
    }));
  }

  async function chooseCare(action: GardenCareAction) {
    if (!canUseGarden || !data || savingInteraction) return;
    const currentActor = beginAuxiliary();
    if (!currentActor) return;
    const guard = trackGardenRequest();
    setSavingInteraction(true);
    setError("");
    setNotice("");
    try {
      const result = await saveGardenCare(action, locale, consent.userId, currentActor);
      if (!currentActor()) return;
      if (!guard.current()) {
        setAuxRecovery({ outcome: "confirmed", reason: "unavailable", checked: false });
        return;
      }
      setAuxRecovery(null);
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
      if (!currentActor()) return;
      failAuxiliary(caught);
    } finally {
      if (auxiliaryActor.current === currentActor) auxiliaryBusy.current = false;
      if (currentActor()) setSavingInteraction(false);
      else if (auxiliaryActor.current === currentActor) { setAuxRecovery(null); setSavingInteraction(false); }
    }
  }

  async function chooseLayout(slot: GardenLayoutSlot, item: GardenItemKey) {
    if (!canUseGarden || !data || savingInteraction) return;
    const currentActor = beginAuxiliary();
    if (!currentActor) return;
    const guard = trackGardenRequest();
    setSavingInteraction(true);
    setError("");
    setNotice("");
    try {
      const result = await saveGardenLayout(slot, item, locale, consent.userId, currentActor);
      if (!currentActor()) return;
      if (!guard.current()) {
        setAuxRecovery({ outcome: "confirmed", reason: "unavailable", checked: false });
        return;
      }
      setAuxRecovery(null);
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
      setParticipationFeedback((current) => current ? {
        ...current, unlockedPositions: current.unlockedPositions.filter((position) => position !== slot),
      } : current);
      setActiveSheet(null);
    } catch (caught) {
      if (!currentActor()) return;
      failAuxiliary(caught);
    } finally {
      if (auxiliaryActor.current === currentActor) auxiliaryBusy.current = false;
      if (currentActor()) setSavingInteraction(false);
      else if (auxiliaryActor.current === currentActor) { setAuxRecovery(null); setSavingInteraction(false); }
    }
  }

  async function createKeepsake(type: GardenKeepsakeType) {
    if (!canUseGarden || !data || savingInteraction) return;
    const currentActor = beginAuxiliary();
    if (!currentActor) return;
    const guard = trackGardenRequest();
    setSavingInteraction(true);
    setError("");
    setNotice("");
    try {
      const result = await saveGardenKeepsake(type, locale, undefined, consent.userId, currentActor);
      if (!currentActor()) return;
      if (!guard.current()) {
        setAuxRecovery({ outcome: "confirmed", reason: "unavailable", checked: false });
        return;
      }
      setAuxRecovery(null);
      setData((current) => current ? {
        ...current,
        canAddKeepsakeToday: false,
        keepsakes: [result.keepsake, ...current.keepsakes.filter((item) => item.id !== result.keepsake.id)],
      } : current);
      setNotice(t(result.created ? "garden.keepsakes.saved" : "garden.keepsakes.alreadySaved"));
    } catch (caught) {
      if (!currentActor()) return;
      failAuxiliary(caught);
    } finally {
      if (auxiliaryActor.current === currentActor) auxiliaryBusy.current = false;
      if (currentActor()) setSavingInteraction(false);
      else if (auxiliaryActor.current === currentActor) { setAuxRecovery(null); setSavingInteraction(false); }
    }
  }

  async function removeKeepsake(id: string) {
    if (!visibleData || auxRecovery || deleting.current || deleteRecovery || savingInteraction || !visibleData.keepsakes.some((item) => item.id === id)) return;
    const guard = trackGardenRequest();
    deleting.current = true;
    setSavingInteraction(true);
    setError("");
    setNotice("");
    try {
      const result = await deleteGardenKeepsake(id, locale, actor.actorId);
      if (!guard.current()) return;
      if (result.deleted !== true || result.id !== id) throw new Error("delete_unconfirmed");
      // A confirmed deletion stays confirmed even when the following read fails.
      setData((current) => current ? { ...current, keepsakes: current.keepsakes.filter((item) => item.id !== id) } : current);
      setNotice(t("garden.keepsakes.removed"));
      setDeleteRecovery("deleted");
      await refreshKeepsakes(guard);
    } catch (caught) {
      if (!guard.current()) return;
      if (caught instanceof TempoGardenRequestError && caught.status < 500) {
        setError(caught.message);
        if ([401, 403].includes(caught.status)) {
          setData(null); setDataOwner(""); setActiveSheet(null);
          if (caught.status === 401) setSignedOut(true);
          else setRestricted(true);
        }
      } else {
        setDeleteRecovery("unknown");
        setData(null); setDataOwner(""); setActiveSheet(null);
      }
    } finally {
      if (guard.settled()) { setSavingInteraction(false); deleting.current = false; }
    }
  }

  async function refreshKeepsakes(request = trackGardenRequest()) {
    const guard = trackGardenRead(request);
    let identityVerified = false;
    setSavingInteraction(true);
    try {
      const user = await getCurrentUser();
      if (!guard.current()) return;
      if (!user || user.id !== actor.actorId) {
        failGardenRead("identity");
        return;
      }
      await actor.getToken(user.id);
      if (!guard.current()) return;
      identityVerified = true;
      const garden = await getTempoGarden(locale, actor.actorId);
      if (!guard.current()) return;
      applyGardenRead(garden, user.id);
      setDeleteRecovery(null);
    } catch (caught) {
      if (!guard.current()) return;
      failGardenRead(classifyGardenReadFailure(caught, identityVerified));
    } finally {
      if (guard.settled()) setSavingInteraction(false);
    }
  }

  async function retryGardenRead() {
    if (actor.phase !== "ready") { await actor.refreshIdentity(); return; }
    await refreshKeepsakes();
  }

  if (signedOut && consent.phase === "signed_out" && !readFailure && !deleteRecovery && !auxRecovery) return <div><GardenWelcome /><div className="container pb-8"><InlineStudentConsent controller={consent} studentOnly /></div></div>;

  const needsIdentity = actor.phase === "error" || (readFailure ? readFailure === "identity" : signedOut);

  return (
    <div className="garden-page">
      <div className="container min-w-0 py-5 sm:py-8">
        <div className="mb-4 flex flex-wrap justify-between gap-3">
          <h1 className="text-2xl font-bold text-ink">{t("gardenWelcome.enter")}</h1>
          <Link href="/account" className="button-secondary">{t("garden.actions.account")}</Link>
        </div>

        {loading ? <div className="garden-loading" role="status">{t("garden.status.loading")}</div> : null}
        {!loading && !consent.studentReady && !visibleData && !deleteRecovery && !auxRecovery && !readFailure && !restricted && !needsIdentity ? <InlineStudentConsent controller={consent} studentOnly className="mb-5" /> : null}
        {visibleData && !canUseGarden ? <p role="status" className="garden-message" data-testid="garden-management-status">{t(
          visibleData.managementReason === "withdrawn" || (!visibleData.managementReason && consent.summary?.consent?.status === "withdrawn")
            ? "garden.management.withdrawn" : "garden.management.consentUnavailable")}</p> : null}
        {needsIdentity ? <div className="garden-message" data-testid="garden-read-identity">
          <p role="alert">{t("garden.management.identityRequired")}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link href="/account" className="button-primary">{t("garden.actions.account")}</Link>
            <button type="button" className="button-secondary" data-testid="garden-identity-retry" disabled={loading || savingInteraction}
              onClick={() => void retryGardenRead()}>{t("garden.management.verifyIdentity")}</button>
          </div>
        </div> : readFailure || restricted ? <div className="garden-message" data-testid={readFailure === "unavailable" ? "garden-read-unavailable" : "garden-read-restricted"}>
          <p role="alert">{t(readFailure === "unavailable" ? "garden.management.readFailed" : "garden.management.accessRestricted")}</p>
          <button type="button" className="button-secondary mt-3" data-testid="garden-read-retry" disabled={loading || savingInteraction}
            onClick={() => void retryGardenRead()}>{t("garden.management.retryRead")}</button>
        </div> : null}
        {error && !readFailure && !needsIdentity && activeSheet !== "layout" ? <p role="alert" className="garden-message">{error}</p> : null}
        {auxRecovery && auxRecovery.outcome !== "pending" ? <div className="garden-message" data-testid="garden-aux-recovery">
          <p role="status">{t(`garden.auxiliary.${auxRecovery.outcome}`)}</p>
          {auxRecovery.outcome !== "confirmed" ? <p className="mt-2">{t(`garden.auxiliary.${auxRecovery.reason}`)}</p> : null}
          {auxRecovery.checked ? <>
            <p className="mt-2">{t(auxRecovery.outcome === "unknown" ? "garden.auxiliary.refreshed" : "garden.auxiliary.refreshedKnown")}</p>
            <button type="button" className="button-secondary mt-3 max-w-full whitespace-normal" data-testid="garden-aux-ack"
              onClick={() => setAuxRecovery(null)}>{t("garden.auxiliary.acknowledge")}</button>
          </> : !readFailure && !needsIdentity ? <button type="button" className="button-secondary mt-3" data-testid="garden-aux-read"
            disabled={savingInteraction || actor.phase !== "ready"} onClick={() => void refreshKeepsakes()}>{t("garden.auxiliary.read")}</button> : null}
        </div> : null}
        {checkInRecovery ? (
          <div className="garden-message">
            <p role="status">{t(checkInRecovery === "saved" ? "garden.quick.savedRefreshPending" : "garden.quick.saveUnconfirmed")}</p>
            <button type="button" className="button-secondary mt-3" disabled={saving} onClick={() => void refreshAfterCheckIn(checkInRecovery)}>
              {t(saving ? "garden.quick.refreshingGarden" : "garden.quick.refreshGarden")}
            </button>
          </div>
        ) : null}
        {deleteRecovery ? <div className="garden-message">
          <p role="status">{t(deleteRecovery === "deleted" ? "garden.management.deletedRefreshPending" : "garden.management.deleteUnknown")}</p>
          {!readFailure && !needsIdentity ? <button type="button" className="button-secondary mt-3" disabled={savingInteraction || actor.phase !== "ready"}
            onClick={() => void refreshKeepsakes()}>{t("garden.quick.refreshGarden")}</button>
            : null}
        </div> : null}

        <details className="mb-5 rounded-2xl border border-sage/20 p-4">
          <summary className="cursor-pointer font-semibold text-sage-dark">{t("gardenWelcome.guide")}</summary>
          <GardenGuide />
        </details>

        {visibleData && !canUseGarden && visibleData.hasExistingData === false ? <p className="garden-message" data-testid="garden-management-empty">{t("garden.management.empty")}</p> : null}
        {visibleData && (canUseGarden || visibleData.hasExistingData !== false) ? (
          <>
            <GardenScene
              readOnly={!canUseGarden}
              stage={visibleData.stage}
              statusText={t(!canUseGarden ? "garden.management.existing" : checkInRecovery === "saved" ? "garden.quick.saved" : visibleData.todayParticipated ? "garden.status.todayRecorded" : "garden.status.todayOpen")}
              onExplore={explore}
              selectedItems={visibleData.layout}
              interaction={sceneInteraction}
              overlay={canUseGarden && showIntro ? (
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
            {canUseGarden && !checkInRecovery && !auxRecovery ? <GardenActionDock onRecord={() => setActiveSheet("record")} onCare={() => setActiveSheet("care")} onLayout={() => openLayout()} /> : null}
            {canUseGarden && visibleData.todayParticipated && !visibleData.todayCare
              && !loading && !saving && !savingInteraction && !checkInRecovery && !auxRecovery && !deleteRecovery ? (
              <p className="garden-notice" data-testid="garden-care-invitation">{t("garden.care.available")}</p>
            ) : null}

            {notice ? <p role="status" className="garden-notice">{notice}</p> : null}
            {participationFeedback ? (
              <GardenParticipationFeedback feedback={participationFeedback} onOpenLayout={openLayout} onDismissUnlocks={dismissUnlocks} />
            ) : null}
            <GardenFactsPanel data={visibleData} readOnly={!canUseGarden} controlsBlocked={Boolean(auxRecovery)} savingPreference={savingPreference || Boolean(auxRecovery)} onReminderChange={updateReminder}
              onOpenKeepsakes={() => { if (!auxRecovery) setActiveSheet("keepsakes"); }} onOpenLayout={() => openLayout()} />

            <GardenRecordSheet open={canUseGarden && activeSheet === "record"} feeling={feeling} saving={saving || Boolean(auxRecovery)} onFeelingChange={setFeeling} onSubmit={submitCheckIn} onClose={() => setActiveSheet(null)} />
            <GardenCareSheet
              open={canUseGarden && activeSheet === "care"}
              todayParticipated={visibleData.todayParticipated}
              todayCare={visibleData.todayCare?.action || null}
              saving={savingInteraction || Boolean(auxRecovery)}
              onChoose={chooseCare}
              onClose={() => setActiveSheet(null)}
            />
            <GardenLayoutSheet
              open={canUseGarden && activeSheet === "layout"}
              unlockedPositions={visibleData.unlockedPositions}
              unlockedItems={visibleData.unlockedItems}
              selectedItems={visibleData.layout}
              saving={savingInteraction || Boolean(auxRecovery)}
              focusSlot={layoutFocusSlot}
              error={error}
              onChoose={chooseLayout}
              onClose={() => { setActiveSheet(null); setLayoutFocusSlot(null); }}
            />
            <GardenKeepsakeDrawer
              open={activeSheet === "keepsakes"}
              keepsakes={visibleData.keepsakes}
              todayParticipated={visibleData.todayParticipated}
              canCreateToday={canUseGarden && visibleData.canAddKeepsakeToday}
              readOnly={!canUseGarden}
              saving={savingInteraction || Boolean(deleteRecovery) || Boolean(auxRecovery)}
              onCreate={createKeepsake}
              onDelete={removeKeepsake}
              onClose={() => setActiveSheet(null)}
            />
          </>
        ) : null}

        <nav className="mt-6 flex flex-wrap gap-3" aria-label={t("garden.support.ariaLabel")}>
          <Link href="/mood-journal" className="button-secondary">{t("garden.support.expression")}</Link>
          <Link href="/referral" className="button-secondary">{t("garden.support.help")}</Link>
          <Link href="/resources" className="button-secondary">{t("garden.support.urgent")}</Link>
        </nav>
        {feedbackTrigger > 0 ? <div className="mt-6"><MicroPilotFeedback feature="quick_check_in" trigger={feedbackTrigger} /></div> : null}
      </div>
    </div>
  );
}
