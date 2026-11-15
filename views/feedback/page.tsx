import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { useSessionActor, type SessionActor } from "@/lib/useSessionActor";
import type { PilotFeedbackRole, PilotFeedbackRow } from "@/lib/pilotFeedback";
import { PILOT_FEEDBACK_VERSION } from "@/lib/pilotFeedback";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { localizedCloudErrorMessage } from "@/lib/cloudRecords";

type FormState = {
  overallExperience: number;
  clarity: number;
  safety: number;
  mostHelpful: string;
  hardToUse: string;
  suggestion: string;
  mayContact: boolean;
};

const emptyForm: FormState = {
  overallExperience: 0,
  clarity: 0,
  safety: 0,
  mostHelpful: "",
  hardToUse: "",
  suggestion: "",
  mayContact: false,
};

const roleLabelKeys: Record<PilotFeedbackRole, TranslationKey> = {
  student: "feedback.member.roles.student",
  guardian: "feedback.member.roles.guardian",
  teacher: "feedback.member.roles.teacher",
};

const ratingLabelKeys: TranslationKey[] = [
  "feedback.member.ratings.one",
  "feedback.member.ratings.two",
  "feedback.member.ratings.three",
  "feedback.member.ratings.four",
  "feedback.member.ratings.five",
];

function formFromFeedback(feedback: PilotFeedbackRow | null): FormState {
  if (!feedback) return emptyForm;
  return {
    overallExperience: feedback.overall_experience,
    clarity: feedback.clarity,
    safety: feedback.safety,
    mostHelpful: feedback.most_helpful,
    hardToUse: feedback.hard_to_use,
    suggestion: feedback.suggestion,
    mayContact: feedback.may_contact,
  };
}

function confirmsSubmission(body: unknown, submitted: FormState, role: PilotFeedbackRole | null): body is { feedback: PilotFeedbackRow } {
  if (!body || typeof body !== "object" || !("feedback" in body) || !body.feedback || typeof body.feedback !== "object") return false;
  const saved = body.feedback as Partial<PilotFeedbackRow>;
  return "role" in body && body.role === role && "version" in body && body.version === PILOT_FEEDBACK_VERSION
    && typeof saved.id === "string" && Boolean(saved.id) && saved.role === role && saved.form_version === PILOT_FEEDBACK_VERSION
    && saved.overall_experience === submitted.overallExperience && saved.clarity === submitted.clarity && saved.safety === submitted.safety
    && saved.most_helpful === submitted.mostHelpful.trim() && saved.hard_to_use === submitted.hardToUse.trim()
    && saved.suggestion === submitted.suggestion.trim() && saved.may_contact === submitted.mayContact;
}

function RatingQuestion({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="rounded-3xl border border-ink/10 bg-white p-4 sm:p-5">
      <legend className="px-1 text-base font-bold leading-7 text-ink">{label}</legend>
      <div className="mt-3 grid grid-cols-5 gap-2" aria-label={t("feedback.member.ratingAria", { label })}>
        {[1, 2, 3, 4, 5].map((rating) => (
          <label key={rating} className={`flex min-h-14 cursor-pointer flex-col items-center justify-center rounded-2xl border px-1 py-2 text-center transition ${value === rating ? "border-sage-dark bg-sage-dark text-white" : "border-ink/10 bg-paper text-ink hover:border-sage"}`}>
            <input className="sr-only" type="radio" name={label} value={rating} checked={value === rating} onChange={() => onChange(rating)} />
            <span className="text-lg font-extrabold">{rating}</span>
            <span className="mt-1 hidden text-[0.65rem] font-bold leading-4 sm:block">{t(ratingLabelKeys[rating - 1])}</span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted"><span>{t("feedback.member.ratingLow")}</span><span>{t("feedback.member.ratingHigh")}</span></div>
    </fieldset>
  );
}

export default function PilotFeedbackPage() {
  const actor = useSessionActor();
  // Account changes unmount the old form immediately, before a new read finishes.
  return <FeedbackWorkspace key={`${actor.phase}:${actor.actorId}`} actor={actor} />;
}

function FeedbackWorkspace({ actor }: { actor: SessionActor }) {
  const { locale, t } = useTranslation();
  const { actorId, phase, getToken, trackRequest } = actor;
  const copy = useRef({ locale, t });
  useEffect(() => { copy.current = { locale, t }; }, [locale, t]);
  const [role, setRole] = useState<PilotFeedbackRole | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [hasSaved, setHasSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const editRevision = useRef(0);
  const pendingSave = useRef<symbol | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const showVisitorCopy = phase === "signed_out";
  const reading = phase === "loading" || (phase === "ready" && loading);
  const displayError = phase === "error" ? t("feedback.member.errors.loadFailed") : error;

  useEffect(() => {
    let active = true;
    const current = trackRequest();
    const controller = new AbortController();
    if (phase !== "ready") return;
    async function load() {
      setLoading(true);
      try {
        const token = await getToken(actorId);
        if (!active || !current()) return;
        const response = await fetch("/api/pilot-feedback", {
          headers: { authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        const body = await response.json();
        if (!active || !current()) return;
        if (!response.ok) {
          setError(copy.current.t(response.status === 401 ? "feedback.member.errors.loadIdentityRequired"
            : response.status === 403 ? "feedback.member.errors.loadAccessDenied" : "feedback.member.errors.loadFailed"));
          return;
        }
        setRole(body.role as PilotFeedbackRole);
        setForm(formFromFeedback((body.feedback || null) as PilotFeedbackRow | null));
        setHasSaved(Boolean(body.feedback));
      } catch (loadError) {
        if (active && current()) setError(localizedCloudErrorMessage(loadError, copy.current.locale, copy.current.t("feedback.member.errors.loadFailed")));
      } finally {
        if (active && current()) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [actorId, phase, getToken, trackRequest]);

  useEffect(() => {
    setError("");
    setNotice("");
  }, [locale]);

  function editForm(changes: Partial<FormState>) {
    ++editRevision.current;
    setForm((current) => ({ ...current, ...changes }));
    setHasUnsavedChanges(true);
    setNotice("");
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingSave.current || phase !== "ready" || !actor.isSameActor(actorId)) return;
    const current = trackRequest();
    if (!form.overallExperience || !form.clarity || !form.safety) {
      setError(t("feedback.member.errors.allRatingsRequired"));
      return;
    }
    const submission = Symbol("feedback-save");
    pendingSave.current = submission;
    const submitted = { ...form };
    const submittedRevision = editRevision.current;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const token = await getToken(actorId);
      if (!current()) return;
      const response = await fetch("/api/pilot-feedback", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(submitted),
      });
      const body = await response.json();
      if (!current()) return;
      if (!response.ok) {
        setError(copy.current.t([400, 401, 403, 429].includes(response.status)
          ? "feedback.member.errors.saveFailed" : "feedback.member.errors.saveUnconfirmed"));
        return;
      }
      if (!confirmsSubmission(body, submitted, role)) throw new Error("feedback_save_unconfirmed");
      const unchanged = editRevision.current === submittedRevision;
      if (unchanged) {
        setForm(formFromFeedback(body.feedback));
        setHasUnsavedChanges(false);
      }
      setHasSaved(true);
      setNotice(copy.current.t(unchanged ? "feedback.member.notices.received" : "feedback.member.notices.receivedWithNewEdits"));
      if (unchanged) window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      if (!current()) return;
      setError(copy.current.t("feedback.member.errors.saveUnconfirmed"));
    } finally {
      if (pendingSave.current === submission) {
        pendingSave.current = null;
        if (current()) setSaving(false);
      }
    }
  }

  return (
    <>
      <PageHero
        label={showVisitorCopy ? t("feedback.visitor.hero.label") : t("feedback.member.hero.label")}
        title={showVisitorCopy ? t("feedback.visitor.hero.title") : t("feedback.member.hero.title")}
        subtitle={showVisitorCopy ? t("feedback.visitor.hero.description") : t("feedback.member.hero.description")}
        action={<Link href="/account" className="button-secondary">{showVisitorCopy ? t("feedback.visitor.hero.action") : t("feedback.member.hero.action")}</Link>}
      />

      <section className="section section-muted pt-8 sm:pt-12">
        <div className="container max-w-3xl">
          {notice ? <div className="mb-6 rounded-3xl border border-sage/30 bg-mint p-5" role="status"><p className="text-lg font-bold text-ink">{notice}</p><p className="mt-2 text-sm leading-7 text-muted">{t("feedback.member.notices.returnAnytime")}</p></div> : null}
          {displayError ? <p className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{displayError}</p> : null}

          {reading ? <div className="card text-sm font-bold text-muted">{t("feedback.visitor.loading")}</div> : null}
          {!reading && phase === "signed_out" ? (
            <div className="card text-center">
              <h2 className="text-xl font-bold text-ink">{t("feedback.visitor.title")}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{t("feedback.visitor.description")}</p>
              <Link href="/account?next=/feedback" className="button-primary mt-5">{t("feedback.visitor.action")}</Link>
            </div>
          ) : null}

          {!reading && phase === "ready" && role ? (
            <form className="grid gap-5" onSubmit={submitFeedback}>
              <div className="rounded-3xl border border-sage/20 bg-mint/50 p-5">
                <p className="text-sm font-bold text-sage-dark">{t("feedback.member.currentRole", { role: t(roleLabelKeys[role]) })}</p>
                <p className="mt-2 text-sm leading-7 text-muted">{t("feedback.member.privacy")}</p>
              </div>

              <RatingQuestion label={t("feedback.member.questions.overall")} value={form.overallExperience} onChange={(value) => editForm({ overallExperience: value })} />
              <RatingQuestion label={t("feedback.member.questions.clarity")} value={form.clarity} onChange={(value) => editForm({ clarity: value })} />
              <RatingQuestion label={t("feedback.member.questions.safety")} value={form.safety} onChange={(value) => editForm({ safety: value })} />

              <div className="card grid gap-5">
                <p className="rounded-2xl bg-cream px-4 py-3 text-sm leading-6 text-muted">{t("feedback.member.personalInfoReminder")}</p>
                {[
                  ["mostHelpful", t("feedback.member.textQuestions.mostHelpful.label"), t("feedback.member.textQuestions.mostHelpful.placeholder")],
                  ["hardToUse", t("feedback.member.textQuestions.hardToUse.label"), t("feedback.member.textQuestions.hardToUse.placeholder")],
                  ["suggestion", t("feedback.member.textQuestions.suggestion.label"), t("feedback.member.textQuestions.suggestion.placeholder")],
                ].map(([key, label, placeholder]) => (
                  <label key={key} className="grid gap-2 text-sm font-bold text-ink">
                    {label}
                    <textarea
                      className="field-control min-h-28 resize-y font-normal leading-7"
                      maxLength={1000}
                      value={form[key as keyof Pick<FormState, "mostHelpful" | "hardToUse" | "suggestion">] as string}
                      onChange={(event) => editForm({ [key]: event.target.value })}
                      placeholder={placeholder}
                    />
                  </label>
                ))}
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-ink/10 bg-paper p-4 text-sm leading-6 text-ink">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-sage-dark" checked={form.mayContact} onChange={(event) => editForm({ mayContact: event.target.checked })} />
                  <span><strong>{t("feedback.member.contactConsent.title")}</strong><span className="mt-1 block text-muted">{t("feedback.member.contactConsent.description")}</span></span>
                </label>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-6 text-muted">{hasUnsavedChanges ? t("feedback.member.unsavedChanges") : hasSaved ? t("feedback.member.savedHelp") : t("feedback.member.submitHelp")}</p>
                <button type="submit" className="button-primary w-full sm:w-auto" disabled={saving}>{saving ? t("feedback.member.saving") : hasSaved ? t("feedback.member.saveChanges") : t("feedback.member.submit")}</button>
              </div>
            </form>
          ) : null}
        </div>
      </section>
    </>
  );
}
