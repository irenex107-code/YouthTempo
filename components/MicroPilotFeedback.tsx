import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/client";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";
import { useSessionActor } from "@/lib/useSessionActor";
import { getSupabase } from "@/lib/supabaseClient";

type Feature = "quick_check_in" | "sweet" | "peer_space" | "support" | "mood_journal" | "worry_time";
type Answer = boolean | null;
const questions = ["helpful", "wouldReturn", "wantsHumanSupport"] as const;
type Draft = { answers: Record<(typeof questions)[number], Answer>; comment: string; revision: number };
type FeedbackContext = {
  ownerId: string; feature: Feature; trigger: number | string; locale: string;
  key: string; actorCurrent: () => boolean;
};
type FeedbackView = { context: FeedbackContext | null; draft: Draft; visible: boolean; busy: boolean; notice: string };
const emptyDraft = (): Draft => ({ answers: { helpful: null, wouldReturn: null, wantsHumanSupport: null }, comment: "", revision: 0 });

export function MicroPilotFeedback({ feature, trigger, crisis = false }: {
  feature: Feature;
  trigger: number | string;
  crisis?: boolean;
}) {
  const { locale, t } = useTranslation();
  const { actorId, phase, trackRequest, getToken, refreshIdentity } = useSessionActor();
  // Drafts live only for this mount. Identity changes hide them, not transfer or delete them.
  const drafts = useRef(new Map<string, Draft>());
  const context = useRef<FeedbackContext | null>(null);
  const pending = useRef(new Set<FeedbackContext>());
  const [identityRevision, setIdentityRevision] = useState(0);
  const [view, setView] = useState<FeedbackView>({ context: null, draft: emptyDraft(), visible: false, busy: false, notice: "" });
  const isCurrent = useCallback((request: FeedbackContext) => context.current === request && request.actorCurrent(), []);
  const verifyActor = useCallback(async (request: FeedbackContext) => {
    if (!isCurrent(request)) return false;
    try {
      await getToken(request.ownerId);
      return isCurrent(request);
    } catch {
      if (isCurrent(request)) {
        context.current = null;
        setView((current) => current.context === request ? { ...current, visible: false, busy: false, notice: "" } : current);
        await refreshIdentity();
        // A transient read failure can recover to the same ID without a hook state change.
        if (request.actorCurrent()) setIdentityRevision((revision) => revision + 1);
      }
      return false;
    }
  }, [getToken, isCurrent, refreshIdentity]);

  useEffect(() => {
    const request: FeedbackContext = { ownerId: actorId, feature, trigger, locale,
      key: `${actorId}:${feature}`, actorCurrent: trackRequest() };
    context.current = request;
    setView({ context: request, draft: drafts.current.get(request.key) || emptyDraft(), visible: false, busy: false, notice: "" });
    if (phase === "ready" && actorId && trigger && !crisis) {
      void (async () => {
        try {
          const result = await peerSpaceRequest<{ eligible: boolean }>(
            `/api/pilot-experience?feature=${encodeURIComponent(feature)}`, locale, "GET", undefined, actorId,
          );
          if (await verifyActor(request)) setView((current) => current.context === request ? { ...current, visible: result.eligible } : current);
        } catch {
          if (await verifyActor(request)) setView((current) => current.context === request ? { ...current, visible: false } : current);
        }
      })();
    }
    return () => { if (context.current === request) context.current = null; };
  }, [actorId, phase, feature, trigger, crisis, locale, identityRevision, trackRequest, verifyActor]);

  useEffect(() => {
    const refresh = () => {
      const request = context.current;
      void refreshIdentity().then(() => {
        if (request && context.current === request && !request.actorCurrent()) setIdentityRevision((revision) => revision + 1);
      });
    };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    // The shared hook owns identity. Also renew the local context when multiple
    // Auth events end at the same ID and React coalesces their state updates.
    const subscription = getSupabase()?.auth.onAuthStateChange((event) => {
      if (event !== "INITIAL_SESSION" && context.current && !context.current.actorCurrent()) {
        setIdentityRevision((revision) => revision + 1);
      }
    });
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
      subscription?.data.subscription.unsubscribe();
    };
  }, [refreshIdentity]);

  function editDraft(update: (draft: Draft) => Draft) {
    const request = view.context;
    if (!request || !isCurrent(request)) return;
    const previous = drafts.current.get(request.key) || emptyDraft();
    const next = { ...update(previous), revision: previous.revision + 1 };
    drafts.current.set(request.key, next);
    setView((current) => current.context === request ? { ...current, draft: next } : current);
  }

  async function finish(outcome: "dismissed" | "submitted") {
    const request = view.context;
    if (!request || !isCurrent(request) || !view.visible || pending.current.has(request) || !trigger || crisis) return;
    const snapshot = drafts.current.get(request.key) || view.draft;
    pending.current.add(request);
    setView((current) => current.context === request ? { ...current, busy: true, notice: "" } : current);
    try {
      if (!(await verifyActor(request))) return;
      const response = await peerSpaceRequest<{ urgent: boolean }>("/api/pilot-experience", locale, "POST", {
        feature, outcome,
        ...(outcome === "submitted" ? { ...snapshot.answers, comment: snapshot.comment } : {}),
      }, request.ownerId);
      if (!(await verifyActor(request))) return;
      // A completed snapshot cannot remove a newer edit, including after leaving and returning.
      const unchanged = (drafts.current.get(request.key)?.revision ?? 0) === snapshot.revision;
      if (unchanged) drafts.current.delete(request.key);
      setView((current) => current.context === request ? { ...current, visible: unchanged ? false : current.visible,
        notice: outcome === "submitted" && response.urgent ? t("microFeedback.urgent")
          : outcome === "submitted" && unchanged ? t("microFeedback.thanks") : "" } : current);
    } catch {
      if (await verifyActor(request)) setView((current) => current.context === request ? { ...current, notice: t("microFeedback.errors.unavailable") } : current);
    } finally {
      pending.current.delete(request);
      if (await verifyActor(request)) setView((current) => current.context === request ? { ...current, busy: false } : current);
    }
  }

  const currentView = phase === "ready" && view.context?.ownerId === actorId && view.context.feature === feature
    && view.context.trigger === trigger && view.context.locale === locale && !crisis;
  const { answers, comment } = view.draft;
  const { busy } = view;
  const notice = currentView ? view.notice : "";

  return (
    <div className="min-w-0">
      {currentView && Boolean(trigger) && view.visible ? (
        <section className="mt-5 rounded-2xl border border-sage/25 bg-paper p-5 shadow-sm" aria-label={t("microFeedback.title")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-ink">{t("microFeedback.title")}</h2>
              <p className="mt-1 text-sm text-muted">{t("microFeedback.description")}</p>
            </div>
            <button type="button" className="text-sm font-bold text-sage-dark underline" disabled={busy} onClick={() => finish("dismissed")}>
              {t("microFeedback.skip")}
            </button>
          </div>
          <div className="mt-4 grid gap-4">
            {questions.map((question) => (
              <fieldset key={question} className="min-w-0">
                <legend className="text-sm font-bold text-ink">{t(`microFeedback.questions.${question}`)}</legend>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  {([true, false] as const).map((value) => (
                    <label key={String(value)} className="flex cursor-pointer items-center gap-2">
                      <input type="radio" name={question} checked={answers[question] === value}
                        onChange={() => editDraft((draft) => ({ ...draft, answers: { ...draft.answers, [question]: value } }))} />
                      {t(value ? "microFeedback.yes" : "microFeedback.no")}
                    </label>
                  ))}
                  <button type="button" className="text-xs text-muted underline" onClick={() => editDraft((draft) => ({ ...draft, answers: { ...draft.answers, [question]: null } }))}>
                    {t("microFeedback.clear")}
                  </button>
                </div>
              </fieldset>
            ))}
            <label className="text-sm font-bold text-ink">{t("microFeedback.comment")}
              <textarea className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3 text-sm font-normal" rows={2}
                maxLength={500} value={comment} onChange={(event) => editDraft((draft) => ({ ...draft, comment: event.target.value }))} />
            </label>
            <button type="button" className="button-secondary w-fit" disabled={busy} onClick={() => finish("submitted")}>
              {t("microFeedback.submit")}
            </button>
          </div>
        </section>
      ) : null}
      {notice ? <p className="mt-3 text-sm leading-6 text-sage-dark" role="status">{notice}{" "}
        {notice === t("microFeedback.urgent") || (notice === t("microFeedback.thanks") && answers.wantsHumanSupport)
          ? <Link href="/referral" className="underline">{t("microFeedback.support")}</Link> : null}
      </p> : null}
    </div>
  );
}
