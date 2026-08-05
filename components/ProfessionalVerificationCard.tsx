import { FormEvent, useEffect, useState } from "react";
import {
  type ProfessionalVerificationStatus,
} from "@/lib/professionalVerification";
import { getSupabase } from "@/lib/supabaseClient";
import { useTranslation } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { localizedCloudErrorMessage } from "@/lib/cloudRecords";

type Verification = {
  status: ProfessionalVerificationStatus;
  institutionName: string | null;
  positionTitle: string | null;
  credentialType: string | null;
  credentialNumber: string | null;
  credentialIssuer: string | null;
  credentialExpiresOn: string | null;
  evidenceReference: string | null;
  applicantStatement: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  legacyConfirmed: boolean;
};

type FormState = {
  institutionName: string;
  positionTitle: string;
  credentialType: string;
  credentialNumber: string;
  credentialIssuer: string;
  credentialExpiresOn: string;
  evidenceReference: string;
  applicantStatement: string;
};

const emptyForm: FormState = {
  institutionName: "",
  positionTitle: "",
  credentialType: "",
  credentialNumber: "",
  credentialIssuer: "",
  credentialExpiresOn: "",
  evidenceReference: "",
  applicantStatement: "",
};

function formFromVerification(verification: Verification | null): FormState {
  if (!verification) return emptyForm;
  return {
    institutionName: verification.institutionName || "",
    positionTitle: verification.positionTitle || "",
    credentialType: verification.credentialType || "",
    credentialNumber: verification.credentialNumber || "",
    credentialIssuer: verification.credentialIssuer || "",
    credentialExpiresOn: verification.credentialExpiresOn || "",
    evidenceReference: verification.evidenceReference || "",
    applicantStatement: verification.applicantStatement || "",
  };
}

async function accessToken() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("账号服务暂时不可用，请稍后再试。");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error("请先登录，再提交专业身份资料。");
  return data.session.access_token;
}

function formatDate(value: string | null, locale: Locale) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

export function ProfessionalVerificationCard() {
  const { locale, t } = useTranslation();
  const [verification, setVerification] = useState<Verification | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const token = await accessToken();
      const response = await fetch("/api/professional-verification", {
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || t("account.professional.errors.loadFailed"));
      const nextVerification = payload.verification as Verification | null;
      setVerification(nextVerification);
      setForm(formFromVerification(nextVerification));
    } catch (loadError) {
      setError(localizedCloudErrorMessage(loadError, locale, t("account.professional.errors.loadFailed")));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    setNotice("");
    setError("");
  }, [locale]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const token = await accessToken();
      const response = await fetch("/api/professional-verification", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ ...form, credentialExpiresOn: form.credentialExpiresOn || null }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || t("account.professional.errors.submitFailed"));
      setNotice(t("account.professional.noticeSubmitted"));
      await load();
    } catch (submitError) {
      setError(localizedCloudErrorMessage(submitError, locale, t("account.professional.errors.submitFailed")));
    } finally {
      setSaving(false);
    }
  }

  const active = verification?.status === "active";
  const isLegacy = Boolean(verification?.legacyConfirmed);
  const statusLabel = verification ? t(`account.professional.status.${verification.status}` as TranslationKey) : "";

  return (
    <section className="section section-muted pt-8 sm:pt-10" aria-labelledby="professional-verification-title">
      <div className="container max-w-4xl">
        <div className="card">
          <p className="eyebrow">{t("account.professional.label")}</p>
          <h2 id="professional-verification-title" className="mt-2 text-[1.5rem] font-bold text-ink">
            {t("account.professional.title")}
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
            {t("account.professional.description")}
          </p>

          {loading ? <p className="mt-6 rounded-2xl bg-cream px-4 py-4 text-sm font-bold text-muted">{t("account.professional.loading")}</p> : null}
          {notice ? <p className="mt-5 rounded-2xl bg-mint px-4 py-3 text-sm font-bold text-sage-dark" aria-live="polite">{notice}</p> : null}
          {error ? <p className="mt-5 rounded-2xl border border-[#b8644d]/25 bg-[#f9eee9] px-4 py-3 text-sm font-bold text-[#8a4634]" role="alert">{error}</p> : null}

          {!loading && verification ? (
            <div className="mt-6 rounded-2xl border border-sage/20 bg-mint/35 px-5 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-bold text-ink">{statusLabel}</p>
                {verification.submittedAt ? <p className="text-xs text-muted">{t("account.professional.submittedAt", { date: formatDate(verification.submittedAt, locale) })}</p> : null}
              </div>
              {verification.reviewNote ? <p className="mt-3 text-sm leading-7 text-muted">{t("account.professional.reviewNote", { note: verification.reviewNote })}</p> : null}
              {active ? (
                <div className="mt-4 grid gap-2 text-sm text-muted sm:grid-cols-2">
                  <p>{t("account.professional.institution", { value: verification.institutionName || (isLegacy ? t("account.professional.legacyConfirmed") : "—") })}</p>
                  <p>{t("account.professional.position", { value: verification.positionTitle || (isLegacy ? t("account.professional.legacyConfirmed") : "—") })}</p>
                  <p>{t("account.professional.credential", { value: verification.credentialType || (isLegacy ? t("account.professional.legacyConfirmed") : "—") })}</p>
                  <p>{t("account.professional.expires", { value: verification.credentialExpiresOn ? formatDate(verification.credentialExpiresOn, locale) : t("account.professional.noExpiry") })}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {!loading && !active ? (
            <form className="mt-7 grid gap-4" onSubmit={submit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-bold text-ink">
                  {t("account.professional.fields.institution")}
                  <input className="field-control" value={form.institutionName} onChange={(event) => update("institutionName", event.target.value)} maxLength={120} placeholder={t("account.professional.fields.institutionPlaceholder")} required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  {t("account.professional.fields.position")}
                  <input className="field-control" value={form.positionTitle} onChange={(event) => update("positionTitle", event.target.value)} maxLength={80} placeholder={t("account.professional.fields.positionPlaceholder")} required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  {t("account.professional.fields.credentialType")}
                  <input className="field-control" value={form.credentialType} onChange={(event) => update("credentialType", event.target.value)} maxLength={80} placeholder={t("account.professional.fields.credentialPlaceholder")} required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  {t("account.professional.fields.credentialNumber")}
                  <input className="field-control" value={form.credentialNumber} onChange={(event) => update("credentialNumber", event.target.value)} maxLength={120} autoComplete="off" required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  {t("account.professional.fields.issuer")}
                  <input className="field-control" value={form.credentialIssuer} onChange={(event) => update("credentialIssuer", event.target.value)} maxLength={120} required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  {t("account.professional.fields.expiry")}
                  <input className="field-control" type="date" value={form.credentialExpiresOn} onChange={(event) => update("credentialExpiresOn", event.target.value)} />
                </label>
              </div>
              <label className="grid gap-2 text-sm font-bold text-ink">
                {t("account.professional.fields.evidence")}
                <textarea className="field-control min-h-28" value={form.evidenceReference} onChange={(event) => update("evidenceReference", event.target.value)} maxLength={500} placeholder={t("account.professional.fields.evidencePlaceholder")} required />
              </label>
              <label className="grid gap-2 text-sm font-bold text-ink">
                {t("account.professional.fields.additional")}
                <textarea className="field-control min-h-24" value={form.applicantStatement} onChange={(event) => update("applicantStatement", event.target.value)} maxLength={1000} />
              </label>
              <p className="text-xs leading-6 text-muted">{t("account.professional.disclaimer")}</p>
              <button className="button-primary w-full sm:w-fit" type="submit" disabled={saving}>
                {saving ? t("account.actions.submitting") : verification ? t("account.professional.resubmit") : t("account.professional.submit")}
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </section>
  );
}
