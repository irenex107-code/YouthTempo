import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { getSupabase } from "@/lib/supabaseClient";
import type { PilotFeedbackRole, PilotFeedbackRow } from "@/lib/pilotFeedback";
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
  const { locale, t } = useTranslation();
  const [accessToken, setAccessToken] = useState("");
  const [role, setRole] = useState<PilotFeedbackRole | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [hasSaved, setHasSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const showVisitorCopy = !loading && !accessToken;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const supabase = getSupabase();
        const { data, error: sessionError } = supabase ? await supabase.auth.getSession() : { data: { session: null }, error: null };
        if (sessionError) throw sessionError;
        const token = data.session?.access_token || "";
        setAccessToken(token);
        if (!token) return;
        const response = await fetch("/api/pilot-feedback", { headers: { authorization: `Bearer ${token}` } });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || t("feedback.member.errors.loadFailed"));
        setRole(body.role as PilotFeedbackRole);
        setForm(formFromFeedback((body.feedback || null) as PilotFeedbackRow | null));
        setHasSaved(Boolean(body.feedback));
      } catch (loadError) {
        setError(localizedCloudErrorMessage(loadError, locale, t("feedback.member.errors.loadFailed")));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  useEffect(() => {
    setError("");
    setNotice("");
  }, [locale]);

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.overallExperience || !form.clarity || !form.safety) {
      setError(t("feedback.member.errors.allRatingsRequired"));
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/pilot-feedback", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("feedback.member.errors.saveFailed"));
      setForm(formFromFeedback(body.feedback as PilotFeedbackRow));
      setHasSaved(true);
      setNotice(body.notice
        ? localizedCloudErrorMessage(new Error(body.notice), locale, t("feedback.member.notices.received"))
        : t("feedback.member.notices.received"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (saveError) {
      setError(localizedCloudErrorMessage(saveError, locale, t("feedback.member.errors.saveFailed")));
    } finally {
      setSaving(false);
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
          {error ? <p className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{error}</p> : null}

          {loading ? <div className="card text-sm font-bold text-muted">{t("feedback.visitor.loading")}</div> : null}
          {!loading && !accessToken ? (
            <div className="card text-center">
              <h2 className="text-xl font-bold text-ink">{t("feedback.visitor.title")}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{t("feedback.visitor.description")}</p>
              <Link href="/account?next=/feedback" className="button-primary mt-5">{t("feedback.visitor.action")}</Link>
            </div>
          ) : null}

          {!loading && accessToken && role ? (
            <form className="grid gap-5" onSubmit={submitFeedback}>
              <div className="rounded-3xl border border-sage/20 bg-mint/50 p-5">
                <p className="text-sm font-bold text-sage-dark">{t("feedback.member.currentRole", { role: t(roleLabelKeys[role]) })}</p>
                <p className="mt-2 text-sm leading-7 text-muted">{t("feedback.member.privacy")}</p>
              </div>

              <RatingQuestion label={t("feedback.member.questions.overall")} value={form.overallExperience} onChange={(value) => setForm((current) => ({ ...current, overallExperience: value }))} />
              <RatingQuestion label={t("feedback.member.questions.clarity")} value={form.clarity} onChange={(value) => setForm((current) => ({ ...current, clarity: value }))} />
              <RatingQuestion label={t("feedback.member.questions.safety")} value={form.safety} onChange={(value) => setForm((current) => ({ ...current, safety: value }))} />

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
                      onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                      placeholder={placeholder}
                    />
                  </label>
                ))}
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-ink/10 bg-paper p-4 text-sm leading-6 text-ink">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-sage-dark" checked={form.mayContact} onChange={(event) => setForm((current) => ({ ...current, mayContact: event.target.checked }))} />
                  <span><strong>{t("feedback.member.contactConsent.title")}</strong><span className="mt-1 block text-muted">{t("feedback.member.contactConsent.description")}</span></span>
                </label>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-6 text-muted">{hasSaved ? t("feedback.member.savedHelp") : t("feedback.member.submitHelp")}</p>
                <button type="submit" className="button-primary w-full sm:w-auto" disabled={saving}>{saving ? t("feedback.member.saving") : hasSaved ? t("feedback.member.saveChanges") : t("feedback.member.submit")}</button>
              </div>
            </form>
          ) : null}
        </div>
      </section>
    </>
  );
}
